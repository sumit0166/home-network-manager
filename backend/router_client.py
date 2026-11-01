import base64
import hashlib
import ipaddress
import re
import requests
from typing import Optional, List, Dict, Tuple
from .config import DEFAULT_ROUTER_URL, DEFAULT_ROUTER_USER

STAT_PAYLOAD = (
    "[STAT_CFG#0,0,0,0,0,0#0,0,0,0,0,0]0,0\r\n"
    "[STAT_ENTRY#0,0,0,0,0,0#0,0,0,0,0,0]1,9\r\n"
    "IpAddress\r\n"
    "MacAddress\r\n"
    "TotalPkts\r\n"
    "TotalBytes\r\n"
    "CurrPkts\r\n"
    "CurrBytes\r\n"
    "CurrIcmp\r\n"
    "CurrUdp\r\n"
    "CurrSyn\r\n"
)

LAN_HOST_PAYLOAD = "[LAN_HOST_ENTRY#0,0,0,0,0,0#0,0,0,0,0,0]0,0\r\n"
WAN_STATUS_PAYLOAD = (
    "[WAN_PPP_CONN#1,1,1,0,0,0#0,0,0,0,0,0]0,0\r\n"
    "[WAN_IP_CONN#1,1,1,0,0,0#0,0,0,0,0,0]0,0\r\n"
)
REBOOT_PAYLOAD = "[ACT_REBOOT#0,0,0,0,0,0#0,0,0,0,0,0]0,0\r\n"

def md5_encrypt(val: str, ss: str) -> str:
    """Computes: hex_md5(ss + val + ss)"""
    payload = f"{ss}{val}{ss}".encode("utf-8")
    return hashlib.md5(payload).hexdigest()

