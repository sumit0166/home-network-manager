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
function switchView(viewName) {
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

// Formatters
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
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
async function loadDashboard() {
  try {
    const res = await fetch('/api/overview');
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('stat-active-devices').textContent = data.active_devices;
    document.getElementById('stat-total-devices').textContent = data.total_devices;
    document.getElementById('stat-current-rate').textContent = data.current_traffic_human;
    document.getElementById('stat-today-data').textContent = data.total_data_today_human;
    document.getElementById('stat-latency-val').textContent = `${data.internet_latency_ms}ms`;

    if (data.top_consumer) {
      document.getElementById('top-consumer-name').textContent = data.top_consumer.name;
      document.getElementById('top-consumer-ip').textContent = `IP: ${data.top_consumer.ip}`;
      document.getElementById('top-consumer-amount').textContent = data.top_consumer.consumed_human;
      document.getElementById('view-top-device-btn').onclick = () => openDeviceDetail(data.top_consumer.mac);
    } else {
      document.getElementById('top-consumer-name').textContent = "No traffic yet";
      document.getElementById('top-consumer-ip').textContent = "—";
      document.getElementById('top-consumer-amount').textContent = "0 B";
    }

    lastSparklineData = data.traffic_sparkline;
    renderDashboardSparkline(data.traffic_sparkline);

    // Render Visual Network Topology Map
    renderTopologyMap(data, devices);

    // Active Devices Table
    const activeList = devices.filter(d => d.is_active);
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
          <td class="mono-cell">${d.total_bytes_human}</td>
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
  // 1. WAN Node
  const wanLat = document.getElementById('topo-wan-lat');
  const wanStatus = document.getElementById('topo-wan-status');
  if (wanLat && wanStatus) {
    wanLat.textContent = `${overviewData.internet_latency_ms}ms`;
    wanStatus.textContent = overviewData.is_online ? 'Online' : 'Outage';
    wanStatus.style.color = overviewData.is_online ? 'var(--accent-green)' : 'var(--accent-rose)';
  }

  // 2. Router Node
  const rActive = document.getElementById('topo-active-count');
  const rRate = document.getElementById('topo-rate-val');
  if (rActive && rRate) {
    rActive.textContent = overviewData.active_devices;
    rRate.textContent = overviewData.current_traffic_human;
  }

  // 3. Device Grids (Active vs Offline)
  const activeDevices = devices.filter(d => d.is_active);
  const offlineDevices = devices.filter(d => !d.is_active);

  const activeNum = document.getElementById('topo-active-num');
  const offlineNum = document.getElementById('topo-offline-num');
  if (activeNum) activeNum.textContent = activeDevices.length;
  if (offlineNum) offlineNum.textContent = offlineDevices.length;

  const activeGrid = document.getElementById('topo-active-grid');
  if (activeGrid) {
    if (activeDevices.length === 0) {
      activeGrid.innerHTML = `<p style="grid-column: 1 / -1; color: var(--text-muted); font-size: 0.8rem;">No active clients connected right now.</p>`;
    } else {
      activeGrid.innerHTML = activeDevices.map(d => `
        <div class="topology-device-card active" onclick="openDeviceDetail('${d.mac}')">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div class="device-avatar" style="background: rgba(16, 185, 129, 0.15); color: var(--accent-green);">
              ${getCategoryIconSvg(d.category)}
            </div>
            <div>
              <div style="font-weight: 600; font-size: 0.85rem; max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${escapeHtml(d.custom_name)}
              </div>
              <div class="mono-cell" style="font-size: 0.72rem; color: var(--text-muted);">${d.ip}</div>
            </div>
          </div>
          <div style="text-align: right;">
            <span class="status-badge online" style="font-size: 0.68rem; padding: 1px 6px;">
              <span class="pulse-dot"></span> Active
            </span>
            <div class="mono-cell" style="font-size: 0.72rem; color: var(--accent-cyan); font-weight: 600; margin-top: 2px;">
              ${d.current_speed_human}
            </div>
          </div>
        </div>
      `).join('');
    }
  }

  const offlineGrid = document.getElementById('topo-offline-grid');
  if (offlineGrid) {
    if (offlineDevices.length === 0) {
      offlineGrid.innerHTML = `<p style="grid-column: 1 / -1; color: var(--text-muted); font-size: 0.8rem;">No offline devices registered.</p>`;
    } else {
      offlineGrid.innerHTML = offlineDevices.map(d => `
        <div class="topology-device-card offline" onclick="openDeviceDetail('${d.mac}')">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div class="device-avatar" style="background: rgba(148, 163, 184, 0.12); color: var(--text-muted);">
              ${getCategoryIconSvg(d.category)}
            </div>
            <div>
              <div style="font-weight: 500; font-size: 0.85rem; color: var(--text-secondary); max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${escapeHtml(d.custom_name)}
              </div>
              <div class="mono-cell" style="font-size: 0.72rem; color: var(--text-muted);">${d.ip}</div>
            </div>
          </div>
          <div style="text-align: right;">
            <span class="status-badge offline" style="font-size: 0.68rem; padding: 1px 6px;">Offline</span>
            <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">
              ${timeAgo(d.last_seen)}
            </div>
          </div>
        </div>
      `).join('');
    }
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

function renderDashboardSparkline(points) {
  const ctx = document.getElementById('dashboardTrafficChart');
  if (!ctx) return;

  const labels = points.map(p => new Date(p.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  const values = points.map(p => p.bytes);
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  if (charts.dashboardTraffic) {
    charts.dashboardTraffic.data.labels = labels;
    charts.dashboardTraffic.data.datasets[0].data = values;
    charts.dashboardTraffic.options.scales.y.grid.color = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    charts.dashboardTraffic.update();
    return;
  }

  charts.dashboardTraffic = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Live Bandwidth',
        data: values,
        borderColor: '#06b6d4',
        backgroundColor: 'rgba(6, 182, 212, 0.15)',
        fill: true,
        tension: 0.35,
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 5
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
  currentDetailMac = mac;
  switchView('device-detail');
}

async function loadDeviceDetail(mac) {
  // If no mac supplied, select first active or available device
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

  // Populate device switcher dropdown
  const selector = document.getElementById('telemetry-device-select');
  if (selector && allDevicesCache.length > 0) {
    selector.innerHTML = allDevicesCache.map(d => `
      <option value="${d.mac}" ${d.mac === mac ? 'selected' : ''}>
        ${escapeHtml(d.custom_name)} (${d.ip}) — ${d.is_active ? 'Active' : 'Offline'}
      </option>
    `).join('');
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
          <div class="event-icon-badge" style="background: rgba(59, 130, 246, 0.15); color: var(--accent-blue);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
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

    if (charts.trafficAnalytics) {
      charts.trafficAnalytics.data.labels = labels;
      charts.trafficAnalytics.data.datasets[0].data = values;
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
            backgroundColor: 'rgba(139, 92, 246, 0.18)',
            fill: true,
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 6
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

    document.getElementById('health-uptime-val').textContent = `${data.uptime_pct}%`;

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
              tension: 0.3,
              borderWidth: 2,
              pointRadius: 2
            },
            {
              label: 'Gateway Latency (ms)',
              data: gwLat,
              borderColor: '#10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              tension: 0.3,
              borderWidth: 2,
              pointRadius: 2
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { grid: { display: false }, ticks: { maxTicksLimit: 12, font: { size: 10 } } },
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
      outContainer.innerHTML = data.outages.map(o => `
        <div class="event-item">
          <div class="event-icon-badge" style="background: rgba(244, 63, 94, 0.15); color: var(--accent-rose);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </div>
          <div class="event-details">
            <div class="event-title-row">
              <span class="event-title">${escapeHtml(o.title)}</span>
              <span class="event-time">${timeAgo(o.timestamp)}</span>
            </div>
            <div class="event-desc">${escapeHtml(o.description)}</div>
          </div>
        </div>
      `).join('');
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
        <div class="event-icon-badge" style="background: ${getEventBadgeColor(e.event_type)};">
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
  if (type === 'DEVICE_CONNECTED' || type === 'OUTAGE_RESOLVED') return 'rgba(16, 185, 129, 0.15); color: var(--accent-green)';
  if (type === 'DEVICE_DISCONNECTED' || type === 'OUTAGE_START') return 'rgba(244, 63, 94, 0.15); color: var(--accent-rose)';
  if (type === 'IP_CHANGED') return 'rgba(245, 158, 11, 0.15); color: var(--accent-amber)';
  return 'rgba(6, 182, 212, 0.15); color: var(--accent-cyan)';
}

function getEventIcon(type) {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
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

    document.getElementById('setting-router-url').value = s.router_url || 'http://192.168.0.1';
    document.getElementById('setting-router-user').value = s.router_user || 'user';
    document.getElementById('setting-poll-interval').value = s.poll_interval || 5;

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

// Live Background Status Poller
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
        rBadge.className = 'status-badge offline';
        rText.textContent = s.password_configured ? 'Retrying' : 'No Pass';
      }

      if (s.internet_online) {
        iBadge.className = 'status-badge online';
        iText.textContent = 'Online';
      } else {
        iBadge.className = 'status-badge offline';
        iText.textContent = 'Outage';
      }
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
    const router_url = document.getElementById('setting-router-url').value;
    const router_user = document.getElementById('setting-router-user').value;
    const router_password = document.getElementById('setting-router-password').value;
    const poll_interval = parseInt(document.getElementById('setting-poll-interval').value);

    const body = { router_url, router_user, poll_interval };
    if (router_password) body.router_password = router_password;

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

  setInterval(pollStatus, 3000);
  setInterval(() => {
    if (currentView === 'dashboard') loadDashboard();
    else if (currentView === 'traffic') loadTrafficAnalytics();
  }, 5000);
});
