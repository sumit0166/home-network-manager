// HomePulse Frontend Application
let currentView = 'dashboard';
let currentDetailMac = null;
let charts = {};
let allDevicesCache = [];
let currentTrafficHours = 24;

// Theme Management
function initTheme() {
  const saved = localStorage.getItem('homepulse-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeButtonUI(saved);

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('homepulse-theme', next);
    updateThemeButtonUI(next);
    refreshCurrentView();
  });
}

function updateThemeButtonUI(theme) {
  const text = document.getElementById('theme-mode-text');
  if (text) {
    text.textContent = theme === 'dark' ? 'Dark Mode' : 'Light Mode';
  }
}

// Navigation & View Routing
let previousView = 'dashboard';

function switchView(viewName) {
  if (currentView !== viewName && currentView !== 'device-detail') {
    previousView = currentView;
  }
  currentView = viewName;
  document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));

  const targetSec = document.getElementById(`view-${viewName}`);
  if (targetSec) targetSec.classList.add('active');

  const navItem = document.querySelector(`.nav-item[data-view="${viewName}"]`);
  if (navItem) navItem.classList.add('active');

  const titles = {
    dashboard: ["Dashboard", "Real-time network observability & device intelligence"],
    devices: ["Devices Inventory", "Complete inventory of all discovered network devices"],
    "device-detail": ["Device Telemetry", "Deep-dive bandwidth and protocol metrics"],
    traffic: ["Traffic Analytics", "Network consumption patterns and top consumers"],
    health: ["Internet Health", "Latency, packet loss, and outage monitoring"],
    history: ["Connection History", "Timeline of joins, disconnects, and state changes"],
    reports: ["Reports & Insights", "Actionable intelligence and usage summaries"],
    settings: ["Settings", "Configure router connection & preferences"]
  };

  if (titles[viewName]) {
    document.getElementById('view-title').textContent = titles[viewName][0];
    document.getElementById('view-subtitle').textContent = titles[viewName][1];
  }

  // Slight timeout so DOM container dimensions reflow before Chart.js draws
  setTimeout(() => {
    refreshCurrentView();
  }, 40);
}

function refreshCurrentView() {
  if (currentView === 'dashboard') loadDashboard();
  else if (currentView === 'devices') loadDevices();
  else if (currentView === 'device-detail') loadDeviceDetail(currentDetailMac);
  else if (currentView === 'traffic') loadTrafficAnalytics();
  else if (currentView === 'health') loadInternetHealth();
  else if (currentView === 'history') loadConnectionHistory();
  else if (currentView === 'reports') loadReports();
  else if (currentView === 'settings') loadSettings();
}

function navigateBackFromTelemetry() {
  if (previousView && previousView !== 'device-detail') {
    switchView(previousView);
  } else {
    switchView('devices');
  }
}

// Formatters
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatMbps(mbps) {
  if (mbps === undefined || mbps === null || isNaN(mbps)) return '0.0 Kbps';
  if (mbps < 1.0) {
    return `${(mbps * 1000).toFixed(1)} Kbps`;
  }
  return `${mbps.toFixed(2)} Mbps`;
}

