import time
from typing import Dict, Any, List, Optional
from .database import get_connection, get_setting

def format_bytes_human(b: int) -> str:
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if b < 1024.0:
            return f"{b:3.1f} {unit}"
        b /= 1024.0
    return f"{b:.1f} PB"

def get_network_overview() -> Dict[str, Any]:
    now = int(time.time())
    today_start = now - (now % 86400)
    conn = get_connection()

    # 1. Device counts
    total_devices = conn.execute("SELECT COUNT(*) as count FROM devices").fetchone()["count"]
    active_devices = conn.execute("SELECT COUNT(*) as count FROM devices WHERE is_active = 1").fetchone()["count"]
    inactive_devices = total_devices - active_devices

    # 2. Latest active traffic rate
    recent_cutoff = now - 20
    curr_rate = conn.execute("""
        SELECT COALESCE(SUM(curr_bytes), 0) as rate 
        FROM traffic_snapshots 
        WHERE timestamp >= ?
    """, (recent_cutoff,)).fetchone()["rate"]

    # 3. Total data today
    today_data_raw = conn.execute("""
        SELECT COALESCE(SUM(device_diff), 0) as total_today FROM (
            SELECT (MAX(total_bytes) - MIN(total_bytes)) as device_diff
            FROM traffic_snapshots
            WHERE timestamp >= ?
            GROUP BY device_mac
        )
    """, (today_start,)).fetchone()["total_today"]

    # If diff is 0 (first reading), sum the current bytes recorded today
    if today_data_raw == 0:
        today_data_raw = conn.execute("""
            SELECT COALESCE(SUM(curr_bytes), 0) as total_today
            FROM traffic_snapshots
            WHERE timestamp >= ?
        """, (today_start,)).fetchone()["total_today"]

    # 4. Latest health status
    health_row = conn.execute("""
        SELECT is_online, internet_latency_ms, gateway_latency_ms, packet_loss_pct 
        FROM network_health 
        ORDER BY timestamp DESC LIMIT 1
    """).fetchone()

    # 5. Top consumer today
    top_consumer = conn.execute("""
        SELECT d.mac, d.custom_name, d.category, d.ip, 
               MAX(COALESCE(MAX(t.total_bytes) - MIN(t.total_bytes), 0), COALESCE(SUM(t.curr_bytes), 0)) as consumed
        FROM traffic_snapshots t
        JOIN devices d ON t.device_mac = d.mac
        WHERE t.timestamp >= ?
        GROUP BY t.device_mac
        ORDER BY consumed DESC LIMIT 1
    """, (today_start,)).fetchone()

    # 6. Recent 60-minute traffic timeline (30s buckets)
    one_hour_ago = now - 3600
    timeline_rows = conn.execute("""
        SELECT (timestamp / 30) * 30 as bucket, SUM(curr_bytes) as bytes
        FROM traffic_snapshots
        WHERE timestamp >= ?
        GROUP BY bucket
        ORDER BY bucket ASC
    """, (one_hour_ago,)).fetchall()

    timeline_points = [{"time": r["bucket"], "bytes": r["bytes"]} for r in timeline_rows]
    
    # Ensure at least 2 points so Chart.js draws a line
    if len(timeline_points) == 1:
        first = timeline_points[0]
        timeline_points.insert(0, {"time": first["time"] - 30, "bytes": 0})
    elif len(timeline_points) == 0:
        timeline_points = [{"time": now - 30, "bytes": 0}, {"time": now, "bytes": curr_rate}]

    conn.close()

    return {
        "total_devices": total_devices,
        "active_devices": active_devices,
        "inactive_devices": inactive_devices,
        "current_traffic_bps": curr_rate,
        "current_traffic_human": f"{format_bytes_human(curr_rate)}/s",
        "total_data_today_bytes": today_data_raw,
        "total_data_today_human": format_bytes_human(today_data_raw),
        "is_online": bool(health_row["is_online"]) if health_row else False,
        "internet_latency_ms": health_row["internet_latency_ms"] if health_row else 0.0,
        "gateway_latency_ms": health_row["gateway_latency_ms"] if health_row else 0.0,
        "top_consumer": {
            "mac": top_consumer["mac"],
            "name": top_consumer["custom_name"],
            "ip": top_consumer["ip"],
            "category": top_consumer["category"],
            "consumed_human": format_bytes_human(top_consumer["consumed"])
        } if top_consumer and top_consumer["consumed"] > 0 else None,
        "isp_name": get_setting("isp_name", "Local ISP"),
        "traffic_sparkline": timeline_points
    }

