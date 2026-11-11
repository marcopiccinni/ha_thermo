import {
  DOMAIN,
  EVENT_TYPES,
  WEEK_DAYS,
  DAY_LABELS,
  esc,
  formatTemp,
  findZone,
  getZoneOptions,
  profileOptions,
  fetchRecorderHistory,
  buildClimateHistorySeries,
  resolvePhysicalClimateEntity,
  deviceClimateReadout,
  renderHistoryChartBlock,
  wireHistoryChartUI,
  yDomainHistory,
  HistoryStreamAccumulator,
  callWS,
  todayKey,
} from "./ha-thermo-common.js?v=0.3.11";

class HaThermoCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
    this.shadowRoot.addEventListener("change", (e) => this._onChange(e));
    this._config = {};
    this._data = null;
    this._error = null;
    this._hass = null;
    this._unsubs = [];
    this._timer = null;
    this._started = false;
    this._prevHvacMode = null;
    this._chartModel = null;
    this._chartTimer = null;
    this._historyStream = null;
    this._historyAccumulator = null;
    this._plottedClimateId = null;
    this._lastByEntity = null;
  }

  static getStubConfig(hass, entities) {
    const climate = entities?.find((id) => id.startsWith("climate."));
    return climate ? { zone: climate, title: "Termostato" } : { title: "Termostato" };
  }

  static getConfigElement() {
    return document.createElement("ha-thermo-card-editor");
  }

  setConfig(config) {
    if (!config) throw new Error("Configurazione non valida");
    this._config = {
      title: "Termostato",
      show_graph: true,
      show_graph_current: true,
      show_graph_target: true,
      show_slider: true,
      show_status: true,
      ...config,
    };
    this._render();
    if (this._hass) this._refreshMiniChart();
  }

  _chartVisibility() {
    const cfg = this._config;
    return {
      current: cfg.show_graph_current !== false,
      target: cfg.show_graph_target !== false,
    };
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._started) {
      this._started = true;
      this._load();
      this._subscribe();
      this._timer = window.setInterval(() => {
        if (!document.hidden) this._load();
      }, 30000);
    }
  }

  connectedCallback() {
    if (!this._hass) return;
    if (!this._data) this._load();
    if (!this._unsubs.length) this._subscribe();
    if (!this._timer) {
      this._timer = window.setInterval(() => {
        if (!document.hidden) this._load();
      }, 30000);
    }
  }

  disconnectedCallback() {
    window.clearInterval(this._timer);
    window.clearTimeout(this._chartTimer);
    this._timer = null;
    this._unsubs.forEach((u) => {
      try {
        u();
      } catch (e) {}
    });
    this._unsubs = [];
  }

  getCardSize() {
    return 5;
  }

  async _subscribe() {
    for (const et of EVENT_TYPES) {
      try {
        const unsub = await this._hass.connection.subscribeEvents(() => this._load(), et);
        this._unsubs.push(unsub);
      } catch (e) {}
    }
    try {
      const unsub = await this._hass.connection.subscribeEvents((ev) => {
        const zone = this._zone();
        const climateId = resolvePhysicalClimateEntity(this._hass, zone, this._config);
        if (zone && ev?.data?.entity_id === climateId) this._onLiveClimateUpdate(ev);
      }, "state_changed");
      this._unsubs.push(unsub);
    } catch (e) {}
  }

  _scheduleMiniChart() {
    window.clearTimeout(this._chartTimer);
    this._chartTimer = window.setTimeout(() => this._refreshMiniChart(), 280);
  }

  async _load() {
    if (!this._hass) return;
    try {
      this._data = await callWS(this._hass, { type: `${DOMAIN}/get_config` });
      this._error = null;
    } catch (e) {
      this._error = e?.message || String(e);
    }
    this._render();
    await this._refreshMiniChart();
  }

  _climatePlotId(zone) {
    return resolvePhysicalClimateEntity(this._hass, zone, this._config);
  }

  _onLiveClimateUpdate(ev) {
    if (!this._chartModel?.series) {
      this._scheduleMiniChart();
      return;
    }
    const zone = this._zone();
    const climateId = this._climatePlotId(zone);
    if (!climateId) return;
    if (ev?.data?.new_state) {
      const ns = ev.data.new_state;
      const row = {
        s: ns.state,
        a: { ...(ns.attributes || {}) },
        lu: Math.floor(new Date(ns.last_updated).getTime() / 1000),
      };
      let rows = this._historyAccumulator?.snapshot()?.[climateId] || this._lastByEntity?.[climateId] || [];
      const last = rows[rows.length - 1];
      if (!last || last.lu !== row.lu) rows = rows.concat(row);
      if (!this._historyAccumulator) this._historyAccumulator = new HistoryStreamAccumulator(24);
      this._historyAccumulator._data = { [climateId]: rows };
    }
    const byEntity = {
      [climateId]: this._historyAccumulator?.snapshot()?.[climateId] || this._lastByEntity?.[climateId] || [],
    };
    const series = buildClimateHistorySeries(this._hass, byEntity, climateId, {
      includeCurrent: true,
      includeTarget: true,
    });
    this._chartModel.series = series;
    const allY = series.flatMap((s) => s.points.map((p) => p.y));
    const domain = yDomainHistory(allY);
    this._chartModel.minY = domain.min;
    this._chartModel.maxY = domain.max;
    this._chartModel.end = Date.now();
    this._paintMiniChart();
    this._updateTempReadout(zone, climateId);
  }

  _paintMiniChart() {
    const host = this.shadowRoot?.querySelector("#mini-chart-host");
    if (!host || !this._chartModel) return;
    host.innerHTML = renderHistoryChartBlock(this._chartModel, this._chartVisibility());
    wireHistoryChartUI(host, this._chartModel, this._chartVisibility());
  }

  _updateTempReadout(zone, climateId) {
    const ro = deviceClimateReadout(this._hass, climateId);
    const ambient = this.shadowRoot?.querySelector(".temp-readonly .ambient, .temp-display");
    const setpoint = this.shadowRoot?.querySelector(".temp-readonly .setpoint");
    const slider = this.shadowRoot?.querySelector("input[data-action='slider']");
    if (ambient && ro.current != null) ambient.textContent = formatTemp(ro.current);
    if (setpoint && ro.target != null) setpoint.textContent = `${formatTemp(ro.target)} setpoint`;
    if (slider && ro.target != null) slider.value = ro.target;
  }

  async _ensureHistoryStream(climateId, hours) {
    if (!this._hass?.connection?.subscribeMessage || this._plottedClimateId === climateId) return;
    this._plottedClimateId = climateId;
    this._historyAccumulator = new HistoryStreamAccumulator(hours);
    const end = Date.now();
    const start = end - hours * 3600000;
    try {
      const unsub = await this._hass.connection.subscribeMessage(
        (msg) => {
          this._historyAccumulator.merge(msg);
          this._onLiveClimateUpdate();
        },
        {
          type: "history/stream",
          entity_ids: [climateId],
          start_time: new Date(start).toISOString(),
          end_time: new Date(end).toISOString(),
          minimal_response: true,
          no_attributes: false,
          significant_changes_only: false,
        },
      );
      this._unsubs.push(unsub);
    } catch (e) {
      /* optional */
    }
  }

  async _refreshMiniChart() {
    const zone = this._zone();
    const cfg = this._config;
    if (!this._hass || !zone || cfg.show_graph === false) return;
    const host = this.shadowRoot?.querySelector("#mini-chart-host");
    if (!host) return;
    const hours = 24;
    const end = Date.now();
    const start = end - hours * 3600000;
    const climateId = this._climatePlotId(zone);
    if (!climateId) return;
    const byEntity = await fetchRecorderHistory(this._hass, [climateId], start, end);
    this._lastByEntity = byEntity;
    if (!this._historyAccumulator) this._historyAccumulator = new HistoryStreamAccumulator(hours);
    this._historyAccumulator._data = { ...byEntity };
    const vis = this._chartVisibility();
    const series = buildClimateHistorySeries(this._hass, byEntity, climateId, {
      includeCurrent: vis.current,
      includeTarget: vis.target,
    });
    const visSeries = series.filter((s) => vis[s.id] !== false);
    const allY = visSeries.flatMap((s) => s.points.map((p) => p.y));
    const { min: minY, max: maxY } = yDomainHistory(allY);
    this._chartModel = {
      series,
      start,
      end,
      spanHours: hours,
      width: 320,
      height: 168,
      minY,
      maxY,
    };
    this._paintMiniChart();
    this._updateTempReadout(zone, climateId);
    await this._ensureHistoryStream(climateId, hours);
  }

  _call(msg, okText) {
    if (!this._hass) return Promise.resolve();
    return this._hass
      .callWS(msg)
      .then(() => {
        if (okText) this._toast(okText);
        return this._load();
      })
      .catch((e) => {
        this._toast(e?.message || String(e), true);
      });
  }

  _toast(txt, err = false) {
    const el = this.shadowRoot.getElementById("toast");
    if (!el) return;
    el.textContent = txt;
    el.classList.toggle("error", err);
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 3000);
  }

  _zone() {
    return findZone(this._data, this._config.zone);
  }

  _climateIsOff(entityId) {
    const st = this._hass?.states?.[entityId];
    if (!st) return true;
    const mode = st.attributes?.hvac_mode ?? st.state;
    return mode === "off" || st.state === "off";
  }

  _tempBlock(zone, cfg, disabled, manual) {
    const climateId = this._climatePlotId(zone);
    const ro = deviceClimateReadout(this._hass, climateId);
    const current = ro.current ?? zone?.current_temperature;
    const target = ro.target ?? zone?.target_temperature;
    if (manual && cfg.show_slider !== false) {
      return `
        <div class="slider-row">
          <button type="button" data-action="down" ${disabled ? "disabled" : ""}>−</button>
          <input type="range" min="${zone.min_temp}" max="${zone.max_temp}" step="0.5" value="${target ?? 20}" data-action="slider" ${disabled ? "disabled" : ""}>
          <button type="button" data-action="up" ${disabled ? "disabled" : ""}>+</button>
        </div>
        <div class="temp-display">${formatTemp(current)} <span class="target">→ ${formatTemp(target)}</span></div>`;
    }
    return `
        <div class="temp-readonly">
          <span class="ambient">${formatTemp(current)}</span>
          <span class="sep">·</span>
          <span class="setpoint">${formatTemp(target)} setpoint</span>
        </div>`;
  }

  _render() {
    if (!this.shadowRoot) return;
    const zone = this._zone();
    const cfg = this._config;
    const disabled = !this._data || !zone;
    const manual = Boolean(zone?.pinned);
    const profiles = this._data?.profiles || [];
    const today = todayKey();
    const todayProfile = zone && (this._data?.weekly_profiles?.[zone.id]?.[today] || zone.active_profile);
    const todayName = profiles.find((p) => p.id === todayProfile)?.name || zone?.active_profile_name;

    const climateId = zone ? this._climatePlotId(zone) : null;
    const climateOff = climateId ? this._climateIsOff(climateId) : true;
    const body = !this._data
      ? `<div class="empty">${this._error ? esc(this._error) : "Caricamento…"}</div>`
      : !zone
        ? `<div class="empty">Configura la card (modifica dashboard)</div>`
        : `
      <div class="head">
        <div class="title">${esc(cfg.title || zone.name)}</div>
        <div class="sub">${manual ? "Manuale" : "Automatico"} · Oggi: ${esc(todayName || "--")}</div>
      </div>
      ${cfg.show_graph !== false ? `<div class="mini-chart" id="mini-chart-host"><div class="empty chart-loading">Caricamento grafico…</div></div>` : ""}
      <div class="controls">
        ${this._tempBlock(zone, cfg, disabled, manual)}
        <div class="mode-row">
          <button type="button" class="toggle ${manual ? "" : "active"}" data-action="mode-auto">Automatico</button>
          <button type="button" class="toggle ${manual ? "active" : ""}" data-action="mode-manual">Manuale</button>
          <button type="button" class="toggle power ${climateOff ? "" : "active"}" data-action="power" title="${climateOff ? "Accendi" : "Spegni"}">${climateOff ? "Off" : "On"}</button>
        </div>
      </div>
      ${cfg.show_status !== false ? `<div class="meta">Profilo attivo: ${esc(zone.active_profile_name || "--")}</div>` : ""}`;

    this.shadowRoot.innerHTML = `<style>
      :host{display:block}
      .card{background:var(--ha-card-background,var(--card-background-color,#fff));color:var(--primary-text-color);border-radius:12px;border:1px solid var(--divider-color);padding:16px}
      .head{display:grid;gap:2px}
      .title{font-weight:600}
      .sub{font-size:0.8rem;color:var(--secondary-text-color)}
      .controls{display:grid;gap:10px;margin-top:10px}
      .mode-row{display:flex;gap:8px}
      .toggle{flex:1;padding:8px;border-radius:6px;border:1px solid var(--divider-color);cursor:pointer;background:var(--card-background-color,#fff);font-size:0.85rem}
      .toggle.active{background:var(--primary-color);color:#fff;border-color:var(--primary-color)}
      .toggle.power{flex:0 0 3.2rem;font-weight:600}
      .slider-row{display:flex;align-items:center;gap:8px}
      .slider-row button{width:36px;height:36px;border-radius:6px;border:1px solid var(--divider-color);cursor:pointer}
      .slider-row input{flex:1}
      .temp-display{text-align:center;font-size:1.4rem;margin:4px 0}
      .temp-readonly{text-align:center;font-size:1.35rem;margin:6px 0;display:flex;justify-content:center;align-items:baseline;gap:6px;flex-wrap:wrap}
      .temp-readonly .ambient{font-weight:600}
      .temp-readonly .sep,.temp-readonly .setpoint{color:var(--secondary-text-color);font-size:1rem}
      .target{font-size:0.95rem;color:var(--secondary-text-color)}
      .meta{font-size:0.8rem;color:var(--secondary-text-color);margin-top:8px}
      .mini-chart{position:relative;margin:8px 0 4px}
      .mini-chart .curve{width:100%;height:168px;display:block}
      .hist-legend{display:flex;flex-direction:column;gap:4px;margin-top:6px;font-size:0.72rem}
      .hist-legend-item{display:inline-flex;align-items:center;gap:6px;margin-right:10px}
      .hist-swatch{width:14px;height:3px;border-radius:1px}
      .chart-tooltip{position:absolute;z-index:2;transform:translateX(-50%);background:var(--card-background-color,#fff);border:1px solid var(--divider-color);border-radius:6px;padding:4px 6px;font-size:0.7rem;box-shadow:0 2px 6px rgba(0,0,0,.12);pointer-events:none}
      .chart-loading{font-size:0.8rem;padding:8px}
      .empty{text-align:center;color:var(--secondary-text-color);padding:16px}
      .toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.85);color:#fff;padding:8px 14px;border-radius:8px;opacity:0;pointer-events:none;z-index:5}.toast.show{opacity:1}.toast.error{background:#c62828}
    </style><div class="card">${body}<div id="toast" class="toast"></div></div>`;
  }

  _onClick(e) {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const zone = this._zone();
    const action = btn.dataset.action;
    if (action === "power" && zone) {
      this._toggleClimatePower(zone);
      return;
    }
    if (action === "up" || action === "down") {
      const slider = this.shadowRoot.querySelector("input[type=range]");
      if (!slider) return;
      const step = parseFloat(slider.step || "0.5");
      let val = parseFloat(slider.value) + (action === "up" ? step : -step);
      slider.value = val;
      slider.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (action === "mode-auto" && zone) {
      this._call({ type: `${DOMAIN}/set_profile`, profile: "__auto__", zones: [zone.id] }, "Automatico");
      return;
    }
    if (action === "mode-manual" && zone) {
      const schedule = this._data?.weekly_profiles?.[zone.id] || {};
      const pid = schedule[todayKey()] || zone.active_profile;
      if (!pid) {
        this._toast("Imposta prima la pianificazione settimanale", true);
        return;
      }
      this._call({ type: `${DOMAIN}/set_profile`, profile: pid, zones: [zone.id] }, "Manuale");
    }
  }

  async _toggleClimatePower(zone) {
    if (!this._hass || !zone) return;
    const eid = this._climatePlotId(zone);
    if (!eid) return;
    const off = this._climateIsOff(eid);
    try {
      if (off) {
        try {
          await this._hass.callService("climate", "turn_on", { entity_id: eid });
        } catch (e1) {
          const mode = this._prevHvacMode || "heat";
          await this._hass.callService("climate", "set_hvac_mode", { entity_id: eid, hvac_mode: mode });
        }
        this._toast("Acceso");
      } else {
        const st = this._hass.states[eid];
        const mode = st?.attributes?.hvac_mode;
        if (mode && mode !== "off") this._prevHvacMode = mode;
        try {
          await this._hass.callService("climate", "turn_off", { entity_id: eid });
        } catch (e1) {
          await this._hass.callService("climate", "set_hvac_mode", { entity_id: eid, hvac_mode: "off" });
        }
        this._toast("Spento");
      }
      await this._load();
    } catch (e) {
      this._toast(e?.message || String(e), true);
    }
  }

  _onChange(e) {
    const t = e.target;
    if (t.matches("input[type=range][data-action='slider']")) {
      const zone = this._zone();
      if (!zone) return;
      this._call(
        { type: `${DOMAIN}/set_temperature`, zones: [zone.id], temperature: parseFloat(t.value) },
        "Temperatura impostata",
      );
      return;
    }
  }
}

class HaThermoCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._zones = [];
    this._profiles = [];
    this._weekly = {};
    this._loaded = false;
  }

  set hass(h) {
    this._hass = h;
    if (!this._loaded) {
      this._loaded = true;
      this._loadIntegration();
    }
  }

  setConfig(config) {
    this._config = {
      title: "Termostato",
      show_graph: true,
      show_graph_current: true,
      show_graph_target: true,
      show_slider: true,
      show_status: true,
      ...config,
    };
    this._render();
  }

  _zoneRecord() {
    return findZone({ zones: this._zones }, this._config.zone);
  }

  async _loadIntegration() {
    if (!this._hass) return;
    try {
      const d = await callWS(this._hass, { type: `${DOMAIN}/get_config` });
      this._zones = d?.zones || [];
      this._profiles = d?.profiles || [];
      this._weekly = d?.weekly_profiles || {};
    } catch (e) {
      /* ignore */
    }
    this._render();
  }

  async _saveWeekDay(zoneId, day, profileId) {
    const schedule = { ...(this._weekly[zoneId] || {}) };
    schedule[day] = profileId;
    await callWS(this._hass, { type: `${DOMAIN}/zone/weekly/set`, zone_id: zoneId, schedule });
    this._weekly[zoneId] = schedule;
  }

  _render() {
    const z = this._zoneRecord();
    const schedule = z ? this._weekly[z.id] || {} : {};
    const weekRows = z
      ? WEEK_DAYS.map((day) => {
          const value = schedule[day] || "";
          return `<label class="weekly-day"><span>${DAY_LABELS[day]}</span><select data-weekly data-day="${day}" data-zone-id="${esc(z.id)}">${profileOptions(this._profiles, value)}</select></label>`;
        }).join("")
      : `<p class="hint">Seleziona una zona termostato.</p>`;
    this.shadowRoot.innerHTML = `<style>
      .form{display:grid;gap:10px;padding:4px 0;font-size:0.9rem}
      label{display:grid;gap:4px}
      input,select{padding:6px;border-radius:6px;border:1px solid var(--divider-color)}
      .section{font-weight:600;margin-top:8px}
      .row{display:flex;align-items:center;gap:8px}
      .weekly-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px}
      .weekly-day{font-size:0.85rem}
      .hint{color:var(--secondary-text-color);font-size:0.8rem}
    </style><div class="form">
      <label>Titolo<input data-f="title" value="${esc(this._config.title || "")}"></label>
      <label>Termostato (zona HA Thermo)<select data-f="zone">${getZoneOptions(this._zones, false)}</select></label>
      <div class="section">Grafico</div>
      <label class="row"><input type="checkbox" data-f="show_graph" ${this._config.show_graph !== false ? "checked" : ""}> Mostra grafico</label>
      <label class="row"><input type="checkbox" data-f="show_graph_current" ${this._config.show_graph_current !== false ? "checked" : ""}> Serie: temperatura attuale</label>
      <label class="row"><input type="checkbox" data-f="show_graph_target" ${this._config.show_graph_target !== false ? "checked" : ""}> Serie: temperatura destinataria</label>
      <div class="section">Termostato</div>
      <label class="row"><input type="checkbox" data-f="show_slider" ${this._config.show_slider !== false ? "checked" : ""}> Slider in Manuale</label>
      <label class="row"><input type="checkbox" data-f="show_status" ${this._config.show_status !== false ? "checked" : ""}> Mostra profilo attivo</label>
      <div class="section">Settimana (salvata su integrazione)</div>
      <div class="weekly-grid">${weekRows}</div>
    </div>`;
    const zoneSel = this.shadowRoot.querySelector('[data-f="zone"]');
    if (zoneSel && this._config.zone) zoneSel.value = this._config.zone;
    this.shadowRoot.querySelectorAll("[data-f]").forEach((el) => el.addEventListener("change", () => this._emitConfig()));
    this.shadowRoot.querySelectorAll("[data-weekly]").forEach((el) =>
      el.addEventListener("change", () => this._onWeeklyChange(el)),
    );
  }

  _emitConfig() {
    const g = (k) => this.shadowRoot.querySelector(`[data-f="${k}"]`);
    const prevZone = this._config.zone;
    const config = {
      ...this._config,
      title: g("title")?.value,
      zone: g("zone")?.value,
      show_graph: g("show_graph")?.checked,
      show_graph_current: g("show_graph_current")?.checked,
      show_graph_target: g("show_graph_target")?.checked,
      show_slider: g("show_slider")?.checked,
      show_status: g("show_status")?.checked,
    };
    this._config = config;
    if (config.zone !== prevZone) this._render();
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }

  async _onWeeklyChange(el) {
    if (!this._hass) return;
    try {
      await this._saveWeekDay(el.dataset.zoneId, el.dataset.day, el.value);
    } catch (e) {
      /* ignore */
    }
  }
}

if (!customElements.get("ha-thermo-card")) customElements.define("ha-thermo-card", HaThermoCard);
if (!customElements.get("ha-thermo-card-editor")) customElements.define("ha-thermo-card-editor", HaThermoCardEditor);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "ha-thermo-card")) {
  window.customCards.push({
    type: "ha-thermo-card",
    name: "HA Thermo",
    description: "Termostato: automatico/manuale, temperatura e pianificazione settimanale profili.",
    preview: true,
    documentationURL: "https://github.com/marcopiccinni/ha_thermo",
  });
}