function timeAgo(unixTimestamp) {
  if (!unixTimestamp) return 'Never';
  const seconds = Math.floor(Date.now() / 1000 - unixTimestamp);
  if (seconds < 5) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// 1. Dashboard View
let lastSparklineData = [];
let latestOverviewData = null;
let currentTopoFilter = 'all';

function setTopoFilter(filter) {
  currentTopoFilter = filter;
  ['all', 'active', 'offline'].forEach(f => {
    const btn = document.getElementById(`topo-pill-${f}-btn`);
    if (btn) btn.classList.toggle('active', f === filter);
  });
  if (latestOverviewData && allDevicesCache) {
    renderTopologyMap(latestOverviewData, allDevicesCache);
  }
}

function toggleTopoFilter() {
  if (currentTopoFilter === 'all') setTopoFilter('active');
  else if (currentTopoFilter === 'active') setTopoFilter('offline');
  else setTopoFilter('all');
}

async function loadDashboard() {
  try {
    const [overviewRes, devicesRes, snmpRes] = await Promise.all([
      fetch('/api/overview'),
      fetch('/api/devices'),
      fetch('/api/snmp/live').catch(() => null)
    ]);
    if (!overviewRes.ok || !devicesRes.ok) return;
    const data = await overviewRes.json();
    const devices = await devicesRes.json();
    let snmpData = null;
    if (snmpRes && snmpRes.ok) {
      try { snmpData = await snmpRes.json(); } catch (e) {}
    }
    latestOverviewData = data;
    allDevicesCache = devices;

    document.getElementById('stat-active-devices').textContent = data.active_devices;
    document.getElementById('stat-total-devices').textContent = data.total_devices;
    document.getElementById('stat-current-rate').textContent = data.current_traffic_human;
    document.getElementById('stat-today-data').textContent = data.total_data_today_human;

    // SNMP Live WAN Telemetry (ppp0)
    const snmpInfo = (snmpData && snmpData.status) ? snmpData.status : data.snmp;
    if (snmpInfo) {
      const snmpDownEl = document.getElementById('stat-snmp-down');
      const snmpUpEl = document.getElementById('stat-snmp-up');
      if (snmpDownEl) snmpDownEl.textContent = snmpInfo.download_human || '0.0 Kbps';
      if (snmpUpEl) snmpUpEl.textContent = snmpInfo.upload_human || '0.0 Kbps';
    }
    
    const healthStatusEl = document.getElementById('stat-health-status');
    if (healthStatusEl) {
      healthStatusEl.textContent = data.is_online ? 'Online' : 'Outage';
      healthStatusEl.style.color = data.is_online ? 'var(--accent-green)' : 'var(--accent-rose)';
    }
    const latValEl = document.getElementById('stat-latency-val');
    if (latValEl) {
      latValEl.textContent = data.is_online ? `${data.internet_latency_ms}ms` : 'Disconnected';
    }

    if (data.top_consumer) {
      document.getElementById('top-consumer-name').textContent = data.top_consumer.name;
      document.getElementById('top-consumer-ip').textContent = `IP: ${data.top_consumer.ip}`;
      document.getElementById('top-consumer-amount').textContent = data.top_consumer.consumed_human;
      
      const topMac = data.top_consumer.mac;
      document.getElementById('view-top-device-btn').onclick = () => {
        if (topMac) {
          openDeviceDetail(topMac);
        } else {
          const matched = allDevicesCache.find(d => d.ip === data.top_consumer.ip || d.custom_name === data.top_consumer.name);
          openDeviceDetail(matched ? matched.mac : null);
        }
      };
    } else {
      document.getElementById('top-consumer-name').textContent = "No traffic yet";
      document.getElementById('top-consumer-ip').textContent = "—";
      document.getElementById('top-consumer-amount').textContent = "0 B";
    }

    lastSparklineData = data.traffic_sparkline;
    const snmpPoints = (snmpData && snmpData.sparkline && snmpData.sparkline.length > 0) ? snmpData.sparkline : null;
    renderDashboardSparkline(data.traffic_sparkline, snmpPoints);

    // Filter pills update
    const activeList = devices.filter(d => d.is_active);
    const offlineList = devices.filter(d => !d.is_active);
    const pillAll = document.getElementById('topo-pill-all');
    const pillActive = document.getElementById('topo-pill-active');
    const pillOffline = document.getElementById('topo-pill-offline');
    if (pillAll) pillAll.textContent = devices.length;
    if (pillActive) pillActive.textContent = activeList.length;
    if (pillOffline) pillOffline.textContent = offlineList.length;

    // Render Visual Radial Topology Map
    renderTopologyMap(data, devices);

    // Active Devices Table
    const tbody = document.getElementById('dashboard-active-tbody');
    if (activeList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">No active clients detected. Ensure router polling is connected in Settings.</td></tr>`;
    } else {
      tbody.innerHTML = activeList.map(d => `
        <tr>
          <td><strong>${escapeHtml(d.custom_name)}</strong></td>
          <td class="mono-cell">${d.ip}</td>
          <td class="mono-cell">${d.mac}</td>
          <td><span class="category-badge ${d.category}">${d.category}</span></td>
          <td class="mono-cell" style="color: var(--accent-cyan); font-weight: 600;">${d.current_speed_human}</td>
          <td class="mono-cell">
            <strong style="color: var(--accent-cyan);">${d.today_bytes_human || d.total_bytes_human}</strong>
            <span style="font-size: 0.72rem; color: var(--text-muted); display: block;">Total: ${d.total_bytes_human}</span>
          </td>
          <td>
            <button class="btn btn-secondary" onclick="openDeviceDetail('${d.mac}')" style="padding: 4px 10px; font-size: 0.78rem;">Details</button>
          </td>
        </tr>
      `).join('');
    }
  } catch (e) {
    console.error("Dashboard error:", e);
  }
}

function renderTopologyMap(overviewData, devices) {
  const svg = document.getElementById('topology-svg');
  if (!svg) return;

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

  // Filter devices according to current filter
  let displayDevices = [];
  if (currentTopoFilter === 'active') {
    displayDevices = devices.filter(d => d.is_active);
  } else if (currentTopoFilter === 'offline') {
    displayDevices = devices.filter(d => !d.is_active);
  } else {
    // All: show active first, then offline
    const active = devices.filter(d => d.is_active);
    const offline = devices.filter(d => !d.is_active);
    displayDevices = [...active, ...offline];
  }

  // Pre-defined radial positions matching the user's uploaded snapshot:
  // Slot 0: Top-Left (Royal Blue card with active wire & moving light pulse, e.g. PC Pixelz 1)
  // Slot 1: Bottom-Left (e.g. Smartphone 3)
  // Slot 2: Bottom-Center-Left (e.g. Laptop Pixelz 2)
  // Slot 3: Bottom-Center-Right (e.g. Laptop Pixelz 2)
  // Slot 4: Bottom-Right (e.g. PC Pixelz 2 / TV)
  // Slot 5: Top-Right (e.g. PC Pixelz 2)
  // Slot 6: Mid-Left
  // Slot 7: Mid-Right
  const slots = [
    { x: 65,  y: 135, w: 200, h: 62, portX: 265, portY: 166, rPortX: 375, rPortY: 220, cp1: [320, 166], cp2: [335, 220] },
    { x: 125, y: 325, w: 195, h: 62, portX: 320, portY: 345, rPortX: 385, rPortY: 260, cp1: [355, 345], cp2: [365, 260] },
    { x: 350, y: 410, w: 195, h: 62, portX: 445, portY: 410, rPortX: 450, rPortY: 270, cp1: [445, 345], cp2: [450, 310] },
    { x: 580, y: 410, w: 195, h: 62, portX: 605, portY: 410, rPortX: 510, rPortY: 270, cp1: [605, 345], cp2: [510, 310] },
    { x: 745, y: 325, w: 195, h: 62, portX: 745, portY: 345, rPortX: 575, rPortY: 260, cp1: [685, 345], cp2: [620, 260] },
    { x: 695, y: 145, w: 195, h: 62, portX: 695, portY: 176, rPortX: 585, rPortY: 220, cp1: [635, 176], cp2: [625, 220] },
    { x: 50,  y: 235, w: 195, h: 62, portX: 245, portY: 266, rPortX: 375, rPortY: 240, cp1: [305, 266], cp2: [335, 240] },
    { x: 755, y: 230, w: 195, h: 62, portX: 755, portY: 261, rPortX: 585, rPortY: 240, cp1: [695, 261], cp2: [640, 240] }
  ];

  const maxDevices = Math.min(displayDevices.length, slots.length);

  // Theme-adaptive palette
  const bgColor = isDark ? '#101116' : '#f8fafc';
  const gridDotColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';
  const wanLineColor = isDark ? '#333948' : '#cbd5e1';
  const ispCardFill = isDark ? '#151720' : '#ffffff';
  const ispCardStroke = isDark ? '#282e3f' : '#e2e8f0';
  const ispTextMain = isDark ? '#f8fafc' : '#0f172a';
  const ispTextSub = isDark ? '#94a3b8' : '#64748b';
  const ispIconBox = isDark ? '#1f2434' : '#f1f5f9';
  const ispIconStroke = isDark ? '#cbd5e1' : '#475569';

  const routerFill = isDark ? '#13151e' : '#ffffff';
  const routerTextMain = isDark ? '#ffffff' : '#0f172a';
  const routerTextSub = isDark ? '#93c5fd' : '#2563eb';
  const routerIconBox = isDark ? '#1c2132' : '#eff6ff';
  const routerIconStroke = isDark ? '#ffffff' : '#2563eb';

  const defaultActiveWire = isDark ? '#384052' : '#94a3b8';
  const offlineWireColor = isDark ? '#232836' : '#cbd5e1';

  const ispName = escapeHtml(overviewData.isp_name || 'Hathway');
  const isInternetOnline = Boolean(overviewData.is_online);
  const isRouterRebooting = Boolean(overviewData.is_rebooting);
  const isRouterConnected = Boolean(overviewData.router_connected ?? true);
  const isRouterDown = isRouterRebooting || !isRouterConnected;

  // Build SVG XML
  let svgContent = `
    <defs>
      <!-- Subtle dot grid pattern (Theme Adaptive) -->
      <pattern id="topoGridPattern" width="22" height="22" patternUnits="userSpaceOnUse">
        <circle cx="2" cy="2" r="1.1" fill="${gridDotColor}"/>
      </pattern>
      
      <!-- Glow Filters -->
      <filter id="glow-blue" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3.5" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      
      <filter id="glow-amber" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="3.5" result="blur"/>
        <feFlood flood-color="#f59e0b" flood-opacity="0.6" result="color"/>
        <feComposite in2="blur" operator="in"/>
        <feMerge>
          <feMergeNode/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>

      <filter id="glow-green" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="2.5" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>

      <filter id="glow-red" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="2.5" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>

      <filter id="laser-pulse" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>

      <!-- Gradients -->
      <linearGradient id="blueCardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#1d4ed8"/>
        <stop offset="100%" stop-color="#2563eb"/>
      </linearGradient>

      <linearGradient id="activeWireGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#3b82f6"/>
        <stop offset="100%" stop-color="#60a5fa"/>
      </linearGradient>
    </defs>

    <!-- Canvas Background with dot grid -->
    <rect width="960" height="520" rx="14" fill="${bgColor}"/>
    <rect width="960" height="520" rx="14" fill="url(#topoGridPattern)"/>

    <!-- WAN to Router Vertical Link (Dynamic: Green when online, Red/Dashed on Outage, Amber on Reboot) -->
    ${isRouterDown ? `
      <line x1="480" y1="96" x2="480" y2="206" stroke="#f59e0b" stroke-width="2.5" stroke-dasharray="6 6"/>
      <circle cx="480" cy="99" r="4.5" fill="#ef4444" filter="url(#glow-red)"/>
      <circle cx="480" cy="204" r="4.5" fill="#f59e0b" filter="url(#glow-amber)"/>
    ` : (isInternetOnline ? `
      <line x1="480" y1="96" x2="480" y2="206" stroke="${wanLineColor}" stroke-width="2"/>
      <circle cx="480" cy="99" r="4" fill="#10b981" filter="url(#glow-green)"/>
      <circle cx="480" cy="204" r="4" fill="#10b981" filter="url(#glow-green)"/>
    ` : `
      <line x1="480" y1="96" x2="480" y2="206" stroke="#ef4444" stroke-width="2.5" stroke-dasharray="6 6"/>
      <circle cx="480" cy="99" r="4.5" fill="#ef4444" filter="url(#glow-red)"/>
      <circle cx="480" cy="204" r="4.5" fill="#ef4444" filter="url(#glow-red)"/>
    `)}
  `;

  // Draw Device Connecting Wires first (behind node cards)
  for (let i = 0; i < maxDevices; i++) {
    const dev = displayDevices[i];
    const s = slots[i];
    const pathD = `M ${s.portX} ${s.portY} C ${s.cp1[0]} ${s.cp1[1]}, ${s.cp2[0]} ${s.cp2[1]}, ${s.rPortX} ${s.rPortY}`;

    const isPrimaryHighlight = (!isRouterDown && i === 0 && dev.is_active);

    if (isRouterDown) {
      // Router rebooting: connection to all devices is lost (dashed offline line + red join dots)
      svgContent += `
        <path d="${pathD}" fill="none" stroke="${offlineWireColor}" stroke-width="1.8" stroke-dasharray="5 5" class="topo-wire" opacity="0.6"/>
        <circle cx="${s.rPortX}" cy="${s.rPortY}" r="4" fill="#ef4444" filter="url(#glow-red)" class="topo-port-dot offline"/>
        <circle cx="${s.portX}" cy="${s.portY}" r="4" fill="#ef4444" filter="url(#glow-red)" class="topo-port-dot offline"/>
      `;
    } else if (isPrimaryHighlight) {
      // Primary Active Glowing Cable (Royal Blue with laser pulse)
      svgContent += `
        <path d="${pathD}" fill="none" stroke="#2563eb" stroke-width="3" filter="url(#glow-blue)"/>
        <circle cx="${s.rPortX}" cy="${s.rPortY}" r="4.5" fill="#10b981" filter="url(#glow-green)"/>
        <circle cx="${s.portX}" cy="${s.portY}" r="4.5" fill="#10b981" filter="url(#glow-green)"/>
        
        <!-- Traveling Laser Pulse -->
        <circle r="4.5" fill="#ffffff" filter="url(#laser-pulse)">
          <animateMotion path="${pathD}" dur="2.0s" repeatCount="indefinite" keyPoints="1;0" keyTimes="0;1"/>
        </circle>
      `;
    } else if (dev.is_active) {
      // All other active devices also get animated traffic pulses / light beads
      const animDur = (2.2 + (i * 0.35)).toFixed(1);
      svgContent += `
        <path d="${pathD}" fill="none" stroke="${defaultActiveWire}" stroke-width="2.2" class="topo-wire"/>
        <circle cx="${s.rPortX}" cy="${s.rPortY}" r="4" fill="#10b981" filter="url(#glow-green)"/>
        <circle cx="${s.portX}" cy="${s.portY}" r="4" fill="#10b981" filter="url(#glow-green)"/>
        
        <!-- Animated Active Data Pulse on every active connection -->
        <circle r="3.5" fill="#10b981" filter="url(#glow-green)">
          <animateMotion path="${pathD}" dur="${animDur}s" repeatCount="indefinite" keyPoints="1;0" keyTimes="0;1"/>
        </circle>
      `;
    } else {
      // Offline Devices: Dashed wire + RED dots at joins (matches active green dots)
      svgContent += `
        <path d="${pathD}" fill="none" stroke="${offlineWireColor}" stroke-width="1.8" stroke-dasharray="5 5" class="topo-wire"/>
        <circle cx="${s.rPortX}" cy="${s.rPortY}" r="4" fill="#ef4444" filter="url(#glow-red)" class="topo-port-dot offline"/>
        <circle cx="${s.portX}" cy="${s.portY}" r="4" fill="#ef4444" filter="url(#glow-red)" class="topo-port-dot offline"/>
      `;
    }
  }

  // Draw Top Node: Configurable ISP / Internet WAN (Dynamic Online vs Outage)
  const ispStroke = isInternetOnline ? ispCardStroke : '#ef4444';
  const ispFilter = isInternetOnline ? '' : 'filter="url(#glow-red)"';
  const ispLedColor = isInternetOnline ? '#10b981' : '#ef4444';
  const ispLedFilter = isInternetOnline ? 'filter="url(#glow-green)"' : 'filter="url(#glow-red)"';
  const ispStatusText = isInternetOnline ? 'ISP • Connected' : '● Disconnected';
  const ispStatusColor = isInternetOnline ? ispTextSub : '#f43f5e';
  const ispTitleText = isInternetOnline ? ispName : `${ispName} (Offline)`;

  svgContent += `
    <g class="topo-node" onclick="switchView('health')" style="cursor: pointer;">
      <rect x="360" y="42" width="240" height="54" rx="14" fill="${ispCardFill}" stroke="${ispStroke}" stroke-width="${isInternetOnline ? 1.5 : 2}" ${ispFilter}/>
      <!-- Inner Icon Box -->
      <rect x="372" y="49" width="40" height="40" rx="10" fill="${ispIconBox}"/>
      <!-- Modem / ISP Icon -->
      <g transform="translate(380, 57)" stroke="${ispIconStroke}" stroke-width="1.8" fill="none">
        <rect x="1" y="7" width="22" height="9" rx="2"/>
        <line x1="5" y1="1" x2="5" y2="7"/>
        <line x1="19" y1="1" x2="19" y2="7"/>
        <circle cx="6" cy="11.5" r="1.5" fill="${ispLedColor}" ${ispLedFilter}/>
        <circle cx="11" cy="11.5" r="1.5" fill="${ispLedColor}" ${ispLedFilter}/>
      </g>
      <!-- Labels -->
      <text x="422" y="66" fill="${isInternetOnline ? ispTextMain : '#f43f5e'}" font-size="13" font-weight="700" font-family="system-ui, sans-serif">
        ${ispTitleText}
      </text>
      <text x="422" y="82" fill="${ispStatusColor}" font-size="11" font-weight="${isInternetOnline ? 400 : 600}" font-family="system-ui, sans-serif">
        ${ispStatusText}
      </text>
    </g>
  `;

  // Draw Center Node: TP-Link Router 1 (Amber on Reboot / Blue on Normal)
  const rBorderColor = isRouterDown ? '#f59e0b' : '#2563eb';
  const rFilter = isRouterDown ? 'filter="url(#glow-amber)"' : 'filter="url(#glow-blue)"';
  const rIconBoxFill = isRouterDown ? (isDark ? '#2b2108' : '#fef3c7') : routerIconBox;
  const rIconColor = isRouterDown ? '#f59e0b' : routerIconStroke;
  const rTitleText = isRouterDown ? 'TP-Link (Rebooting)' : 'TP-Link Router 1';
  const rTitleColor = isRouterDown ? '#f59e0b' : routerTextMain;
  const rSubText = isRouterDown ? '192.168.0.1 • Rebooting' : '192.168.0.1 (Gateway)';
  const rSubColor = isRouterDown ? '#fbbf24' : routerTextSub;

  svgContent += `
    <g class="topo-node" onclick="openRouterModal()" style="cursor: pointer;">
      <title>${isRouterDown ? 'Gateway Router is Rebooting' : 'Click for Router Diagnostics & Reboot'}</title>
      <rect x="355" y="206" width="250" height="64" rx="14" fill="${routerFill}" stroke="${rBorderColor}" stroke-width="${isRouterDown ? 2.5 : 2}" ${rFilter}/>
      <!-- Inner Icon Box -->
      <rect x="367" y="218" width="40" height="40" rx="10" fill="${rIconBoxFill}"/>
      <!-- Router / Screen Icon -->
      <g transform="translate(375, 226)" stroke="${rIconColor}" stroke-width="1.8" fill="none">
        <rect x="2" y="2" width="20" height="14" rx="2"/>
        <line x1="8" y1="20" x2="16" y2="20"/>
        <line x1="12" y1="16" x2="12" y2="20"/>
      </g>
      <!-- Labels -->
      <text x="418" y="233" fill="${rTitleColor}" font-size="13" font-weight="700" font-family="system-ui, sans-serif">
        ${rTitleText}
      </text>
      <text x="418" y="252" fill="${rSubColor}" font-size="11" font-weight="${isRouterDown ? 600 : 400}" font-family="system-ui, sans-serif">
        ${rSubText}
      </text>
    </g>
  `;

  // Draw Device Cards
  for (let i = 0; i < maxDevices; i++) {
    const dev = displayDevices[i];
    const s = slots[i];
    const isPrimaryHighlight = (!isRouterDown && i === 0 && dev.is_active);

    const safeName = escapeHtml(dev.custom_name || dev.hostname || "Device");
    const ipLabel = dev.ip ? `${dev.ip}/ 24` : '192.168.0.x';
    const iconSvgPaths = getSvgDeviceIcon(dev.category);

    if (isPrimaryHighlight) {
      // Royal Blue Primary Node (Matches PC Pixelz 1)
      svgContent += `
        <g class="topo-node topo-node-primary" onclick="openDeviceDetail('${dev.mac}')" style="cursor: pointer;">
          <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="14" fill="url(#blueCardGrad)" filter="url(#glow-blue)"/>
          
          <!-- Inner Icon Box -->
          <rect x="${s.x + 12}" y="${s.y + 11}" width="40" height="40" rx="10" fill="rgba(255, 255, 255, 0.22)"/>
          
          <!-- Icon -->
          <g transform="translate(${s.x + 20}, ${s.y + 19})" stroke="#ffffff" stroke-width="1.8" fill="none">
            ${iconSvgPaths}
          </g>
          
          <!-- Floating notification envelope / activity badge -->
          <g transform="translate(${s.x - 6}, ${s.y + 36})">
            <rect x="0" y="0" width="22" height="15" rx="3" fill="#eab308" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.4))"/>
            <path d="M 2 3 L 11 9 L 20 3" stroke="#713f12" stroke-width="1.3" fill="none"/>
          </g>

          <!-- Device Name and IP -->
          <text x="${s.x + 60}" y="${s.y + 27}" fill="#ffffff" font-size="13" font-weight="700" font-family="system-ui, sans-serif">
            ${truncateText(safeName, 15)}
          </text>
          <text x="${s.x + 60}" y="${s.y + 45}" fill="#dbeafe" font-size="11" font-family="system-ui, sans-serif">
            ${ipLabel}
          </text>
        </g>
      `;
    } else {
      // Standard Node (Adaptive Light/Dark Theme)
      const isOnline = (!isRouterDown && dev.is_active);
      let cardFill, cardStroke, nameFill, subFill, iconStroke, iconBoxFill, cardOpacity;

      if (isOnline) {
        cardFill = isDark ? '#151720' : '#ffffff';
        cardStroke = isDark ? '#2a3040' : '#e2e8f0';
        nameFill = isDark ? '#f1f5f9' : '#0f172a';
        subFill = isDark ? '#94a3b8' : '#64748b';
        iconStroke = isDark ? '#cbd5e1' : '#475569';
        iconBoxFill = isDark ? '#1d2232' : '#f1f5f9';
        cardOpacity = '1';
      } else {
        cardFill = isDark ? '#12141a' : '#f1f5f9';
        cardStroke = isDark ? '#202430' : '#e2e8f0';
        nameFill = isDark ? '#94a3b8' : '#64748b';
        subFill = isRouterDown ? '#ef4444' : (isDark ? '#64748b' : '#94a3b8');
        iconStroke = isDark ? '#64748b' : '#94a3b8';
        iconBoxFill = isDark ? '#181b24' : '#e2e8f0';
        cardOpacity = isRouterDown ? '0.6' : '0.7';
      }

      const displaySub = isRouterDown ? `${ipLabel} • Lost` : ipLabel;

      svgContent += `
        <g class="topo-node" onclick="openDeviceDetail('${dev.mac}')" style="cursor: pointer; opacity: ${cardOpacity};">
          <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="14" fill="${cardFill}" stroke="${cardStroke}" stroke-width="1.5"/>
          
          <!-- Inner Icon Box -->
          <rect x="${s.x + 12}" y="${s.y + 11}" width="40" height="40" rx="10" fill="${iconBoxFill}"/>
          
          <!-- Icon -->
          <g transform="translate(${s.x + 20}, ${s.y + 19})" stroke="${iconStroke}" stroke-width="1.8" fill="none">
            ${iconSvgPaths}
          </g>

          <!-- Device Name and IP -->
          <text x="${s.x + 60}" y="${s.y + 27}" fill="${nameFill}" font-size="12.5" font-weight="600" font-family="system-ui, sans-serif">
            ${truncateText(safeName, 15)}
          </text>
          <text x="${s.x + 60}" y="${s.y + 45}" fill="${subFill}" font-size="11" font-family="system-ui, sans-serif">
            ${displaySub}
          </text>
        </g>
      `;
    }
  }

  svg.innerHTML = svgContent;
}

function truncateText(str, max) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max - 1) + '…' : str;
}

