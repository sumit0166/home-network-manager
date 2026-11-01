# Common OUI prefix database for fallback recognition
OUI_DATABASE = {
    # Apple
    "F0:68:E3": ("Apple", "mobile"),
    "F6:48:BB": ("Apple", "mobile"),
    "74:56:3C": ("Apple", "laptop"),
    "AC:BC:32": ("Apple", "laptop"),
    "BC:D0:74": ("Apple", "mobile"),
    "DC:A9:04": ("Apple", "laptop"),
    "F0:18:98": ("Apple", "mobile"),
    
    # Samsung
    "52:07:2E": ("Samsung Electronics", "mobile"),
    "42:52:AD": ("Samsung Electronics", "tv"),
    "F4:42:8F": ("Samsung", "mobile"),
    "8C:77:12": ("Samsung", "tv"),
    "CC:07:AB": ("Samsung", "mobile"),
    
    # Xiaomi / POCO / Redmi
    "78:11:DC": ("Xiaomi", "mobile"),
    "28:6C:07": ("Xiaomi", "mobile"),
    "64:A2:F9": ("Xiaomi", "mobile"),
    "50:EC:50": ("Xiaomi", "iot"),
    "F0:B0:40": ("Xiaomi / Mi", "tv"),
    
    # IoT / Smart Home
    "24:62:AB": ("Espressif (ESP8266/ESP32)", "iot"),
    "30:AE:A4": ("Espressif", "iot"),
    "84:CC:A8": ("Espressif", "iot"),
    "68:C6:3A": ("Tuya Smart", "iot"),
    "10:52:1C": ("Tuya Smart", "iot"),
    "B8:27:EB": ("Raspberry Pi", "iot"),
    "DC:A6:32": ("Raspberry Pi", "iot"),
    "E4:5F:01": ("Raspberry Pi", "iot"),
    "00:17:88": ("Philips Hue", "iot"),
    "D0:73:D5": ("LIFX", "iot"),
    
    # Media / TV / Streaming
    "00:09:DF": ("Smart TV", "tv"),
    "60:A4:4C": ("Amazon (FireTV/Echo)", "tv"),
    "44:65:0D": ("Amazon (FireTV/Echo)", "iot"),
    "3C:5A:37": ("Google (Chromecast/Nest)", "tv"),
    "54:60:09": ("Google", "iot"),
    "E8:9F:80": ("LG Electronics", "tv"),
    "38:8C:50": ("Sony", "tv"),
    "00:24:81": ("Sony PlayStation", "desktop"),
    
    # PC / Network / Other
    "00:E0:4C": ("Realtek Semiconductor", "desktop"),
    "00:1A:2B": ("Intel Corporate", "laptop"),
    "34:E6:AD": ("Intel Corporate", "laptop"),
    "00:1B:21": ("Intel", "desktop"),
    "2C:6D:C1": ("HP / Enterprise Client", "laptop"),
    "70:85:C2": ("TP-Link Technologies", "network"),
    "50:D4:F7": ("TP-Link", "network"),
    "00:0C:29": ("VMware", "desktop"),
}

def guess_category_from_hostname(name: str) -> str:
    if not name:
        return "unknown"
    n = name.lower()
    if any(k in n for k in ["tv", "mitv", "firetv", "chromecast", "roku", "appletv", "shield", "smarttv", "bravia", "oled"]):
        return "tv"
    if any(k in n for k in ["moto", "motorola", "oneplus", "iphone", "galaxy", "redmi", "pixel", "phone", "android", "mobile", "samsung", "oppo", "vivo", "realme", "xiaomi", "s24", "g35", "nord", "v24", "v25"]):
        return "mobile"
    if any(k in n for k in ["lt", "laptop", "macbook", "thinkpad", "zenbook", "yoga", "notebook", "dell", "hp-"]):
        return "laptop"
    if any(k in n for k in ["desk", "pc", "desktop", "imac", "mac-mini", "tower", "workstation", "station"]):
        return "desktop"
    if any(k in n for k in ["esp", "tuya", "sonoff", "shelly", "smart", "echo", "nest", "plug", "bulb", "cam", "camera", "printer"]):
        return "iot"
    return "unknown"

def lookup_vendor(mac: str):
    """Fallback vendor lookup from MAC OUI."""
    if not mac or len(mac) < 8:
        return "Network Client", "unknown"
    prefix = mac[:8].replace("-", ":").upper()
    if prefix in OUI_DATABASE:
        return OUI_DATABASE[prefix]
    
    # Generic prefix matching
    first_two = prefix[:5]
    for pfx, info in OUI_DATABASE.items():
        if pfx.startswith(first_two):
            return info
            
    return "Network Client", "unknown"
