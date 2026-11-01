import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = os.path.join(BASE_DIR, "network_monitor.db")
STATIC_DIR = os.path.join(BASE_DIR, "frontend")

DEFAULT_ROUTER_URL = "http://192.168.0.1"
DEFAULT_ROUTER_USER = "user"
DEFAULT_POLL_INTERVAL = 5  # seconds
DEFAULT_WEB_PORT = 8000
