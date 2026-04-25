const $ = (id) => document.getElementById(id);

let selectedConnectionId = null;
let currentConnections = [];
let connectionFormDirty = false;
let currentHistoryHours = 4;
let currentPolicy = null;
let historyHighContrast = false;
let connectionPanelOpen = false;
let connectionEditorOpen = false;
let batteryDashboardOpen = false;
let policyPanelOpen = false;

function fmt(value, fallback = "-") {
  return value === null || value === undefined || value === "" ? fallback : value;
}

function emptyToNull(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = value;
}

function formatNumber(value, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function currentDirectionFromStatus(status) {
  const normalized = String(status || "").toLowerCase();
  if (["charging", "full"].includes(normalized)) return "充电";
  if (["discharging", "not_charging"].includes(normalized)) return "放电";
  return null;
}

function formatCurrent(ua, status = null) {
  const numeric = Number(ua);
  if (!Number.isFinite(numeric)) return "-";
  if (numeric === 0) return "0 mA";

  const direction = currentDirectionFromStatus(status) || (numeric > 0 ? "+电流" : "-电流");
  const absMa = Math.abs(numeric) / 1000;
  if (absMa >= 1000) {
    return `${direction} ${formatNumber(absMa / 1000, 2)} A`;
  }
  return `${direction} ${formatNumber(absMa, absMa >= 100 ? 0 : 1)} mA`;
}

function formatVoltageMv(mv) {
  const numeric = Number(mv);
  if (!Number.isFinite(numeric)) return "-";
  return `${formatNumber(numeric / 1000, 3)} V`;
}

function formatMicroCurrent(ua) {
  const numeric = Number(ua);
  if (!Number.isFinite(numeric)) return "-";
  if (Math.abs(numeric) >= 1000000) return `${formatNumber(numeric / 1000000, 2)} A`;
  return `${formatNumber(numeric / 1000, 0)} mA`;
}

function formatMicroVoltage(uv) {
  const numeric = Number(uv);
  if (!Number.isFinite(numeric)) return "-";
  return `${formatNumber(numeric / 1000000, 1)} V`;
}

function formatChargeCounter(uah) {
  const numeric = Number(uah);
  if (!Number.isFinite(numeric)) return "-";
  if (numeric >= 1000000) return `${formatNumber(numeric / 1000000, 2)} Ah`;
  return `${formatNumber(numeric / 1000, 1)} mAh`;
}

function powerSourceSummary(plugged) {
  if (!plugged) return "未知";
  const sources = [];
  if (plugged.ac === true) sources.push("AC");
  if (plugged.usb === true) sources.push("USB");
  if (plugged.wireless === true) sources.push("无线");
  if (plugged.dock === true) sources.push("Dock");
  if (sources.length) return sources.join(" / ");

  const values = [plugged.ac, plugged.usb, plugged.wireless, plugged.dock].filter((value) => value !== null && value !== undefined);
  if (values.length && values.every((value) => value === false)) return "未接电源";
  return "未知";
}

function formatTemperature(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return `${formatNumber(numeric, 1)}°C`;
}

function renderBatteryDashboard(battery) {
  setText("metricCurrent", formatCurrent(battery?.current_now_ua, battery?.status));
  setText(
    "metricCurrentMeta",
    battery?.current_now_ua !== null && battery?.current_now_ua !== undefined
      ? `${formatNumber(battery.current_now_ua, 0)} µA · status=${fmt(battery?.status)}`
      : "设备未提供 current_now"
  );

  setText("metricVoltage", formatVoltageMv(battery?.voltage_mv));
  setText("metricVoltageMeta", `status=${fmt(battery?.status)} · present=${fmt(battery?.present)}`);

  setText("metricTemperature", formatTemperature(battery?.temperature_c));
  setText("metricTemperatureMeta", battery?.temperature_c !== null && battery?.temperature_c !== undefined ? `raw=${fmt(battery?.raw?.temperature)}` : "设备未返回温度");

  setText("metricHealth", fmt(battery?.health));
  setText("metricHealthMeta", `health_raw=${fmt(battery?.health_raw)}`);

  setText("metricTechnology", fmt(battery?.technology));
  setText("metricTechnologyMeta", `status_raw=${fmt(battery?.status_raw)}`);

  setText("metricPower", powerSourceSummary(battery?.plugged));
  setText("metricPowerMeta", `AC=${fmt(battery?.plugged?.ac)} USB=${fmt(battery?.plugged?.usb)} 无线=${fmt(battery?.plugged?.wireless)}`);

  setText("metricChargeCounter", formatChargeCounter(battery?.charge_counter_uah));
  setText("metricChargeCounterMeta", battery?.charge_counter_uah !== null && battery?.charge_counter_uah !== undefined ? `${formatNumber(battery.charge_counter_uah, 0)} µAh` : "设备未返回 charge counter");

  const maxCurrent = formatMicroCurrent(battery?.max_charging_current_ua);
  const maxVoltage = formatMicroVoltage(battery?.max_charging_voltage_uv);
  setText(
    "metricMaxCharge",
    maxCurrent === "-" && maxVoltage === "-" ? "-" : `${maxCurrent}${maxVoltage === "-" ? "" : ` / ${maxVoltage}`}`
  );
  setText("metricMaxChargeMeta", "来自 dumpsys battery");
}

function setConnectionPanelOpen(open) {
  connectionPanelOpen = Boolean(open);
  const card = $("connectionCard");
  const panel = $("connectionDetailPanel");
  const cue = $("connectionCardCueText");
  if (card) {
    card.classList.toggle("is-open", connectionPanelOpen);
    card.setAttribute("aria-expanded", connectionPanelOpen ? "true" : "false");
  }
  if (panel) {
    panel.classList.toggle("is-open", connectionPanelOpen);
    panel.setAttribute("aria-hidden", connectionPanelOpen ? "false" : "true");
  }
  if (cue) {
    cue.textContent = connectionPanelOpen ? "点击收起连接对象" : "点击展开连接对象";
  }
}

function setConnectionEditorOpen(open) {
  connectionEditorOpen = Boolean(open);
  const modal = $("connectionEditorModal");
  if (!modal) return;
  modal.hidden = !connectionEditorOpen;
  document.body.style.overflow = connectionEditorOpen ? "hidden" : "";
}

function openConnectionEditor(title = "设备参数") {
  const titleNode = $("connectionEditorTitle");
  if (titleNode) titleNode.textContent = title;
  setConnectionEditorOpen(true);
}

function closeConnectionEditor() {
  setConnectionEditorOpen(false);
}

function setBatteryDashboardOpen(open) {
  batteryDashboardOpen = Boolean(open);
  const card = $("batteryCard");
  const panel = $("batteryDashboardPanel");
  const cue = $("batteryCardCueText");
  if (card) {
    card.classList.toggle("is-open", batteryDashboardOpen);
    card.setAttribute("aria-expanded", batteryDashboardOpen ? "true" : "false");
  }
  if (panel) {
    panel.classList.toggle("is-open", batteryDashboardOpen);
    panel.setAttribute("aria-hidden", batteryDashboardOpen ? "false" : "true");
  }
  if (cue) {
    cue.textContent = batteryDashboardOpen ? "点击收起仪表盘" : "点击展开仪表盘";
  }
}

function setPolicyPanelOpen(open) {
  policyPanelOpen = Boolean(open);
  const card = $("policyCard");
  const panel = $("policyDetailPanel");
  const cue = $("policyCardCueText");
  if (card) {
    card.classList.toggle("is-open", policyPanelOpen);
    card.setAttribute("aria-expanded", policyPanelOpen ? "true" : "false");
  }
  if (panel) {
    panel.classList.toggle("is-open", policyPanelOpen);
    panel.setAttribute("aria-hidden", policyPanelOpen ? "false" : "true");
  }
  if (cue) {
    cue.textContent = policyPanelOpen ? "点击收起策略参数" : "点击展开策略参数";
  }
}

function setExclusiveDetailPanel(panelName) {
  const shouldOpenConnection = panelName === "connection";
  const shouldOpenBattery = panelName === "battery";
  const shouldOpenPolicy = panelName === "policy";
  setConnectionPanelOpen(shouldOpenConnection);
  setBatteryDashboardOpen(shouldOpenBattery);
  setPolicyPanelOpen(shouldOpenPolicy);
}

function toggleExclusiveDetailPanel(panelName) {
  const isOpen =
    (panelName === "connection" && connectionPanelOpen) ||
    (panelName === "battery" && batteryDashboardOpen) ||
    (panelName === "policy" && policyPanelOpen);
  if (isOpen) {
    setExclusiveDetailPanel(null);
  } else {
    setExclusiveDetailPanel(panelName);
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  return response.json();
}

function renderStatus(data) {
  const active = data.active_connection;
  const battery = data.battery;
  const decision = data.decision;
  const action = data.last_action;
  const health = active ? data.connection_health[active.id] : null;
  const capability = data.control_capability;

  $("activeConnection").textContent = active ? `${active.name} (${active.id})` : "未配置";
  $("connectionHealth").textContent = health
    ? `${health.status}${health.last_error ? " | " + health.last_error : ""}`
    : "unknown";
  $("controlCapability").textContent = capability
    ? `control_capability: ${capability.supported ? "supported" : "unsupported"} / ${capability.backend}`
    : "control_capability: unknown";

  $("batteryLevel").textContent = battery?.level !== null && battery?.level !== undefined ? `${battery.level}%` : "-";
  $("batteryMeta").textContent = battery
    ? `status=${fmt(battery.status)} temp=${formatTemperature(battery.temperature_c)} health=${fmt(battery.health)} current=${formatCurrent(battery.current_now_ua, battery.status)}`
    : fmt(data.last_error, "暂无数据");
  renderBatteryDashboard(battery);

  $("policyDecision").textContent = decision ? decision.action : "-";
  $("policyReason").textContent = decision ? decision.reason : "等待评估...";

  $("lastAction").textContent = action ? action.action : "-";
  $("lastActionMeta").textContent = action
    ? `${action.success ? "success" : "failed"} / ${action.supported ? "supported" : "unsupported"} / ${action.message}`
    : "暂无动作";

  const policy = data.policy;
  if (policy) {
    currentPolicy = policy;
    const form = $("policyForm");
    for (const [key, value] of Object.entries(policy)) {
      if (!form.elements[key]) continue;
      if (form.elements[key].type === "checkbox") {
        form.elements[key].checked = Boolean(value);
      } else {
        form.elements[key].value = value;
      }
    }
  }
}

function defaultConnection() {
  return {
    id: "",
    name: "",
    adb_path: "adb",
    server_host: "127.0.0.1",
    server_port: 5037,
    serial: null,
    note: null,
    enabled: true,
    charging: {
      backend: "none",
      sysfs_path: null,
      enable_value: "1",
      disable_value: "0",
      enable_command: null,
      disable_command: null,
      require_su: false,
    },
  };
}

function fillConnectionForm(connection) {
  const conn = connection || defaultConnection();
  const charging = conn.charging || defaultConnection().charging;
  const form = $("connectionForm");

  form.elements.original_id.value = conn.id || "";
  form.elements.id.value = conn.id || "";
  form.elements.name.value = conn.name || "";
  form.elements.adb_path.value = conn.adb_path || "adb";
  form.elements.server_host.value = conn.server_host || "";
  form.elements.server_port.value = conn.server_port || "";
  form.elements.serial.value = conn.serial || "";
  form.elements.note.value = conn.note || "";
  form.elements.enabled.checked = Boolean(conn.enabled);
  form.elements.charging_backend.value = charging.backend || "none";
  form.elements.sysfs_path.value = charging.sysfs_path || "";
  form.elements.enable_value.value = charging.enable_value || "1";
  form.elements.disable_value.value = charging.disable_value || "0";
  form.elements.enable_command.value = charging.enable_command || "";
  form.elements.disable_command.value = charging.disable_command || "";
  form.elements.require_su.checked = Boolean(charging.require_su);
  $("deleteConnectionBtn").disabled = !conn.id;
  connectionFormDirty = false;
}

function connectionPayloadFromForm() {
  const form = $("connectionForm");
  return {
    original_id: emptyToNull(form.elements.original_id.value),
    id: form.elements.id.value.trim(),
    name: form.elements.name.value.trim(),
    adb_path: form.elements.adb_path.value.trim() || "adb",
    server_host: emptyToNull(form.elements.server_host.value),
    server_port: form.elements.server_port.value ? Number(form.elements.server_port.value) : null,
    serial: emptyToNull(form.elements.serial.value),
    note: emptyToNull(form.elements.note.value),
    enabled: form.elements.enabled.checked,
    charging: {
      backend: form.elements.charging_backend.value,
      sysfs_path: emptyToNull(form.elements.sysfs_path.value),
      enable_value: form.elements.enable_value.value || "1",
      disable_value: form.elements.disable_value.value || "0",
      enable_command: emptyToNull(form.elements.enable_command.value),
      disable_command: emptyToNull(form.elements.disable_command.value),
      require_su: form.elements.require_su.checked,
    },
  };
}

function selectConnectionForEdit(connectionId, force = false) {
  const item = currentConnections.find((entry) => entry.connection.id === connectionId);
  if (!item) {
    selectedConnectionId = null;
    fillConnectionForm(defaultConnection());
    openConnectionEditor("设备参数");
    return;
  }
  selectedConnectionId = connectionId;
  if (!connectionFormDirty || force) {
    fillConnectionForm(item.connection);
  }
  $("connectionFormMessage").textContent = `正在编辑 ${item.connection.name}`;
  openConnectionEditor(`编辑设备 · ${item.connection.name}`);
}

function renderConnections(items) {
  currentConnections = items;
  $("connections").innerHTML = "";

  const knownIds = new Set(items.map((item) => item.connection.id));
  if (!selectedConnectionId || !knownIds.has(selectedConnectionId)) {
    const active = items.find((item) => item.active) || items[0];
    if (active) {
      selectedConnectionId = active.connection.id;
    } else {
      selectedConnectionId = null;
    }
  }

  for (const item of items) {
    const conn = item.connection;
    const health = item.health;
    const capability = item.control_capability;
    const row = document.createElement("div");
    row.className = "connection-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(conn.name)}</strong>
        <span>${escapeHtml(conn.id)}${conn.enabled ? "" : " · disabled"}</span>
        <small>${escapeHtml(fmt(conn.serial, "no serial"))} · ${escapeHtml(fmt(conn.server_host))}:${escapeHtml(fmt(conn.server_port))}</small>
        <small>adb=${escapeHtml(conn.adb_path)} · backend=${escapeHtml(capability?.backend || conn.charging?.backend || "none")}</small>
        <small>${health ? escapeHtml(health.status) : "unknown"}${health?.last_error ? " · " + escapeHtml(health.last_error) : ""}</small>
      </div>
      <div class="connection-actions">
        <button type="button" data-action="edit" class="secondary">编辑</button>
        <button type="button" data-action="active" ${item.active || !conn.enabled ? "disabled" : ""}>${item.active ? "当前" : "切换"}</button>
      </div>
    `;
    row.querySelector('[data-action="edit"]').addEventListener("click", () => selectConnectionForEdit(conn.id, true));
    row.querySelector('[data-action="active"]').addEventListener("click", async () => {
      const result = await api("/api/connections/active", {
        method: "POST",
        body: JSON.stringify({ connection_id: conn.id }),
      });
      if (!result.ok) alert(result.error);
      await refresh();
    });
    $("connections").appendChild(row);
  }
}

async function refresh() {
  const [status, connections] = await Promise.all([api("/api/status"), api("/api/connections")]);
  if (status.ok) renderStatus(status.data);
  if (connections.ok) renderConnections(connections.data);
}

async function loadConfigEditor() {
  const result = await api("/api/config");
  if (!result.ok) {
    $("configMessage").textContent = result.error;
    return;
  }
  $("configPath").textContent = `配置文件路径：${result.data.path}`;
  $("configEditor").value = JSON.stringify(result.data.config, null, 2);
  $("configMessage").textContent = "配置已加载。";
}

const CHARGE_STATE_COLORS = {
  charging: { label: "充电中", color: "#15803d", fill: "rgba(21, 128, 61, 0.22)" },
  not_charging: { label: "未充电", color: "#d7dde5", fill: "rgba(0, 0, 0, 0)" },
  unknown: { label: "未知", color: "#f5c542", fill: "rgba(245, 197, 66, 0.22)" },
};

const TRANSITION_BUBBLES = {
  temperature_stop: { label: "温度保护停止充电", color: "#d92d20", icon: "thermometer" },
  upper_limit_stop: { label: "达到上限停止充电", color: "#c75000", icon: "battery" },
  force_charge_stop: { label: "强制充电达到上限停止", color: "#c75000", icon: "battery" },
  below_lower_start: { label: "低于下限开始充电", color: "#15803d", icon: "bolt" },
  minimum_start: { label: "最低电量保护开始充电", color: "#3559c7", icon: "bolt" },
  force_start: { label: "强制开始充电", color: "#0b7a75", icon: "bolt" },
  no_power_failure: { label: "接电异常", color: "#7a271a", icon: "plug" },
  start: { label: "开始充电", color: "#15803d", icon: "bolt" },
  stop: { label: "停止充电", color: "#486581", icon: "plug" },
  unknown: { label: "切换状态未知", color: "#f5c542", icon: "question" },
};

const POLICY_REFERENCE_LINES = [
  { key: "charge_upper_limit", color: "rgba(126, 166, 122, 0.58)", dash: [7, 7] },
  { key: "charge_lower_limit", color: "rgba(205, 179, 105, 0.58)", dash: [7, 7] },
  { key: "minimum_allowed_battery_percent", color: "rgba(198, 124, 124, 0.58)", dash: [7, 7] },
];

let historyChartPoints = [];
let lastHistoryRecords = [];
let historyColorStats = {
  chargeAverageUa: 1500000,
  dischargeAverageUa: 1500000,
};
const HISTORY_CONTRAST_STORAGE_KEY = "adbcc.historyHighContrast";
let historyAnimationFrameId = null;
let historyAnimationMs = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function mixColor(fromHex, toHex, amount) {
  const from = hexToRgb(fromHex);
  const to = hexToRgb(toHex);
  const ratio = clamp(amount, 0, 1);
  const channel = (a, b) => Math.round(a + (b - a) * ratio);
  return `rgb(${channel(from.r, to.r)}, ${channel(from.g, to.g)}, ${channel(from.b, to.b)})`;
}

function temperatureColor(temp) {
  if (!Number.isFinite(temp)) return "#8792a2";
  return mixColor("#f5c542", "#d92d20", (temp - 30) / 15);
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeHistoryColorStats(records) {
  const chargeCurrents = [];
  const dischargeCurrents = [];

  for (const item of records || []) {
    const currentUa = Number(item?.battery?.current_now_ua);
    if (!Number.isFinite(currentUa)) continue;

    const direction = currentDirectionFromStatus(item?.battery?.status);
    const magnitude = Math.abs(currentUa);
    if (direction === "充电") chargeCurrents.push(magnitude);
    if (direction === "放电") dischargeCurrents.push(magnitude);
  }

  return {
    chargeAverageUa: average(chargeCurrents) || 1500000,
    dischargeAverageUa: average(dischargeCurrents) || 1500000,
  };
}

function currentIntensity(item) {
  const numeric = Number(item?.battery?.current_now_ua);
  if (!Number.isFinite(numeric)) return { direction: null, strength: 0.28 };

  const direction = currentDirectionFromStatus(item?.battery?.status);
  if (direction === "充电") {
    const reference = Math.max(historyColorStats.chargeAverageUa || 0, 1);
    return { direction, strength: clamp(Math.abs(numeric) / reference, 0.35, 1.6) };
  }

  if (direction === "放电") {
    const reference = Math.max(historyColorStats.dischargeAverageUa || 0, 1);
    return { direction, strength: clamp(Math.abs(numeric) / reference, 0.35, 1.6) };
  }

  return { direction: null, strength: 0.28 };
}

function rgbaFromCssColor(color, alpha) {
  const rgbMatch = String(color).match(/rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/i);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const { r, g, b } = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function historyAreaStyle(item) {
  const { direction, strength } = currentIntensity(item);
  const amount = clamp((strength - 0.35) / 1.1, 0.12, 1);

  if (direction === "充电") {
    const base = historyHighContrast ? mixColor("#9fd4b0", "#1f6f44", amount) : mixColor("#c3e5cd", "#2f8f58", amount);
    const alpha = historyHighContrast ? 0.56 + amount * 0.26 : 0.46 + amount * 0.28;
    return { direction, amount, color: rgbaFromCssColor(base, alpha) };
  }

  if (direction === "放电") {
    const base = historyHighContrast ? mixColor("#e6b7b7", "#a93f3f", amount) : mixColor("#efcccc", "#c25555", amount);
    const alpha = historyHighContrast ? 0.54 + amount * 0.24 : 0.44 + amount * 0.26;
    return { direction, amount, color: rgbaFromCssColor(base, alpha) };
  }

  return {
    direction: null,
    amount: 0.2,
    color: historyHighContrast ? "rgba(171, 183, 197, 0.42)" : "rgba(194, 203, 214, 0.34)",
  };
}

function historyAreaFill(item) {
  return historyAreaStyle(item).color;
}

function addGradientStop(gradient, offset, color) {
  gradient.addColorStop(clamp(offset, 0, 1), color);
}

function drawContinuousHistoryArea(ctx, valid, x, y, baseline, plotW, pad, cssWidth) {
  if (!valid.length) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x(valid[0].time), baseline);
  for (const point of valid) {
    ctx.lineTo(x(point.time), y(point.level));
  }
  ctx.lineTo(x(valid[valid.length - 1].time), baseline);
  ctx.closePath();
  ctx.clip();

  const left = pad.left;
  const right = cssWidth - pad.right;
  const width = Math.max(plotW, 1);
  const gradient = ctx.createLinearGradient(left, 0, right, 0);

  if (valid.length === 1) {
    addGradientStop(gradient, 0, historyAreaFill(valid[0].item));
    addGradientStop(gradient, 1, historyAreaFill(valid[0].item));
  } else {
    valid.forEach((point, index) => {
      const offset = (x(point.time) - left) / width;
      const color = historyAreaFill(point.item);
      const feather = Math.min(0.018, 0.7 / valid.length);
      if (index === 0) addGradientStop(gradient, 0, color);
      addGradientStop(gradient, Math.max(0, offset - feather), color);
      addGradientStop(gradient, offset, color);
      addGradientStop(gradient, Math.min(1, offset + feather), color);
      if (index === valid.length - 1) addGradientStop(gradient, 1, color);
    });
  }

  ctx.fillStyle = gradient;
  ctx.fillRect(left, pad.top, plotW, baseline - pad.top);

  const softenMiddle = ctx.createLinearGradient(0, pad.top, 0, baseline);
  softenMiddle.addColorStop(0, "rgba(255, 255, 255, 0)");
  softenMiddle.addColorStop(0.26, "rgba(255, 255, 255, 0.08)");
  softenMiddle.addColorStop(0.58, "rgba(255, 255, 255, 0.34)");
  softenMiddle.addColorStop(1, "rgba(255, 255, 255, 0.68)");
  ctx.fillStyle = softenMiddle;
  ctx.fillRect(left, pad.top, plotW, baseline - pad.top);

  const topTint = ctx.createLinearGradient(0, pad.top, 0, baseline);
  topTint.addColorStop(0, "rgba(255, 255, 255, 0)");
  topTint.addColorStop(0.18, "rgba(255, 255, 255, 0)");
  topTint.addColorStop(0.42, "rgba(255, 255, 255, 0.08)");
  topTint.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = topTint;
  ctx.fillRect(left, pad.top, plotW, baseline - pad.top);

  ctx.restore();
}

function drawChargingAxisBase(ctx, x1, x2, baseline, item) {
  if (x2 - x1 <= 1) return;

  const { direction, amount } = historyAreaStyle(item);
  if (direction !== "充电") return;

  const gradient = ctx.createLinearGradient(x1, baseline, x2, baseline);
  const bright = historyHighContrast ? "rgba(37, 133, 77, 0.98)" : "rgba(53, 156, 95, 0.98)";
  const soft = historyHighContrast ? "rgba(113, 210, 142, 0.84)" : "rgba(140, 224, 165, 0.8)";
  gradient.addColorStop(0, soft);
  gradient.addColorStop(0.5, bright);
  gradient.addColorStop(1, soft);

  ctx.save();
  ctx.strokeStyle = gradient;
  ctx.lineCap = "round";
  ctx.lineWidth = 3.6 + amount * 2.4;
  ctx.shadowColor = historyHighContrast ? "rgba(49, 173, 96, 0.58)" : "rgba(64, 189, 109, 0.52)";
  ctx.shadowBlur = 12 + amount * 15;
  ctx.beginPath();
  ctx.moveTo(x1, baseline);
  ctx.lineTo(x2, baseline);
  ctx.stroke();
  ctx.restore();
}

function fillSoftPill(ctx, x, y, width, height, gradient) {
  const radius = height / 2;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();
}

function drawChargingAxisFlow(ctx, x1, x2, baseline, item) {
  const width = x2 - x1;
  if (width <= 1) return;

  const { direction, strength } = currentIntensity(item);
  if (direction !== "充电") return;

  const intensity = clamp((strength - 0.35) / 1.1, 0.18, 1);
  const bandHeight = 34 + intensity * 34;
  const left = x1;
  const right = x2;
  const topLimit = baseline - bandHeight;
  const time = historyAnimationMs;
  const riseProgress = ((time * (historyHighContrast ? 0.0002 : 0.00016)) % 1 + 1) % 1;
  const breathe = (Math.sin(time * (historyHighContrast ? 0.0038 : 0.003)) + 1) / 2;
  const glowGradient = ctx.createLinearGradient(0, baseline, 0, topLimit);
  glowGradient.addColorStop(0, historyHighContrast ? "rgba(35, 136, 79, 0.5)" : "rgba(45, 145, 87, 0.46)");
  glowGradient.addColorStop(0.42, historyHighContrast ? "rgba(83, 194, 119, 0.28)" : "rgba(102, 204, 133, 0.22)");
  glowGradient.addColorStop(1, "rgba(170, 238, 190, 0)");

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, topLimit - 4, width, bandHeight + 4);
  ctx.clip();

  ctx.fillStyle = glowGradient;
  ctx.fillRect(left, topLimit, width, bandHeight);

  const veilCount = 4;
  for (let i = 0; i < veilCount; i += 1) {
    const phase = (riseProgress + i / veilCount) % 1;
    const yCenter = baseline - phase * (bandHeight + 14);
    const veilHeight = 10 + intensity * 9 + i * 1.8;
    const veilAlpha = (1 - phase) * (historyHighContrast ? 0.2 : 0.15);
    const veilGradient = ctx.createLinearGradient(0, yCenter - veilHeight, 0, yCenter + veilHeight);
    veilGradient.addColorStop(0, "rgba(255,255,255,0)");
    veilGradient.addColorStop(0.5, `rgba(229, 255, 236, ${veilAlpha.toFixed(3)})`);
    veilGradient.addColorStop(1, "rgba(255,255,255,0)");
    fillSoftPill(ctx, left + 1, yCenter - veilHeight, Math.max(width - 2, 10), veilHeight * 2, veilGradient);
  }

  const crownY = baseline - (10 + intensity * 12) - breathe * (3 + intensity * 3.4);
  const crownGradient = ctx.createLinearGradient(0, crownY - 6, 0, crownY + 6);
  crownGradient.addColorStop(0, "rgba(255,255,255,0)");
  crownGradient.addColorStop(0.48, historyHighContrast ? "rgba(242, 255, 246, 0.48)" : "rgba(242, 255, 246, 0.44)");
  crownGradient.addColorStop(1, "rgba(255,255,255,0)");
  fillSoftPill(ctx, left + 4, crownY - 5, Math.max(width - 8, 12), 10, crownGradient);

  ctx.restore();
}

function startHistoryAnimation() {
  if (historyAnimationFrameId !== null) return;
  const tick = (timestamp) => {
    historyAnimationMs = timestamp;
    if (lastHistoryRecords.length) drawHistoryChart(lastHistoryRecords);
    historyAnimationFrameId = window.requestAnimationFrame(tick);
  };
  historyAnimationFrameId = window.requestAnimationFrame(tick);
}

function stopHistoryAnimation() {
  if (historyAnimationFrameId === null) return;
  window.cancelAnimationFrame(historyAnimationFrameId);
  historyAnimationFrameId = null;
}

function classifyChargeState(item) {
  if (item.is_charging === true) return "charging";
  if (item.is_charging === false) return "not_charging";

  const status = String(item.battery?.status || "").toLowerCase();
  if (status === "charging") return "charging";
  if (["discharging", "not_charging", "full"].includes(status)) return "not_charging";

  return "unknown";
}

function classifyTransitionBubble(item, previousState, currentState) {
  const decision = item.decision || {};
  const action = item.last_action || {};
  const reason = String(decision.reason || "").toLowerCase();
  const message = String(action.message || "").toLowerCase();

  if (action.success === false && action.action && action.action !== "noop") return "no_power_failure";
  if (message.includes("no external power")) return "no_power_failure";
  if (reason.includes("temperature") || reason.includes("high temperature")) return "temperature_stop";
  if (reason.includes("force charge stop")) return "force_charge_stop";
  if (reason.includes("upper limit")) return "upper_limit_stop";
  if (reason.includes("minimum allowed")) return "minimum_start";
  if (reason.includes("force charge")) return "force_start";
  if (reason.includes("below lower limit")) return "below_lower_start";
  if (action.action === "enable_charging") return "start";
  if (action.action === "disable_charging") return "stop";
  if (previousState === "not_charging" && currentState === "charging") return "start";
  if (previousState === "charging" && currentState === "not_charging") return "stop";
  return "unknown";
}

function isChargingTransition(previousState, currentState) {
  const known = new Set(["charging", "not_charging"]);
  return known.has(previousState) && known.has(currentState) && previousState !== currentState;
}

function drawBubbleIcon(ctx, icon, x, y) {
  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 1.8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (icon === "thermometer") {
    ctx.beginPath();
    ctx.arc(x, y + 4, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y + 2);
    ctx.lineTo(x, y - 7);
    ctx.arc(x, y - 7, 2.8, Math.PI, 0, false);
    ctx.lineTo(x + 2.8, y + 2);
    ctx.stroke();
  } else if (icon === "battery") {
    ctx.strokeRect(x - 6, y - 4, 10, 8);
    ctx.beginPath();
    ctx.moveTo(x + 5, y - 1.5);
    ctx.lineTo(x + 7, y - 1.5);
    ctx.lineTo(x + 7, y + 1.5);
    ctx.lineTo(x + 5, y + 1.5);
    ctx.stroke();
    ctx.fillRect(x - 4, y - 2, 6, 4);
  } else if (icon === "plug") {
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 6);
    ctx.lineTo(x - 4, y - 2);
    ctx.moveTo(x + 4, y - 6);
    ctx.lineTo(x + 4, y - 2);
    ctx.moveTo(x - 6, y - 2);
    ctx.lineTo(x + 6, y - 2);
    ctx.lineTo(x + 5, y + 3);
    ctx.lineTo(x - 5, y + 3);
    ctx.closePath();
    ctx.stroke();
    ctx.moveTo(x, y + 3);
    ctx.lineTo(x, y + 8);
    ctx.stroke();
  } else if (icon === "question") {
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", x, y + 0.5);
  } else {
    ctx.beginPath();
    ctx.moveTo(x + 1, y - 8);
    ctx.lineTo(x - 5, y + 1);
    ctx.lineTo(x, y + 1);
    ctx.lineTo(x - 2, y + 8);
    ctx.lineTo(x + 5, y - 2);
    ctx.lineTo(x, y - 2);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawTransitionBubble(ctx, point, bubble) {
  const bubbleX = point.x;
  const bubbleY = point.bubbleY;
  ctx.save();
  ctx.strokeStyle = bubble.color;
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(point.x, point.y - 4);
  ctx.lineTo(bubbleX, bubbleY + 15);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(bubbleX, bubbleY, 14, 0, Math.PI * 2);
  ctx.fillStyle = bubble.color;
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();
  drawBubbleIcon(ctx, bubble.icon, bubbleX, bubbleY);
  ctx.restore();
}

function chartPolicy(records) {
  if (currentPolicy) return currentPolicy;
  const latestWithPolicy = [...records].reverse().find((item) => item.policy);
  return latestWithPolicy?.policy || null;
}

function drawPolicyReferenceLines(ctx, records, y, pad, cssWidth) {
  const policy = chartPolicy(records);
  if (!policy) return;

  ctx.save();

  for (const line of POLICY_REFERENCE_LINES) {
    const value = Number(policy[line.key]);
    if (!Number.isFinite(value)) continue;

    const py = y(value);
    ctx.beginPath();
    ctx.setLineDash(line.dash);
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 1.1;
    ctx.moveTo(pad.left, py);
    ctx.lineTo(cssWidth - pad.right, py);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.restore();
}

function drawNoHistory(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#657080";
  ctx.font = "16px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("暂无历史数据", width / 2, height / 2);
}

function drawHistoryChart(records) {
  const canvas = $("historyChart");
  const wrapper = canvas.parentElement;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(320, wrapper.clientWidth);
  const cssHeight = 360;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.height = `${cssHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  historyChartPoints = [];
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const valid = records
    .map((item) => ({
      item,
      time: new Date(item.timestamp).getTime(),
      level: Number(item.battery?.level),
      temp: item.battery?.temperature_c === null ? null : Number(item.battery?.temperature_c),
    }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.level));

  if (!valid.length) {
    drawNoHistory(ctx, cssWidth, cssHeight);
    return;
  }

  const pad = { left: 46, right: 18, top: 20, bottom: 38 };
  const plotW = cssWidth - pad.left - pad.right;
  const plotH = cssHeight - pad.top - pad.bottom;
  const minTime = valid[0].time;
  const maxTime = valid[valid.length - 1].time;
  const span = Math.max(1, maxTime - minTime);
  const x = (time) => pad.left + ((time - minTime) / span) * plotW;
  const y = (level) => pad.top + (1 - clamp(level, 0, 100) / 100) * plotH;
  const baseline = pad.top + plotH;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  ctx.strokeStyle = "#d7dde5";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#657080";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const tick of [0, 20, 40, 60, 80, 100]) {
    const ty = y(tick);
    ctx.beginPath();
    ctx.moveTo(pad.left, ty);
    ctx.lineTo(cssWidth - pad.right, ty);
    ctx.stroke();
    ctx.fillText(`${tick}%`, pad.left - 8, ty);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const timeTicks = valid.length > 1 ? [valid[0], valid[Math.floor(valid.length / 2)], valid[valid.length - 1]] : [valid[0]];
  for (const tick of timeTicks) {
    const tx = x(tick.time);
    ctx.fillText(new Date(tick.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), tx, baseline + 10);
  }

  drawContinuousHistoryArea(ctx, valid, x, y, baseline, plotW, pad, cssWidth);

  for (let i = 0; i < valid.length - 1; i += 1) {
    const current = valid[i];
    const next = valid[i + 1];
    drawChargingAxisBase(ctx, x(current.time), x(next.time), baseline, current.item);
  }

  for (let i = 0; i < valid.length - 1; i += 1) {
    const current = valid[i];
    const next = valid[i + 1];
    drawChargingAxisFlow(ctx, x(current.time), x(next.time), baseline, current.item);
  }

  drawPolicyReferenceLines(ctx, records, y, pad, cssWidth);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 0; i < Math.max(1, valid.length - 1); i += 1) {
    const current = valid[i];
    const next = valid[i + 1] || valid[i];
    ctx.beginPath();
    ctx.moveTo(x(current.time), y(current.level));
    ctx.lineTo(x(next.time), y(next.level));
    ctx.strokeStyle = temperatureColor(current.temp);
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  for (const point of valid) {
    const px = x(point.time);
    const py = y(point.level);
    historyChartPoints.push({ x: px, y: py, item: point.item });
    ctx.beginPath();
    ctx.arc(px, py, valid.length > 200 ? 1.4 : 2.8, 0, Math.PI * 2);
    ctx.fillStyle = temperatureColor(point.temp);
    ctx.fill();
  }

  for (let i = 1; i < valid.length; i += 1) {
    const previous = valid[i - 1];
    const current = valid[i];
    const previousState = classifyChargeState(previous.item);
    const currentState = classifyChargeState(current.item);
    if (!isChargingTransition(previousState, currentState)) continue;

    const px = x(current.time);
    const py = y(current.level);
    const bubbleKey = classifyTransitionBubble(current.item, previousState, currentState);
    const bubble = TRANSITION_BUBBLES[bubbleKey] || TRANSITION_BUBBLES.unknown;
    const bubblePoint = {
      x: px,
      y: py,
      bubbleY: Math.max(pad.top + 16, py - 32),
      item: current.item,
      transition: true,
      transitionLabel: bubble.label,
    };
    drawTransitionBubble(ctx, bubblePoint, bubble);
    historyChartPoints.push(bubblePoint);
  }

  ctx.strokeStyle = "#20242a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, baseline);
  ctx.lineTo(cssWidth - pad.right, baseline);
  ctx.stroke();
}

function renderHistoryLegend() {
  const speedLegend = historyHighContrast
    ? "linear-gradient(90deg, rgba(169, 63, 63, 0.64), rgba(171, 183, 197, 0.42), rgba(31, 111, 68, 0.68))"
    : "linear-gradient(90deg, rgba(194, 85, 85, 0.58), rgba(194, 203, 214, 0.34), rgba(47, 143, 88, 0.62))";
  $("historyLegend").innerHTML = `
    <span class="legend-item"><span class="legend-swatch" style="background:${speedLegend}"></span>面积颜色：连续映射充放电速度</span>
    <span class="legend-item"><span class="legend-swatch" style="background:linear-gradient(180deg, rgba(53, 156, 95, 0.96), rgba(160, 226, 175, 0.04))"></span>充电时：底部绿带向上涌动</span>
    <span class="legend-item"><span class="legend-swatch" style="background:linear-gradient(90deg,#f5c542,#d92d20)"></span>曲线颜色：温度黄到红</span>
    <span class="legend-item"><span class="legend-swatch bubble-swatch"></span>气泡：充电状态切换点</span>
  `;
}

function applyHistoryContrastPreference() {
  const toggle = $("historyContrastToggle");
  if (toggle) toggle.checked = historyHighContrast;
}

function loadHistoryContrastPreference() {
  try {
    historyHighContrast = window.localStorage.getItem(HISTORY_CONTRAST_STORAGE_KEY) === "true";
  } catch {
    historyHighContrast = false;
  }
  applyHistoryContrastPreference();
}

function saveHistoryContrastPreference(enabled) {
  historyHighContrast = Boolean(enabled);
  applyHistoryContrastPreference();
  try {
    window.localStorage.setItem(HISTORY_CONTRAST_STORAGE_KEY, historyHighContrast ? "true" : "false");
  } catch {}
}

function renderHistory(data) {
  const records = data.records || [];
  const levels = records.map((item) => item.battery?.level).filter((value) => Number.isFinite(value));
  const latest = records[records.length - 1];
  const levelRange = levels.length ? `${Math.min(...levels)}% - ${Math.max(...levels)}%` : "-";

  $("historySummary").textContent = records.length
    ? `最近 ${data.hours} 小时 ${data.count} 条记录；最新 ${fmtTime(latest.timestamp)}；电量范围 ${levelRange}`
    : `最近 ${data.hours} 小时暂无历史记录`;

  lastHistoryRecords = records;
  drawHistoryChart(records);
  renderHistoryLegend();
}

async function loadHistory() {
  const [result, pastDayResult] = await Promise.all([
    api(`/api/history?hours=${currentHistoryHours}`),
    currentHistoryHours === 24 ? Promise.resolve(null) : api("/api/history?hours=24"),
  ]);
  if (!result.ok) {
    $("historySummary").textContent = result.error;
    return;
  }
  const colorRecords = currentHistoryHours === 24 ? result.data.records : pastDayResult?.ok ? pastDayResult.data.records : result.data.records;
  historyColorStats = computeHistoryColorStats(colorRecords);
  renderHistory(result.data);
}

function setHistoryRange(hours) {
  currentHistoryHours = hours;
  document.querySelectorAll(".history-range").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.historyHours) === hours);
  });
  loadHistory();
}

