import { DOMAIN, EVENT_TYPES, esc, formatTemp, formatTime, todayKey, findZone, getZoneOptions, renderChart, callWS } from "./ha-thermo-common.js?v=0.2.2";

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
    this._config = { title: "Grafico", height: 180, show_legend: true, show_current: true, show_target: true, show_profile: true, show_next: true, ...config };
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
  _profile(zone) { const id = zone?.active_profile; return (this._data?.profiles || []).find((p) => p.id === id); }
  _render() {
    if (!this.shadowRoot) return;
    const zone = this._zone();
    const body = !this._data ? `<div class="empty">${this._error ? esc(this._error) : "Caricamento…"}</div>` : !zone ? `<div class="empty">Scegli il termostato con la matita</div>` : this._graph(zone);
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
  _graph(zone) {
    const profile = this._profile(zone);
    const low = Number(zone.min_temp ?? 5), high = Number(zone.max_temp ?? 35), pad = (high - low) * 0.15 || 5;
    const minY = low - pad, maxY = high + pad;
    const y = (t) => 160 - ((t - minY) / (maxY - minY)) * 140;
    const day = todayKey();
    const curve = profile?.curves?.[zone.id]?.[day] || [];
    const points = curve.length === 24 ? curve.map((t, h) => `${h * 9},${y(t).toFixed(2)}`).join(" ") : "";
    const targetY = y(zone.target_temperature ?? profile?.targets?.[zone.id] ?? zone.default_temp ?? 20).toFixed(2);
    const currentY = zone.current_temperature == null ? null : y(zone.current_temperature).toFixed(2);
    const cfg = this._config;
    return `<div class="chart-wrap">
      <svg class="curve" viewBox="0 0 207 180" preserveAspectRatio="none">
        ${cfg.show_target!==false ? `<line x1="0" y1="${targetY}" x2="207" y2="${targetY}" stroke="var(--primary-color)" stroke-width="1.5" stroke-dasharray="4 3"/>` : ""}
        ${cfg.show_current!==false && currentY ? `<line x1="0" y1="${currentY}" x2="207" y2="${currentY}" stroke="var(--secondary-text-color)" stroke-width="1" opacity="0.6"/>` : ""}
        ${points ? `<polyline fill="none" stroke="var(--accent-color)" stroke-width="2" points="${points}"/>` : ""}
      </svg>
      ${cfg.show_legend!==false ? `<div class="legend">
        ${cfg.show_target!==false ? `<span><i style="display:inline-block;width:10px;height:2px;background:var(--primary-color);margin-right:4px"></i>Target ${formatTemp(zone.target_temperature)}</span>` : ""}
        ${cfg.show_current!==false && zone.current_temperature!=null ? `<span><i style="display:inline-block;width:10px;height:2px;background:var(--secondary-text-color);margin-right:4px"></i>Attuale ${formatTemp(zone.current_temperature)}</span>` : ""}
        ${cfg.show_profile!==false ? `<span>Profilo: ${esc(zone.active_profile_name||"--")}</span>` : ""}
        ${cfg.show_next!==false ? `<span>Prossimo: ${formatTime(zone.next_change)}</span>` : ""}
      </div>` : ""}
    </div>`;
  }
}

class HaThermoGraphCardEditor extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "open" }); this._config = {}; this._zones = []; }
  set hass(hass) { this._hass = hass; this._loadZones(); }
  setConfig(config) { this._config = { title: "Grafico", height: 180, show_legend: true, show_current: true, show_target: true, show_profile: true, show_next: true, ...config }; this._render(); }
  async _loadZones() { if (!this._hass) return; try { const data = await callWS(this._hass, { type: `${DOMAIN}/get_config` }); this._zones = data?.zones || []; } catch (e) {} this._render(); }
  _render() {
    const zoneOpts = getZoneOptions(this._zones, false);
    this.shadowRoot.innerHTML = `<style>
      .form{display:grid;gap:12px;padding:8px 0}
      label{display:grid;gap:4px;font-size:0.9rem}
      input,select{padding:8px;border-radius:6px;border:1px solid var(--divider-color);background:var(--card-background-color,#fff);color:var(--primary-text-color)}
      .row{display:flex;align-items:center;gap:8px}
      fieldset{border:1px solid var(--divider-color);border-radius:8px;padding:8px 12px}
      legend{font-size:0.85rem;color:var(--secondary-text-color)}
    </style><div class="form">
      <label>Titolo<input type="text" data-field="title" value="${esc(this._config.title||"")}"></label>
      <label>Termostato<select data-field="zone">${zoneOpts}<option value="${esc(this._config.zone||"")}" ${!this._zones.find(z=>z.id===this._config.zone)?'selected':''}>${esc(this._config.zone||"Scegli...")}</option></select></label>
      <label>Altezza grafico (px)<input type="number" data-field="height" value="${esc(this._config.height||180)}"></label>
      <fieldset><legend>Mostra</legend>
        <label class="row"><input type="checkbox" data-field="show_legend" ${this._config.show_legend!==false?"checked":""}>Legenda</label>
        <label class="row"><input type="checkbox" data-field="show_target" ${this._config.show_target!==false?"checked":""}>Target</label>
        <label class="row"><input type="checkbox" data-field="show_current" ${this._config.show_current!==false?"checked":""}>Attuale</label>
        <label class="row"><input type="checkbox" data-field="show_profile" ${this._config.show_profile!==false?"checked":""}>Profilo</label>
        <label class="row"><input type="checkbox" data-field="show_next" ${this._config.show_next!==false?"checked":""}>Prossimo cambio</label>
      </fieldset>
    </div>`;
    this.shadowRoot.querySelectorAll("input,select").forEach((el) => el.addEventListener("change", () => this._changed()));
  }
  _changed() {
    const get = (f) => this.shadowRoot.querySelector(`[data-field="${f}"]`);
    const config = { ...this._config, title: get("title")?.value, zone: get("zone")?.value, height: Number(get("height")?.value)||180 };
    ["show_legend","show_target","show_current","show_profile","show_next"].forEach(k => { config[k] = get(k)?.checked; });
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }
}

if (!customElements.get("ha-thermo-graph-card-editor")) customElements.define("ha-thermo-graph-card-editor", HaThermoGraphCardEditor);
if (!customElements.get("ha-thermo-graph-card")) customElements.define("ha-thermo-graph-card", HaThermoGraphCard);
window.customCards = window.customCards || [];
if (!window.customCards.some(c => c.type === "ha-thermo-graph-card")) {
  window.customCards.push({ type: "ha-thermo-graph-card", name: "HA Thermo Grafico", description: "Grafico 24h di un termostato.", preview: true, getEntitySuggestion: (hass, entityId) => entityId.startsWith("climate.") ? { config: { type: "custom:ha-thermo-graph-card", zone: entityId } } : null });
}
