export const DOMAIN = "ha_thermo";
export const INTEGRATION_VERSION = "0.3.9";
export const EVENT_TYPES = [
  `${DOMAIN}_profile_changed`,
  `${DOMAIN}_bypass_started`,
  `${DOMAIN}_bypass_ended`,
  `${DOMAIN}_target_changed`,
  `${DOMAIN}_manual_override`,
  `${DOMAIN}_profile_override_started`,
  `${DOMAIN}_profile_override_ended`,
  `${DOMAIN}_profiles_changed`,
  `${DOMAIN}_zone_schedule_changed`,
];
export const WEEK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const DAY_LABELS = { mon: "Lun", tue: "Mar", wed: "Mer", thu: "Gio", fri: "Ven", sat: "Sab", sun: "Dom" };

export const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const round = (v) => (v == null ? null : Math.round(v * 2) / 2);

export const formatTemp = (v) => (v == null || Number.isNaN(Number(v)) ? "--" : `${(Math.round(Number(v) * 10) / 10).toFixed(1)}°`);

export const formatRemaining = (s) => {
  if (s == null) return "--";
  const m = Math.max(0, Math.round(Number(s) / 60));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
};

export const todayKey = () => DAY_KEYS[new Date().getDay()];

export const findZone = (data, zoneFilter) => {
  if (!data?.zones?.length) return null;
  if (!zoneFilter) return data.zones.length === 1 ? data.zones[0] : null;
  const v = String(zoneFilter).trim();
  if (!v) return data.zones.length === 1 ? data.zones[0] : null;
  for (const z of data.zones) {
    if (z.id === v || z.climate_entity === v || z.name.toLowerCase() === v.toLowerCase()) return z;
  }
  return null;
};

export const getZoneOptions = (zones, includeAll = false, allLabel = "Tutte le zone") => {
  const opts = includeAll ? [`<option value="all">${esc(allLabel)}</option>`] : [];
  for (const z of zones) opts.push(`<option value="${esc(z.id)}">${esc(z.name)} (${esc(z.climate_entity)})</option>`);
  return opts.join("");
};

export const profileOptions = (profiles, selected) =>
  (profiles || [])
    .map((p) => `<option value="${esc(p.id)}" ${selected === p.id ? "selected" : ""}>${esc(p.name)}</option>`)
    .join("");

export const callWS = async (hass, msg) => await hass.callWS(msg);

export const slugProfileId = (name) =>
  String(name || "profilo")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48) || "profilo";

export const newProfileDraft = (name, temperature = 20) => ({
  id: slugProfileId(name),
  name: name || "Nuovo profilo",
  icon: "mdi:home-thermometer",
  hourly: Array.from({ length: 24 }, () => Number(temperature)),
});

export const uniformProfileHourly = (profile, temperature) => {
  const next = JSON.parse(JSON.stringify(profile));
  next.hourly = Array.from({ length: 24 }, () => Number(temperature));
  return next;
};

export const profileAverageTemp = (profile, fallback = 20) => {
  if (!Array.isArray(profile?.hourly) || !profile.hourly.length) return fallback;
  const sum = profile.hourly.reduce((a, b) => a + Number(b), 0);
  return Math.round((sum / profile.hourly.length) * 10) / 10;
};

export const GRAPH_TIME_RANGES = [
  { key: "6h", hours: 6, label: "6 ore" },
  { key: "12h", hours: 12, label: "12 ore" },
  { key: "24h", hours: 24, label: "24 ore" },
  { key: "48h", hours: 48, label: "48 ore" },
  { key: "7d", hours: 168, label: "7 giorni" },
];

export const graphHoursToShow = (config = {}, fallbackHours = 48) => {
  const h = Number(config.hours_to_show);
  if (h > 0 && h <= 168) return h;
  const preset = GRAPH_TIME_RANGES.find((r) => r.key === config.time_range);
  return preset?.hours ?? fallbackHours;
};

export const HISTORY_SERIES_COLORS = {
  current: "#2196F3",
  target: "#FFC107",
  profile: "#4CAF50",
  sensors: ["#03A9F4", "#9C27B0", "#009688", "#E91E63"],
};

export const parseRoomSensorList = (value) => {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter((v) => v.startsWith("sensor."));
  if (value == null || value === "") return [];
  return String(value)
  .split(/[,;\s]+/)
  .map((s) => s.trim())
  .filter((s) => s.startsWith("sensor."));
};

