export const DOMAIN = "ha_thermo";
export const EVENT_TYPES = [
  `${DOMAIN}_profile_changed`,
  `${DOMAIN}_bypass_started`,
  `${DOMAIN}_bypass_ended`,
  `${DOMAIN}_target_changed`,
  `${DOMAIN}_manual_override`,
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

export const renderChart = (zone, profile, data) => {
  const low = Number(zone.min_temp ?? 5);
  const high = Number(zone.max_temp ?? 35);
  const pad = (high - low) * 0.15 || 5;
  const minY = low - pad;
  const maxY = high + pad;
  const y = (t) => 160 - ((t - minY) / (maxY - minY)) * 140;
  const day = todayKey();
  const curve = profile?.curves?.[zone.id]?.[day];
  if (!curve || curve.length !== 24) {
    return `<svg class="curve" viewBox="0 0 207 180" preserveAspectRatio="none"><text x="103" y="90" text-anchor="middle" fill="var(--secondary-text-color)" font-size="0.8rem">Nessun dato per ${DAY_LABELS[day]}</text></svg>`;
  }
  const points = curve.map((t, h) => `${h * 9},${y(t).toFixed(2)}`).join(" ");
  const targetY = y(zone.target_temperature ?? profile?.targets?.[zone.id] ?? zone.default_temp ?? 20).toFixed(2);
  const currentY = zone.current_temperature == null ? null : y(zone.current_temperature).toFixed(2);
  return `
    <svg class="curve" viewBox="0 0 207 180" preserveAspectRatio="none">
      <line x1="0" y1="${targetY}" x2="207" y2="${targetY}" stroke="var(--primary-color)" stroke-width="1.5" stroke-dasharray="4 3"/>
      ${currentY ? `<line x1="0" y1="${currentY}" x2="207" y2="${currentY}" stroke="var(--secondary-text-color)" stroke-width="1" opacity="0.6"/>` : ""}
      ${points ? `<polyline fill="none" stroke="var(--accent-color)" stroke-width="2" points="${points}"/>` : ""}
      <text x="4" y="12" class="legend-target">Target ${formatTemp(zone.target_temperature)}</text>
      ${currentY ? `<text x="4" y="26" class="legend-current">Attuale ${formatTemp(zone.current_temperature)}</text>` : ""}
    </svg>`;
};

export const callWS = async (hass, msg) => {
  return await hass.callWS(msg);
};
