import sqlite3
import time
from typing import List, Dict, Optional, Any
from .config import DB_PATH
from .oui import lookup_vendor, guess_category_from_hostname

def get_connection():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.executescript("""
    CREATE TABLE IF NOT EXISTS devices (
        mac TEXT PRIMARY KEY,
        ip TEXT,
        custom_name TEXT,
        category TEXT DEFAULT 'unknown',
        vendor TEXT,
        first_seen INTEGER,
        last_seen INTEGER,
        is_active INTEGER DEFAULT 1,
        notes TEXT,
        hostname TEXT,
        interface TEXT
    );

    CREATE TABLE IF NOT EXISTS traffic_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_mac TEXT,
        timestamp INTEGER,
        total_bytes INTEGER,
        total_pkts INTEGER,
        curr_bytes INTEGER,
        curr_pkts INTEGER,
        curr_icmp INTEGER,
        curr_udp INTEGER,
        curr_syn INTEGER,
        FOREIGN KEY (device_mac) REFERENCES devices(mac)
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_mac_time ON traffic_snapshots(device_mac, timestamp);
    CREATE INDEX IF NOT EXISTS idx_snapshots_time ON traffic_snapshots(timestamp);

    CREATE TABLE IF NOT EXISTS network_health (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER,
        is_online INTEGER,
        internet_latency_ms REAL,
        gateway_latency_ms REAL,
        packet_loss_pct REAL
    );

    CREATE INDEX IF NOT EXISTS idx_health_time ON network_health(timestamp);

    CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER,
        event_type TEXT,
        device_mac TEXT,
        title TEXT,
        description TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_events_time ON events(timestamp);

    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    );
    """)
    
    # Migrations for existing tables
    cursor.execute("PRAGMA table_info(devices);")
    cols = [r[1] for r in cursor.fetchall()]
    if "hostname" not in cols:
        cursor.execute("ALTER TABLE devices ADD COLUMN hostname TEXT;")
    if "interface" not in cols:
        cursor.execute("ALTER TABLE devices ADD COLUMN interface TEXT;")

    cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('isp_name', 'Local ISP');")

    conn.commit()
    conn.close()

def get_setting(key: str, default: Optional[str] = None) -> Optional[str]:
    conn = get_connection()
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else default

def set_setting(key: str, value: str):
    conn = get_connection()
    conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))
    conn.commit()
    conn.close()

def log_event(event_type: str, title: str, description: str, device_mac: Optional[str] = None):
    conn = get_connection()
    conn.execute(
        "INSERT INTO events (timestamp, event_type, device_mac, title, description) VALUES (?, ?, ?, ?, ?)",
        (int(time.time()), event_type, device_mac, title, description)
    )
    conn.commit()
    conn.close()

