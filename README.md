# 🌐 HomePulse — Personal Network Operations Center

<div align="center">

![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![PySNMP](https://img.shields.io/badge/SNMP-v2c%20Hybrid-blueviolet?style=for-the-badge)
![SQLite](https://img.shields.io/badge/SQLite-WAL%20Mode-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![Chart.js](https://img.shields.io/badge/Chart.js-Telemetry-FF6384?style=for-the-badge&logo=chartdotjs&logoColor=white)
![Release](https://img.shields.io/badge/Release-v1.0.0-emerald?style=for-the-badge)

**Transform a standard home router into a fully observable, enterprise-grade personal Network Operations Center (NOC).**

[Features](#-key-features) • [Router Compatibility](#-hardware--router-compatibility) • [Hybrid Architecture](#-hybrid-telemetry-architecture) • [Installation](#-installation--quick-start) • [API Reference](#-api-reference) • [Release Notes](#-release-notes-v100)

</div>

---

> [!IMPORTANT]
> ### 📌 Hardware & Router Compatibility Notice
> **HomePulse currently supports TP-Link routers** utilizing the web management CGI daemon (`httpd`/CGI).
> 
> * **Verified & Tested Model:** **TP-Link TL-WR850N** (Firmware 3.16+ / MediaTek architecture).
> * **Compatible Families:** Other TP-Link routers sharing standard CGI endpoints (`/cgi?1&5`, `/cgi?5`, `/cgi?7`, `/cgi/login`, `/cgi/getParm`) such as **TL-WR840N**, **TL-WR841N**, and select **Archer series** gateways.
> * **SNMP Requirements:** Standard SNMP v2c agent enabled on the router (UDP port 161) for hardware-level interface telemetry.

---

## 📖 Overview

**HomePulse** is a lightweight, self-hosted network monitoring system designed to run continuously on a local machine. Operating via a **Hybrid Architecture** (combining proprietary HTTP CGI reverse-engineering with standard SNMP v2c polling), HomePulse delivers real-time per-device throughput, hardware WAN traffic splitting, interactive topology visualization, ISP reliability scoring, and automated network intelligence.

All telemetry is stored locally in an embedded SQLite database (WAL mode) and rendered through an ultra-responsive glassmorphic dashboard supporting instant dark and light themes.

---

## ⚡ Key Features

### 1. 🛰️ Hybrid SNMP v2c & CGI Telemetry Engine
* **Hardware WAN Throughput Splitting:** Direct 64-bit/32-bit octet polling on the router's WAN interface (`ppp0` at OID `1.3.6.1.2.1.2.2.1.10.4` and `1.3.6.1.2.1.2.2.1.16.4`), yielding accurate live download and upload speeds.
* **19-Interface Matrix Discovery:** Automated discovery of all hardware and virtual interfaces (`br0`, `ra0`–`ra4`, `eth0.2`–`eth0.6`, `lo`, `ifb0`, etc.) reporting administrative status, operational status, packet error counters, and discards.
* **Hardware Uptime Counter:** Queries standard MIB-II `sysUpTime` (`1.3.6.1.2.1.1.3.0`) for exact, tamper-proof hardware uptime independent of web session resets.

### 2. 🗺️ Interactive Network Topology Map
* **Dynamic Node Visualization:** Live data-flow tree connecting `Internet (WAN) ➔ Gateway Router ➔ Active Clients`.
* **State Awareness:** Immediate visual feedback during disconnections, line drops, and router reboot sequences with animated status rings.
* **Node Deep Linking:** Click any client node in the topology to jump directly to its telemetry profile.

### 3. 🔄 Remote Router Reboot & WAN Details
* **One-Click Reboot with Safety Guard:** Trigger gateway reboot via reverse-engineered `[ACT_REBOOT]` CGI commands with a confirmation modal and automated probing countdown until the router recovers.
* **Live WAN Profile:** Instant display of external Public IP, Internet Gateway, upstream DNS servers, PPPoE session state, and MAC address with one-click clipboard copying.

### 4. 📊 Redesigned Reports & Executive Insights (Zero Redundancy)
* **Executive Intelligence Takeaways:** Plain-English automated network takeaways with status badges summarizing uptime, outage frequency, and burn rate.
* **ISP SLA Quality Scorecard:** Automated letter grade (`A+`, `A`, `B`, `C`), 30-day uptime percentage, MTTR (Mean Time To Recovery), average latency/loss, and peak jitter congestion window.
* **Bandwidth Burn Rate & Forecast:** Daily consumption average, Month-to-Date (MTD) usage, and end-of-month projected consumption.
* **WAN Ingress vs. Egress Ratio:** Proportional traffic profile (`DL : UL`) derived from hardware octets.
* **Lifestyle Consumption Patterns:** Weekday (Mon–Fri) vs. Weekend (Sat–Sun) comparative usage analysis.
* **Fleet Category Share:** Proportional bandwidth breakdown and device distribution across hardware classes (Desktop, Mobile, TV, Laptop, IoT).
* **Off-Hours / Overnight Traffic Audit:** Sleep-hours audit (01:00 – 06:00) identifying background update spikes and ghost traffic.
* **Dormant Devices Audit:** Audits devices inactive on the local network for more than 14 days.

### 5. 🔍 Per-Device Deep-Dive Telemetry
* Individual profile pages for every device.
* Hourly consumption timelines and protocol distribution analysis (**UDP**, **TCP/SYN**, **ICMP**).
* Custom glassmorphic device picker with live search filter and theme-aware styling.
* Custom device naming, category tagging, and device event timelines.

### 6. 🩺 Independent Internet Health & Outage Detection
* **Dual-Target Probing:** Probes both the local Gateway (Port 80) and high-availability WAN DNS (`1.1.1.1` / `8.8.8.8`) independently.
* **Outage Incident Log:** Records internet disruption events, exact downtime durations, and resolution timestamps.
* **24-Hour Telemetry Graph:** Smart bucketing to visualize 24-hour latency and packet loss trends cleanly without visual clutter.

---

## 🔬 Hybrid Telemetry Architecture

```
                                 ┌──────────────────────────────────────────────────────────┐
                                 │                TP-Link TL-WR850N Gateway                 │
                                 │                                                          │
                                 │   [Embedded HTTPD / CGI]          [SNMP v2c Daemon]      │
                                 │      Port 80 (TCP)                  Port 161 (UDP)       │
                                 └────────────▲──────────────────────────────▲──────────────┘
                                              │                              │
                        CGI Handshake         │                              │ MIB-II & IF-MIB
                     (Salted MD5, TokenID)    │                              │ (ppp0 WAN Octets)
                                              │                              │
┌─────────────────────────────────────────────▼──────────────────────────────▼──────────────────────────┐
│                                            HomePulse Backend Engine                                    │
│                                                                                                        │
│   ┌───────────────────────────┐    ┌───────────────────────────┐    ┌──────────────────────────────┐   │
│   │   RouterClient (CGI)      │    │    SnmpClient (v1arch)    │    │    HealthMonitor (TCP/DNS)   │   │
│   │   - Hostnames & IPs       │    │    - WAN In/Out Octets    │    │    - Gateway 192.168.0.1     │   │
│   │   - Active Lease Flags    │    │    - sysUpTime & sysDescr │    │    - Cloud Probes (1.1.1.1)  │   │
│   │   - WAN Profile & Reboot  │    │    - 19-Interface Matrix  │    │    - Outage Duration Log     │   │
│   └─────────────┬─────────────┘    └─────────────┬─────────────┘    └──────────────┬───────────────┘   │
│                 │                                │                                 │                   │
│                 └────────────────────────────────┼─────────────────────────────────┘                   │
│                                                  ▼                                                     │
│                                   ┌─────────────────────────────┐                                      │
│                                   │  Reconciliation & Storage   │                                      │
│                                   │   (SQLite WAL Database)     │                                      │
│                                   └──────────────┬──────────────┘                                      │
│                                                  ▼                                                     │
│                                   ┌─────────────────────────────┐                                      │
│                                   │  FastAPI REST Server (8000) │                                      │
│                                   └──────────────┬──────────────┘                                      │
└──────────────────────────────────────────────────┼─────────────────────────────────────────────────────┘
                                                   ▼
                                    ┌─────────────────────────────┐
                                    │    Single-Page Web UI       │
                                    │ Glassmorphism / Dark Mode   │
                                    └─────────────────────────────┘
```

---

## 📂 Project Structure

```
home-network-manager/
├── run.py                    # Application launcher (CLI arguments, web server, browser init)
├── network_monitor.db        # Embedded SQLite database (WAL mode)
├── requirements.txt          # Python dependencies (FastAPI, PySNMP, Requests, Pydantic)
├── README.md                 # System documentation & manual
│
├── backend/
│   ├── __init__.py
│   ├── config.py             # System paths, defaults, and configuration loader
│   ├── database.py           # SQLite schema, connection pooling, and migrations
│   ├── router_client.py      # TP-Link CGI authentication, MD5 salt handshake, reboot & WAN calls
│   ├── health_monitor.py     # Sub-millisecond TCP latency prober & outage event detector
│   ├── collector.py          # Background polling engine & state reconciliation worker
│   ├── analytics.py          # SLA scoring, forecasting, category aggregations, and insights
│   ├── app.py                # FastAPI endpoints, static asset mounting, REST routing
│   ├── oui.py                # MAC OUI database & device category heuristics
│   └── snmp/
│       ├── __init__.py
│       ├── client.py         # Async PySNMP v1arch client for MIB-II & IF-MIB polling
│       └── poller.py         # High-frequency WAN ppp0 throughput calculator
│
└── frontend/
    ├── index.html            # Single-Page Application (SPA) with 8 dedicated views
    ├── css/
    │   └── style.css         # Glassmorphic layout, modern dark/light themes, animations
    └── js/
        └── app.js            # Live telemetry polling, Chart.js managers, interactive topology
```

---

## 🚀 Installation & Quick Start

### Prerequisites
* **Python 3.10+**
* Connected to your home network (Ethernet or Wi-Fi) with router accessible at `192.168.0.1`

### 1. Clone the Repository
```powershell
git clone https://github.com/sumit0166/home-network-manager.git
cd home-network-manager
```

### 2. Install Dependencies
```powershell
pip install -r requirements.txt
```

### 3. Launch the Application
Start HomePulse with your router administrator password:
```powershell
python run.py -p YOUR_ROUTER_PASSWORD
```

*(You can also launch without `-p` and configure your credentials and SNMP community string in the web dashboard under **Settings**).*

The application will start background workers and launch your default browser to:
👉 **`http://127.0.0.1:8000`**

---

## 🛠️ Configuration & Settings

All configuration parameters can be tuned via CLI flags or live from the **Settings** view:

| Parameter | Default | Description |
|---|---|---|
| `router_url` | `http://192.168.0.1` | Router web management portal address |
| `router_user` | `admin` | Router administration username |
| `router_password` | *(Configured)* | Router administration password |
| `snmp_community` | `public` | SNMP v2c community string |
| `snmp_port` | `161` | SNMP UDP port on the router gateway |
| `poll_interval` | `5` seconds | Background statistics polling frequency (3–60s) |
| `web_port` | `8000` | Port for the local web dashboard |

---

## 📡 REST API Reference

HomePulse exposes a complete REST API:

| Endpoint | Method | Description |
|---|---|---|
| `/api/status` | `GET` | Overall collector status, engine speeds, and connection state |
| `/api/overview` | `GET` | Executive dashboard overview metrics, sparklines, and router info |
| `/api/devices` | `GET` | Complete list of all discovered devices and metadata |
| `/api/devices/{mac}` | `GET` | Deep-dive telemetry, hourly charts, and event timeline for a device |
| `/api/devices/{mac}` | `PATCH` | Update custom device name, category, or notes |
| `/api/traffic` | `GET` | Historical traffic trends (`?period_hours=1\|24\|168`) & top consumers |
| `/api/health` | `GET` | 24-hour Gateway and WAN DNS latency telemetry & outage log |
| `/api/wan` | `GET` | Real-time WAN ISP details (public IP, gateway, DNS, PPPoE status, MAC) |
| `/api/router/reboot` | `POST` | Trigger remote router reboot mechanism |
| `/api/events` | `GET` | Chronological connection & network state events timeline |
| `/api/reports` | `GET` | Executive intelligence: SLA score, forecast, WAN ratio, lifestyle & audits |
| `/api/snmp/live` | `GET` | Real-time WAN (`ppp0`) split download/upload speeds & octet counters |
| `/api/snmp/interfaces` | `GET` | Discovered router interface table (index, name, MAC, status, errors) |
| `/api/snmp/system` | `GET` | MIB-II hardware system info (`sysDescr`, `sysName`, `sysUpTime`) |
| `/api/settings` | `GET` / `POST` | Read or update router credentials, polling frequencies, and SNMP |

---

## 📦 Release Notes: v1.0.0

### **Version 1.0.0 — Production Release (Initial Milestone)**

* **Hybrid Architecture Implementation:**
  * Coupled TP-Link HTTP CGI reverse engineering with async SNMP v2c polling.
  * Dedicated WAN `ppp0` interface bandwidth monitoring with split download/upload speeds.
  * Router interface discovery matrix (19 hardware and virtual interfaces).
  * Direct hardware uptime tracking via MIB-II `sysUpTime`.
* **Router Remote Reboot & WAN Profile:**
  * Added remote reboot mechanism via CGI command with confirmation dialog and probing recovery monitor.
  * Added WAN & ISP telemetry box (External IP, Gateway IP, DNS servers, PPPoE session status).
* **Redesigned Reports & Insights Tab:**
  * Replaced duplicate dashboard metrics with 8 non-repeating macro-analytical dimensions:
    * Executive Smart Takeaways
    * 30-Day ISP SLA & Quality Scorecard (Letter grade, MTTR, latency/loss)
    * Monthly Bandwidth Forecast & Burn Rate
    * WAN Ingress vs. Egress Ratio (`ppp0`)
    * Lifestyle Consumption Patterns (Weekday vs. Weekend)
    * Fleet Category Bandwidth Distribution
    * Off-Hours / Overnight Traffic Audit (01:00 – 06:00)
    * Dormant Devices Audit (> 14 days inactive)
* **UI Polish & Controls:**
  * Custom rounded glassmorphic device picker with live search filter and theme-aware styling.
  * Streamlined horizontal Settings layout.
  * Dedicated color-coded event icons for disconnections, reboots, and outages.
  * Smart 24-hour latency graph bucketing.

---

## 🛡️ License

This project is licensed under the **MIT License**.