function getSvgDeviceIcon(cat) {
  if (cat === 'mobile') {
    return `<rect x="5" y="1" width="14" height="22" rx="2.5"/><circle cx="12" cy="18" r="1" fill="currentColor"/>`;
  } else if (cat === 'laptop') {
    return `<rect x="4" y="3" width="16" height="12" rx="1.5"/><line x1="2" y1="18" x2="22" y2="18"/><line x1="10" y1="18" x2="14" y2="18"/>`;
  } else if (cat === 'tv') {
    return `<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="7" y1="21" x2="17" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>`;
  } else {
    // Desktop default
    return `<rect x="2" y="2" width="20" height="14" rx="2"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="16" x2="12" y2="20"/>`;
  }
}

function getCategoryIconSvg(cat) {
  if (cat === 'mobile') {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>`;
  } else if (cat === 'laptop') {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/></svg>`;
  } else if (cat === 'tv') {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>`;
  } else if (cat === 'iot') {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 14 5-5-5-5"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/></svg>`;
  } else {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>`;
  }
}

function renderDashboardSparkline(points, snmpPoints) {
  const ctx = document.getElementById('dashboardTrafficChart');
  if (!ctx) return;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  // 1. Dual-line SNMP High-Speed Real-time Series (Download vs Upload)
  if (snmpPoints && snmpPoints.length > 0) {
    const labels = snmpPoints.map(p => new Date(p.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    const dlValues = snmpPoints.map(p => p.dl);
    const ulValues = snmpPoints.map(p => p.ul);

    if (charts.dashboardTraffic && charts.dashboardTraffic.data.datasets.length === 2) {
      charts.dashboardTraffic.data.labels = labels;
      charts.dashboardTraffic.data.datasets[0].data = dlValues;
      charts.dashboardTraffic.data.datasets[1].data = ulValues;
      charts.dashboardTraffic.data.datasets[0].pointRadius = 0;
      charts.dashboardTraffic.data.datasets[1].pointRadius = 0;
      charts.dashboardTraffic.options.scales.y.grid.color = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
      charts.dashboardTraffic.update('none');
      return;
    }

    if (charts.dashboardTraffic) {
      charts.dashboardTraffic.destroy();
    }

    const gradDl = ctx.getContext('2d').createLinearGradient(0, 0, 0, 240);
    gradDl.addColorStop(0, 'rgba(6, 182, 212, 0.28)');
    gradDl.addColorStop(1, 'rgba(6, 182, 212, 0.0)');

    const gradUl = ctx.getContext('2d').createLinearGradient(0, 0, 0, 240);
    gradUl.addColorStop(0, 'rgba(192, 132, 252, 0.22)');
    gradUl.addColorStop(1, 'rgba(192, 132, 252, 0.0)');

    charts.dashboardTraffic = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '↓ Download (ppp0)',
            data: dlValues,
            borderColor: '#06b6d4',
            backgroundColor: gradDl,
            fill: true,
            tension: 0.38,
            borderWidth: 2.2,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHitRadius: 10
          },
          {
            label: '↑ Upload (ppp0)',
            data: ulValues,
            borderColor: '#c084fc',
            backgroundColor: gradUl,
            fill: true,
            tension: 0.38,
            borderWidth: 2.2,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHitRadius: 10
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              boxWidth: 10,
              boxHeight: 10,
              font: { size: 10 },
              color: isDark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)'
            }
          },
          tooltip: {
            callbacks: {
              label: context => `${context.dataset.label}: ${formatMbps(context.parsed.y)}`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 10 } } },
          y: {
            grid: { color: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)' },
            ticks: { callback: v => formatMbps(v), font: { size: 10 } }
          }
        }
      }
    });
    return;
  }

  // 2. Fallback to client aggregate sparkline
  if (!points || points.length === 0) return;
  const labels = points.map(p => new Date(p.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  const values = points.map(p => p.bytes);

  if (charts.dashboardTraffic && charts.dashboardTraffic.data.datasets.length === 1) {
    charts.dashboardTraffic.data.labels = labels;
    charts.dashboardTraffic.data.datasets[0].data = values;
    charts.dashboardTraffic.data.datasets[0].pointRadius = 0;
    charts.dashboardTraffic.options.scales.y.grid.color = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    charts.dashboardTraffic.update();
    return;
  }

  if (charts.dashboardTraffic) {
    charts.dashboardTraffic.destroy();
  }

  const gradFallback = ctx.getContext('2d').createLinearGradient(0, 0, 0, 240);
  gradFallback.addColorStop(0, 'rgba(6, 182, 212, 0.25)');
  gradFallback.addColorStop(1, 'rgba(6, 182, 212, 0.0)');

  charts.dashboardTraffic = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Live Bandwidth',
        data: values,
        borderColor: '#06b6d4',
        backgroundColor: gradFallback,
        fill: true,
        tension: 0.38,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHitRadius: 10
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: context => `Traffic: ${formatBytes(context.parsed.y)}/s`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 10 } } },
        y: {
          grid: { color: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)' },
          ticks: { callback: v => formatBytes(v), font: { size: 10 } }
        }
      }
    }
  });
}

// High-frequency live SNMP poller (2.5s) for smooth speedometer & dual charts
async function pollSnmpLive() {
  if (currentView !== 'dashboard') return;
  try {
    const res = await fetch('/api/snmp/live');
    if (!res.ok) return;
    const data = await res.json();
    if (!data) return;

    if (data.status) {
      const snmpDownEl = document.getElementById('stat-snmp-down');
      const snmpUpEl = document.getElementById('stat-snmp-up');
      if (snmpDownEl) snmpDownEl.textContent = data.status.download_human || '0.0 Kbps';
      if (snmpUpEl) snmpUpEl.textContent = data.status.upload_human || '0.0 Kbps';
    }

    if (data.sparkline && data.sparkline.length > 0) {
      renderDashboardSparkline(null, data.sparkline);
    }
  } catch (e) {}
}

// 2. Devices Inventory
async function loadDevices() {
  try {
    const res = await fetch('/api/devices');
    if (!res.ok) return;
    const devices = await res.json();
    allDevicesCache = devices;
    renderFilteredDevices();
  } catch (e) {
    console.error("Devices error:", e);
  }
}

function renderFilteredDevices() {
  const query = (document.getElementById('device-search-input').value || '').toLowerCase();
  const activeCat = document.querySelector('#device-category-pills .pill-btn.active').dataset.cat;

  const filtered = allDevicesCache.filter(d => {
    const matchesQuery = d.custom_name.toLowerCase().includes(query) ||
                         d.ip.toLowerCase().includes(query) ||
                         d.mac.toLowerCase().includes(query);
    const matchesCat = (activeCat === 'all') || (d.category === activeCat);
    return matchesQuery && matchesCat;
  });

  const tbody = document.getElementById('devices-inventory-tbody');
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 32px;">No matching devices found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(d => `
    <tr>
      <td>
        <span class="status-badge ${d.is_active ? 'online' : 'offline'}">
          <span class="pulse-dot"></span> ${d.is_active ? 'Active' : 'Offline'}
        </span>
      </td>
      <td>
        <strong>${escapeHtml(d.custom_name)}</strong>
        ${d.interface ? `<span style="font-size: 0.7rem; color: var(--text-muted); display: block;">${escapeHtml(d.interface)}</span>` : ''}
      </td>
      <td><span class="category-badge ${d.category}">${d.category}</span></td>
      <td class="mono-cell">${d.ip}</td>
      <td class="mono-cell">${d.mac}</td>
      <td>${escapeHtml(d.vendor || 'Unknown')}</td>
      <td class="mono-cell" style="color: var(--accent-cyan); font-weight: 600;">${d.current_speed_human}</td>
      <td class="mono-cell">${d.total_bytes_human}</td>
      <td>${timeAgo(d.last_seen)}</td>
      <td>
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-secondary" onclick="openDeviceDetail('${d.mac}')" style="padding: 4px 8px; font-size: 0.78rem;">View</button>
          <button class="btn btn-secondary" onclick="openEditModal('${d.mac}')" style="padding: 4px 8px; font-size: 0.78rem;">Edit</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// 3. Device Details Deep Dive
async function openDeviceDetail(mac) {
  if (mac) {
    currentDetailMac = mac;
  }
  switchView('device-detail');
}

async function loadDeviceDetail(mac) {
  if (!mac) {
    mac = currentDetailMac;
  }
  // If still no mac supplied, select first active or available device
  if (!mac) {
    if (allDevicesCache.length === 0) {
      try {
        const res = await fetch('/api/devices');
        if (res.ok) allDevicesCache = await res.json();
      } catch (e) {}
    }
    const first = allDevicesCache.find(d => d.is_active) || allDevicesCache[0];
    if (first) {
      mac = first.mac;
      currentDetailMac = mac;
    } else {
      document.getElementById('detail-device-name').textContent = "No Devices Discovered";
      return;
    }
  }
  currentDetailMac = mac;

  // Update back button label depending on origin
  const backLabel = document.getElementById('telemetry-back-label');
  if (backLabel) {
    backLabel.textContent = (previousView === 'dashboard') ? 'Back to Dashboard' : 'Back to Devices';
  }

  // Populate device switcher dropdown
  const selector = document.getElementById('telemetry-device-select');
  if (selector && allDevicesCache.length > 0) {
    const sorted = [...allDevicesCache].sort((a, b) => (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0));
    selector.innerHTML = sorted.map(d => `
      <option value="${d.mac}" ${d.mac === mac ? 'selected' : ''}>
        ${d.is_active ? '🟢 [Online]' : '🔴 [Offline]'} ${escapeHtml(d.custom_name)} (${d.ip})
      </option>
    `).join('');
    selector.value = mac;
    selector.onchange = (e) => {
      currentDetailMac = e.target.value;
      loadDeviceDetail(e.target.value);
    };
  }

  try {
    const res = await fetch(`/api/devices/${encodeURIComponent(mac)}`);
    if (!res.ok) {
      document.getElementById('detail-device-name').textContent = "Device telemetry not found";
      return;
    }
    const data = await res.json();
    const d = data.device;

    document.getElementById('detail-device-name').textContent = d.custom_name;
    const catBadge = document.getElementById('detail-category-badge');
    if (catBadge) {
      catBadge.className = `category-badge ${d.category}`;
      catBadge.textContent = d.category;
    }
    document.getElementById('detail-ip-badge').textContent = `IP: ${d.ip}`;
    document.getElementById('detail-mac-badge').textContent = `MAC: ${d.mac}`;

    document.getElementById('detail-today-data').textContent = data.consumption.today;
    document.getElementById('detail-week-data').textContent = data.consumption.week;
    document.getElementById('detail-month-data').textContent = data.consumption.month;

    const editBtn = document.getElementById('edit-detail-device-btn');
    if (editBtn) editBtn.onclick = () => openEditModal(d.mac);

    renderDeviceHourlyChart(data.hourly_chart || []);
    renderDeviceProtocolChart(data.protocols || { udp: 0, tcp_syn: 0, icmp: 0 });

    const evtContainer = document.getElementById('device-events-timeline');
    if (!data.events || data.events.length === 0) {
      evtContainer.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem;">No recent state changes recorded for this client.</p>`;
    } else {
      evtContainer.innerHTML = data.events.map(e => `
        <div class="event-item">
          <div class="event-icon-badge" style="${getEventBadgeColor(e.event_type)}">
            ${getEventIcon(e.event_type)}
          </div>
          <div class="event-details">
            <div class="event-title-row">
              <span class="event-title">${escapeHtml(e.title)}</span>
              <span class="event-time">${timeAgo(e.timestamp)}</span>
            </div>
            <div class="event-desc">${escapeHtml(e.description)}</div>
          </div>
        </div>
      `).join('');
    }
  } catch (e) {
    console.error("Detail error:", e);
  }
}

function renderDeviceHourlyChart(points) {
  const ctx = document.getElementById('deviceHourlyChart');
  if (!ctx) return;

  const labels = points.length > 0
    ? points.map(p => new Date(p.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    : [new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })];
  const dataVals = points.length > 0 ? points.map(p => p.bytes) : [0];

  if (charts.deviceHourly) {
    charts.deviceHourly.data.labels = labels;
    charts.deviceHourly.data.datasets[0].data = dataVals;
    charts.deviceHourly.resize();
    charts.deviceHourly.update();
  } else {
    charts.deviceHourly = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Consumed Bytes',
          data: dataVals,
          backgroundColor: 'rgba(59, 130, 246, 0.65)',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 12, font: { size: 10 } } },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { callback: v => formatBytes(v), font: { size: 10 } }
          }
        }
      }
    });
  }
}

