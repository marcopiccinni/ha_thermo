import {
  DOMAIN,
  EVENT_TYPES,
  GRAPH_TIME_RANGES,
  esc,
  findZone,
  getZoneOptions,
  graphHoursToShow,
  parseRoomSensorList,
  profileSchedulePoints,
  fetchRecorderHistory,
  assembleHistorySeries,
  renderHistoryChartBlock,
  wireHistoryChartUI,
  yDomainHistory,
  callWS,
  todayKey,
  HISTORY_SERIES_COLORS,
} from "./ha-thermo-common.js?v=0.3.9";

const DEFAULT_CONFIG = () => ({
  title: "Grafico",
  height: 220,
  time_range: "48h",
  hours_to_show: null,
  min_temp: null,
  max_temp: null,
  show_current: true,
  show_target: true,
  show_profile_overlay: false,
  room_sensors: [],
  color_current: HISTORY_SERIES_COLORS.current,
  color_target: HISTORY_SERIES_COLORS.target,
  color_profile: HISTORY_SERIES_COLORS.profile,
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
    this._chartModel = null;
    this._visibility = { current: true, target: true, profile: false };
    this._historyStream = false;
  }

  static getStubConfig(hass, entities) {
    const climate = entities?.find((id) => id.startsWith("climate."));
    return climate
      ? { zone: climate, climate_entity: climate, title: "Grafico termostato", time_range: "48h" }
      : { title: "Grafico termostato", time_range: "48h" };
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
    this._visibility.profile = this._config.show_profile_overlay === true;
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
      }, 120000);
    }
  }

  connectedCallback() {
    if (!this._hass) return;
    if (!this._data) this._loadConfig();
    if (!this._unsubs.length) this._subscribe();
    if (!this._timer) {
      this._timer = window.setInterval(() => {
        if (!document.hidden) this._scheduleChartReload();
      }, 120000);
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

  async _subscribeHistoryStream(climateId, roomIds) {
    if (!this._hass?.connection?.subscribeMessage) return;
    const hours = graphHoursToShow(this._config, 48);
    const end = Date.now();
    const start = end - hours * 3600000;
    const ids = [climateId, ...roomIds.filter((id) => id !== climateId)];
    try {
      const unsub = await this._hass.connection.subscribeMessage(
        () => this._scheduleChartReload(),
        {
          type: "history/stream",
          entity_ids: ids,
          start_time: new Date(start).toISOString(),
          end_time: new Date(end).toISOString(),
          minimal_response: false,
          significant_changes_only: false,
        },
      );
      this._unsubs.push(unsub);
    } catch (e) {
      /* stream optional */
    }
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
    this._reloadTimer = window.setTimeout(() => this._renderChart(), 300);
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
    const climateId = this._climateEntity();
    const zone = this._zone();
    if (climateId && !this._historyStream) {
      this._historyStream = true;
      await this._subscribeHistoryStream(climateId, this._roomSensorIds(zone));
    }
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
    const height = this._config.height || 220;
    const body = !this._data
      ? `<div class="empty">${this._error ? esc(this._error) : "Caricamento…"}</div>`
      : !this._climateEntity()
        ? `<div class="empty">Collega il termostato (climate) con la matita</div>`
        : `<div class="chart-wrap" id="chart-host" style="min-height:${height}px"><div class="empty">Caricamento storico…</div></div>`;
    this.shadowRoot.innerHTML = `<style>
      :host{display:block}
      .card{background:var(--ha-card-background,var(--card-background-color,#fff));color:var(--primary-text-color);border-radius:var(--ha-card-border-radius,12px);border:var(--ha-card-border-width,1px) solid var(--ha-card-border-color,var(--divider-color,transparent));box-shadow:var(--ha-card-box-shadow,none);padding:16px}
      .head{margin-bottom:8px}
      .title{font-weight:600;font-size:1.05rem}
      .sub{font-size:0.75rem;color:var(--secondary-text-color);margin-top:2px}
      .chart-wrap{position:relative;width:100%}
      .curve{width:100%;display:block}
      .hist-legend{display:flex;flex-direction:column;gap:6px;margin-top:8px;font-size:0.8rem}
      .hist-legend-item{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none}
      .hist-swatch{width:18px;height:3px;border-radius:1px;flex-shrink:0}
      .hist-label{color:var(--secondary-text-color)}
      .hist-label strong{color:var(--primary-text-color);font-weight:600;margin-left:4px}
      .chart-tooltip{position:absolute;z-index:2;transform:translateX(-50%);background:var(--card-background-color,#fff);border:1px solid var(--divider-color);border-radius:8px;padding:6px 8px;font-size:0.75rem;box-shadow:0 2px 8px rgba(0,0,0,.15);pointer-events:none;white-space:nowrap}
      .empty{color:var(--secondary-text-color);padding:12px 0;text-align:center}
    </style><div class="card"><div class="head"><div class="title">${esc(this._config.title || zone?.name || "Grafico")}</div>${sub}</div>${body}</div>`;
  }

  _profileHourly(zone) {
    if (Array.isArray(zone?.forecast) && zone.forecast.length === 24) return zone.forecast;
    const schedule = this._data?.weekly_profiles?.[zone?.id];
    const pid = schedule?.[todayKey()] || zone?.active_profile;
    const profile = (this._data?.profiles || []).find((p) => p.id === pid);
    if (Array.isArray(profile?.hourly) && profile.hourly.length === 24) return profile.hourly;
    return null;
  }

  _paintChart() {
    const host = this.shadowRoot?.querySelector("#chart-host");
    if (!host || !this._chartModel) return;
    host.innerHTML = renderHistoryChartBlock(this._chartModel, this._visibility);
    wireHistoryChartUI(host, this._chartModel, this._visibility);
  }

  async _renderChart() {
    if (!this._hass || !this.shadowRoot) return;
    const climateId = this._climateEntity();
    if (!climateId) return;
    const zone = this._zone();
    const cfg = this._config;
    const roomIds = this._roomSensorIds(zone);
    this._updateWatch(climateId, roomIds);

    const hours = graphHoursToShow(cfg, 48);
    const end = Date.now();
    const start = end - hours * 3600000;
    const entityIds = [climateId, ...roomIds.filter((id) => id !== climateId)];
    const byEntity = await fetchRecorderHistory(this._hass, entityIds, start, end);

    let profilePts = null;
    if (cfg.show_profile_overlay) {
      const hourly = zone ? this._profileHourly(zone) : null;
      if (hourly) profilePts = profileSchedulePoints(hourly, start, end);
    }

    const series = assembleHistorySeries({
      hass: this._hass,
      byEntity,
      climateId,
      sensorIds: roomIds,
      includeCurrent: cfg.show_current !== false,
      includeTarget: cfg.show_target !== false,
      profilePoints: profilePts,
      colors: {
        current: cfg.color_current,
        target: cfg.color_target,
        profile: cfg.color_profile,
      },
    });

    series.forEach((s) => {
      if (s.id.startsWith("sensor:")) this._visibility[s.id] = this._visibility[s.id] !== false;
    });
    if (profilePts) this._visibility.profile = cfg.show_profile_overlay !== false;

    const allY = series.flatMap((s) => s.points.map((p) => p.y));
    const { min: minY, max: maxY } = yDomainHistory(allY, cfg.min_temp, cfg.max_temp);
    const height = cfg.height || 220;

    this._chartModel = {
      series,
      start,
      end,
      spanHours: hours,
      width: 480,
      height,
      minY,
      maxY,
    };
    this._paintChart();
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
      (r) => `<option value="${r.key}" ${(c.time_range || "48h") === r.key ? "selected" : ""}>${esc(r.label)}</option>`,
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
      <span class="hint">Oppure imposta <code>climate_entity</code> nel YAML.</span>
      <label>Sensori temperatura ambiente (opzionale)
        <textarea data-field="room_sensors" rows="2" placeholder="sensor.sala, sensor.camera">${esc(roomVal)}</textarea>
      </label>
      <label>Intervallo<select data-field="time_range">${rangeOpts}</select></label>
      <label>Altezza grafico (px)<input type="number" data-field="height" min="120" max="480" value="${esc(c.height || 220)}"></label>
      <div class="row">
        <label style="flex:1">Y min (vuoto=auto)<input type="number" step="0.5" data-field="min_temp" value="${esc(c.min_temp ?? "")}"></label>
        <label style="flex:1">Y max<input type="number" step="0.5" data-field="max_temp" value="${esc(c.max_temp ?? "")}"></label>
      </div>
      <label class="row"><input type="checkbox" data-field="show_target" ${c.show_target !== false ? "checked" : ""}> Mostra setpoint (storico)</label>
      <label class="row"><input type="checkbox" data-field="show_current" ${c.show_current !== false ? "checked" : ""}> Mostra temperatura ambiente</label>
      <label class="row"><input type="checkbox" data-field="show_profile_overlay" ${c.show_profile_overlay === true ? "checked" : ""}> Sovrapponi profilo di oggi (tratteggio)</label>
      <label>Colore ambiente<input type="text" data-field="color_current" value="${esc(c.color_current || HISTORY_SERIES_COLORS.current)}"></label>
      <label>Colore setpoint<input type="text" data-field="color_target" value="${esc(c.color_target || HISTORY_SERIES_COLORS.target)}"></label>
      <label>Colore profilo<input type="text" data-field="color_profile" value="${esc(c.color_profile || HISTORY_SERIES_COLORS.profile)}"></label>
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
    description: "Storico recorder in stile Home Assistant.",
    preview: true,
    documentationURL: "https://github.com/marcopiccinni/ha_thermo",
  });
}