function showHistoryTooltip(event) {
  const tooltip = $("historyTooltip");
  if (!historyChartPoints.length) {
    tooltip.hidden = true;
    return;
  }

  const canvas = $("historyChart");
  const rect = canvas.getBoundingClientRect();
  const mx = event.clientX - rect.left;
  const my = event.clientY - rect.top;
  let nearest = null;
  let bestDistance = Infinity;
  for (const point of historyChartPoints) {
    const distance = Math.hypot(point.x - mx, point.y - my);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = point;
    }
  }

  if (!nearest || bestDistance > 36) {
    tooltip.hidden = true;
    return;
  }

  const item = nearest.item;
  const battery = item.battery || {};
  const decision = item.decision || {};
  const action = item.last_action || {};
  const state = CHARGE_STATE_COLORS[classifyChargeState(item)] || CHARGE_STATE_COLORS.unknown;
  tooltip.innerHTML = `
    <strong>${escapeHtml(fmtTime(item.timestamp))}</strong><br />
    ${escapeHtml(item.connection_name || item.connection_id)} · ${escapeHtml(fmt(battery.level))}% · ${escapeHtml(formatTemperature(battery.temperature_c))}<br />
    ${escapeHtml(nearest.transitionLabel || state.label)}<br />
    电流：${escapeHtml(formatCurrent(battery.current_now_ua, battery.status))} · 电压：${escapeHtml(formatVoltageMv(battery.voltage_mv))}<br />
    健康度：${escapeHtml(fmt(battery.health))} · 类型：${escapeHtml(fmt(battery.technology))}<br />
    策略：${escapeHtml(fmt(decision.action))}，${escapeHtml(fmt(decision.reason, ""))}<br />
    状态：充电中=${escapeHtml(fmt(item.is_charging))}，接电=${escapeHtml(fmt(item.power_connected))}<br />
    执行：${item.action_executed ? "已执行" : "未执行"} ${escapeHtml(fmt(action.action, ""))}
  `;
  tooltip.hidden = false;
  tooltip.style.left = `${clamp(nearest.x + 12, 8, rect.width - 350)}px`;
  tooltip.style.top = `${clamp(nearest.y - 18, 8, rect.height - 170)}px`;
}

