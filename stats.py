import base64
import getpass
import hashlib
import ipaddress
import re
import sys
import time
import requests

ROUTER_URL = "http://192.168.0.1"

# Exact 175-byte payload with \r\n line endings matching the PCAP
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

def md5_encrypt(val: str, ss: str) -> str:
    """Computes: hex_md5(ss + val + ss)"""
    payload = f"{ss}{val}{ss}".encode("utf-8")
    return hashlib.md5(payload).hexdigest()

def login_router(session: requests.Session, password: str, base_url: str = ROUTER_URL, username: str = "user"):
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
        "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
        "DNT": "1",
        "Connection": "keep-alive"
    })

    # Step 0: Pre-flight
    session.get(f"{base_url}/", timeout=5)

    # Step 1: Get dynamic salt 'ss'
    post_headers = {
        "Origin": base_url,
        "Referer": f"{base_url}/",
        "Accept": "*/*",
        "Content-Length": "0"
    }
    req1 = requests.Request("POST", f"{base_url}/cgi/getParm", headers=post_headers, data=b"")
    prep1 = session.prepare_request(req1)
    prep1.headers.pop("Content-Type", None)
    resp1 = session.send(prep1, timeout=5)

    ss_match = re.search(r'var\s+ss\s*=\s*["\']([^"\']+)["\'];', resp1.text)
    if not ss_match:
        print("[-] Could not retrieve dynamic 'ss' salt from getParm.")
        return None

    live_ss = ss_match.group(1)
    user_hash = md5_encrypt(username, live_ss)

    # Prepare password candidates (Standard vs User-Restricted)
    b64_plain = base64.b64encode(password.encode("utf-8")).decode("utf-8")
    b64_restricted = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("utf-8")

    candidates = [
        md5_encrypt(b64_restricted, live_ss),
        md5_encrypt(b64_plain, live_ss)
    ]

    for pass_hash in candidates:
        login_url = f"{base_url}/cgi/login?UserName={user_hash}&Passwd={pass_hash}&Action=1&LoginStatus=0"
        req2 = requests.Request("POST", login_url, headers=post_headers, data=b"")
        prep2 = session.prepare_request(req2)
        prep2.headers.pop("Content-Type", None)
        session.send(prep2, timeout=5)

        # Check authentication on dashboard
        dash = session.get(f"{base_url}/", headers={"Referer": f"{base_url}/"}, timeout=5)
        token_match = re.search(r'var\s+token\s*=\s*["\']([^"\']+)["\'];', dash.text)
        if token_match:
            return token_match.group(1)

    return None

def format_bytes(b: int) -> str:
    """Format bytes into readable KB/MB/GB."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if b < 1024.0:
            return f"{b:3.1f} {unit}"
        b /= 1024.0
    return f"{b:.1f} TB"

def parse_stat_response(raw_text: str):
    """Parses TP-Link custom bracket notation into structured dictionaries."""
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

            for col in ["totalPkts", "totalBytes", "currPkts", "currBytes", "currIcmp", "currUdp", "currSyn"]:
                entry[col] = int(entry.get(col, 0))

            entries.append(entry)

    return entries

def get_router_statistics(session: requests.Session, token: str, base_url: str = ROUTER_URL):
    url = f"{base_url}/cgi?1&5"
    headers = {
        "TokenID": token,  # <-- The required authentication header
        "Origin": base_url,
        "Referer": f"{base_url}/",
        "Content-Type": "text/plain",
        "Accept": "*/*"
    }

    resp = session.post(url, data=STAT_PAYLOAD, headers=headers, timeout=5)
    if resp.status_code != 200:
        print(f"[-] Failed to fetch statistics (Status: {resp.status_code})")
        return []

    return parse_stat_response(resp.text)

def print_stats_table(entries):
    print("\n" + "=" * 90)
    print(f"{'IP Address':<16} {'MAC Address':<18} {'Total Data':<12} {'Curr Speed':<12} {'Pkts (Tot/Cur)':<16} {'UDP/SYN/ICMP'}")
    print("-" * 90)

    for d in sorted(entries, key=lambda x: x["currBytes"], reverse=True):
        ip = d["ip"]
        mac = d.get("macAddress", "N/A")
        total_b = format_bytes(d["totalBytes"])
        curr_b = format_bytes(d["currBytes"])
        pkts = f"{d['totalPkts']}/{d['currPkts']}"
        proto = f"{d['currUdp']}/{d['currSyn']}/{d['currIcmp']}"
        print(f"{ip:<16} {mac:<18} {total_b:<12} {curr_b:<12} {pkts:<16} {proto}")
    print("=" * 90)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        pwd = sys.argv[1]
    else:
        pwd = getpass.getpass("Enter router password: ")

    session = requests.Session()
    print("[*] Logging in to router...")
    token = login_router(session, pwd)

    if not token:
        print("[-] Authentication failed. Please check your password.")
        sys.exit(1)

    print(f"[+] Successfully authenticated! (Token: {token})")
    print("[*] Starting live statistics monitor (Ctrl+C to stop)...\n")

    try:
        while True:
            stats = get_router_statistics(session, token)
            if stats:
                print_stats_table(stats)
            else:
                print("[-] No statistics received.")
            time.sleep(3)
    except KeyboardInterrupt:
        print("\n[*] Stopped monitoring.")