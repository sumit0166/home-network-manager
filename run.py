import argparse
import sys
import os
import uvicorn
import webbrowser
from threading import Timer

from backend.config import DEFAULT_WEB_PORT, DB_PATH
from backend.database import init_db, set_setting, get_setting

def main():
    parser = argparse.ArgumentParser(description="HomePulse — Personal Network Operations Center")
    parser.add_argument("--password", "-p", help="Router admin password", default=None)
    parser.add_argument("--port", type=int, default=DEFAULT_WEB_PORT, help="Web server port (default 8000)")
    parser.add_argument("--no-browser", action="store_true", help="Do not automatically launch browser")
    args = parser.parse_args()

    init_db()

    if args.password:
        set_setting("router_password", args.password)
        print("[+] Router password saved to local secure configuration.")
    else:
        existing_pwd = get_setting("router_password")
        if not existing_pwd:
            print("[!] Notice: No router password configured.")
            print("[!] You can configure the router password in the web dashboard under 'Settings'.\n")

    url = f"http://127.0.0.1:{args.port}"
    print("=" * 70)
    print("  HOMEPULSE — Personal Network Operations Center")
    print(f"  Web Dashboard running at: {url}")
    print(f"  Local SQLite Database:     {DB_PATH}")
    print("=" * 70)

    # if not args.no_browser:
    #     Timer(1.2, lambda: webbrowser.open(url)).start()

    uvicorn.run("backend.app:app", host="0.0.0.0", port=args.port, log_level="info")

if __name__ == "__main__":
    main()