function hideHistoryTooltip() {
  $("historyTooltip").hidden = true;
}

$("refreshBtn").addEventListener("click", refresh);

$("loadConfigBtn").addEventListener("click", loadConfigEditor);

$("loadHistoryBtn").addEventListener("click", loadHistory);

document.querySelectorAll(".history-range").forEach((button) => {
  button.addEventListener("click", () => setHistoryRange(Number(button.dataset.historyHours)));
});

if ($("historyContrastToggle")) {
  $("historyContrastToggle").addEventListener("change", () => {
    saveHistoryContrastPreference($("historyContrastToggle").checked);
    drawHistoryChart(lastHistoryRecords);
    renderHistoryLegend();
  });
}

if ($("batteryCard")) {
  $("batteryCard").addEventListener("click", () => {
    toggleExclusiveDetailPanel("battery");
  });
  $("batteryCard").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleExclusiveDetailPanel("battery");
    }
  });
}

if ($("connectionCard")) {
  $("connectionCard").addEventListener("click", () => {
    toggleExclusiveDetailPanel("connection");
  });
  $("connectionCard").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleExclusiveDetailPanel("connection");
    }
  });
}

if ($("policyCard")) {
  $("policyCard").addEventListener("click", () => {
    toggleExclusiveDetailPanel("policy");
  });
  $("policyCard").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleExclusiveDetailPanel("policy");
    }
  });
}