function renderDeviceProtocolChart(protocols) {
  const ctx = document.getElementById('deviceProtocolChart');
  if (!ctx) return;

  if (charts.deviceProtocol) charts.deviceProtocol.destroy();

  const total = protocols.udp + protocols.tcp_syn + protocols.icmp;
  const data = total > 0 ? [protocols.udp, protocols.tcp_syn, protocols.icmp] : [1, 1, 1];
  const labels = total > 0 ? ['UDP', 'TCP/SYN', 'ICMP'] : ['No Data Yet', '', ''];

  charts.deviceProtocol = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: ['#06b6d4', '#3b82f6', '#f43f5e'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } }
      }
    }
  });
}

// 4. Traffic Analytics
async function loadTrafficAnalytics() {
  try {
    const res = await fetch(`/api/traffic?period_hours=${currentTrafficHours}`);
    if (!res.ok) return;
    const data = await res.json();

    const ctx = document.getElementById('trafficAnalyticsChart');
    if (!ctx) return;

    const labels = data.timeline.map(p => new Date(p.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    const values = data.timeline.map(p => p.bytes);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    const grad = ctx.getContext('2d').createLinearGradient(0, 0, 0, 260);
    grad.addColorStop(0, 'rgba(139, 92, 246, 0.32)');
    grad.addColorStop(1, 'rgba(139, 92, 246, 0.0)');

    if (charts.trafficAnalytics) {
      charts.trafficAnalytics.data.labels = labels;
      charts.trafficAnalytics.data.datasets[0].data = values;
      charts.trafficAnalytics.data.datasets[0].pointRadius = 0;
      charts.trafficAnalytics.options.scales.y.grid.color = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
      charts.trafficAnalytics.resize();
      charts.trafficAnalytics.update();
    } else {
      charts.trafficAnalytics = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Network Consumption',
            data: values,
            borderColor: '#8b5cf6',
            backgroundColor: grad,
            fill: true,
            tension: 0.38,
            borderWidth: 2.2,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointHitRadius: 10
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: context => `Traffic: ${formatBytes(context.parsed.y)}`
              }
            }
          },
          scales: {
            x: { grid: { display: false }, ticks: { maxTicksLimit: 12, font: { size: 10 } } },
            y: {
              grid: { color: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)' },
              ticks: { callback: v => formatBytes(v), font: { size: 10 } }
            }
          }
        }
      });
    }

    // Top Consumers Table
    const tbody = document.getElementById('top-consumers-tbody');
    if (!data.top_devices || data.top_devices.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">No consumption recorded yet for this period.</td></tr>`;
    } else {
      tbody.innerHTML = data.top_devices.map((d, i) => `
        <tr>
          <td><strong>#${i + 1}</strong></td>
          <td><strong>${escapeHtml(d.name)}</strong></td>
          <td><span class="category-badge ${d.category}">${d.category}</span></td>
          <td class="mono-cell">${d.ip}</td>
          <td class="mono-cell" style="color: var(--accent-purple); font-weight: 700;">${d.human}</td>
        </tr>
      `).join('');
    }
  } catch (e) {
    console.error("Traffic error:", e);
  }
}