const _tsFromState = (state) => {
  if (!state) return null;
  if (state.last_changed) return new Date(state.last_changed).getTime();
  if (state.last_updated) return new Date(state.last_updated).getTime();
  if (state.lu != null) return Number(state.lu) * 1000;
  if (state.lc != null) return Number(state.lc) * 1000;
  return null;
};

export const normalizeHistoryStates = (states) => {
  if (!Array.isArray(states)) return [];
  return states.map((raw) => {
    if (raw.last_changed || raw.last_updated) return raw;
    const lu = raw.lu != null ? Number(raw.lu) * 1000 : null;
    const lc = raw.lc != null ? Number(raw.lc) * 1000 : lu;
    return {
      state: raw.s ?? raw.state,
      last_changed: lc ? new Date(lc).toISOString() : undefined,
      last_updated: lu ? new Date(lu).toISOString() : undefined,
      attributes: raw.a ?? raw.attributes ?? {},
    };
  });
};

/** @param {unknown} raw @param {string[]} entityIds */
export const historyByEntity = (raw, entityIds = []) => {
  const out = {};
  if (!raw) return out;
  if (Array.isArray(raw)) {
    if (raw.length && (raw[0]?.entity_id || raw[0]?.e)) {
      for (const block of raw) {
        const id = block.entity_id || block.e;
        if (id) out[id] = normalizeHistoryStates(block.states || block.s || []);
      }
      return out;
    }
    if (entityIds.length === raw.length) {
      entityIds.forEach((id, i) => {
        out[id] = normalizeHistoryStates(raw[i]);
      });
      return out;
    }
    if (entityIds.length === 1) {
      out[entityIds[0]] = normalizeHistoryStates(raw);
    }
    return out;
  }
  if (typeof raw === "object") {
    for (const [id, states] of Object.entries(raw)) {
      out[id] = normalizeHistoryStates(states);
    }
  }
  return out;
};

export const climateSetpointFromState = (state) => {
  const a = state?.attributes || {};
  if (a.temperature != null && !Number.isNaN(Number(a.temperature))) return Number(a.temperature);
  const low = a.target_temp_low;
  const high = a.target_temp_high;
  if (low != null && high != null && !Number.isNaN(Number(low)) && !Number.isNaN(Number(high))) {
    return (Number(low) + Number(high)) / 2;
  }
  if (low != null && !Number.isNaN(Number(low))) return Number(low);
  if (high != null && !Number.isNaN(Number(high))) return Number(high);
  return NaN;
};

export const climateCurrentFromState = (state) => {
  const a = state?.attributes || {};
  if (a.current_temperature != null && !Number.isNaN(Number(a.current_temperature))) {
    return Number(a.current_temperature);
  }
  return NaN;
};

export const sensorTempFromState = (state) => {
  const n = parseFloat(state?.state);
  if (Number.isNaN(n) || state?.state === "unavailable" || state?.state === "unknown") return NaN;
  return n;
};

const _historyPoints = (states, valueFn) => {
  const points = [];
  for (const s of states || []) {
    const y = valueFn(s);
    const x = _tsFromState(s);
    if (x == null || Number.isNaN(y)) continue;
    points.push({ x, y });
  }
  return points;
};

export const historySetpointPoints = (states) => _historyPoints(states, climateSetpointFromState);
export const historyClimateCurrentPoints = (states) => _historyPoints(states, climateCurrentFromState);
export const historySensorPoints = (states) => _historyPoints(states, sensorTempFromState);

export const yDomainPadded = (values, minOverride, maxOverride, minSpan = 1.5) => {
  const nums = values.filter((v) => v != null && !Number.isNaN(v));
  if (!nums.length) return { min: 18, max: 24 };
  let min = minOverride != null ? Number(minOverride) : Math.min(...nums);
  let max = maxOverride != null ? Number(maxOverride) : Math.max(...nums);
  if (minOverride == null && maxOverride == null) {
    if (max - min < minSpan) {
      const mid = (min + max) / 2;
      min = mid - minSpan / 2;
      max = mid + minSpan / 2;
    }
    const pad = Math.max(0.4, (max - min) * 0.1);
    min -= pad;
    max += pad;
  }
  return { min, max };
};

