export const DOMAIN = "ha_thermo";
export const INTEGRATION_VERSION = "0.3.8";
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

export const renderChart = (zone, profile, data, opts = {}) => {
  const showTarget = opts.show_target !== false;
  const showCurrent = opts.show_current !== false;
  const showGrid = opts.show_grid !== false;
  const forecast = Array.isArray(zone?.forecast) && zone.forecast.length === 24 ? zone.forecast : null;
  const curve = forecast
    ? forecast.map(Number)
    : Array.isArray(profile?.hourly) && profile.hourly.length === 24
      ? profile.hourly.map(Number)
      : null;
  const target = zone?.target_temperature ?? zone?.default_temp ?? 20;
  const current = zone?.current_temperature;

  const W = 300,
    H = 170,
    left = 36,
    right = 10,
    top = 12,
    bottom = 22;
  const plotW = W - left - right,
    plotH = H - top - bottom;

  const series = [];
  if (curve) series.push(...curve);
  if (showTarget && target != null) series.push(Number(target));
  if (showCurrent && current != null) series.push(Number(current));
  if (!series.length) series.push(Number(zone?.default_temp ?? 20));

  let dmin = Math.min(...series),
    dmax = Math.max(...series);
  const minSpan = 2;
  if (dmax - dmin < minSpan) {
    const mid = (dmin + dmax) / 2;
    dmin = mid - minSpan / 2;
    dmax = mid + minSpan / 2;
  }
  const pad = Math.max(0.3, (dmax - dmin) * 0.12);
  dmin -= pad;
  dmax += pad;

  const x = (h) => left + (h / 23) * plotW;
  const y = (t) => top + (1 - (t - dmin) / (dmax - dmin)) * plotH;
  const fy = (t) => y(t).toFixed(1);

  const gridTicks = [];
  for (let i = 0; i < 4; i++) gridTicks.push(dmin + ((dmax - dmin) * i) / 3);

  const grid = showGrid
    ? gridTicks
        .map(
          (t) =>
            `<line x1="${left}" y1="${fy(t)}" x2="${W - right}" y2="${fy(t)}" stroke="var(--divider-color)" stroke-width="0.5" opacity="0.5"/>` +
            `<text x="${left - 6}" y="${(y(t) + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="var(--secondary-text-color)">${(Math.round(t * 10) / 10).toFixed(0)}°</text>`,
        )
        .join("")
    : "";

  const hourLabels = [0, 6, 12, 18, 23]
    .map((h) => `<text x="${x(h).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="8" fill="var(--secondary-text-color)">${h}:00</text>`)
    .join("");

  const targetLine =
    showTarget && target != null
      ? `<line x1="${left}" y1="${fy(target)}" x2="${W - right}" y2="${fy(target)}" stroke="var(--primary-color)" stroke-width="1.5" stroke-dasharray="5 3"/>`
      : "";
  const currentLine =
    showCurrent && current != null
      ? `<line x1="${left}" y1="${fy(current)}" x2="${W - right}" y2="${fy(current)}" stroke="var(--secondary-text-color)" stroke-width="1" opacity="0.65"/>`
      : "";

  let curveLine = "";
  let dots = "";
  if (curve) {
    const pts = curve.map((t, h) => `${x(h).toFixed(1)},${fy(t)}`).join(" ");
    curveLine = `<polyline fill="none" stroke="var(--accent-color)" stroke-width="2" points="${pts}" stroke-linejoin="round"/>`;
    dots = curve.map((t, h) => `<circle cx="${x(h).toFixed(1)}" cy="${fy(t)}" r="1.6" fill="var(--accent-color)"/>`).join("");
  } else {
    curveLine = `<text x="${(left + (W - right)) / 2}" y="${top + plotH / 2}" text-anchor="middle" font-size="9" fill="var(--secondary-text-color)">Nessuna curva</text>`;
  }

  return `<svg class="curve" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${grid}${hourLabels}${targetLine}${currentLine}${curveLine}${dots}</svg>`;
};

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

export const graphHoursToShow = (config = {}) => {
  const h = Number(config.hours_to_show);
  if (h > 0 && h <= 168) return h;
  const preset = GRAPH_TIME_RANGES.find((r) => r.key === config.time_range);
  return preset?.hours ?? 24;
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
  const n = parseFloat(state?.state);
  if (!Number.isNaN(n) && String(state?.state).match(/^\d/)) return n;
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
    return d.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
};