// 5. Internet Health
async function loadInternetHealth() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return;
    const data = await res.json();

    const isOnline = Boolean(data.is_online);

    // Internet Status card
    const internetStatusEl = document.getElementById('health-internet-status');
    const internetSubEl = document.getElementById('health-internet-sub');
    const internetIconEl = document.getElementById('health-internet-icon');
    if (internetStatusEl) {
      internetStatusEl.textContent = isOnline ? 'Online' : 'Outage';
      internetStatusEl.style.color = isOnline ? 'var(--accent-green)' : 'var(--accent-rose)';
    }
    if (internetSubEl) {
      internetSubEl.textContent = isOnline 
        ? `Connected via ISP • 24h Uptime: ${data.uptime_pct}%` 
        : `Connection lost (DNS timeout) • 24h Uptime: ${data.uptime_pct}%`;
    }
    if (internetIconEl) {
      internetIconEl.className = isOnline ? 'stat-icon green' : 'stat-icon rose';
    }

    // Legacy or optional uptime element check
    const uptimeEl = document.getElementById('health-uptime-val');
    if (uptimeEl) {
      uptimeEl.textContent = `${data.uptime_pct}%`;
    }

    // Gateway / Router card
    const gwStatusEl = document.getElementById('health-gw-status');
    if (gwStatusEl) {
      gwStatusEl.textContent = data.gateway_online ? 'Online' : 'Unreachable';
      gwStatusEl.style.color = data.gateway_online ? 'var(--accent-green)' : 'var(--accent-rose)';
    }

    const gwLatEl = document.getElementById('health-gw-lat');
    if (gwLatEl) {
      gwLatEl.textContent = data.current_gateway_lat ?? 0;
    }

    // WAN Latency card
    const wanLatEl = document.getElementById('health-wan-lat');
    const wanSubEl = document.getElementById('health-wan-sub');
    if (wanLatEl) {
      if (isOnline) {
        wanLatEl.textContent = `${data.current_internet_lat ?? 0}ms`;
        wanLatEl.style.color = 'var(--accent-blue)';
      } else {
        wanLatEl.textContent = 'Timed Out';
        wanLatEl.style.color = 'var(--accent-rose)';
      }
    }
    if (wanSubEl) {
      wanSubEl.textContent = isOnline ? 'Cloud DNS probe (1.1.1.1)' : 'Probe response failed';
    }

    // Packet Loss card
    const lossEl = document.getElementById('health-packet-loss');
    const lossSubEl = document.getElementById('health-packet-loss-sub');
    const lossIconEl = document.getElementById('health-loss-icon');
    const loss = data.current_packet_loss ?? 0;
    if (lossEl) {
      lossEl.textContent = `${loss}%`;
      if (!isOnline || loss >= 100) {
        lossEl.style.color = 'var(--accent-rose)';
      } else if (loss > 0) {
        lossEl.style.color = 'var(--accent-amber)';
      } else {
        lossEl.style.color = 'var(--accent-green)';
      }
    }
    if (lossSubEl) {
      if (!isOnline || loss >= 100) {
        lossSubEl.textContent = '100% probes lost (Outage)';
      } else if (loss > 0) {
        lossSubEl.textContent = `${loss}% probe packet loss`;
      } else {
        lossSubEl.textContent = 'Zero dropped probes';
      }
    }
    if (lossIconEl) {
      if (!isOnline || loss >= 100) {
        lossIconEl.className = 'stat-icon rose';
      } else if (loss > 0) {
        lossIconEl.className = 'stat-icon amber';
      } else {
        lossIconEl.className = 'stat-icon green';
      }
    }

    // WAN & ISP Connection Details
    const wan = data.wan_info || {};
    const extIpEl = document.getElementById('wan-ext-ip');
    if (extIpEl) extIpEl.textContent = wan.external_ip || '--';

    const gwIpEl = document.getElementById('wan-gw-ip');
    if (gwIpEl) gwIpEl.textContent = wan.gateway_ip || '--';

    const dnsEl = document.getElementById('wan-dns');
    if (dnsEl) dnsEl.textContent = wan.dns_servers_str || '--';

    const connTypeEl = document.getElementById('wan-conn-type');
    if (connTypeEl) {
      const typeStr = [wan.transport_type, wan.connection_type].filter(Boolean).join(' • ');
      connTypeEl.textContent = typeStr || '--';
    }

    const macEl = document.getElementById('wan-mac');
    if (macEl) macEl.textContent = wan.mac_address || '--';

    const uptimeEl2 = document.getElementById('wan-uptime');
    if (uptimeEl2) {
      if (wan.uptime_seconds) {
        const secs = wan.uptime_seconds;
        const d = Math.floor(secs / 86400);
        const h = Math.floor((secs % 86400) / 3600);
        const m = Math.floor((secs % 3600) / 60);
        uptimeEl2.textContent = d > 0 ? `${d}d ${h}h ${m}m` : (h > 0 ? `${h}h ${m}m` : `${m}m ${secs % 60}s`);
      } else {
        uptimeEl2.textContent = '--';
      }
    }

    const badgeEl = document.getElementById('wan-conn-status-badge');
    if (badgeEl) {
      const isConnected = wan.connection_status === 'Connected' || isOnline;
      badgeEl.textContent = isConnected ? 'Connected' : 'Disconnected';
      badgeEl.className = isConnected ? 'category-badge network' : 'category-badge iot';
      badgeEl.style.color = isConnected ? 'var(--accent-green)' : 'var(--accent-rose)';
    }

    const ctx = document.getElementById('healthLatencyChart');
    if (!ctx) return;

    const labels = data.timeline.map(p => new Date(p.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    const wanLat = data.timeline.map(p => p.internet_lat);
    const gwLat = data.timeline.map(p => p.gateway_lat);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    if (charts.healthLatency) {
      charts.healthLatency.data.labels = labels;
      charts.healthLatency.data.datasets[0].data = wanLat;
      charts.healthLatency.data.datasets[1].data = gwLat;
      charts.healthLatency.data.datasets[0].pointRadius = 0;
      charts.healthLatency.data.datasets[1].pointRadius = 0;
      charts.healthLatency.options.scales.y.grid.color = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
      charts.healthLatency.resize();
      charts.healthLatency.update();
    } else {
      charts.healthLatency = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Internet Latency (ms)',
              data: wanLat,
              borderColor: '#3b82f6',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              tension: 0.35,
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 5,
              pointHitRadius: 10
            },
            {
              label: 'Gateway Latency (ms)',
              data: gwLat,
              borderColor: '#10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              tension: 0.35,
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 5,
              pointHitRadius: 10
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { grid: { display: false }, ticks: { maxTicksLimit: 10, font: { size: 10 } } },
            y: {
              grid: { color: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)' },
              ticks: { callback: v => `${v}ms`, font: { size: 10 } }
            }
          }
        }
      });
    }

    const outContainer = document.getElementById('health-outage-timeline');
    if (data.outages.length === 0) {
      outContainer.innerHTML = `<p style="color: var(--accent-green); font-size: 0.85rem; font-weight: 500;">Zero connection outages detected in the last 24 hours.</p>`;
    } else {
      outContainer.innerHTML = data.outages.map(o => {
        const isResolved = o.event_type === 'OUTAGE_RESOLVED' || (o.title && o.title.toLowerCase().includes('restored'));
        const badgeBg = isResolved ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)';
        const badgeColor = isResolved ? 'var(--accent-green)' : 'var(--accent-rose)';
        const iconSvg = isResolved 
          ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="9 11 12 14 20 6" stroke-width="2.5"/></svg>`
          : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

        return `
        <div class="event-item">
          <div class="event-icon-badge" style="background: ${badgeBg}; color: ${badgeColor};">
            ${iconSvg}
          </div>
          <div class="event-details">
            <div class="event-title-row">
              <span class="event-title">${escapeHtml(o.title)}</span>
              <span class="event-time">${timeAgo(o.timestamp)}</span>
            </div>
            <div class="event-desc">${escapeHtml(o.description)}</div>
          </div>
        </div>
        `;
      }).join('');
    }

    // Router Hardware Ports & Interface Matrix via SNMP
    try {
      const [snmpLiveRes, snmpIfsRes] = await Promise.all([
        fetch('/api/snmp/live').catch(() => null),
        fetch('/api/snmp/interfaces').catch(() => null)
      ]);

      if (snmpLiveRes && snmpLiveRes.ok) {
        const liveData = await snmpLiveRes.json();
        const snmpPill = document.getElementById('snmp-status-pill');
        const snmpUptime = document.getElementById('snmp-hw-uptime');
        if (snmpPill) {
          if (liveData.status && liveData.status.is_connected) {
            snmpPill.textContent = 'SNMP v2c Connected';
            snmpPill.className = 'category-badge network';
            snmpPill.style.color = 'var(--accent-green)';
          } else {
            snmpPill.textContent = 'SNMP Disconnected';
            snmpPill.className = 'category-badge iot';
            snmpPill.style.color = 'var(--accent-rose)';
          }
        }
        if (snmpUptime && liveData.status) {
          snmpUptime.textContent = liveData.status.sys_uptime_human || '--';
        }
      }

      if (snmpIfsRes && snmpIfsRes.ok) {
        const interfaces = await snmpIfsRes.json();
        const tbody = document.getElementById('snmp-interfaces-tbody');
        if (tbody && Array.isArray(interfaces) && interfaces.length > 0) {
          const sorted = [...interfaces].sort((a, b) => {
            if (a.is_hardware && !b.is_hardware) return -1;
            if (!a.is_hardware && b.is_hardware) return 1;
            return a.index - b.index;
          });

          tbody.innerHTML = sorted.map(iface => {
            const isUp = iface.is_up;
            const statusBadge = isUp 
              ? `<span class="category-badge network" style="color: var(--accent-green); font-size: 0.75rem; padding: 2px 8px;">UP</span>`
              : `<span class="category-badge iot" style="color: var(--text-muted); font-size: 0.75rem; padding: 2px 8px;">DOWN</span>`;
            const errClass = (iface.in_errors > 0 || iface.out_errors > 0) ? 'color: var(--accent-rose); font-weight: 600;' : 'color: var(--text-muted);';
            const discClass = (iface.in_discards > 0 || iface.out_discards > 0) ? 'color: var(--accent-amber); font-weight: 600;' : 'color: var(--text-muted);';

            return `
              <tr>
                <td style="font-weight: 600; font-family: monospace; color: var(--accent-cyan);">${escapeHtml(iface.name)}</td>
                <td>
                  <div>${escapeHtml(iface.role)}</div>
                  <div style="font-size: 0.72rem; color: var(--text-muted);">Index #${iface.index}</div>
                </td>
                <td>${statusBadge}</td>
                <td style="font-family: monospace; font-size: 0.78rem;">${iface.mac || '—'}</td>
                <td style="${errClass}">${iface.in_errors} / ${iface.out_errors}</td>
                <td style="${discClass}">${iface.in_discards} / ${iface.out_discards}</td>
              </tr>
            `;
          }).join('');
        }
      }
    } catch (snmpErr) {
      console.warn("SNMP health data fetch error:", snmpErr);
    }
  } catch (e) {
    console.error("Health error:", e);
  }
}

// 6. Connection History
async function loadConnectionHistory() {
  try {
    const res = await fetch('/api/events?limit=80');
    if (!res.ok) return;
    const events = await res.json();
    const container = document.getElementById('global-events-timeline');
    if (events.length === 0) {
      container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem;">No historical network events recorded yet.</p>`;
      return;
    }

    container.innerHTML = events.map(e => `
      <div class="event-item">
        <div class="event-icon-badge" style="${getEventBadgeColor(e.event_type)}">
          ${getEventIcon(e.event_type)}
        </div>
        <div class="event-details">
          <div class="event-title-row">
            <span class="event-title">${escapeHtml(e.title)}</span>
            <span class="event-time">${timeAgo(e.timestamp)}</span>
          </div>
          <div class="event-desc">${escapeHtml(e.description)}</div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    console.error("History error:", e);
  }
}

function getEventBadgeColor(type) {
  switch (type) {
    case 'DEVICE_DISCONNECTED':
      return 'background: rgba(244, 63, 94, 0.15); color: var(--accent-rose);';
    case 'DEVICE_CONNECTED':
      return 'background: rgba(6, 182, 212, 0.15); color: var(--accent-cyan);';
    case 'DEVICE_DISCOVERED':
      return 'background: rgba(16, 185, 129, 0.15); color: var(--accent-green);';
    case 'ROUTER_REBOOT':
    case 'ROUTER_REBOOT_SNMP':
      return 'background: rgba(245, 158, 11, 0.15); color: var(--accent-amber);';
    case 'ROUTER_RECONNECT':
      return 'background: rgba(16, 185, 129, 0.15); color: var(--accent-green);';
    case 'OUTAGE_START':
      return 'background: rgba(244, 63, 94, 0.15); color: var(--accent-rose);';
    case 'OUTAGE_RESOLVED':
      return 'background: rgba(16, 185, 129, 0.15); color: var(--accent-green);';
    case 'IP_CHANGED':
      return 'background: rgba(168, 85, 247, 0.15); color: #c084fc;';
    case 'DEVICE_UPDATED':
      return 'background: rgba(148, 163, 184, 0.15); color: var(--text-muted);';
    default:
      return 'background: rgba(59, 130, 246, 0.15); color: var(--accent-blue);';
  }
}

function getEventIcon(type) {
  switch (type) {
    case 'DEVICE_DISCONNECTED':
      // Device Offline: WiFi Off / Disconnected icon
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>`;
    case 'DEVICE_CONNECTED':
      // Device Reconnected: WiFi connected icon
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>`;
    case 'DEVICE_DISCOVERED':
      // New Device Added: Plus / Sparkle icon
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="12" x="3" y="4" rx="2"/><path d="M12 16v4m-4 0h8"/><path d="M12 7v6m-3-3h6"/></svg>`;
    case 'ROUTER_REBOOT':
    case 'ROUTER_REBOOT_SNMP':
      // Router Rebooted: Circular restart icon
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>`;
    case 'ROUTER_RECONNECT':
      // Router Back Online: Server check icon
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/><path d="m14 10 2 2 4-4"/></svg>`;
    case 'OUTAGE_START':
      // Internet Connection Disconnected / Outage
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`;
    case 'OUTAGE_RESOLVED':
      // Internet Connection Restored
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><polyline points="9 11 12 14 20 6" stroke-width="2.2"/></svg>`;
    case 'IP_CHANGED':
      // IP Changed icon
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>`;
    case 'DEVICE_UPDATED':
      // Device Details Updated icon
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    default:
      return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  }
}

// 7. Reports & Insights
async function loadReports() {
  try {
    const res = await fetch('/api/reports');
    if (!res.ok) return;
    const rep = await res.json();

    document.getElementById('rep-busiest-hour').textContent = rep.busiest_hour_today;
    document.getElementById('rep-busiest-data').textContent = `${rep.busiest_hour_data} consumed`;

    document.getElementById('rep-top-today').textContent = rep.top_device_today;
    document.getElementById('rep-top-today-data').textContent = `${rep.top_device_today_data} consumed today`;

    document.getElementById('rep-top-month').textContent = rep.top_device_month;
    document.getElementById('rep-top-month-data').textContent = `${rep.top_device_month_data} consumed this month`;

    const tbody = document.getElementById('dormant-devices-tbody');
    if (rep.dormant_devices.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--accent-green); padding: 20px;">All discovered devices have been active within the past 7 days.</td></tr>`;
    } else {
      tbody.innerHTML = rep.dormant_devices.map(d => `
        <tr>
          <td><strong>${escapeHtml(d.custom_name)}</strong></td>
          <td class="mono-cell">${d.ip}</td>
          <td class="mono-cell">${d.mac}</td>
          <td>${timeAgo(d.last_seen)}</td>
        </tr>
      `).join('');
    }
  } catch (e) {
    console.error("Reports error:", e);
  }
}

