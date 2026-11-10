import { DOMAIN, EVENT_TYPES, esc, formatTemp, findZone, getZoneOptions, callWS } from "./ha-thermo-common.js?v=0.3.6";

class HaThermoGraphCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {}; this._data = null; this._error = null; this._hass = null; this._unsubs = []; this._timer = null; this._started = false;
  }
  static getStubConfig(hass, entities) { const climate = entities?.find((id) => id.startsWith("climate.")); return climate ? { zone: climate, title: "Grafico termostato" } : { title: "Grafico termostato" }; }
  static getConfigElement() { return document.createElement("ha-thermo-graph-card-editor"); }
  setConfig(config) {
    if (!config) throw new Error("Configurazione non valida");
    this._config = { title: "Grafico", height: 180, hours_to_show: 24, min_temp: null, max_temp: null, show_current: true, show_target: true, ...config };
    this._render();
  }
  set hass(hass) {
    this._hass = hass;
    if (!this._started) { this._started = true; this._load(); this._subscribe(); this._timer = window.setInterval(() => { if (!document.hidden) this._load(); }, 30000); }
  }
  connectedCallback() { if (!this._hass) return; if (!this._data) this._load(); if (!this._unsubs.length) this._subscribe(); if (!this._timer) this._timer = window.setInterval(() => { if (!document.hidden) this._load(); }, 30000); }
  disconnectedCallback() { window.clearInterval(this._timer); this._timer = null; this._unsubs.forEach((u) => { try { u(); } catch (e) {} }); this._unsubs = []; }
  getCardSize() { return 4; }
  async _subscribe() { for (const et of EVENT_TYPES) { try { const unsub = await this._hass.connection.subscribeEvents(() => this._load(), et); this._unsubs.push(unsub); } catch (e) {} } }
  async _load() { if (!this._hass) return; try { this._data = await callWS(this._hass, { type: `${DOMAIN}/get_config` }); this._error = null; } catch (e) { this._error = e?.message || String(e); } this._render(); }
  _zone() { return findZone(this._data, this._config.zone); }
  async _fetchHistory(entityId) {
    if (!this._hass || !entityId) return [];
    const hours = this._config.hours_to_show || 24;
    const now = new Date();
    const startTime = new Date(now.getTime() - hours * 3600 * 1000);
    try {
      const history = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: startTime.toISOString(),
        end_time: now.toISOString(),
        entity_ids: [entityId],
        minimal_response: true,
        no_attributes: false,
      });
      return history?.[0] || [];
    } catch (e) {
      return [];
    }
  }
  async _render() {
    if (!this.shadowRoot) return;
    const zone = this._zone();
    const body = !this._data ? `<div class="empty">${this._error ? esc(this._error) : "Caricamento…"}</div>` : !zone ? `<div class="empty">Scegli il termostato con la matita</div>` : await this._graph(zone);
    this.shadowRoot.innerHTML = `<style>
      :host{display:block}
      .card{background:var(--ha-card-background,var(--card-background-color,#fff));color:var(--primary-text-color);border-radius:var(--ha-card-border-radius,12px);border:var(--ha-card-border-width,1px) solid var(--ha-card-border-color,var(--divider-color,transparent));box-shadow:var(--ha-card-box-shadow,none);padding:16px}
      .head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
      .title{font-weight:600;font-size:1.05rem}
      .chart-wrap{position:relative;width:100%}
      .curve{width:100%;height:${this._config.height||180}px;background:rgba(127,127,127,0.05);border-radius:8px}
      .legend{display:flex;gap:12px;font-size:0.75rem;color:var(--secondary-text-color);margin-top:8px}
      .empty{color:var(--secondary-text-color);padding:12px 0;text-align:center}
    </style><div class="card"><div class="head"><div class="title">${esc(this._config.title || (zone?.name || "Grafico"))}</div></div>${body}</div>`;
  }
  async _graph(zone) {
    const cfg = this._config;
    const currentData = cfg.show_current !== false ? await this._fetchHistory(zone.temperature_sensor || zone.climate_entity) : [];
    const targetData = cfg.show_target !== false ? await this._fetchHistory(zone.climate_entity) : [];
    const currentPoints = currentData.map((s) => ({ x: new Date(s.last_changed).getTime(), y: parseFloat(s.state) })).filter((p) => !isNaN(p.y));
    const targetPoints = targetData.map((s) => ({ x: new Date(s.last_changed).getTime(), y: parseFloat(s.state) })).filter((p) => !isNaN(p.y));
    const allY = [...currentPoints, ...targetPoints].map((p) => p.y);
    const minY = cfg.min_temp != null ? cfg.min_temp : (allY.length ? Math.min(...allY) - 1 : 15);
    const maxY = cfg.max_temp != null ? cfg.max_temp : (allY.length ? Math.max(...allY) + 1 : 30);
    const chart = this._drawChart(currentPoints, targetPoints, minY, maxY, cfg.height || 180);
    return `<div class="chart-wrap">${chart}${this._legend(cfg)}</div>`;
  }
  _drawChart(current, target, minY, maxY, height) {
    if (!current.length && !target.length) {
      return `<svg class="curve" viewBox="0 0 400 ${height}"><text x="200" y="${height / 2}" text-anchor="middle" fill="var(--secondary-text-color)">Nessun dato storico</text></svg>`;
    }
    const now = Date.now();
    const hours = this._config.hours_to_show || 24;
    const startTime = now - hours * 3600 * 1000;
    const width = 400;
    const xScale = (t) => ((t - startTime) / (hours * 3600 * 1000)) * width;
    const yScale = (v) => height - ((v - minY) / (maxY - minY)) * height;
    const pathFromPoints = (points) => {
      if (!points.length) return "";
      const sorted = [...points].sort((a, b) => a.x - b.x);
      return sorted.map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.x).toFixed(1)} ${yScale(p.y).toFixed(1)}`).join(" ");
    };
    const currentPath = pathFromPoints(current);
    const targetPath = pathFromPoints(target);
    return `<svg class="curve" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <line x1="0" y1="${yScale(minY)}" x2="${width}" y2="${yScale(minY)}" stroke="var(--divider-color)" stroke-width="1"/>
      <line x1="0" y1="${yScale(maxY)}" x2="${width}" y2="${yScale(maxY)}" stroke="var(--divider-color)" stroke-width="1"/>
      ${currentPath ? `<path d="${currentPath}" fill="none" stroke="var(--primary-color)" stroke-width="2"/>` : ""}
      ${targetPath ? `<path d="${targetPath}" fill="none" stroke="var(--accent-color,#ff9800)" stroke-width="2" stroke-dasharray="4,2"/>` : ""}
    </svg>`;
  }
  _legend(cfg) {
    return `<div class="legend">
      ${cfg.show_current !== false ? `<span><span style="display:inline-block;width:12px;height:2px;background:var(--primary-color);vertical-align:middle"></span> Attuale</span>` : ""}
      ${cfg.show_target !== false ? `<span><span style="display:inline-block;width:12px;height:2px;background:var(--accent-color,#ff9800);vertical-align:middle;border-bottom:2px dashed var(--accent-color,#ff9800)"></span> Target</span>` : ""}
    </div>`;
  }
}

class HaThermoGraphCardEditor extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "open" }); this._config = {}; this._zones = []; this._loaded = false; }
  set hass(h) { this._hass = h; if (!this._loaded) { this._loaded = true; this._loadZones(); } }
  setConfig(config) { this._config = { title: "Grafico", height: 180, hours_to_show: 24, min_temp: null, max_temp: null, show_current: true, show_target: true, ...config }; this._render(); }
  async _loadZones() { if (!this._hass) return; try { const d = await callWS(this._hass, { type: `${DOMAIN}/get_config` }); this._zones = d?.zones || []; } catch (e) {} this._render(); }
  _render() {
    const allOpt = '<option value="all">Tutte le zone</option>', zoneOpts = getZoneOptions(this._zones, false);
    this.shadowRoot.innerHTML = `<style>.form{display:grid;gap:12px;padding:8px 0}label{display:grid;gap:4px;font-size:0.9rem}input,select{padding:6px;border-radius:6px;border:1px solid var(--divider-color)}.row{display:flex;gap:8px}</style><div class="form">
      <label>Titolo<input type="text" data-field="title" value="${esc(this._config.title || "")}"></label>
      <label>Zona<select data-field="zone">${allOpt}${zoneOpts}</select></label>
      <label>Altezza<input type="number" data-field="height" value="${esc(this._config.height || 180)}"></label>
      <label>Ore storico<input type="number" data-field="hours_to_show" value="${esc(this._config.hours_to_show || 24)}"></label>
      <div class="row"><label>Temp min<input type="number" data-field="min_temp" value="${esc(this._config.min_temp ?? "")}"></label><label>Temp max<input type="number" data-field="max_temp" value="${esc(this._config.max_temp ?? "")}"></label></div>
      <label class="row"><input type="checkbox" data-field="show_current" ${this._config.show_current !== false ? "checked" : ""}>Mostra attuale</label>
      <label class="row"><input type="checkbox" data-field="show_target" ${this._config.show_target !== false ? "checked" : ""}>Mostra target</label>
    </div>`;
    this.shadowRoot.querySelectorAll("input,select").forEach(el => el.addEventListener("change", () => this._changed()));
  }
  _changed() {
    const get = (f) => this.shadowRoot.querySelector(`[data-field="${f}"]`);
    const config = { ...this._config, title: get("title")?.value, zone: get("zone")?.value };
    ["height", "hours_to_show"].forEach(k => { const v = Number(get(k)?.value); if (v > 0) config[k] = v; });
    ["min_temp", "max_temp"].forEach(k => { const v = get(k)?.value; config[k] = v === "" ? null : (v ? Number(v) : null); });
    ["show_current", "show_target"].forEach(k => { config[k] = get(k)?.checked; });
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }
}

if (!customElements.get("ha-thermo-graph-card")) customElements.define("ha-thermo-graph-card", HaThermoGraphCard);
if (!customElements.get("ha-thermo-graph-card-editor")) customElements.define("ha-thermo-graph-card-editor", HaThermoGraphCardEditor);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "ha-thermo-graph-card")) {
  window.customCards.push({
    type: "ha-thermo-graph-card",
    name: "HA Thermo Grafico",
    description: "Storico e andamento temperature/setpoint del termostato HA Thermo.",
    preview: true,
    documentationURL: "https://github.com/marcopiccinni/ha_thermo",
  });
}