def upsert_device(mac: str, ip: str, hostname: Optional[str] = None, interface: Optional[str] = None, is_active: bool = True) -> Dict[str, Any]:
    now = int(time.time())
    mac_norm = mac.replace("-", ":").upper()
    conn = get_connection()
    row = conn.execute("SELECT * FROM devices WHERE mac = ?", (mac_norm,)).fetchone()
    
    vendor_fallback, cat_fallback = lookup_vendor(mac_norm)
    guessed_cat = guess_category_from_hostname(hostname) if hostname else cat_fallback
    
    is_new = False
    
    if not row:
        chosen_name = hostname if hostname else f"{vendor_fallback} ({ip.split('.')[-1]})"
        conn.execute("""
            INSERT INTO devices (mac, ip, custom_name, category, vendor, first_seen, last_seen, is_active, hostname, interface)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (mac_norm, ip, chosen_name, guessed_cat, vendor_fallback, now, now, 1 if is_active else 0, hostname or "", interface or ""))
        is_new = True
    else:
        old_ip = row["ip"]
        was_active = bool(row["is_active"])
        current_name = row["custom_name"]
        
        # Upgrade name to real hostname if not customized
        new_name = current_name
        if hostname and (not row["hostname"] or current_name.startswith(row["vendor"] or "Unknown") or current_name.endswith(f"({old_ip.split('.')[-1]})")):
            new_name = hostname
            
        new_cat = row["category"]
        if new_cat == "unknown" and guessed_cat != "unknown":
            new_cat = guessed_cat

        if old_ip != ip:
            log_event("IP_CHANGED", f"IP Changed for {new_name}", f"Changed from {old_ip} to {ip}", mac_norm)
            
        if not was_active and is_active:
            log_event("DEVICE_CONNECTED", "Device Reconnected", f"{new_name} ({ip}) came online", mac_norm)
        elif was_active and not is_active:
            log_event("DEVICE_DISCONNECTED", "Device Offline", f"{new_name} ({ip}) went offline", mac_norm)

        # Update last_seen ONLY if device is active right now
        last_seen = now if is_active else row["last_seen"]

        conn.execute("""
            UPDATE devices 
            SET ip = ?, last_seen = ?, is_active = ?, custom_name = ?, category = ?, hostname = COALESCE(?, hostname), interface = COALESCE(?, interface)
            WHERE mac = ?
        """, (ip, last_seen, 1 if is_active else 0, new_name, new_cat, hostname, interface, mac_norm))
        
    conn.commit()
    updated = conn.execute("SELECT * FROM devices WHERE mac = ?", (mac_norm,)).fetchone()
    conn.close()
    
    if is_new:
        log_event("DEVICE_DISCOVERED", f"New Device: {updated['custom_name']}", f"Discovered at IP {ip} ({mac_norm})", mac_norm)
        
    return dict(updated)

def mark_inactive_devices(active_macs: List[str]):
    now = int(time.time())
    active_macs_norm = [m.replace("-", ":").upper() for m in active_macs]
    conn = get_connection()
    placeholders = ",".join("?" for _ in active_macs_norm)
    query = f"SELECT * FROM devices WHERE is_active = 1 AND mac NOT IN ({placeholders})" if active_macs_norm else "SELECT * FROM devices WHERE is_active = 1"
    inactive = conn.execute(query, active_macs_norm if active_macs_norm else ()).fetchall()
    
    for dev in inactive:
        conn.execute("UPDATE devices SET is_active = 0 WHERE mac = ?", (dev["mac"],))
        log_event("DEVICE_DISCONNECTED", "Device Offline", f"{dev['custom_name']} ({dev['ip']}) went offline", dev["mac"])
            
    conn.commit()
    conn.close()

def record_traffic_snapshot(mac: str, total_bytes: int, total_pkts: int, curr_bytes: int, curr_pkts: int, curr_icmp: int, curr_udp: int, curr_syn: int):
    now = int(time.time())
    mac_norm = mac.replace("-", ":").upper()
    conn = get_connection()
    conn.execute("""
        INSERT INTO traffic_snapshots (device_mac, timestamp, total_bytes, total_pkts, curr_bytes, curr_pkts, curr_icmp, curr_udp, curr_syn)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (mac_norm, now, total_bytes, total_pkts, curr_bytes, curr_pkts, curr_icmp, curr_udp, curr_syn))
    conn.commit()
    conn.close()

def record_health(is_online: bool, internet_lat: float, gateway_lat: float, packet_loss: float):
    now = int(time.time())
    conn = get_connection()
    
    last = conn.execute("SELECT is_online FROM network_health ORDER BY timestamp DESC LIMIT 1").fetchone()
    if last is not None:
        last_online = bool(last["is_online"])
        if last_online and not is_online:
            log_event("OUTAGE_START", "Internet Disconnection Detected", "Primary gateway/WAN DNS probe failed.")
        elif not last_online and is_online:
            log_event("OUTAGE_RESOLVED", "Internet Connection Restored", f"Online latency restored to {internet_lat:.1f}ms.")
            
    conn.execute("""
        INSERT INTO network_health (timestamp, is_online, internet_latency_ms, gateway_latency_ms, packet_loss_pct)
        VALUES (?, ?, ?, ?, ?)
    """, (now, 1 if is_online else 0, internet_lat, gateway_lat, packet_loss))
    conn.commit()
    conn.close()