export const stepLinePath = (points, xScale, yScale, rangeStart, rangeEnd) => {
  if (!points?.length) return "";
  const sorted = [...points].sort((a, b) => a.x - b.x);
  let idx = 0;
  while (idx < sorted.length - 1 && sorted[idx + 1].x <= rangeStart) idx += 1;
  let y = sorted[idx].y;
  let x = rangeStart;
  const parts = [`M ${xScale(x).toFixed(2)} ${yScale(y).toFixed(2)}`];
  for (let i = idx; i < sorted.length; i += 1) {
    const p = sorted[i];
    if (p.x > rangeEnd) break;
    const px = Math.max(p.x, rangeStart);
    if (px > x) {
      parts.push(`L ${xScale(px).toFixed(2)} ${yScale(y).toFixed(2)}`);
      x = px;
    }
    if (p.y !== y) {
      parts.push(`L ${xScale(x).toFixed(2)} ${yScale(p.y).toFixed(2)}`);
      y = p.y;
    }
  }
  parts.push(`L ${xScale(rangeEnd).toFixed(2)} ${yScale(y).toFixed(2)}`);
  return parts.join(" ");
};

export const linePath = (points, xScale, yScale, rangeStart, rangeEnd) => {
  const inRange = (points || [])
    .filter((p) => p.x >= rangeStart && p.x <= rangeEnd)
    .sort((a, b) => a.x - b.x);
  if (!inRange.length) return "";
  return inRange.map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.x).toFixed(2)} ${yScale(p.y).toFixed(2)}`).join(" ");
};

/** Today's scheduled hourly profile mapped onto the time axis (step segments). */
export const profileSchedulePoints = (hourly, rangeStart, rangeEnd) => {
  if (!Array.isArray(hourly) || hourly.length < 24) return [];
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const points = [];
  for (let h = 0; h < 24; h += 1) {
    const x = dayStart.getTime() + h * 3600000;
    if (x > rangeEnd) break;
    if (x + 3600000 < rangeStart) continue;
    const y = Number(hourly[h]);
    if (!Number.isNaN(y)) points.push({ x, y });
  }
  return points;
};

export const formatChartTime = (ms, spanHours) => {
  const d = new Date(ms);
  if (spanHours > 48) {
    return d.toLocaleString("it-IT", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
};

export const formatTempLegend = (v) => {
  if (v == null || Number.isNaN(Number(v))) return "--";
  const n = Math.round(Number(v) * 10) / 10;
  return `${n.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`;
};

const _lastY = (points) => (points?.length ? points[points.length - 1].y : null);

export const liveClimateValue = (hass, entityId, kind) => {
  const st = hass?.states?.[entityId];
  if (!st) return null;
  if (kind === "current") return climateCurrentFromState(st);
  if (kind === "target") return climateSetpointFromState(st);
  return sensorTempFromState(st);
};

export async function fetchRecorderHistory(hass, entityIds, startMs, endMs) {
  if (!hass || !entityIds?.length) return {};
  try {
    const raw = await hass.callWS({
      type: "history/history_during_period",
      start_time: new Date(startMs).toISOString(),
      end_time: new Date(endMs).toISOString(),
      entity_ids: entityIds,
      minimal_response: false,
      no_attributes: false,
      significant_changes_only: false,
    });
    return historyByEntity(raw, entityIds);
  } catch (e) {
    return {};
  }
}

export function yDomainHistory(values, minOverride, maxOverride) {
  const nums = (values || []).filter((v) => v != null && !Number.isNaN(v));
  if (!nums.length) return { min: 16, max: 22 };
  let min = minOverride != null ? Number(minOverride) : Math.floor(Math.min(...nums)) - 1;
  let max = maxOverride != null ? Number(maxOverride) : Math.ceil(Math.max(...nums)) + 1;
  if (max <= min) max = min + 2;
  return { min, max };
}

export function xAxisTickMarks(start, end, spanHours) {
  const stepH = spanHours <= 72 ? 6 : 12;
  const step = stepH * 3600000;
  const marks = [];
  const cursor = new Date(start);
  cursor.setMinutes(0, 0, 0);
  cursor.setSeconds(0, 0);
  const offset = cursor.getHours() % stepH;
  if (offset) cursor.setHours(cursor.getHours() + (stepH - offset));
  while (cursor.getTime() <= end + step) {
    const ms = cursor.getTime();
    if (ms >= start - 1 && ms <= end + 1) {
      const isMidnight = cursor.getHours() === 0;
      marks.push({
        ms,
        isMidnight,
        time: cursor.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }),
        date: isMidnight
          ? cursor.toLocaleDateString("it-IT", { day: "numeric", month: "short" }).replace(/\./g, "")
          : null,
      });
    }
    cursor.setHours(cursor.getHours() + stepH);
  }
  return marks;
}

export function assembleHistorySeries({
  hass,
  byEntity,
  climateId,
  sensorIds = [],
  includeCurrent = true,
  includeTarget = true,
  profilePoints = null,
  colors = {},
}) {
  const climateHist = byEntity[climateId] || [];
  const series = [];
  if (includeTarget) {
    const points = historySetpointPoints(climateHist);
    series.push({
      id: "target",
      label: "temperatura destinataria",
      color: colors.target || HISTORY_SERIES_COLORS.target,
      points,
      step: true,
      currentValue: liveClimateValue(hass, climateId, "target") ?? _lastY(points),
    });
  }
  if (includeCurrent) {
    const points = historyClimateCurrentPoints(climateHist);
    series.push({
      id: "current",
      label: "temperatura attuale",
      color: colors.current || HISTORY_SERIES_COLORS.current,
      points,
      step: true,
      currentValue: liveClimateValue(hass, climateId, "current") ?? _lastY(points),
    });
  }
  sensorIds.forEach((sid, i) => {
    if (sid === climateId) return;
    const points = historySensorPoints(byEntity[sid] || []);
    const label = hass?.states?.[sid]?.attributes?.friendly_name || sid;
    series.push({
      id: `sensor:${sid}`,
      label,
      color: (colors.sensors && colors.sensors[i]) || HISTORY_SERIES_COLORS.sensors[i % HISTORY_SERIES_COLORS.sensors.length],
      points,
      step: true,
      currentValue: liveClimateValue(hass, sid, "sensor") ?? _lastY(points),
    });
  });
  if (profilePoints?.length) {
    series.push({
      id: "profile",
      label: "profilo programmato",
      color: colors.profile || HISTORY_SERIES_COLORS.profile,
      points: profilePoints,
      step: true,
      dashed: true,
      currentValue: null,
    });
  }
  return series;
}

export function renderHistoryChartSvg({
  series,
  visibility = {},
  start,
  end,
  spanHours,
  width = 480,
  height = 200,
  minY,
  maxY,
}) {
  const left = 42;
  const right = 10;
  const top = 16;
  const bottom = 28;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const span = Math.max(1, end - start);
  const xScale = (t) => left + ((t - start) / span) * plotW;
  const yScale = (v) => top + (1 - (v - minY) / (maxY - minY)) * plotH;

  const visible = series.filter((s) => visibility[s.id] !== false);
  const hasData = visible.some((s) => s.points?.length);
  if (!hasData) {
    return `<svg class="curve" data-history-chart viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="var(--secondary-text-color)">Nessun dato storico</text></svg>`;
  }

  const yGrid = [];
  for (let v = Math.ceil(minY); v <= Math.floor(maxY); v += 1) {
    const y = yScale(v);
    yGrid.push(
      `<line x1="${left}" y1="${y.toFixed(1)}" x2="${width - right}" y2="${y.toFixed(1)}" stroke="var(--divider-color)" stroke-width="0.6" opacity="0.55"/>` +
        `<text x="${left - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--secondary-text-color)">${v}</text>`,
    );
  }
  yGrid.push(
    `<text x="${left - 6}" y="${(top - 4).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--secondary-text-color)">°C</text>`,
  );

  const xGrid = xAxisTickMarks(start, end, spanHours).map((m) => {
    const x = xScale(m.ms);
    const labelY = m.isMidnight ? height - 18 : height - 8;
    const weight = m.isMidnight ? "600" : "400";
    const fill = m.isMidnight ? "var(--primary-text-color)" : "var(--secondary-text-color)";
    let text = m.isMidnight ? m.date : m.time;
    return (
      `<line x1="${x.toFixed(1)}" y1="${top}" x2="${x.toFixed(1)}" y2="${height - bottom}" stroke="var(--divider-color)" stroke-width="0.4" opacity="0.35"/>` +
      `<text x="${x.toFixed(1)}" y="${labelY}" text-anchor="middle" font-size="8" font-weight="${weight}" fill="${fill}">${esc(text)}</text>`
    );
  });

  const paths = visible
    .map((s) => {
      const d = stepLinePath(s.points, xScale, yScale, start, end);
      if (!d) return "";
      const dash = s.dashed ? ` stroke-dasharray="6 4" stroke-width="1.5"` : ` stroke-width="2"`;
      return `<path data-series-path="${esc(s.id)}" d="${d}" fill="none" stroke="${esc(s.color)}"${dash} vector-effect="non-scaling-stroke"/>`;
    })
    .join("");

  return `<svg class="curve" data-history-chart viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" data-range-start="${start}" data-range-end="${end}" data-min-y="${minY}" data-max-y="${maxY}">
    ${yGrid.join("")}
    ${xGrid.join("")}
  <rect class="chart-hit" x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="transparent" pointer-events="all"/>
  ${paths}
    <line class="chart-crosshair" x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="var(--secondary-text-color)" stroke-width="1" opacity="0" pointer-events="none"/>
</svg>`;
}

export function renderHistoryLegend(series, visibility = {}) {
  return `<div class="hist-legend">${series
    .map((s) => {
      const on = visibility[s.id] !== false;
      const val = s.currentValue != null ? formatTempLegend(s.currentValue) : "";
      return `<label class="hist-legend-item" data-legend-series="${esc(s.id)}">
        <input type="checkbox" data-series-toggle="${esc(s.id)}" ${on ? "checked" : ""} />
        <span class="hist-swatch" style="background:${esc(s.color)}${s.dashed ? ";opacity:0.65;border-bottom:2px dashed currentColor" : ""}"></span>
        <span class="hist-label">${esc(s.label)}${val ? ` <strong>${esc(val)}</strong>` : ""}</span>
      </label>`;
    })
    .join("")}</div>`;
}

export function renderHistoryChartBlock(model, visibility) {
  const svg = renderHistoryChartSvg({ ...model, visibility, series: model.series });
  const legend = renderHistoryLegend(model.series, visibility);
  return `${svg}${legend}<div class="chart-tooltip" hidden></div>`;
}

export function wireHistoryChartUI(host, model, visibility, onVisibilityChange) {
  if (!host) return;
  host.querySelectorAll("[data-series-toggle]").forEach((input) => {
    input.addEventListener("change", () => {
      const id = input.getAttribute("data-series-toggle");
      visibility[id] = input.checked;
      const paths = host.querySelector(`svg[data-history-chart]`);
      const path = host.querySelector(`[data-series-path="${id}"]`);
      if (path) path.style.display = input.checked ? "" : "none";
      if (onVisibilityChange) onVisibilityChange(id, input.checked);
      if (paths && model) {
        host.querySelector(".chart-tooltip")?.setAttribute("hidden", "");
      }
    });
  });
  const svg = host.querySelector("svg[data-history-chart]");
  const tip = host.querySelector(".chart-tooltip");
  const hit = host.querySelector(".chart-hit");
  const cross = host.querySelector(".chart-crosshair");
  if (!svg || !tip || !hit || !model) return;

  const left = 42;
  const right = 10;
  const top = 16;
  const bottom = 28;
  const width = model.width || 480;
  const height = model.height || 200;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const { start, end, minY, maxY, series } = model;
  const span = end - start;
  const clientToTime = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const rel = (clientX - rect.left) / rect.width;
    return start + rel * span;
  };
  const yAt = (v) => top + (1 - (v - minY) / (maxY - minY)) * plotH;

  const valueAtTime = (points, t) => {
    if (!points?.length) return null;
    let idx = 0;
    while (idx < points.length - 1 && points[idx + 1].x <= t) idx += 1;
    return points[idx].y;
  };

  const showTip = (ev) => {
    const rect = svg.getBoundingClientRect();
    const relX = Math.min(Math.max(ev.clientX - rect.left, 0), rect.width);
    const t = start + (relX / rect.width) * span;
    const x = left + ((t - start) / span) * plotW;
    if (cross) {
      cross.setAttribute("x1", String(x));
      cross.setAttribute("x2", String(x));
      cross.setAttribute("opacity", "0.35");
    }
    const rows = series
      .filter((s) => visibility[s.id] !== false)
      .map((s) => {
        const y = valueAtTime(s.points, t);
        if (y == null) return null;
        return `<div style="color:${esc(s.color)}">${esc(s.label)}: ${esc(formatTempLegend(y))}</div>`;
      })
      .filter(Boolean);
    if (!rows.length) {
      tip.setAttribute("hidden", "");
      return;
    }
    tip.innerHTML = rows.join("");
    tip.removeAttribute("hidden");
    tip.style.left = `${relX}px`;
    tip.style.top = "4px";
  };

  hit.addEventListener("mousemove", showTip);
  hit.addEventListener("mouseleave", () => {
    tip.setAttribute("hidden", "");
    cross?.setAttribute("opacity", "0");
  });
}
