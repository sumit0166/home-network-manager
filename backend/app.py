from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
import os

from .config import STATIC_DIR, DEFAULT_ROUTER_URL, DEFAULT_ROUTER_USER, DEFAULT_POLL_INTERVAL
from .database import init_db, get_connection, get_setting, set_setting, log_event
from .collector import collector_instance
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
        
    collector_instance.start()

@app.on_event("shutdown")
def shutdown():
    collector_instance.stop()

# --- REST APIs ---

@app.get("/api/status")
def get_system_status():
    return {
        "collector_running": collector_instance.is_running,
        "router_connected": collector_instance.status["router_connected"],
        "internet_online": collector_instance.status["internet_online"],
        "last_error": collector_instance.status["last_error"],
        "active_devices": collector_instance.status["active_devices"],
        "current_down_bps": collector_instance.status["current_down_speed_bps"],
        "last_poll_time": collector_instance.last_poll_time,
        "password_configured": bool(get_setting("router_password"))
    }

@app.get("/api/overview")
def overview():
    return get_network_overview()

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
    return get_internet_health_analytics()

@app.get("/api/events")
def list_events(limit: int = 50):
    conn = get_connection()
    rows = conn.execute("SELECT * FROM events ORDER BY timestamp DESC LIMIT ?", (limit,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/api/reports")
def reports():
    return get_reports_and_insights()

@app.get("/api/settings")
def get_settings():
    return {
        "router_url": get_setting("router_url", DEFAULT_ROUTER_URL),
        "router_user": get_setting("router_user", DEFAULT_ROUTER_USER),
        "poll_interval": int(get_setting("poll_interval", str(DEFAULT_POLL_INTERVAL))),
        "has_password": bool(get_setting("router_password"))
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