// 8. Settings View
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) return;
    const s = await res.json();

    const ispField = document.getElementById('setting-isp-name');
    if (ispField) ispField.value = s.isp_name || 'Local ISP';
    document.getElementById('setting-router-url').value = s.router_url || 'http://192.168.0.1';
    document.getElementById('setting-router-user').value = s.router_user || 'user';
    document.getElementById('setting-poll-interval').value = s.poll_interval || 5;

    const snmpEnabledEl = document.getElementById('setting-snmp-enabled');
    if (snmpEnabledEl) snmpEnabledEl.checked = s.snmp_enabled !== false;
    const snmpCommunityEl = document.getElementById('setting-snmp-community');
    if (snmpCommunityEl) snmpCommunityEl.value = s.snmp_community || 'sumitsakpal0183';
    const snmpPortEl = document.getElementById('setting-snmp-port');
    if (snmpPortEl) snmpPortEl.value = s.snmp_port || 161;

    const pwdStatus = document.getElementById('pwd-status-text');
    if (s.has_password) {
      pwdStatus.textContent = "✓ Password configured and active.";
      pwdStatus.style.color = "var(--accent-green)";
    } else {
      pwdStatus.textContent = "⚠ Password not set. Please enter router password.";
      pwdStatus.style.color = "var(--accent-rose)";
    }
  } catch (e) {
    console.error("Settings error:", e);
  }
}

