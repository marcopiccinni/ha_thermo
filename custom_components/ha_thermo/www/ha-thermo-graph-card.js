import {
  DOMAIN,
  EVENT_TYPES,
  GRAPH_TIME_RANGES,
  esc,
  formatChartTime,
  formatTemp,
  findZone,
  getZoneOptions,
  graphHoursToShow,
  historyByEntity,
  historyClimateCurrentPoints,
  historySensorPoints,
  historySetpointPoints,
  linePath,
  parseRoomSensorList,
  profileSchedulePoints,
  stepLinePath,
  yDomainPadded,
  callWS,
  todayKey,
} from "./ha-thermo-common.js?v=0.3.7";

const DEFAULT_COLORS = {
  current: "var(--primary-color)",
  target: "#ff9800",
  profile: "#4caf50",
  sensors: ["#2196f3", "#9c27b0", "#009688", "#e91e63"],
};

const DEFAULT_CONFIG = () => ({
  title: "Grafico",
  height: 200,
  time_range: "24h",
  hours_to_show: null,
  min_temp: null,
  max_temp: null,
  show_current: true,
  show_target: true,
  show_profile_overlay: true,
  room_sensors: [],
  color_current: DEFAULT_COLORS.current,
  color_target: DEFAULT_COLORS.target,
  color_profile: DEFAULT_COLORS.profile,
});

class HaThermoGraphCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = DEFAULT_CONFIG();
    this._data = null;
    this._error = null;
    this._hass = null;
    this._unsubs = [];
    this._timer = null;
    this._reloadTimer = null;
    this._started = false;
    this._watch = new Set();
    this._chartSvg = "";
  }

  static getStubConfig(hass, entities) {
    const climate = entities?.find((id) => id.startsWith("climate."));
    return climate
      ? { zone: climate, climate_entity: climate, title: "Grafico termostato", time_range: "24h" }
      : { title: "Grafico termostato", time_range: "24h" };
  }

  static getConfigElement() {
    return document.createElement("ha-thermo-graph-card-editor");
  }

  setConfig(config) {
    if (!config) throw new Error("Configurazione non valida");
    const legacyProfile = config.show_profile != null ? config.show_profile : undefined;
    this._config = {
      ...DEFAULT_CONFIG(),
      ...config,
      show_profile_overlay:
        config.show_profile_overlay ?? legacyProfile ?? DEFAULT_CONFIG().show_profile_overlay,
    };
    this._renderChrome();
    this._scheduleChartReload();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._started) {
      this._started = true;
      this._loadConfig();
      this._subscribe();
      this._timer = window.setInterval(() => {
        if (!document.hidden) this._scheduleChartReload();
      }, 60000);
    }
  }

  connectedCallback() {
    if (!this._hass) return;
    if (!this._data) this._loadConfig();
    if (!this._unsubs.length) this._subscribe();
    if (!this._timer) {
      this._timer = window.setInterval(() => {
        if (!document.hidden) this._scheduleChartReload();
      }, 60000);
    }
  }

  disconnectedCallback() {
    window.clearInterval(this._timer);
    window.clearTimeout(this._reloadTimer);
    this._timer = null;
    this._reloadTimer = null;
    this._unsubs.forEach((u) => {
      try {
        u();
      } catch (e) {
        /* ignore */
      }
    });
    this._unsubs = [];
  }

  getCardSize() {
    return 4;
  }

  _climateEntity() {
    const cfg = this._config;
    if (cfg.climate_entity) return cfg.climate_entity;
    const zone = findZone(this._data, cfg.zone);
    return zone?.climate_entity || (String(cfg.zone || "").startsWith("climate.") ? cfg.zone : null);
  }

  _zone() {
    return findZone(this._data, this._config.zone || this._config.climate_entity);
  }

  _roomSensorIds(zone) {
    const fromConfig = parseRoomSensorList(this._config.room_sensors);
    if (fromConfig.length) return fromConfig;
    if (zone?.temperature_sensor) return [zone.temperature_sensor];
    return [];
  }

  _updateWatch(climateId, roomIds) {
    this._watch = new Set([climateId, ...roomIds].filter(Boolean));
  }

  async _subscribe() {
    for (const et of EVENT_TYPES) {
      try {
        const unsub = await this._hass.connection.subscribeEvents(() => this._scheduleChartReload(), et);
        this._unsubs.push(unsub);
      } catch (e) {
        /* ignore */
      }
    }
    try {
      const unsub = await this._hass.connection.subscribeEvents((ev) => {
        const eid = ev?.data?.entity_id;
        if (eid && this._watch.has(eid)) this._scheduleChartReload();
      }, "state_changed");
      this._unsubs.push(unsub);
    } catch (e) {
      /* ignore */
    }
  }

  _scheduleChartReload() {
    window.clearTimeout(this._reloadTimer);
    this._reloadTimer = window.setTimeout(() => this._renderChart(), 350);
  }

  async _loadConfig() {
    if (!this._hass) return;
    try {
      this._data = await callWS(this._hass, { type: `${DOMAIN}/get_config` });
      this._error = null;
    } catch (e) {
      this._error = e?.message || String(e);
    }
    this._renderChrome();
    await this._renderChart();
  }

  _renderChrome() {
    if (!this.shadowRoot) return;
    const zone = this._zone();
    const sub =
      zone?.climate_entity && zone?.name
        ? `<div class="sub">${esc(zone.name)} · ${esc(zone.climate_entity)}</div>`
        : this._climateEntity()
          ? `<div class="sub">${esc(this._climateEntity())}</div>`
          : "";
    const body = !this._data
      ? `<div class="empty">${this._error ? esc(this._error) : "Caricamento…"}</div>`
      : !this._climateEntity()
        ? `<div class="empty">Collega il termostato (climate) con la matita</div>`
        : `<div class="chart-wrap" id="chart-host">${this._chartSvg || `<div class="empty">Caricamento storico…</div>`}</div>`;
    const height = this._config.height || 200;
    this.shadowRoot.innerHTML = `<style>
      :host{display:block}
      .card{background:var(--ha-card-background,var(--card-background-color,#fff));color:var(--primary-text-color);border-radius:var(--ha-card-border-radius,12px);border:var(--ha-card-border-width,1px) solid var(--ha-card-border-color,var(--divider-color,transparent));box-shadow:var(--ha-card-box-shadow,none);padding:16px}
      .head{margin-bottom:8px}
      .title{font-weight:600;font-size:1.05rem}
      .sub{font-size:0.75rem;color:var(--secondary-text-color);margin-top:2px}
      .chart-wrap{position:relative;width:100%}
      .curve{width:100%;height:${height}px;background:rgba(127,127,127,0.05);border-radius:8px;display:block}
      .legend{display:flex;flex-wrap:wrap;gap:10px 14px;font-size:0.75rem;color:var(--secondary-text-color);margin-top:8px}
      .legend span{display:inline-flex;align-items:center;gap:4px}
      .swatch{width:14px;height:3px;border-radius:1px;display:inline-block}
      .empty{color:var(--secondary-text-color);padding:12px 0;text-align:center}
    </style><div class="card"><div class="head"><div class="title">${esc(this._config.title || zone?.name || "Grafico")}</div>${sub}</div>${body}${this._legendHtml()}</div>`;
  }

  async _fetchHistory(entityIds) {
    if (!this._hass || !entityIds.length) return {};
    const hours = graphHoursToShow(this._config);
    const end = Date.now();
    const start = end - hours * 3600000;
    try {
      const raw = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: new Date(start).toISOString(),
        end_time: new Date(end).toISOString(),
        entity_ids: entityIds,
        minimal_response: true,
        no_attributes: false,
      });
      return historyByEntity(raw, entityIds);
    } catch (e) {
      return {};
    }
  }

  _profileHourly(zone) {
    if (Array.isArray(zone?.forecast) && zone.forecast.length === 24) return zone.forecast;
    const schedule = this._data?.weekly_profiles?.[zone?.id];
    const pid = schedule?.[todayKey()] || zone?.active_profile;
    const profile = (this._data?.profiles || []).find((p) => p.id === pid);
    if (Array.isArray(profile?.hourly) && profile.hourly.length === 24) return profile.hourly;
    return null;
  }

  async _renderChart() {
    if (!this._hass || !this.shadowRoot) return;
    const climateId = this._climateEntity();
    if (!climateId) return;
    const zone = this._zone();
    const cfg = this._config;
    const roomIds = this._roomSensorIds(zone);
    this._updateWatch(climateId, roomIds);

    const hours = graphHoursToShow(cfg);
    const end = Date.now();
    const start = end - hours * 3600000;

    const entityIds = [climateId, ...roomIds.filter((id) => id !== climateId)];
    const byEntity = await this._fetchHistory(entityIds);
    const climateHist = byEntity[climateId] || [];

    const setpoints = cfg.show_target !== false ? historySetpointPoints(climateHist) : [];
    let currentPts = [];
    if (cfg.show_current !== false) {
      if (roomIds.length) {
        for (const sid of roomIds) {
          const pts = historySensorPoints(byEntity[sid] || []);
          if (pts.length) currentPts = currentPts.concat(pts.map((p) => ({ ...p, _sensor: sid })));
        }
      }
      if (!currentPts.length) {
        currentPts = historyClimateCurrentPoints(climateHist);
      }
    }

    const sensorSeries = [];
    if (roomIds.length && cfg.show_current !== false) {
      roomIds.forEach((sid, i) => {
        const pts = historySensorPoints(byEntity[sid] || []);
        if (pts.length) sensorSeries.push({ id: sid, points: pts, colorIdx: i });
      });
    }

    let profilePts = [];
    if (cfg.show_profile_overlay !== false && zone) {
      const hourly = this._profileHourly(zone);
      if (hourly) profilePts = profileSchedulePoints(hourly, start, end);
    }

    const allY = [
      ...setpoints.map((p) => p.y),
      ...currentPts.map((p) => p.y),
      ...sensorSeries.flatMap((s) => s.points.map((p) => p.y)),
      ...profilePts.map((p) => p.y),
    ];
    const { min: minY, max: maxY } = yDomainPadded(allY, cfg.min_temp, cfg.max_temp);

    this._chartSvg = this._buildSvg({
      setpoints,
      currentPts: roomIds.length ? [] : currentPts,
      sensorSeries,
      profilePts,
      minY,
      maxY,
      start,
      end,
      hours,
      cfg,
    });

    const host = this.shadowRoot.querySelector("#chart-host");
    if (host) host.innerHTML = this._chartSvg;
    else this._renderChrome();
  }

  _buildSvg({ setpoints, currentPts, sensorSeries, profilePts, minY, maxY, start, end, hours, cfg }) {
    const height = cfg.height || 200;
    const width = 480;
    const left = 44;
    const right = 12;
    const top = 14;
    const bottom = 26;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const span = end - start;
    const xScale = (t) => left + ((t - start) / span) * plotW;
    const yScale = (v) => top + (1 - (v - minY) / (maxY - minY)) * plotH;

    const cCurrent = cfg.color_current || DEFAULT_COLORS.current;
    const cTarget = cfg.color_target || DEFAULT_COLORS.target;
    const cProfile = cfg.color_profile || DEFAULT_COLORS.profile;

  if (!setpoints.length && !currentPts.length && !sensorSeries.length && !profilePts.length) {
      return `<svg class="curve" viewBox="0 0 ${width} ${height}"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="var(--secondary-text-color)">Nessun dato storico nel recorder</text></svg>`;
    }

    const grid = [];
    for (let i = 0; i <= 3; i += 1) {
      const v = minY + ((maxY - minY) * i) / 3;
      const y = yScale(v);
      grid.push(
        `<line x1="${left}" y1="${y.toFixed(1)}" x2="${width - right}" y2="${y.toFixed(1)}" stroke="var(--divider-color)" stroke-width="0.6" opacity="0.55"/>` +
          `<text x="${left - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--secondary-text-color)">${(Math.round(v * 10) / 10).toFixed(1)}°</text>`,
      );
    }

    const xLabels = [];
    for (let i = 0; i <= 4; i += 1) {
      const t = start + (span * i) / 4;
      xLabels.push(
        `<text x="${xScale(t).toFixed(1)}" y="${height - 6}" text-anchor="middle" font-size="8" fill="var(--secondary-text-color)">${esc(formatChartTime(t, hours))}</text>`,
      );
    }

    const paths = [];
    const titles = [];

    if (profilePts.length) {
      const d = stepLinePath(profilePts, xScale, yScale, start, end);
      if (d) {
        paths.push(
          `<path d="${d}" fill="none" stroke="${esc(cProfile)}" stroke-width="1.5" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"><title>Profilo programmato (oggi)</title></path>`,
        );
      }
    }

    if (setpoints.length) {
      const d = stepLinePath(setpoints, xScale, yScale, start, end);
      if (d) {
        paths.push(
          `<path d="${d}" fill="none" stroke="${esc(cTarget)}" stroke-width="2.2" vector-effect="non-scaling-stroke"><title>Setpoint (storico)</title></path>`,
        );
      }
    }

    if (currentPts.length) {
      const d = linePath(currentPts, xScale, yScale, start, end);
      if (d) {
        paths.push(
          `<path d="${d}" fill="none" stroke="${esc(cCurrent)}" stroke-width="2" vector-effect="non-scaling-stroke"><title>Temperatura ambiente (climate)</title></path>`,
        );
      }
      titles.push(...this._tooltipDots(currentPts, xScale, yScale, cCurrent, "Ambiente"));
    }

    sensorSeries.forEach((s) => {
      const color = DEFAULT_COLORS.sensors[s.colorIdx % DEFAULT_COLORS.sensors.length];
      const d = linePath(s.points, xScale, yScale, start, end);
      if (d) {
        paths.push(
          `<path d="${d}" fill="none" stroke="${esc(color)}" stroke-width="1.8" vector-effect="non-scaling-stroke"><title>${esc(s.id)}</title></path>`,
        );
      }
      titles.push(...this._tooltipDots(s.points, xScale, yScale, color, s.id));
    });

    return `<svg class="curve" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      ${grid.join("")}
      ${xLabels.join("")}
      ${paths.join("")}
      ${titles.join("")}
    </svg>`;
  }

  _tooltipDots(points, xScale, yScale, color, label) {
    if (points.length > 80) return [];
    const step = Math.ceil(points.length / 40);
    const out = [];
    for (let i = 0; i < points.length; i += step) {
      const p = points[i];
      out.push(
        `<circle cx="${xScale(p.x).toFixed(1)}" cy="${yScale(p.y).toFixed(1)}" r="3" fill="${esc(color)}" opacity="0.85"><title>${esc(label)}: ${esc(formatTemp(p.y))} · ${esc(formatChartTime(p.x, 24))}</title></circle>`,
      );
    }
    return out;
  }

  _legendHtml() {
    const cfg = this._config;
    const zone = this._zone();
    const roomIds = this._roomSensorIds(zone);
    const items = [];
    if (cfg.show_target !== false) {
      items.push(
        `<span><span class="swatch" style="background:${esc(cfg.color_target || DEFAULT_COLORS.target)}"></span>Setpoint</span>`,
      );
    }
    if (cfg.show_current !== false) {
      if (roomIds.length) {
        roomIds.forEach((id, i) => {
          const c = DEFAULT_COLORS.sensors[i % DEFAULT_COLORS.sensors.length];
          items.push(`<span><span class="swatch" style="background:${esc(c)}"></span>${esc(id)}</span>`);
        });
      } else {
        items.push(
          `<span><span class="swatch" style="background:${esc(cfg.color_current || DEFAULT_COLORS.current)}"></span>Ambiente</span>`,
        );
      }
    }
    if (cfg.show_profile_overlay !== false) {
      items.push(
        `<span><span class="swatch" style="background:${esc(cfg.color_profile || DEFAULT_COLORS.profile)};opacity:0.7;border-bottom:2px dashed ${esc(cfg.color_profile || DEFAULT_COLORS.profile)}"></span>Profilo oggi</span>`,
      );
    }
    return items.length ? `<div class="legend">${items.join("")}</div>` : "";
  }
}

class HaThermoGraphCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = DEFAULT_CONFIG();
    this._zones = [];
    this._loaded = false;
  }

  set hass(h) {
    this._hass = h;
    if (!this._loaded) {
      this._loaded = true;
      this._loadZones();
    }
  }

  setConfig(config) {
    this._config = { ...DEFAULT_CONFIG(), ...config };
    this._render();
  }

  async _loadZones() {
    if (!this._hass) return;
    try {
      const d = await callWS(this._hass, { type: `${DOMAIN}/get_config` });
      this._zones = d?.zones || [];
    } catch (e) {
      /* ignore */
    }
    this._render();
  }

  _render() {
    const c = this._config;
    const rangeOpts = GRAPH_TIME_RANGES.map(
      (r) => `<option value="${r.key}" ${(c.time_range || "24h") === r.key ? "selected" : ""}>${esc(r.label)}</option>`,
    ).join("");
    const zoneOpts = getZoneOptions(this._zones, false);
    const roomVal = Array.isArray(c.room_sensors) ? c.room_sensors.join(", ") : c.room_sensors || "";
    this.shadowRoot.innerHTML = `<style>
      .form{display:grid;gap:12px;padding:8px 0}
      label{display:grid;gap:4px;font-size:0.9rem}
      input,select,textarea{padding:6px;border-radius:6px;border:1px solid var(--divider-color);font:inherit}
      .row{display:flex;gap:8px;align-items:center}
      .hint{font-size:0.75rem;color:var(--secondary-text-color)}
    </style><div class="form">
      <label>Titolo<input type="text" data-field="title" value="${esc(c.title || "")}"></label>
      <label>Termostato (zona HA Thermo)<select data-field="zone">${zoneOpts}</select></label>
      <span class="hint">Oppure imposta <code>climate_entity</code> nel YAML. Se i sensori ambiente sono vuoti, si usa <code>current_temperature</code> del climate.</span>
      <label>Sensori temperatura ambiente (opzionale)
        <textarea data-field="room_sensors" rows="2" placeholder="sensor.sala, sensor.camera">${esc(roomVal)}</textarea>
      </label>
      <label>Intervallo<select data-field="time_range">${rangeOpts}</select></label>
      <label>Altezza grafico (px)<input type="number" data-field="height" min="120" max="480" value="${esc(c.height || 200)}"></label>
      <div class="row">
        <label style="flex:1">Y min (vuoto=auto)<input type="number" step="0.5" data-field="min_temp" value="${esc(c.min_temp ?? "")}"></label>
        <label style="flex:1">Y max<input type="number" step="0.5" data-field="max_temp" value="${esc(c.max_temp ?? "")}"></label>
      </div>
      <label class="row"><input type="checkbox" data-field="show_target" ${c.show_target !== false ? "checked" : ""}> Mostra setpoint (storico)</label>
      <label class="row"><input type="checkbox" data-field="show_current" ${c.show_current !== false ? "checked" : ""}> Mostra temperatura ambiente</label>
      <label class="row"><input type="checkbox" data-field="show_profile_overlay" ${c.show_profile_overlay !== false ? "checked" : ""}> Sovrapponi profilo di oggi (tratteggio)</label>
      <label>Colore ambiente<input type="text" data-field="color_current" value="${esc(c.color_current || DEFAULT_COLORS.current)}"></label>
      <label>Colore setpoint<input type="text" data-field="color_target" value="${esc(c.color_target || DEFAULT_COLORS.target)}"></label>
      <label>Colore profilo<input type="text" data-field="color_profile" value="${esc(c.color_profile || DEFAULT_COLORS.profile)}"></label>
    </div>`;
    const zoneSel = this.shadowRoot.querySelector('[data-field="zone"]');
    if (zoneSel && c.zone) zoneSel.value = c.zone;
    this.shadowRoot.querySelectorAll("input,select,textarea").forEach((el) =>
      el.addEventListener("change", () => this._changed()),
    );
  }

  _changed() {
    const get = (f) => this.shadowRoot.querySelector(`[data-field="${f}"]`);
    const config = {
      ...this._config,
      title: get("title")?.value,
      zone: get("zone")?.value,
      time_range: get("time_range")?.value,
      color_current: get("color_current")?.value,
      color_target: get("color_target")?.value,
      color_profile: get("color_profile")?.value,
      room_sensors: parseRoomSensorList(get("room_sensors")?.value),
      show_target: get("show_target")?.checked,
      show_current: get("show_current")?.checked,
      show_profile_overlay: get("show_profile_overlay")?.checked,
    };
    const height = Number(get("height")?.value);
    if (height >= 120) config.height = height;
    ["min_temp", "max_temp"].forEach((k) => {
      const v = get(k)?.value;
      config[k] = v === "" || v == null ? null : Number(v);
    });
    config.hours_to_show = null;
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }
}

if (!customElements.get("ha-thermo-graph-card")) customElements.define("ha-thermo-graph-card", HaThermoGraphCard);
if (!customElements.get("ha-thermo-graph-card-editor")) {
  customElements.define("ha-thermo-graph-card-editor", HaThermoGraphCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "ha-thermo-graph-card")) {
  window.customCards.push({
    type: "ha-thermo-graph-card",
    name: "HA Thermo Grafico",
    description: "Storico recorder: setpoint e temperatura ambiente; profilo opzionale.",
    preview: true,
    documentationURL: "https://github.com/marcopiccinni/ha_thermo",
  });
}