def get_devices_summary() -> List[Dict[str, Any]]:
    now = int(time.time())
    today_start = now - (now % 86400)
    conn = get_connection()
    devices = conn.execute("SELECT * FROM devices ORDER BY is_active DESC, last_seen DESC").fetchall()
    
    # Pre-aggregate today's consumption per device (delta since midnight)
    today_rows = conn.execute("""
        SELECT device_mac,
               MAX(COALESCE(MAX(total_bytes) - MIN(total_bytes), 0), COALESCE(SUM(curr_bytes), 0)) as today_consumed
        FROM traffic_snapshots
        WHERE timestamp >= ?
        GROUP BY device_mac
    """, (today_start,)).fetchall()
    today_map = {r["device_mac"]: r["today_consumed"] for r in today_rows}

    result = []
    for d in devices:
        stat = conn.execute("""
            SELECT curr_bytes, total_bytes 
            FROM traffic_snapshots 
            WHERE device_mac = ? 
            ORDER BY timestamp DESC LIMIT 1
        """, (d["mac"],)).fetchone()

        today_b = today_map.get(d["mac"], 0)
        is_act = bool(d["is_active"])
        speed_bytes = (stat["curr_bytes"] if stat else 0) if is_act else 0

        result.append({
            "mac": d["mac"],
            "ip": d["ip"],
            "custom_name": d["custom_name"],
            "hostname": d["hostname"] or "",
            "category": d["category"],
            "vendor": d["vendor"],
            "interface": d["interface"] or "",
            "first_seen": d["first_seen"],
            "last_seen": d["last_seen"],
            "is_active": is_act,
            "current_speed_bytes": speed_bytes,
            "current_speed_human": f"{format_bytes_human(speed_bytes)}/s" if is_act else "0.0 B/s",
            "today_bytes": today_b,
            "today_bytes_human": format_bytes_human(today_b),
            "total_bytes": stat["total_bytes"] if stat else 0,
            "total_bytes_human": format_bytes_human(stat["total_bytes"] if stat else 0),
            "notes": d["notes"] or ""
        })
    conn.close()
    return result

def get_device_detail(mac: str) -> Optional[Dict[str, Any]]:
    mac_norm = mac.replace("-", ":").upper()
    conn = get_connection()
    dev = conn.execute("SELECT * FROM devices WHERE mac = ?", (mac_norm,)).fetchone()
    if not dev:
        conn.close()
        return None

    now = int(time.time())
    today_start = now - (now % 86400)
    week_start = now - (7 * 86400)
    month_start = now - (30 * 86400)

    # 1. Total consumed intervals
    today_row = conn.execute("""
        SELECT MAX(COALESCE(MAX(total_bytes) - MIN(total_bytes), 0), COALESCE(SUM(curr_bytes), 0)) as diff
        FROM traffic_snapshots WHERE device_mac = ? AND timestamp >= ?
    """, (mac_norm, today_start)).fetchone()
    today_consumed = today_row["diff"] if today_row else 0

    week_row = conn.execute("""
        SELECT MAX(COALESCE(MAX(total_bytes) - MIN(total_bytes), 0), COALESCE(SUM(curr_bytes), 0)) as diff
        FROM traffic_snapshots WHERE device_mac = ? AND timestamp >= ?
    """, (mac_norm, week_start)).fetchone()
    week_consumed = week_row["diff"] if week_row else 0

    month_row = conn.execute("""
        SELECT MAX(COALESCE(MAX(total_bytes) - MIN(total_bytes), 0), COALESCE(SUM(curr_bytes), 0)) as diff
        FROM traffic_snapshots WHERE device_mac = ? AND timestamp >= ?
    """, (mac_norm, month_start)).fetchone()
    month_consumed = month_row["diff"] if month_row else 0

    # 2. Hourly breakdown past 24 hours
    day_ago = now - 86400
    hourly_rows = conn.execute("""
        SELECT (timestamp / 1800) * 1800 as bucket, SUM(curr_bytes) as bytes
        FROM traffic_snapshots
        WHERE device_mac = ? AND timestamp >= ?
        GROUP BY bucket
        ORDER BY bucket ASC
    """, (mac_norm, day_ago)).fetchall()

    # 3. Protocol distribution
    proto_row = conn.execute("""
        SELECT SUM(curr_udp) as udp, SUM(curr_syn) as syn, SUM(curr_icmp) as icmp
        FROM traffic_snapshots
        WHERE device_mac = ? AND timestamp >= ?
    """, (mac_norm, day_ago)).fetchone()

    # 4. Recent events
    events = conn.execute("""
        SELECT timestamp, event_type, title, description 
        FROM events 
        WHERE device_mac = ? 
        ORDER BY timestamp DESC LIMIT 15
    """, (mac_norm,)).fetchall()

    conn.close()

    return {
        "device": dict(dev),
        "consumption": {
            "today": format_bytes_human(today_consumed),
            "week": format_bytes_human(week_consumed),
            "month": format_bytes_human(month_consumed),
            "today_bytes": today_consumed,
            "week_bytes": week_consumed,
            "month_bytes": month_consumed
        },
        "hourly_chart": [{"timestamp": r["bucket"], "bytes": r["bytes"]} for r in hourly_rows],
        "protocols": {
            "udp": proto_row["udp"] or 0,
            "tcp_syn": proto_row["syn"] or 0,
            "icmp": proto_row["icmp"] or 0
        },
        "events": [dict(e) for e in events]
    }