$("historyChart").addEventListener("mousemove", showHistoryTooltip);
$("historyChart").addEventListener("mouseleave", hideHistoryTooltip);

window.addEventListener("resize", () => {
  drawHistoryChart(lastHistoryRecords);
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopHistoryAnimation();
  else startHistoryAnimation();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && connectionEditorOpen) {
    closeConnectionEditor();
  }
});

if ($("connectionEditorModal")) {
  $("connectionEditorModal").addEventListener("click", (event) => {
    if (event.target === $("connectionEditorModal")) {
      closeConnectionEditor();
    }
  });
}

if ($("closeConnectionEditorBtn")) {
  $("closeConnectionEditorBtn").addEventListener("click", () => {
    closeConnectionEditor();
  });
}

$("saveConfigBtn").addEventListener("click", async () => {
  let parsed;
  try {
    parsed = JSON.parse($("configEditor").value);
  } catch (error) {
    $("configMessage").textContent = `JSON 格式错误：${error.message}`;
    return;
  }

  const result = await api("/api/config", {
    method: "POST",
    body: JSON.stringify({ config: parsed }),
  });
  if (!result.ok) {
    $("configMessage").textContent = result.error;
    return;
  }

  $("configPath").textContent = `配置文件路径：${result.data.path}`;
  $("configEditor").value = JSON.stringify(result.data.config, null, 2);
  $("configMessage").textContent = "完整配置已保存并立即生效。";
  selectedConnectionId = result.data.config.active_connection_id;
  connectionFormDirty = false;
  await refresh();
});