// Edit Device Modal
function openEditModal(mac) {
  const d = allDevicesCache.find(x => x.mac === mac);
  if (!d) return;

  document.getElementById('edit-mac').value = d.mac;
  document.getElementById('edit-custom-name').value = d.custom_name;
  document.getElementById('edit-category').value = d.category || 'unknown';
  document.getElementById('edit-notes').value = d.notes || '';

  document.getElementById('device-modal').classList.add('open');
}

function closeDeviceModal() {
  document.getElementById('device-modal').classList.remove('open');
}

// Clipboard copy helper
function copyText(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const text = el.textContent.trim();
  if (!text || text === '--') return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(`Copied ${text} to clipboard!`);
    }).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  showToast(`Copied ${text} to clipboard!`);
}

function showToast(msg) {
  let toast = document.getElementById('global-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'global-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:var(--bg-card);border:1px solid var(--accent-blue);color:var(--text-primary);padding:10px 18px;border-radius:8px;font-size:0.85rem;box-shadow:0 8px 24px rgba(0,0,0,0.3);z-index:9999;transition:opacity 0.25s ease;pointer-events:none;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  setTimeout(() => {
    toast.style.opacity = '0';
  }, 2500);
}

// Router Gateway Details & Diagnostics Modal
async function openRouterModal() {
  const modal = document.getElementById('router-modal');
  if (!modal) return;

  try {
    const res = await fetch('/api/wan');
    if (res.ok) {
      const wan = await res.json();
      const extIpEl = document.getElementById('rm-ext-ip');
      const gwIpEl = document.getElementById('rm-gw-ip');
      const dnsEl = document.getElementById('rm-dns');
      const connTypeEl = document.getElementById('rm-conn-type');
      const statusEl = document.getElementById('rm-status');

      if (extIpEl) extIpEl.textContent = wan.external_ip || '--';
      if (gwIpEl) gwIpEl.textContent = wan.gateway_ip || '--';
      if (dnsEl) dnsEl.textContent = wan.dns_servers_str || '--';
      if (connTypeEl) connTypeEl.textContent = [wan.transport_type, wan.connection_type].filter(Boolean).join(' • ') || 'PPPoE';
      if (statusEl) {
        statusEl.textContent = wan.connection_status || 'Online';
        statusEl.style.color = (wan.connection_status === 'Connected') ? 'var(--accent-green)' : 'var(--accent-amber)';
      }
    }
  } catch (e) {
    console.error("Router diagnostics fetch error:", e);
  }

  modal.classList.add('open');
}

function closeRouterModal() {
  const modal = document.getElementById('router-modal');
  if (modal) modal.classList.remove('open');
}

// Router Reboot Handlers & Confirmation
function openRebootModal() {
  const modal = document.getElementById('reboot-modal');
  if (!modal) return;
  
  const initView = document.getElementById('reboot-modal-initial-view');
  const progView = document.getElementById('reboot-modal-progress-view');
  if (initView) initView.style.display = 'block';
  if (progView) progView.style.display = 'none';

  const confirmBtn = document.getElementById('reboot-confirm-btn');
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
      Yes, Reboot Now
    `;
  }
  modal.classList.add('open');
}

function closeRebootModal() {
  const modal = document.getElementById('reboot-modal');
  if (modal) modal.classList.remove('open');
}

let rebootCountdownTimer = null;
let rebootStatusPollTimer = null;

async function executeRouterReboot() {
  const initView = document.getElementById('reboot-modal-initial-view');
  const progView = document.getElementById('reboot-modal-progress-view');
  const confirmBtn = document.getElementById('reboot-confirm-btn');
  const cdEl = document.getElementById('reboot-countdown');
  const msgEl = document.getElementById('reboot-progress-msg');

  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Sending signal...';
  }

  try {
    const res = await fetch('/api/router/reboot', { method: 'POST' });
    let data;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      const text = await res.text();
      data = { detail: text || res.statusText };
    }

    if (!res.ok) {
      alert(`Reboot command rejected: ${data.detail || 'Could not communicate with router.'}`);
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
          Yes, Reboot Now
        `;
      }
      return;
    }

    // Immediately reflect rebooting state on topology and health views
    if (currentView === 'dashboard') loadDashboard();
    else if (currentView === 'health') loadInternetHealth();

    // Switch to countdown view
    if (initView) initView.style.display = 'none';
    if (progView) progView.style.display = 'block';

    let remaining = 65;
    if (cdEl) {
      cdEl.textContent = `${remaining}s`;
      cdEl.style.color = 'var(--accent-amber)';
    }
    if (msgEl) {
      msgEl.textContent = 'Hardware restart initiated. Power cycling gateway...';
      msgEl.style.color = 'var(--text-muted)';
    }

    clearInterval(rebootCountdownTimer);
    clearInterval(rebootStatusPollTimer);

    rebootCountdownTimer = setInterval(() => {
      remaining--;
      if (remaining > 45) {
        if (msgEl) msgEl.textContent = 'Power cycling hardware...';
      } else if (remaining > 25) {
        if (msgEl) msgEl.textContent = 'Booting router firmware & web server...';
      } else if (remaining > 5) {
        if (msgEl) msgEl.textContent = 'Reconnecting to gateway (192.168.0.1)...';
      } else {
        if (msgEl) msgEl.textContent = 'Probing gateway & authenticating...';
      }

      if (remaining <= 0) {
        clearInterval(rebootCountdownTimer);
        if (cdEl) cdEl.textContent = 'Probing...';
      } else {
        if (cdEl) cdEl.textContent = `${remaining}s`;
      }
    }, 1000);

    // Wait 15s for the reboot cycle to begin, then poll every 2s
    let attempts = 0;
    setTimeout(() => {
      rebootStatusPollTimer = setInterval(async () => {
        attempts++;
        try {
          const sRes = await fetch('/api/status');
          if (sRes.ok) {
            const s = await sRes.json();
            if (s.router_connected) {
              if (s.internet_online) {
                clearInterval(rebootCountdownTimer);
                clearInterval(rebootStatusPollTimer);
                if (cdEl) {
                  cdEl.textContent = 'ONLINE';
                  cdEl.style.color = 'var(--accent-green)';
                }
                if (msgEl) {
                  msgEl.textContent = 'Reboot complete! Router and Internet reconnected.';
                  msgEl.style.color = 'var(--accent-green)';
                }
                setTimeout(() => {
                  closeRebootModal();
                  if (currentView === 'dashboard') loadDashboard();
                  else if (currentView === 'health') loadInternetHealth();
                }, 1400);
              } else {
                // Router is back up, waiting for WAN PPPoE to dial
                if (cdEl) {
                  cdEl.textContent = 'ROUTER UP';
                  cdEl.style.color = 'var(--accent-cyan)';
                }
                if (msgEl) {
                  msgEl.textContent = 'Gateway is up! Reconnecting internet (PPPoE)...';
                  msgEl.style.color = 'var(--accent-cyan)';
                }
                if (attempts > 30) {
                  // After waiting for WAN, auto-close anyway
                  clearInterval(rebootCountdownTimer);
                  clearInterval(rebootStatusPollTimer);
                  setTimeout(() => {
                    closeRebootModal();
                    if (currentView === 'dashboard') loadDashboard();
                    else if (currentView === 'health') loadInternetHealth();
                  }, 1500);
                }
              }
            }
          }
        } catch (e) {
          // Expected while router is cycling power
        }

        if (attempts > 50) {
          clearInterval(rebootStatusPollTimer);
          clearInterval(rebootCountdownTimer);
          if (msgEl) {
            msgEl.textContent = 'Reboot cycle took longer than expected. Please check router.';
          }
        }
      }, 2000);
    }, 15000);

  } catch (err) {
    alert(`Error: ${err.message}`);
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Yes, Reboot Now';
    }
  }
}

