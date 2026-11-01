import socket
import time
from typing import Tuple

def probe_latency(host: str, port: int, timeout: float = 1.5) -> Tuple[bool, float]:
    """Measures precise TCP connect latency in milliseconds."""
    start = time.perf_counter()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(timeout)
        s.connect((host, port))
        s.close()
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        return True, round(elapsed_ms, 2)
    except Exception:
        return False, 0.0

def check_network_health(gateway_ip: str = "192.168.0.1") -> dict:
    """Probes gateway and WAN DNS (1.1.1.1 and 8.8.8.8) to determine connectivity and latency."""
    # 1. Gateway probe (Port 80 HTTP)
    gw_ok, gw_lat = probe_latency(gateway_ip, 80, timeout=1.0)
    
    # 2. Internet WAN probes (DNS Port 53 on 1.1.1.1 and 8.8.8.8)
    wan1_ok, wan1_lat = probe_latency("1.1.1.1", 53, timeout=1.5)
    wan2_ok, wan2_lat = probe_latency("8.8.8.8", 53, timeout=1.5)

    is_online = wan1_ok or wan2_ok
    
    if wan1_ok and wan2_ok:
        internet_lat = round((wan1_lat + wan2_lat) / 2.0, 2)
        packet_loss = 0.0
    elif is_online:
        internet_lat = wan1_lat if wan1_ok else wan2_lat
        packet_loss = 50.0
    else:
        internet_lat = 0.0
        packet_loss = 100.0

    return {
        "is_online": is_online,
        "gateway_reachable": gw_ok,
        "gateway_latency_ms": gw_lat if gw_ok else 0.0,
        "internet_latency_ms": internet_lat,
        "packet_loss_pct": packet_loss
    }
