export const DOMAIN = "ha_thermo";
export const EVENT_TYPES = [
  `${DOMAIN}_profile_changed`,
  `${DOMAIN}_bypass_started`,
  `${DOMAIN}_bypass_ended`,
  `${DOMAIN}_target_changed`,
  `${DOMAIN}_manual_override`,
  `${DOMAIN}_profile_override_started`,
  `${DOMAIN}_profile_override_ended`,
  `${DOMAIN}_weekly_changed`,
];
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const DAY_LABELS = { mon: "Lun", tue: "Mar", wed: "Mer", thu: "Gio", fri: "Ven", sat: "Sab", sun: "Dom" };

export const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const round = (v) => (v == null ? null : Math.round(v * 2) / 2);

export const formatTemp = (v) => (v == null || Number.isNaN(Number(v)) ? "--" : `${(Math.round(Number(v) * 10) / 10).toFixed(1)}°`);

export const formatTime = (v) => {
  if (!v) return "--";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "--" : d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
};

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

export const renderChart = (zone, profile, data, opts = {}) => {
  const showTarget = opts.show_target !== false;
  const showCurrent = opts.show_current !== false;
  const showGrid = opts.show_grid !== false;
  const day = todayKey();
  const forecast = Array.isArray(zone.forecast) && zone.forecast.length === 24 ? zone.forecast : null;
  const rawCurve = profile?.curves?.[zone.id]?.[day];
  const curve = forecast
    ? forecast.map(Number)
    : Array.isArray(rawCurve) && rawCurve.length === 24
      ? rawCurve.map(Number)
      : null;
  const target = zone.target_temperature ?? profile?.targets?.[zone.id] ?? zone.default_temp ?? 20;
  const current = zone.current_temperature;

  const W = 300, H = 170, left = 36, right = 10, top = 12, bottom = 22;
  const plotW = W - left - right, plotH = H - top - bottom;

  const series = [];
  if (curve) series.push(...curve);
  if (showTarget && target != null) series.push(Number(target));
  if (showCurrent && current != null) series.push(Number(current));
  if (!series.length) series.push(Number(zone.default_temp ?? 20));

  let dmin = Math.min(...series), dmax = Math.max(...series);
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
  const ticks = 4;
  for (let i = 0; i < ticks; i++) gridTicks.push(dmin + ((dmax - dmin) * i) / (ticks - 1));

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
    dots = curve
      .map((t, h) => `<circle cx="${x(h).toFixed(1)}" cy="${fy(t)}" r="1.6" fill="var(--accent-color)"/>`)
      .join("");
  } else {
    curveLine = `<text x="${(left + (W - right)) / 2}" y="${top + plotH / 2}" text-anchor="middle" font-size="9" fill="var(--secondary-text-color)">Nessuna curva per ${DAY_LABELS[day]}</text>`;
  }

  return `<svg class="curve" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${grid}${hourLabels}${targetLine}${currentLine}${curveLine}${dots}</svg>`;
};

export const callWS = async (hass, msg) => {
  return await hass.callWS(msg);
};
