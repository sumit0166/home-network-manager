import re
import sys
import base64
import hashlib
import getpass
import requests

ROUTER_URL = "http://192.168.0.1"

def md5_encrypt(val: str, ss: str) -> str:
    """Replicates $.md5.encrypt: hex_md5(ss + val + ss)"""
    payload = f"{ss}{val}{ss}".encode("utf-8")
    return hashlib.md5(payload).hexdigest()

def authenticate_and_get_token(password: str, base_url: str = ROUTER_URL, username: str = "user"):
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
        "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
        "DNT": "1",
        "Connection": "keep-alive"
    })

    # Step 0: Pre-flight
    print(f"[*] Step 0: Initializing session with {base_url}/...")
    session.get(f"{base_url}/", timeout=5)

    # Step 1: Get live dynamic salt 'ss'
    print(f"[*] Step 1: Requesting live salt from {base_url}/cgi/getParm...")
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
        print("[-] Could not retrieve 'ss' salt from getParm.")
        sys.exit(1)

    live_ss = ss_match.group(1)
    print(f"[+] Retrieved live session salt ss = '{live_ss}'")

    # Step 2: Compute dynamic hashes
    user_hash = md5_encrypt(username, live_ss)
    print(f"[*] Computed UserName hash: {user_hash}")

    # Prepare password candidates (Standard vs User-Restriction)
    b64_plain = base64.b64encode(password.encode("utf-8")).decode("utf-8")
    b64_restricted = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("utf-8")

    candidates = [
        ("Restricted (user:password)", md5_encrypt(b64_restricted, live_ss)),
        ("Standard (password only)", md5_encrypt(b64_plain, live_ss))
    ]

    for label, pass_hash in candidates:
        print(f"\n[*] Trying {label} -> Passwd: {pass_hash}...")
        login_url = f"{base_url}/cgi/login?UserName={user_hash}&Passwd={pass_hash}&Action=1&LoginStatus=0"
        req2 = requests.Request("POST", login_url, headers=post_headers, data=b"")
        prep2 = session.prepare_request(req2)
        prep2.headers.pop("Content-Type", None)
        
        resp2 = session.send(prep2, timeout=5)
        print(f"    Login response: {resp2.text.strip()}")
        print(f"    Session Cookie: {session.cookies.get_dict()}")

        # Step 3: Fetch Dashboard
        print(f"[*] Step 3: Requesting {base_url}/ with active session...")
        get_headers = {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Referer": f"{base_url}/",
            "Upgrade-Insecure-Requests": "1"
        }
        resp3 = session.get(f"{base_url}/", headers=get_headers, timeout=5)

        # Look for the authenticated token tag
        token_match = re.search(r'<script\s+type=["\']text/javascript["\']>\s*var\s+token\s*=\s*["\']([^"\']+)["\'];\s*</script>', resp3.text)
        if token_match:
            print("\n" + "=" * 60)
            print("[+] SUCCESS! AUTHENTICATION COMPLETE!")
            print(f"[+] Authenticated Script Tag:\n    {token_match.group(0)}")
            print(f"[+] Extracted Token: {token_match.group(1)}")
            print("=" * 60)
            return token_match.group(1)
        else:
            print("    [-] Not authenticated under this variant.")

    print("\n[-] Authentication failed: Check your plaintext password.")
    return None

if __name__ == "__main__":
    if len(sys.argv) > 1:
        pwd = sys.argv[1]
    else:
        pwd = getpass.getpass("Enter your router password: ")
    authenticate_and_get_token(pwd)