def get_traffic_analytics(period_hours: int = 24) -> Dict[str, Any]:
    now = int(time.time())
    start_time = now - (period_hours * 3600)
    conn = get_connection()

    # Fine-grained adaptive bucketing:
    # 1 hour -> 30s buckets (~120 points)
    # 6 hours -> 120s (2 min) buckets (~180 points)
    # 24 hours -> 600s (10 min) buckets (~144 points)
    # 7 days -> 1800s (30 min) buckets (~336 points)
    if period_hours <= 1:
        bucket_sec = 30
    elif period_hours <= 6:
        bucket_sec = 120
    elif period_hours <= 24:
        bucket_sec = 600
    else:
        bucket_sec = 1800

    timeline = conn.execute(f"""
        SELECT (timestamp / {bucket_sec}) * {bucket_sec} as bucket, 
               COALESCE(SUM(curr_bytes), 0) as total_bytes
        FROM traffic_snapshots
        WHERE timestamp >= ?
        GROUP BY bucket
        ORDER BY bucket ASC
    """, (start_time,)).fetchall()

    timeline_points = [{"time": r["bucket"], "bytes": r["total_bytes"]} for r in timeline]

    # Ensure at least 2 points so Chart.js renders a clean continuous curve
    if len(timeline_points) == 1:
        p0 = timeline_points[0]
        timeline_points.insert(0, {"time": p0["time"] - bucket_sec, "bytes": 0})
    elif len(timeline_points) == 0:
        timeline_points = [{"time": now - bucket_sec, "bytes": 0}, {"time": now, "bytes": 0}]

    # Top devices during this period
    top_devices = conn.execute("""
        SELECT d.mac, d.custom_name, d.category, d.ip, 
               MAX(COALESCE(sub.consumed, 0), COALESCE(sub.curr_sum, 0)) as total_consumed
        FROM devices d
        LEFT JOIN (
            SELECT device_mac, 
                   (MAX(total_bytes) - MIN(total_bytes)) as consumed,
                   SUM(curr_bytes) as curr_sum
            FROM traffic_snapshots
            WHERE timestamp >= ?
            GROUP BY device_mac
        ) sub ON d.mac = sub.device_mac
        WHERE total_consumed > 0 OR d.is_active = 1
        ORDER BY total_consumed DESC LIMIT 8
    """, (start_time,)).fetchall()

    conn.close()

    return {
        "period_hours": period_hours,
        "timeline": timeline_points,
        "top_devices": [{
            "mac": r["mac"],
            "name": r["custom_name"],
            "category": r["category"],
            "ip": r["ip"],
            "bytes": r["total_consumed"] or 0,
            "human": format_bytes_human(r["total_consumed"] or 0)
        } for r in top_devices]
    }

