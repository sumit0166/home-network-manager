import threading
import time
from typing import Optional
from .config import DEFAULT_ROUTER_URL, DEFAULT_ROUTER_USER, DEFAULT_POLL_INTERVAL
from .database import (
    get_setting,
    upsert_device,
    mark_inactive_devices,
    record_traffic_snapshot,
    record_health
)
from .router_client import RouterClient
from .health_monitor import check_network_health

class NetworkCollector:
    def __init__(self):
        self.client: Optional[RouterClient] = None
        self.thread: Optional[threading.Thread] = None
        self.stop_event = threading.Event()
        self.is_running = False
        self.last_poll_time = 0
        self.poll_interval = DEFAULT_POLL_INTERVAL
        self.prev_traffic = {}
        self.status = {
            "router_connected": False,
            "internet_online": False,
            "last_error": None,
            "active_devices": 0,
            "total_devices": 0,
            "current_down_speed_bps": 0,
            "current_up_speed_bps": 0
        }

    def start(self):
        if self.is_running:
            return
        self.stop_event.clear()
        self.is_running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.is_running = False

    def _run_loop(self):
        router_url = get_setting("router_url", DEFAULT_ROUTER_URL)
        router_user = get_setting("router_user", DEFAULT_ROUTER_USER)
        self.client = RouterClient(base_url=router_url, username=router_user)

        last_health_time = 0

        while not self.stop_event.is_set():
            router_pass = get_setting("router_password", "")
            interval_setting = get_setting("poll_interval")
            if interval_setting:
                try:
                    self.poll_interval = max(3, int(interval_setting))
                except ValueError:
                    self.poll_interval = 5

            now = time.time()

            # 1. Health Probe (every 10 seconds)
            if now - last_health_time >= 10:
                gw_ip = router_url.replace("http://", "").replace("https://", "").split("/")[0].split(":")[0]
                health = check_network_health(gateway_ip=gw_ip)
                record_health(
                    is_online=health["is_online"],
                    internet_lat=health["internet_latency_ms"],
                    gateway_lat=health["gateway_latency_ms"],
                    packet_loss=health["packet_loss_pct"]
                )
                self.status["internet_online"] = health["is_online"]
                last_health_time = now

            # 2. Router Poll
            if not router_pass:
                self.status["router_connected"] = False
                self.status["last_error"] = "Router password not configured in Settings."
            else:
                # Ensure authenticated session
                if not self.client.is_connected or not self.client.token:
                    logged_in = self.client.login(router_pass)
                    if not logged_in:
                        self.status["router_connected"] = False
                        self.status["last_error"] = self.client.last_error
                        time.sleep(4)
                        continue

                # Query 2.1: LAN Hosts (/cgi?5)
                lan_hosts_map = {}
                ok_hosts, lan_hosts = self.client.fetch_lan_hosts()
                if ok_hosts and lan_hosts:
                    for h in lan_hosts:
                        mac = h["mac"]
                        lan_hosts_map[mac] = h

                # Query 2.2: Live Traffic Statistics (/cgi?1&5)
                ok_stats, entries = self.client.fetch_statistics()
                stats_map = {}
                if ok_stats and entries:
                    for item in entries:
                        mac = item.get("macAddress", "").replace("-", ":").upper()
                        if mac:
                            stats_map[mac] = item

                if not ok_stats and not ok_hosts:
                    self.client.token = None
                    self.status["router_connected"] = False
                    self.status["last_error"] = self.client.last_error
                else:
                    self.status["router_connected"] = True
                    self.status["last_error"] = None
                    self.last_poll_time = int(now)

                    # Union of all known MACs
                    all_macs = set(lan_hosts_map.keys()).union(set(stats_map.keys()))
                    active_macs = []
                    total_curr_bytes = 0

                    for mac in all_macs:
                        lan_info = lan_hosts_map.get(mac, {})
                        stat_info = stats_map.get(mac, {})

                        ip = stat_info.get("ip") or lan_info.get("ip") or ""
                        hostname = lan_info.get("hostname") or ""
                        interface = lan_info.get("interface") or ""

                        raw_curr_pkts = stat_info.get("currPkts", 0)
                        raw_curr_bytes = stat_info.get("currBytes", 0)
                        raw_total_bytes = stat_info.get("totalBytes", 0)
                        router_active_flag = lan_info.get("active", None)

                        # Track byte delta between polling cycles
                        prev_total, prev_time = self.prev_traffic.get(mac, (raw_total_bytes, now))
                        delta_bytes = max(0, raw_total_bytes - prev_total) if mac in self.prev_traffic else 0
                        self.prev_traffic[mac] = (raw_total_bytes, now)

                        # Determine if device is truly active on the network:
                        # 1. Router explicitly reports active=0 in DHCP/WLAN host table -> INACTIVE
                        if router_active_flag is False:
                            is_device_active = False
                            effective_curr_bytes = 0
                            effective_curr_pkts = 0
                        # 2. Router explicitly reports active=1 in host table -> ACTIVE
                        elif router_active_flag is True:
                            is_device_active = True
                            # If total bytes didn't move, live rate is 0 B/s (stale router stats discarded)
                            effective_curr_bytes = delta_bytes if delta_bytes > 0 else (raw_curr_bytes if raw_curr_bytes < 50000 else 0)
                            effective_curr_pkts = raw_curr_pkts if (delta_bytes > 0 or raw_curr_bytes > 0) else 0
                        # 3. Router host entry missing, but total_bytes is actively increasing -> ACTIVE
                        elif delta_bytes > 0:
                            is_device_active = True
                            effective_curr_bytes = delta_bytes
                            effective_curr_pkts = raw_curr_pkts
                        # 4. Otherwise (no traffic change and not flagged active) -> INACTIVE
                        else:
                            is_device_active = False
                            effective_curr_bytes = 0
                            effective_curr_pkts = 0

                        if is_device_active:
                            active_macs.append(mac)
                            total_curr_bytes += effective_curr_bytes

                        # Register or update device with accurate active flag
                        upsert_device(
                            mac=mac,
                            ip=ip,
                            hostname=hostname,
                            interface=interface,
                            is_active=is_device_active
                        )

                        # Record traffic snapshot if stat entry was present
                        if stat_info:
                            record_traffic_snapshot(
                                mac=mac,
                                total_bytes=raw_total_bytes,
                                total_pkts=stat_info.get("totalPkts", 0),
                                curr_bytes=effective_curr_bytes,
                                curr_pkts=effective_curr_pkts,
                                curr_icmp=stat_info.get("currIcmp", 0) if is_device_active else 0,
                                curr_udp=stat_info.get("currUdp", 0) if is_device_active else 0,
                                curr_syn=stat_info.get("currSyn", 0) if is_device_active else 0
                            )

                    # Mark all devices not in active_macs as inactive
                    mark_inactive_devices(active_macs)
                    self.status["active_devices"] = len(active_macs)
                    self.status["current_down_speed_bps"] = total_curr_bytes

            time.sleep(self.poll_interval)

collector_instance = NetworkCollector()