$("newConnectionBtn").addEventListener("click", () => {
  selectedConnectionId = null;
  fillConnectionForm(defaultConnection());
  $("connectionFormMessage").textContent = "正在新建连接";
  openConnectionEditor("新建设备");
});

$("connectionForm").addEventListener("input", () => {
  connectionFormDirty = true;
});

$("connectionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = connectionPayloadFromForm();
  const result = await api("/api/connections", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  $("connectionFormMessage").textContent = result.ok ? "设备参数已保存，下一轮轮询立即生效。" : result.error;
  if (result.ok) {
    selectedConnectionId = payload.id;
    connectionFormDirty = false;
    closeConnectionEditor();
  }
  await refresh();
});

$("deleteConnectionBtn").addEventListener("click", async () => {
  const payload = connectionPayloadFromForm();
  if (!payload.id) return;
  if (!confirm(`删除连接 ${payload.id}？`)) return;
  const result = await api(`/api/connections/${encodeURIComponent(payload.id)}`, { method: "DELETE" });
  $("connectionFormMessage").textContent = result.ok ? "连接已删除。" : result.error;
  if (result.ok) {
    selectedConnectionId = null;
    fillConnectionForm(defaultConnection());
    closeConnectionEditor();
  }
  await refresh();
});

async function savePolicyForm(message = "已保存，下一次轮询立即使用新策略。") {
  const form = $("policyForm");
  const forceCharge = form.elements.force_charge_enabled;
  const forceStop = form.elements.force_charge_stop_percent;
  const payload = {
    charge_upper_limit: Number(form.elements.charge_upper_limit.value),
    charge_lower_limit: Number(form.elements.charge_lower_limit.value),
    temperature_stop_threshold_c: Number(form.elements.temperature_stop_threshold_c.value),
    temperature_resume_threshold_c: Number(form.elements.temperature_resume_threshold_c.value),
    minimum_allowed_battery_percent: Number(form.elements.minimum_allowed_battery_percent.value),
    charge_start_timeout_seconds: Number(form.elements.charge_start_timeout_seconds.value),
    force_charge_enabled: forceCharge ? forceCharge.checked : false,
    force_charge_stop_percent: Number(forceStop?.value || 95),
    policy_name: "threshold",
  };
  const result = await api("/api/policy", { method: "POST", body: JSON.stringify(payload) });
  $("formMessage").textContent = result.ok ? message : result.error;
  await refresh();
}

$("policyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await savePolicyForm();
});

if ($("policyForm").elements.force_charge_enabled) {
  $("policyForm").elements.force_charge_enabled.addEventListener("change", async () => {
    await savePolicyForm("强制充电开关已更新，下一次轮询立即生效。");
  });
}

loadHistoryContrastPreference();
setExclusiveDetailPanel(null);
setConnectionEditorOpen(false);
startHistoryAnimation();
refresh();
loadConfigEditor();
loadHistory();
setInterval(refresh, 5000);
setInterval(loadHistory, 60000);