// Live Background Status Poller
let prevRouterState = null;
async function pollStatus() {
  try {
    const res = await fetch('/api/status');
    if (res.ok) {
      const s = await res.json();
      const rBadge = document.getElementById('sidebar-router-badge');
      const rText = document.getElementById('sidebar-router-text');
      const iBadge = document.getElementById('sidebar-internet-badge');
      const iText = document.getElementById('sidebar-internet-text');

      if (s.router_connected) {
        rBadge.className = 'status-badge online';
        rText.textContent = 'Connected';
      } else {
        rBadge.className = s.is_rebooting ? 'status-badge rebooting' : 'status-badge offline';
        rText.textContent = s.is_rebooting ? 'Rebooting' : (s.password_configured ? 'Retrying' : 'No Pass');
      }

      if (s.internet_online) {
        iBadge.className = 'status-badge online';
        iText.textContent = 'Online';
      } else {
        iBadge.className = 'status-badge offline';
        iText.textContent = 'Outage';
      }

      // Auto refresh views when router transitions from offline/rebooting to connected
      if (prevRouterState === false && s.router_connected) {
        if (currentView === 'dashboard') loadDashboard();
        else if (currentView === 'health') loadInternetHealth();
      }
      prevRouterState = Boolean(s.router_connected);
    }
  } catch (e) {}
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Initialization & Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  initTheme();

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      switchView(item.dataset.view);
    });
  });

  document.getElementById('refresh-btn').addEventListener('click', () => {
    refreshCurrentView();
  });

  document.getElementById('device-search-input').addEventListener('input', renderFilteredDevices);
  document.querySelectorAll('#device-category-pills .pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#device-category-pills .pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderFilteredDevices();
    });
  });

  document.querySelectorAll('#traffic-period-pills .pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#traffic-period-pills .pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTrafficHours = parseInt(btn.dataset.hours);
      loadTrafficAnalytics();
    });
  });

  document.getElementById('device-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const mac = document.getElementById('edit-mac').value;
    const custom_name = document.getElementById('edit-custom-name').value;
    const category = document.getElementById('edit-category').value;
    const notes = document.getElementById('edit-notes').value;

    const res = await fetch(`/api/devices/${mac}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_name, category, notes })
    });

    if (res.ok) {
      closeDeviceModal();
      refreshCurrentView();
    }
  });

  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const isp_name = document.getElementById('setting-isp-name')?.value?.trim();
    const router_url = document.getElementById('setting-router-url').value;
    const router_user = document.getElementById('setting-router-user').value;
    const router_password = document.getElementById('setting-router-password').value;
    const poll_interval = parseInt(document.getElementById('setting-poll-interval').value);
    const snmp_enabled = document.getElementById('setting-snmp-enabled')?.checked ?? true;
    const snmp_community = document.getElementById('setting-snmp-community')?.value?.trim();
    const snmp_port = parseInt(document.getElementById('setting-snmp-port')?.value || '161');

    const body = { router_url, router_user, poll_interval, snmp_enabled, snmp_port };
    if (isp_name) body.isp_name = isp_name;
    if (router_password) body.router_password = router_password;
    if (snmp_community) body.snmp_community = snmp_community;

    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (res.ok) {
      alert("Settings saved successfully! The collector is reconnecting...");
      loadSettings();
      pollStatus();
    }
  });

  loadDashboard();
  pollStatus();

  // Background polling intervals
  setInterval(pollSnmpLive, 2500);
  setInterval(pollStatus, 3000);
  setInterval(() => {
    if (currentView === 'dashboard') loadDashboard();
    else if (currentView === 'traffic') loadTrafficAnalytics();
    else if (currentView === 'health') loadInternetHealth();
    else if (currentView === 'devices') loadDevices();
  }, 5000);
});