class RouterClient:
    def __init__(self, base_url: str = DEFAULT_ROUTER_URL, username: str = DEFAULT_ROUTER_USER):
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
            "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
            "DNT": "1",
            "Connection": "keep-alive"
        })
        self.token: Optional[str] = None
        self.is_connected = False
        self.last_error: Optional[str] = None

    def login(self, password: str) -> bool:
        """Performs full handshake and retrieves the token."""
        try:
            # Purge any stale session cookies or broken sockets before initiating fresh handshake
            if hasattr(self, 'session') and self.session:
                try:
                    self.session.cookies.clear()
                    self.session.close()
                except Exception:
                    pass
            self.session = requests.Session()
            self.session.headers.update({
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
                "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
                "DNT": "1",
                "Connection": "keep-alive"
            })

            # Step 0: Pre-flight
            self.session.get(f"{self.base_url}/", timeout=4)

            # Step 1: Request live salt 'ss'
            post_headers = {
                "Origin": self.base_url,
                "Referer": f"{self.base_url}/",
                "Accept": "*/*",
                "Content-Length": "0"
            }
            req1 = requests.Request("POST", f"{self.base_url}/cgi/getParm", headers=post_headers, data=b"")
            prep1 = self.session.prepare_request(req1)
            prep1.headers.pop("Content-Type", None)
            resp1 = self.session.send(prep1, timeout=5)

            ss_match = re.search(r'var\s+ss\s*=\s*["\']([^"\']+)["\'];', resp1.text)
            if not ss_match:
                self.last_error = "Could not extract session salt (ss) from router."
                self.is_connected = False
                return False

            live_ss = ss_match.group(1)
            user_hash = md5_encrypt(self.username, live_ss)

            # Both variants: user-restricted (user:pwd) and standard (pwd)
            b64_restricted = base64.b64encode(f"{self.username}:{password}".encode("utf-8")).decode("utf-8")
            b64_plain = base64.b64encode(password.encode("utf-8")).decode("utf-8")

            candidates = [
                md5_encrypt(b64_restricted, live_ss),
                md5_encrypt(b64_plain, live_ss)
            ]

            for pass_hash in candidates:
                login_url = f"{self.base_url}/cgi/login?UserName={user_hash}&Passwd={pass_hash}&Action=1&LoginStatus=0"
                req2 = requests.Request("POST", login_url, headers=post_headers, data=b"")
                prep2 = self.session.prepare_request(req2)
                prep2.headers.pop("Content-Type", None)
                self.session.send(prep2, timeout=5)

                # Verify authenticated dashboard
                dash = self.session.get(f"{self.base_url}/", headers={"Referer": f"{self.base_url}/"}, timeout=5)
                token_match = re.search(r'var\s+token\s*=\s*["\']([^"\']+)["\'];', dash.text)
                if token_match:
                    self.token = token_match.group(1)
                    self.is_connected = True
                    self.last_error = None
                    return True

            self.last_error = "Invalid password or authentication rejected by router."
            self.is_connected = False
            return False

        except Exception as e:
            self.last_error = f"Router connection failed: {str(e)}"
            self.is_connected = False
            return False

    def fetch_lan_hosts(self) -> Tuple[bool, List[Dict]]:
        """Queries /cgi?5 for DHCP and LAN/WLAN connected host information (names, IPs, MACs)."""
        if not self.token:
            return False, []

        url = f"{self.base_url}/cgi?5"
        headers = {
            "TokenID": self.token,
            "Origin": self.base_url,
            "Referer": f"{self.base_url}/",
            "Content-Type": "text/plain",
            "Accept": "*/*"
        }

        try:
            resp = self.session.post(url, data=LAN_HOST_PAYLOAD, headers=headers, timeout=5)
            if resp.status_code != 200:
                return False, []

            entries = self._parse_lan_hosts(resp.text)
            return True, entries
        except Exception as e:
            return False, []

    def _parse_lan_hosts(self, raw_text: str) -> List[Dict]:
        entries = []
        blocks = re.split(r'\[\d+,\d+,\d+,\d+,\d+,\d+\]\d+', raw_text)
        for block in blocks:
            if "MACAddress=" not in block and "macAddress=" not in block:
                continue
            entry = {}
            for line in block.strip().splitlines():
                if "=" in line:
                    k, v = line.strip().split("=", 1)
                    entry[k.strip()] = v.strip()

            mac = entry.get("MACAddress") or entry.get("macAddress")
            ip = entry.get("IPAddress") or entry.get("ipAddress")
            hostname = entry.get("hostName") or entry.get("hostname") or ""
            conn_intf = entry.get("X_TP_ConnIntf") or ""
            active_val = entry.get("active", "0")

            if mac and ip:
                mac_norm = mac.replace("-", ":").upper()
                entries.append({
                    "mac": mac_norm,
                    "ip": ip,
                    "hostname": hostname,
                    "interface": conn_intf,
                    "active": active_val == "1"
                })
        return entries

    def fetch_statistics(self) -> Tuple[bool, List[Dict]]:
        """Queries /cgi?1&5 using the active session and TokenID."""
        if not self.token:
            return False, []

        url = f"{self.base_url}/cgi?1&5"
        headers = {
            "TokenID": self.token,
            "Origin": self.base_url,
            "Referer": f"{self.base_url}/",
            "Content-Type": "text/plain",
            "Accept": "*/*"
        }

        try:
            resp = self.session.post(url, data=STAT_PAYLOAD, headers=headers, timeout=5)
            if resp.status_code != 200:
                self.last_error = f"Statistics request failed with HTTP {resp.status_code}"
                self.is_connected = False
                return False, []

            entries = self._parse_statistics(resp.text)
            self.is_connected = True
            return True, entries

        except Exception as e:
            self.last_error = f"Error fetching router statistics: {str(e)}"
            self.is_connected = False
            return False, []

    def _parse_statistics(self, raw_text: str) -> List[Dict]:
        entries = []
        blocks = re.split(r'\[\d+,\d+,\d+,\d+,\d+,\d+\]\d+', raw_text)

        for block in blocks:
            if "ipAddress=" not in block:
                continue
            entry = {}
            for line in block.strip().splitlines():
                if "=" in line:
                    k, v = line.strip().split("=", 1)
                    entry[k] = v

            if "ipAddress" in entry:
                try:
                    entry["ip"] = str(ipaddress.IPv4Address(int(entry["ipAddress"])))
                except ValueError:
                    entry["ip"] = entry["ipAddress"]

                if "macAddress" in entry:
                    entry["macAddress"] = entry["macAddress"].replace("-", ":").upper()

                for col in ["totalPkts", "totalBytes", "currPkts", "currBytes", "currIcmp", "currUdp", "currSyn"]:
                    entry[col] = int(entry.get(col, 0))

                entries.append(entry)

        return entries

    def fetch_wan_status(self) -> Tuple[bool, Dict]:
        """Queries /cgi?1 using active session to retrieve external WAN IP, Gateway, DNS, connection type."""
        if not self.token:
            return False, {}

        url = f"{self.base_url}/cgi?1"
        headers = {
            "TokenID": self.token,
            "Origin": self.base_url,
            "Referer": f"{self.base_url}/",
            "Content-Type": "text/plain",
            "Accept": "*/*"
        }

        try:
            resp = self.session.post(url, data=WAN_STATUS_PAYLOAD, headers=headers, timeout=5)
            if resp.status_code != 200:
                # Try PPPoE payload individually if multi-payload didn't return 200
                resp = self.session.post(url, data="[WAN_PPP_CONN#1,1,1,0,0,0#0,0,0,0,0,0]0,0\r\n", headers=headers, timeout=5)
                if resp.status_code != 200:
                    return False, {}

            wan_data = self._parse_wan_status(resp.text)
            return True, wan_data
        except Exception as e:
            return False, {}

    def _parse_wan_status(self, raw_text: str) -> Dict:
        """Parses WAN_PPP_CONN or WAN_IP_CONN key-value response."""
        data = {}
        # Parse blocks in case both PPP and IP blocks returned
        blocks = re.split(r'\[\d+,\d+,\d+,\d+,\d+,\d+\]\d+', raw_text)
        
        candidates = []
        for block in blocks:
            if not block.strip():
                continue
            entry = {}
            for line in block.strip().splitlines():
                if "=" in line:
                    k, v = line.strip().split("=", 1)
                    entry[k.strip()] = v.strip()
            if entry.get("externalIPAddress") or entry.get("connectionStatus"):
                candidates.append(entry)

        # Select candidate with valid external IP or first candidate
        chosen = {}
        for c in candidates:
            ip = c.get("externalIPAddress", "")
            if ip and ip != "0.0.0.0":
                chosen = c
                break
        if not chosen and candidates:
            chosen = candidates[0]

        ext_ip = chosen.get("externalIPAddress", "")
        gw_ip = chosen.get("defaultGateway", "") or chosen.get("remoteIPAddress", "")
        dns_raw = chosen.get("DNSServers", "")
        dns_list = [d.strip() for d in dns_raw.split(",") if d.strip() and d.strip() != "0.0.0.0"]
        conn_status = chosen.get("connectionStatus", "Connected" if ext_ip and ext_ip != "0.0.0.0" else "Disconnected")
        transport = chosen.get("transportType", "") or chosen.get("connectionType", "PPPoE")
        mac = chosen.get("MACAddress", "")
        if mac:
            mac = mac.replace("-", ":").upper()

        try:
            uptime_sec = int(chosen.get("uptime", 0))
        except (ValueError, TypeError):
            uptime_sec = 0

        return {
            "external_ip": ext_ip if ext_ip and ext_ip != "0.0.0.0" else "Unavailable",
            "gateway_ip": gw_ip if gw_ip and gw_ip != "0.0.0.0" else "Unavailable",
            "dns_servers": dns_list,
            "dns_servers_str": ", ".join(dns_list) if dns_list else "Not Available",
            "connection_status": conn_status,
            "connection_type": chosen.get("connectionType", "IP_Routed"),
            "transport_type": transport,
            "mac_address": mac,
            "uptime_seconds": uptime_sec,
            "interface_name": chosen.get("name", "") or chosen.get("X_TP_IfName", "ppp0"),
            "username": chosen.get("username", "")
        }

    def reboot(self) -> Tuple[bool, str]:
        """Sends hardware reboot command to router: POST /cgi?7 with [ACT_REBOOT#0,0,0,0,0,0#0,0,0,0,0,0]0,0."""
        if not self.token:
            return False, "Router client is not authenticated (TokenID missing)."

        url = f"{self.base_url}/cgi?7"
        headers = {
            "TokenID": self.token,
            "Origin": self.base_url,
            "Referer": f"{self.base_url}/",
            "Content-Type": "text/plain",
            "Accept": "*/*"
        }

        try:
            resp = self.session.post(url, data=REBOOT_PAYLOAD, headers=headers, timeout=6)
            self.token = None
            self.is_connected = False
            try:
                self.session.cookies.clear()
                self.session.close()
            except Exception:
                pass
            if resp.status_code == 200:
                return True, "Reboot command received successfully. Router is restarting."
            return False, f"Router returned HTTP {resp.status_code}"
        except (requests.ConnectionError, requests.Timeout):
            # When the router reboots immediately, closing socket/resetting connection is normal
            self.token = None
            self.is_connected = False
            try:
                self.session.cookies.clear()
                self.session.close()
            except Exception:
                pass
            return True, "Reboot command sent (connection terminated as router restarts)."
        except Exception as e:
            return False, f"Reboot request failed: {str(e)}"
