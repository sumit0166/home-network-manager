from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
import os
import time

from .config import STATIC_DIR, DEFAULT_ROUTER_URL, DEFAULT_ROUTER_USER, DEFAULT_POLL_INTERVAL
from .database import init_db, get_connection, get_setting, set_setting, log_event
from .collector import collector_instance
from .snmp import snmp_poller_instance
from .analytics import (
    get_network_overview,
    get_devices_summary,
    get_device_detail,
    get_traffic_analytics,
    get_internet_health_analytics,
    get_reports_and_insights
)

app = FastAPI(title="HomePulse Network Monitor", version="1.0.0")

class DeviceUpdateRequest(BaseModel):
    custom_name: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None

class SettingsUpdateRequest(BaseModel):
    router_url: Optional[str] = None
    router_user: Optional[str] = None
    router_password: Optional[str] = None
    poll_interval: Optional[int] = None
    isp_name: Optional[str] = None
    snmp_enabled: Optional[bool] = None
    snmp_community: Optional[str] = None
    snmp_port: Optional[int] = None

@app.on_event("startup")
def startup():
    init_db()
    # Check if default router URL is saved
    if not get_setting("router_url"):
        set_setting("router_url", DEFAULT_ROUTER_URL)
    if not get_setting("router_user"):
        set_setting("router_user", DEFAULT_ROUTER_USER)
    if not get_setting("poll_interval"):
        set_setting("poll_interval", str(DEFAULT_POLL_INTERVAL))
    if not get_setting("isp_name"):
        set_setting("isp_name", "Hathway")
    if not get_setting("snmp_enabled"):
        set_setting("snmp_enabled", "1")
    if not get_setting("snmp_community"):
        set_setting("snmp_community", "sumitsakpal0183")
    if not get_setting("snmp_port"):
        set_setting("snmp_port", "161")
        
    collector_instance.start()
    snmp_poller_instance.start()

@app.on_event("shutdown")
def shutdown():
    collector_instance.stop()
    snmp_poller_instance.stop()

# --- REST APIs ---

@app.get("/api/status")
def get_system_status():
    return {
        "collector_running": collector_instance.is_running,
        "router_connected": collector_instance.status["router_connected"],
        "internet_online": collector_instance.status["internet_online"],
        "is_rebooting": collector_instance.status.get("is_rebooting", False),
        "last_error": collector_instance.status["last_error"],
        "active_devices": collector_instance.status["active_devices"],
        "current_down_bps": collector_instance.status["current_down_speed_bps"],
        "last_poll_time": collector_instance.last_poll_time,
        "password_configured": bool(get_setting("router_password")),
        "wan_info": collector_instance.status.get("wan_info", {}),
        "snmp": snmp_poller_instance.status
    }

@app.get("/api/overview")
def overview():
    data = get_network_overview()
    data["is_rebooting"] = collector_instance.status.get("is_rebooting", False)
    data["router_connected"] = collector_instance.status["router_connected"]
    data["wan_info"] = collector_instance.status.get("wan_info", {})
    data["snmp"] = snmp_poller_instance.status
    return data

@app.get("/api/devices")
def list_devices():
    return get_devices_summary()

@app.get("/api/devices/{mac}")
def device_detail(mac: str):
    detail = get_device_detail(mac)
    if not detail:
        raise HTTPException(status_code=404, detail="Device not found")
    return detail

@app.patch("/api/devices/{mac}")
def update_device(mac: str, payload: DeviceUpdateRequest):
    conn = get_connection()
    dev = conn.execute("SELECT * FROM devices WHERE mac = ?", (mac,)).fetchone()
    if not dev:
        conn.close()
        raise HTTPException(status_code=404, detail="Device not found")

    new_name = payload.custom_name if payload.custom_name is not None else dev["custom_name"]
    new_cat = payload.category if payload.category is not None else dev["category"]
    new_notes = payload.notes if payload.notes is not None else dev["notes"]

    conn.execute("""
        UPDATE devices SET custom_name = ?, category = ?, notes = ? WHERE mac = ?
    """, (new_name, new_cat, new_notes, mac))
    conn.commit()
    conn.close()

    log_event("DEVICE_UPDATED", f"Device Updated: {new_name}", f"Updated details for {mac}", mac)
    return {"status": "success", "mac": mac}

@app.get("/api/traffic")
def traffic_analytics(period_hours: int = 24):
    return get_traffic_analytics(period_hours)

@app.get("/api/health")
def internet_health():
    data = get_internet_health_analytics()
    data["is_rebooting"] = collector_instance.status.get("is_rebooting", False)
    data["router_connected"] = collector_instance.status["router_connected"]
    data["wan_info"] = collector_instance.status.get("wan_info", {})
    return data

@app.get("/api/wan")
def get_wan_status():
    wan = collector_instance.status.get("wan_info", {})
    if not wan and collector_instance.client and collector_instance.client.token:
        ok, live_wan = collector_instance.client.fetch_wan_status()
        if ok and live_wan:
            collector_instance.status["wan_info"] = live_wan
            return live_wan
    return wan or {
        "external_ip": "Unavailable",
        "gateway_ip": "Unavailable",
        "dns_servers": [],
        "dns_servers_str": "Unavailable",
        "connection_status": "Disconnected",
        "transport_type": "Unknown",
        "mac_address": "",
        "uptime_seconds": 0
    }

