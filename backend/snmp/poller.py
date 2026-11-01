import asyncio
import threading
import time
from datetime import datetime
from typing import Dict, Any, List, Optional
from collections import deque

from ..database import get_setting, get_connection, log_event
from .client import SnmpClient

MAX_COUNTER = 2**32

def calculate_delta(previous: int, current: int) -> Optional[int]:
    if current >= previous:
        return current - previous
    # 32-bit counter rollover
    if previous > 0xF0000000 and current < 0x0FFFFFFF:
        return (MAX_COUNTER - previous) + current
    # Counter reset or counter jump
    return None

def format_rate_human(mbps: float) -> str:
    if mbps < 1.0:
        kbps = mbps * 1000.0
        return f"{kbps:.1f} Kbps"
    return f"{mbps:.2f} Mbps"

def format_uptime(secs: int) -> str:
    d = secs // 86400
    h = (secs % 86400) // 3600
    m = (secs % 3600) // 60
    s = secs % 60
    if d > 0:
        return f"{d}d {h}h {m}m"
    if h > 0:
        return f"{h}h {m}m {s}s"
    return f"{m}m {s}s"

class SnmpPoller:
    def __init__(self):
        self.thread: Optional[threading.Thread] = None
        self.stop_event = threading.Event()
        self.is_running = False
        self.poll_interval = 2.5
        self.client: Optional[SnmpClient] = None
        
        # In-memory recent samples (last 60 data points for live streaming)
        self.recent_points = deque(maxlen=60)
        self.cached_interfaces: List[Dict[str, Any]] = []
        self.cached_system: Dict[str, Any] = {}
        
        self.status: Dict[str, Any] = {
            "is_connected": False,
            "download_mbps": 0.0,
            "upload_mbps": 0.0,
            "download_human": "0.0 Kbps",
            "upload_human": "0.0 Kbps",
            "sys_uptime_seconds": 0,
            "sys_uptime_human": "--",
            "last_poll_time": 0,
            "last_error": None
        }

    def start(self):
        if self.is_running:
            return
        self.stop_event.clear()
        self.is_running = True
        self.thread = threading.Thread(target=self._thread_entry, daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.is_running = False

    def _thread_entry(self):
        asyncio.run(self._run_async_loop())

    async def _run_async_loop(self):
        previous = None
        previous_time = None
        last_db_save = 0
        last_if_scan = 0

        while not self.stop_event.is_set():
            # Check if SNMP is enabled in settings
            snmp_enabled = get_setting("snmp_enabled", "1") != "0"
            if not snmp_enabled:
                self.status["is_connected"] = False
                await asyncio.sleep(4)
                continue

            host = get_setting("router_url", "http://192.168.0.1").replace("http://", "").replace("https://", "").split("/")[0].split(":")[0]
            community = get_setting("snmp_community", "sumitsakpal0183")
            port = int(get_setting("snmp_port", "161"))

            if not self.client or self.client.host != host or self.client.community != community:
                self.client = SnmpClient(host=host, port=port, community=community)

            loop_start = time.monotonic()
            wall_now = int(time.time())

            try:
                # 1. Fetch WAN counters (ppp0 index 4)
                current = await self.client.get_wan_counters()

                if current is None:
                    self.status["is_connected"] = False
                    self.status["last_error"] = "SNMP probe timed out or router is rebooting."
                    self.status["download_mbps"] = 0.0
                    self.status["upload_mbps"] = 0.0
                    self.status["download_human"] = "0.0 Kbps"
                    self.status["upload_human"] = "0.0 Kbps"
                    previous = None
                    await asyncio.sleep(2.5)
                    continue

                self.status["is_connected"] = True
                self.status["last_error"] = None
                self.status["last_poll_time"] = wall_now

                uptime_ticks = current["sys_uptime"]
                uptime_sec = uptime_ticks // 100
                self.status["sys_uptime_seconds"] = uptime_sec
                self.status["sys_uptime_human"] = format_uptime(uptime_sec)

                # 2. Compute live Bandwidth deltas
                if previous is not None and previous_time is not None:
                    elapsed = loop_start - previous_time

                    # Check for router reboot through sys_uptime reset
                    if current["sys_uptime"] < previous["sys_uptime"]:
                        log_event("ROUTER_REBOOT_SNMP", "Router Hardware Reboot Detected", f"Router uptime reset via SNMP (now {uptime_sec}s).")
                        delta_in = None
                        delta_out = None
                    else:
                        delta_in = calculate_delta(previous["in_octets"], current["in_octets"])
                        delta_out = calculate_delta(previous["out_octets"], current["out_octets"])

                    if delta_in is not None and delta_out is not None and elapsed > 0:
                        dl_mbps = round((delta_in * 8 / elapsed) / 1_000_000, 3)
                        ul_mbps = round((delta_out * 8 / elapsed) / 1_000_000, 3)

                        self.status["download_mbps"] = dl_mbps
                        self.status["upload_mbps"] = ul_mbps
                        self.status["download_human"] = format_rate_human(dl_mbps)
                        self.status["upload_human"] = format_rate_human(ul_mbps)

                        point = {
                            "time": wall_now,
                            "dl": dl_mbps,
                            "ul": ul_mbps
                        }
                        self.recent_points.append(point)

                        # Save snapshot to SQLite every 5 seconds
                        if wall_now - last_db_save >= 5:
                            last_db_save = wall_now
                            try:
                                conn = get_connection()
                                conn.execute("""
                                    INSERT INTO snmp_wan_traffic (
                                        timestamp, elapsed, download_bytes, upload_bytes,
                                        download_mbps, upload_mbps, in_octets, out_octets, sys_uptime
                                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                                """, (
                                    wall_now, round(elapsed, 2), delta_in, delta_out,
                                    dl_mbps, ul_mbps, current["in_octets"], current["out_octets"], uptime_sec
                                ))
                                conn.commit()
                                conn.close()
                            except Exception:
                                pass

                previous = current
                previous_time = loop_start

                # 3. Periodically scan interface matrix & system metadata (every 30s)
                if wall_now - last_if_scan >= 30:
                    last_if_scan = wall_now
                    try:
                        self.cached_system = await self.client.get_system_info()
                        self.cached_interfaces = await self.client.get_interfaces_table()
                    except Exception:
                        pass

            except Exception as e:
                self.status["is_connected"] = False
                self.status["last_error"] = str(e)
                previous = None

            # Accurate pacing
            elapsed_loop = time.monotonic() - loop_start
            sleep_time = max(0.5, self.poll_interval - elapsed_loop)
            await asyncio.sleep(sleep_time)

snmp_poller_instance = SnmpPoller()
