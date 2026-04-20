const $ = (id) => document.getElementById(id);

let selectedConnectionId = null;
let currentConnections = [];
let connectionFormDirty = false;
let currentHistoryHours = 4;
let currentPolicy = null;

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
    ? `status=${fmt(battery.status)} temp=${fmt(battery.temperature_c)}°C health=${fmt(battery.health)} present=${fmt(battery.present)}`
    : fmt(data.last_error, "暂无数据");

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
    return;
  }
  selectedConnectionId = connectionId;
  if (!connectionFormDirty || force) {
    fillConnectionForm(item.connection);
  }
  $("connectionFormMessage").textContent = `正在编辑 ${item.connection.name}`;
}

function renderConnections(items) {
  currentConnections = items;
  $("connections").innerHTML = "";

  const knownIds = new Set(items.map((item) => item.connection.id));
  if (!selectedConnectionId || !knownIds.has(selectedConnectionId)) {
    const active = items.find((item) => item.active) || items[0];
    if (active) {
      selectedConnectionId = active.connection.id;
      fillConnectionForm(active.connection);
    } else {
      selectedConnectionId = null;
      fillConnectionForm(defaultConnection());
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

  for (let i = 0; i < valid.length - 1; i += 1) {
    const current = valid[i];
    const next = valid[i + 1];
    const state = CHARGE_STATE_COLORS[classifyChargeState(current.item)] || CHARGE_STATE_COLORS.unknown;
    const x1 = x(current.time);
    const y1 = y(current.level);
    const x2 = x(next.time);
    const y2 = y(next.level);
    ctx.beginPath();
    ctx.moveTo(x1, baseline);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2, baseline);
    ctx.closePath();
    ctx.fillStyle = state.fill;
    ctx.fill();
  }

  if (valid.length === 1) {
    const only = valid[0];
    const state = CHARGE_STATE_COLORS[classifyChargeState(only.item)] || CHARGE_STATE_COLORS.unknown;
    const px = x(only.time);
    ctx.fillStyle = state.fill;
    ctx.fillRect(pad.left, y(only.level), plotW, baseline - y(only.level));
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
  const legendItems = Object.values(CHARGE_STATE_COLORS)
    .map(
      (item) =>
        `<span class="legend-item"><span class="legend-swatch" style="background:${item.fill}; border-color:${item.color}"></span>${escapeHtml(item.label)}</span>`
    )
    .join("");
  $("historyLegend").innerHTML = `${legendItems}<span class="legend-item"><span class="legend-swatch" style="background:linear-gradient(90deg,#f5c542,#d92d20)"></span>曲线颜色：温度黄到红</span><span class="legend-item"><span class="legend-swatch bubble-swatch"></span>气泡：充电状态切换点</span>`;
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
  const result = await api(`/api/history?hours=${currentHistoryHours}`);
  if (!result.ok) {
    $("historySummary").textContent = result.error;
    return;
  }
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
    ${escapeHtml(item.connection_name || item.connection_id)} · ${escapeHtml(fmt(battery.level))}% · ${escapeHtml(fmt(battery.temperature_c))}°C<br />
    ${escapeHtml(nearest.transitionLabel || state.label)}<br />
    策略：${escapeHtml(fmt(decision.action))}，${escapeHtml(fmt(decision.reason, ""))}<br />
    状态：充电中=${escapeHtml(fmt(item.is_charging))}，接电=${escapeHtml(fmt(item.power_connected))}<br />
    执行：${item.action_executed ? "已执行" : "未执行"} ${escapeHtml(fmt(action.action, ""))}
  `;
  tooltip.hidden = false;
  tooltip.style.left = `${clamp(nearest.x + 12, 8, rect.width - 310)}px`;
  tooltip.style.top = `${clamp(nearest.y - 18, 8, rect.height - 120)}px`;
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

$("historyChart").addEventListener("mousemove", showHistoryTooltip);
$("historyChart").addEventListener("mouseleave", hideHistoryTooltip);

window.addEventListener("resize", () => {
  drawHistoryChart(lastHistoryRecords);
});

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

refresh();
loadConfigEditor();
loadHistory();
setInterval(refresh, 5000);
setInterval(loadHistory, 60000);