def get_internet_health_analytics() -> Dict[str, Any]:
    now = int(time.time())
    start_time = now - (24 * 3600)
    conn = get_connection()

    # Latency over time (600s / 10-minute buckets: 144 points for smooth 24h curve)
    health_timeline = conn.execute("""
        SELECT (timestamp / 600) * 600 as bucket, 
               AVG(internet_latency_ms) as avg_internet_lat,
               AVG(gateway_latency_ms) as avg_gw_lat,
               AVG(packet_loss_pct) as avg_packet_loss,
               MIN(is_online) as min_online
        FROM network_health
        WHERE timestamp >= ?
        GROUP BY bucket
        ORDER BY bucket ASC
    """, (start_time,)).fetchall()

    total_pings = conn.execute("SELECT COUNT(*) as cnt FROM network_health WHERE timestamp >= ?", (start_time,)).fetchone()["cnt"]
    online_pings = conn.execute("SELECT COUNT(*) as cnt FROM network_health WHERE timestamp >= ? AND is_online = 1", (start_time,)).fetchone()["cnt"]
    uptime_pct = round((online_pings / total_pings) * 100.0, 2) if total_pings > 0 else 100.0

    outages = conn.execute("""
        SELECT timestamp, event_type, title, description 
        FROM events 
        WHERE event_type IN ('OUTAGE_START', 'OUTAGE_RESOLVED') AND timestamp >= ?
        ORDER BY timestamp DESC
    """, (start_time,)).fetchall()

    latest_health = conn.execute("""
        SELECT is_online, internet_latency_ms, gateway_latency_ms, packet_loss_pct
        FROM network_health
        ORDER BY timestamp DESC LIMIT 1
    """).fetchone()

    conn.close()

    points = [{
        "time": r["bucket"],
        "internet_lat": round(r["avg_internet_lat"] or 0, 1),
        "gateway_lat": round(r["avg_gw_lat"] or 0, 1),
        "packet_loss": round(r["avg_packet_loss"] or 0, 1),
        "online": bool(r["min_online"])
    } for r in health_timeline]

    if len(points) == 1:
        points.insert(0, {"time": points[0]["time"] - 600, "internet_lat": points[0]["internet_lat"], "gateway_lat": points[0]["gateway_lat"], "packet_loss": 0, "online": True})

    return {
        "uptime_pct": uptime_pct,
        "is_online": bool(latest_health["is_online"]) if latest_health else False,
        "gateway_online": bool(latest_health and latest_health["gateway_latency_ms"] > 0),
        "current_gateway_lat": round(latest_health["gateway_latency_ms"], 1) if latest_health else 0.0,
        "current_internet_lat": round(latest_health["internet_latency_ms"], 1) if latest_health else 0.0,
        "current_packet_loss": round(latest_health["packet_loss_pct"], 1) if latest_health else 0.0,
        "timeline": points,
        "outages": [dict(o) for o in outages]
    }

def get_reports_and_insights() -> Dict[str, Any]:
    now = int(time.time())
    today_start = now - (now % 86400)
    month_start = now - (30 * 86400)
    week_start = now - (7 * 86400)
    conn = get_connection()

    busiest_hour_row = conn.execute("""
        SELECT strftime('%H:00', datetime(timestamp, 'unixepoch', 'localtime')) as hour_str,
               SUM(curr_bytes) as total_bytes
        FROM traffic_snapshots
        WHERE timestamp >= ?
        GROUP BY hour_str
        ORDER BY total_bytes DESC LIMIT 1
    """, (today_start,)).fetchone()

    top_today = conn.execute("""
        SELECT d.custom_name, 
               MAX(COALESCE(MAX(t.total_bytes) - MIN(t.total_bytes), 0), COALESCE(SUM(t.curr_bytes), 0)) as consumed
        FROM traffic_snapshots t JOIN devices d ON t.device_mac = d.mac
        WHERE t.timestamp >= ?
        GROUP BY t.device_mac ORDER BY consumed DESC LIMIT 1
    """, (today_start,)).fetchone()

    top_month = conn.execute("""
        SELECT d.custom_name, 
               MAX(COALESCE(MAX(t.total_bytes) - MIN(t.total_bytes), 0), COALESCE(SUM(t.curr_bytes), 0)) as consumed
        FROM traffic_snapshots t JOIN devices d ON t.device_mac = d.mac
        WHERE t.timestamp >= ?
        GROUP BY t.device_mac ORDER BY consumed DESC LIMIT 1
    """, (month_start,)).fetchone()

    week_data = conn.execute("""
        SELECT COALESCE(SUM(consumed), 0) as total FROM (
            SELECT MAX(COALESCE(MAX(total_bytes) - MIN(total_bytes), 0), COALESCE(SUM(curr_bytes), 0)) as consumed
            FROM traffic_snapshots WHERE timestamp >= ? GROUP BY device_mac
        )
    """, (week_start,)).fetchone()["total"]

    dormant_devices = conn.execute("""
        SELECT custom_name, ip, mac, last_seen 
        FROM devices 
        WHERE last_seen < ?
        ORDER BY last_seen ASC
    """, (week_start,)).fetchall()

    conn.close()

    return {
        "busiest_hour_today": busiest_hour_row["hour_str"] if busiest_hour_row and busiest_hour_row["total_bytes"] > 0 else "N/A",
        "busiest_hour_data": format_bytes_human(busiest_hour_row["total_bytes"]) if busiest_hour_row else "0 B",
        "top_device_today": top_today["custom_name"] if top_today and top_today["consumed"] > 0 else "None yet",
        "top_device_today_data": format_bytes_human(top_today["consumed"]) if top_today else "0 B",
        "top_device_month": top_month["custom_name"] if top_month and top_month["consumed"] > 0 else "None yet",
        "top_device_month_data": format_bytes_human(top_month["consumed"]) if top_month else "0 B",
        "total_week_data": format_bytes_human(week_data),
        "dormant_devices": [dict(d) for d in dormant_devices]
    }
