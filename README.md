# 🌐 HomePulse — Personal Network Operations Center

<div align="center">

![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-WAL%20Mode-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![Chart.js](https://img.shields.io/badge/Chart.js-Telemetry-FF6384?style=for-the-badge&logo=chartdotjs&logoColor=white)
<!-- ![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge) -->

**Transform a basic home router into a fully observable, enterprise-grade personal network operations dashboard.**

[Features](#-key-features) • [How It Works](#-how-it-works) • [Installation](#-installation--quick-start) • [Architecture](#-architecture) • [API Reference](#-api-endpoints)

</div>

---

## 📖 Overview

**HomePulse** is a lightweight, locally hosted personal network monitoring system designed to run continuously on your PC. It interfaces directly with your home router (specifically TP-Link routers such as the TL-WR850N, TL-WR840N, Archer series, etc.) to extract real-time bandwidth consumption, active/offline states, connected device identities, and internet health metrics.

Everything is stored in an embedded SQLite database and presented through a modern glassmorphic web dashboard with full **Dark Mode** and **Light Mode** support.

---

## ⚡ Key Features

### 1. 🗺️ Visual Network Topology Map
* **Hierarchical Tree:** Displays an interactive live data-flow tree: `Internet (WAN) ➔ Gateway Router ➔ Connected Clients`.
* **Flow Telemetry:** Live ping latency indicators, instantaneous bandwidth rate, and animated pulse flows.
* **Active vs Offline Categorization:** Clear visual separation between active devices (associated with live throughput) and powered-off / sleeping devices (with relative *"last seen"* timestamps).

### 2. 🏷️ Real Device Discovery & Identification
* **True Hostnames:** Queries router DHCP/WLAN host tables (`/cgi?5`) to pull real device names (`moto-g35-5G`, `motorola-edge-50`, `OnePlus-Nord-CE-2-Lite-5G`, `LT0173063`, `MITV`).
* **Auto-Categorization:** Derives device categories (Mobile, Laptop, Desktop, TV/Media, IoT) from device hostnames and vendor MAC prefixes.
* **Custom Naming & Notes:** Rename devices, assign custom icons, and tag device owners.

### 3. ⏱️ Accurate Active vs. Offline State Detection
* **Multi-Factor State Verification:** Distinguishes between lease cache entries and true active connections using the router's internal `active` flag combined with real-time packet throughput (`currBytes` / `currPkts`).
* **Timestamp Freezing:** When a device disconnects or is powered off (e.g. a Smart TV), its `last_seen` timestamp freezes so you know exactly when it went offline.

### 4. 📈 Real-Time & Historical Traffic Analytics
* **Live Telemetry:** Instantaneous network speed gauge (`B/s`, `KB/s`, `MB/s`) and 60-minute gradient sparklines.
* **Consumption Trends:** Adaptive historical timeframes (1 Hour, 24 Hours, 7 Days) with auto-scaling time buckets.
* **Top Consumers Leaderboard:** Ranks top bandwidth-consuming devices over any chosen period.

### 5. 🔍 Dedicated Device Deep-Dive Telemetry
* Individual profile pages for every device.
* Real-time consumption metrics: **Today**, **Last 7 Days**, **Last 30 Days**.
* Hourly traffic breakdown bar charts (24-hour timeline).
* Protocol distribution analysis (**UDP**, **TCP/SYN**, **ICMP**).
* Device event log (connection events, IP changes, reconnection history).

### 6. 🩺 Independent Internet Health & Outage Detection
* **Dual-Target Probing:** Probes both the local Gateway (Port 80) and high-availability WAN DNS (`1.1.1.1` / `8.8.8.8`) independently.
* **Outage Log:** Automatically detects and records internet disconnection events, outage duration, and recovery timestamps.
* **24-Hour Availability Score:** Calculates availability and packet loss metrics.

---

## 🔬 How It Works (Router Protocol Reverse Engineering)

HomePulse communicates with TP-Link embedded web management daemons (`httpd` / CGI) via a reverse-engineered handshake protocol:

```
[Client]                                              [Router]
   │                                                     │
   ├─── Step 0: GET / (Pre-flight socket setup) ────────>│
   │                                                     │
   ├─── Step 1: POST /cgi/getParm ───────────────────────>│
   │<── Returns var ss="<DYNAMIC_SALT>"; ────────────────┤
   │                                                     │
   ├─── Step 2: Compute Hash: MD5(ss + val + ss)         │
   │    POST /cgi/login?UserName=...&Passwd=... ────────>│
   │<── Sets Cookie: JSESSIONID=... ─────────────────────┤
   │                                                     │
   ├─── Step 3: GET / (Extract var token="<TOKENID>";) ──>│
   │                                                     │
   ├─── Step 4: POST /cgi?5 (with TokenID header) ───────>│  --> Returns LAN_HOST_ENTRY (Hostnames, IPs, MACs)
   │                                                     │
   └─── Step 5: POST /cgi?1&5 (with TokenID header) ─────>│  --> Returns STAT_ENTRY (Traffic counters)
```

1. **Anti-Replay Salting:** Password hashes are computed client-side using `MD5(ss + Base64(password) + ss)` where `ss` is a dynamic challenge token refreshed per session.
2. **Tokenized CGI Access:** Post-authentication API calls (`/cgi?1&5` and `/cgi?5`) pass the authenticated session token via the `TokenID: <token>` HTTP header.

---

## 📂 Project Structure

```
home-network-manager/
│
├── run.py                    # Application launcher (CLI args, web server & browser open)
├── network_monitor.db        # Embedded SQLite database (WAL mode)
├── requirements.txt          # Python dependencies
├── README.md                 # Documentation
│
├── backend/
│   ├── __init__.py
│   ├── config.py             # System paths and default parameters
│   ├── oui.py                # MAC OUI database & category heuristics
│   ├── database.py           # SQLite connection, migrations, event logging
│   ├── router_client.py      # TP-Link session auth, dynamic MD5, TokenID queries
│   ├── health_monitor.py     # Sub-millisecond TCP latency & outage prober
│   ├── collector.py          # Background polling engine & state reconciler
│   ├── analytics.py          # Data aggregation, hourly bucketing, reports
│   └── app.py                # FastAPI server, REST API endpoints, static mount
│
└── frontend/
    ├── index.html            # Next-Gen Single-Page Application (SPA)
    ├── css/
    │   └── style.css         # Glassmorphism, animations, dark/light themes
    └── js/
        └── app.js            # Live polling, Chart.js graphs, topology tree
```

---

## 🚀 Installation & Quick Start

### Prerequisites
* **Python 3.10+**
* Connected to your home network (Wi-Fi or Ethernet) with router accessible at `192.168.0.1`

### 1. Clone / Navigate to Directory
```powershell
cd D:\Python\home-network-manager
```

### 2. Install Dependencies
```powershell
pip install fastapi uvicorn requests
```

### 3. Launch the Application
Start HomePulse with your router administrator password:
```powershell
python run.py -p YOUR_ROUTER_PASSWORD
```

*(You can also run without `-p` and configure your credentials later in the web dashboard under **Settings**).*

The application will start the background monitoring engine and automatically launch your browser to:
👉 **`http://127.0.0.1:8000`**

---

## 🛠️ Configuration & Settings

All settings can be configured either via CLI or directly through the web UI under the **Settings** view:

| Setting | Default | Description |
|---|---|---|
| `router_url` | `http://192.168.0.1` | Router web management portal address |
| `router_user` | `user` | Router admin/management username |
| `router_password` | *(Configured)* | Router login password |
| `poll_interval` | `5` seconds | Background statistics polling frequency (3–60s) |
| `web_port` | `8000` | Port for the local web dashboard |

---

## 📡 REST API Reference

HomePulse exposes a complete JSON API:

| Endpoint | Method | Description |
|---|---|---|
| `/api/status` | `GET` | Live collector status, speeds, and connectivity |
| `/api/overview` | `GET` | Executive dashboard overview metrics & 60m sparkline |
| `/api/devices` | `GET` | Complete list of all discovered devices & metadata |
| `/api/devices/{mac}` | `GET` | Deep-dive telemetry, hourly charts, and event history for a device |
| `/api/devices/{mac}` | `PATCH` | Update custom friendly name, category, or notes |
| `/api/traffic` | `GET` | Traffic trends over time (`?period_hours=1|24|168`) & top consumers |
| `/api/health` | `GET` | 24-hour Internet & gateway latency telemetry and outage logs |
| `/api/events` | `GET` | Chronological connection events timeline |
| `/api/reports` | `GET` | Usage insights: busiest hours, top devices, dormant devices |
| `/api/settings` | `GET` / `POST` | Read or update router connection parameters |

---

## 🎨 Theme & Aesthetic

HomePulse is designed with a next-generation aesthetic:
* **Glassmorphism:** Frosted translucent cards with subtle 1px border glows (`backdrop-filter: blur(16px)`).
* **Typography:** `Inter` for clean UI readability, paired with `JetBrains Mono` for IP addresses, MACs, and metrics.
* **Dark & Light Mode:** Toggle seamlessly between dark slate and clean porcelain themes with instant `localStorage` persistence.

---

## 🛡️ License

This project is open-source under the **MIT License**.