@app.post("/api/router/reboot")
def trigger_router_reboot():
    router_pass = get_setting("router_password", "")
    if not router_pass:
        raise HTTPException(status_code=400, detail="Router password is not configured in Settings.")

    client = collector_instance.client
    if not client:
        raise HTTPException(status_code=500, detail="Router client is not initialized.")

    if not client.token:
        logged_in = client.login(router_pass)
        if not logged_in:
            raise HTTPException(status_code=502, detail=client.last_error or "Could not authenticate with router.")

    success, msg = client.reboot()
    if success:
        log_event("ROUTER_REBOOT", "Router Reboot Initiated", "Reboot command dispatched to TP-Link gateway.")
        collector_instance.status["is_rebooting"] = True
        collector_instance.status["reboot_start_time"] = time.time()
        collector_instance.status["router_connected"] = False
        collector_instance.status["internet_online"] = False
        collector_instance.status["active_devices"] = 0
        collector_instance.status["last_error"] = "Router is rebooting..."
        try:
            from .database import record_health
            conn = get_connection()
            conn.execute("UPDATE devices SET is_active = 0")
            conn.commit()
            conn.close()
            record_health(is_online=False, internet_lat=0.0, gateway_lat=0.0, packet_loss=100.0)
        except Exception:
            pass
        return {"status": "success", "message": msg}
    else:
        raise HTTPException(status_code=502, detail=msg)

@app.get("/api/events")
def list_events(limit: int = 50):
    conn = get_connection()
    rows = conn.execute("SELECT * FROM events ORDER BY timestamp DESC LIMIT ?", (limit,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/api/reports")
def reports():
    return get_reports_and_insights()

# --- SNMP Hybrid Subsystem Endpoints ---

@app.get("/api/snmp/live")
def get_snmp_live():
    return {
        "status": snmp_poller_instance.status,
        "sparkline": list(snmp_poller_instance.recent_points)
    }

@app.get("/api/snmp/interfaces")
async def get_snmp_interfaces():
    if snmp_poller_instance.cached_interfaces:
        return snmp_poller_instance.cached_interfaces
    if snmp_poller_instance.client:
        ifs = await snmp_poller_instance.client.get_interfaces_table()
        snmp_poller_instance.cached_interfaces = ifs
        return ifs
    return []

@app.get("/api/snmp/system")
async def get_snmp_system():
    if snmp_poller_instance.cached_system:
        return snmp_poller_instance.cached_system
    if snmp_poller_instance.client:
        sysinfo = await snmp_poller_instance.client.get_system_info()
        snmp_poller_instance.cached_system = sysinfo
        return sysinfo
    return {}

@app.get("/api/settings")
def get_settings():
    return {
        "router_url": get_setting("router_url", DEFAULT_ROUTER_URL),
        "router_user": get_setting("router_user", DEFAULT_ROUTER_USER),
        "poll_interval": int(get_setting("poll_interval", str(DEFAULT_POLL_INTERVAL))),
        "has_password": bool(get_setting("router_password")),
        "isp_name": get_setting("isp_name", "Hathway"),
        "snmp_enabled": get_setting("snmp_enabled", "1") != "0",
        "snmp_community": get_setting("snmp_community", "sumitsakpal0183"),
        "snmp_port": int(get_setting("snmp_port", "161"))
    }

@app.post("/api/settings")
def update_settings(payload: SettingsUpdateRequest):
    if payload.router_url:
        set_setting("router_url", payload.router_url.strip())
    if payload.router_user:
        set_setting("router_user", payload.router_user.strip())
    if payload.router_password:
        set_setting("router_password", payload.router_password)
        # Reset router client token to trigger immediate login
        if collector_instance.client:
            collector_instance.client.token = None
    if payload.poll_interval and payload.poll_interval >= 3:
        set_setting("poll_interval", str(payload.poll_interval))
        collector_instance.poll_interval = payload.poll_interval
    if payload.isp_name is not None:
        set_setting("isp_name", payload.isp_name.strip() or "Hathway")
    if payload.snmp_enabled is not None:
        set_setting("snmp_enabled", "1" if payload.snmp_enabled else "0")
    if payload.snmp_community is not None:
        set_setting("snmp_community", payload.snmp_community.strip())
        if snmp_poller_instance.client:
            snmp_poller_instance.client.community = payload.snmp_community.strip()
            snmp_poller_instance.client.auth = CommunityData(payload.snmp_community.strip(), mpModel=1)
    if payload.snmp_port is not None:
        set_setting("snmp_port", str(payload.snmp_port))
        if snmp_poller_instance.client:
            snmp_poller_instance.client.port = payload.snmp_port

    return {"status": "success"}

# Serve Frontend SPA
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/{full_path:path}")
def serve_spa(full_path: str):
    # Static files take precedence if requested directly
    file_path = os.path.join(STATIC_DIR, full_path)
    if full_path and os.path.isfile(file_path):
        return FileResponse(file_path)
    # Default to index.html
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))
