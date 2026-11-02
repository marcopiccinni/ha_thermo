import { DOMAIN, EVENT_TYPES, DAY_KEYS, esc, round, formatTemp, formatTime, formatRemaining, todayKey, findZone, getZoneOptions, renderChart, callWS } from "./ha-thermo-common.js?v=0.2.2";

class HaThermoCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
    this.shadowRoot.addEventListener("change", (e) => this._onChange(e));
    this.shadowRoot.addEventListener("input", (e) => this._onInput(e));
    this._config = {};
    this._data = null;
    this._error = null;
    this._busy = null;
    this._hass = null;
    this._unsubs = [];
    this._timer = null;
    this._started = false;
  }

  static getStubConfig(hass, entities) {
    const climate = entities?.find((id) => id.startsWith("climate."));
    return climate ? { zone: climate, title: "Termostato" } : { title: "Termostato" };
  }

  static getConfigElement() { return document.createElement("ha-thermo-card-editor"); }

  setConfig(config) {
    if (!config) throw new Error("Configurazione non valida");
    this._config = { title: "Termostati", show_graph: false, show_slider: true, show_profile: true, show_bypass: true, show_enable: true, show_status: true, bypass_minutes: 60, hold_minutes: 60, ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._started) {
      this._started = true;
      this._load();
      this._subscribe();
      this._timer = window.setInterval(() => { if (!document.hidden) this._load(); }, 30000);
    }
  }

  connectedCallback() {
    if (!this._hass) return;
    if (!this._data) this._load();
    if (!this._unsubs.length) this._subscribe();
    if (!this._timer) this._timer = window.setInterval(() => { if (!document.hidden) this._load(); }, 30000);
  }

  disconnectedCallback() {
    window.clearInterval(this._timer); this._timer = null;
    this._unsubs.forEach((u) => { try { u(); } catch (e) {} });
    this._unsubs = [];
  }

  getCardSize() { return this._config.show_graph ? 6 : 4; }

  async _subscribe() {
    for (const et of EVENT_TYPES) {
      try { const unsub = await this._hass.connection.subscribeEvents(() => this._load(), et); this._unsubs.push(unsub); } catch (e) {}
    }
  }

  async _load() {
    if (!this._hass) return;
    try { this._data = await callWS(this._hass, { type: `${DOMAIN}/get_config` }); this._error = null; } catch (e) { this._error = e?.message || String(e); }
    this._render();
  }

  _zone() { return findZone(this._data, this._config.zone); }

  _profile(zone) {
    const id = zone?.active_profile;
    return (this._data?.profiles || []).find((p) => p.id === id);
  }

  _call(msg) {
    if (!this._hass) return;
    this._hass.callWS(msg).then(() => this._load()).catch((e) => { this._error = e?.message || String(e); });
  }

  _render() {
    if (!this.shadowRoot) return;
    const zone = this._zone();
    const body = !this._data
      ? `<div class="empty">${this._error ? esc(this._error) : "Caricamento…"}</div>`
      : !zone
        ? `<div class="empty">Scegli il termostato con la matita</div>`
        : this._zoneCard(zone);
    this.shadowRoot.innerHTML = `<style>
      :host{display:block}
      .card{background:var(--ha-card-background,var(--card-background-color,#fff));color:var(--primary-text-color);border-radius:var(--ha-card-border-radius,12px);border:var(--ha-card-border-width,1px) solid var(--ha-card-border-color,var(--divider-color,transparent));box-shadow:var(--ha-card-box-shadow,none);padding:16px}
      .head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
      .title{font-weight:600;font-size:1.05rem}
      .temp-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0}
      .temp-current{font-size:1.8rem;color:var(--secondary-text-color)}
      .temp-target{font-size:2rem;font-weight:600;color:var(--primary-color)}
      .curve{width:100%;height:180px;margin:8px 0;background:rgba(127,127,127,0.05);border-radius:8px}
      .stepper{display:flex;align-items:center;gap:8px;margin:8px 0}
      .stepper button{width:36px;height:36px;border-radius:6px;border:1px solid var(--divider-color);background:var(--card-background-color,#fff);color:var(--primary-text-color);font-size:1.2rem}
      .stepper input{flex:1}
      .zone-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
      .zone-actions select{flex:1;min-width:120px;padding:8px;border-radius:6px;border:1px solid var(--divider-color);background:var(--card-background-color,#fff);color:var(--primary-text-color)}
      .pill{padding:4px 10px;border-radius:99px;font-size:0.8rem;border:1px solid var(--divider-color)}
      .pill.on{background:var(--success-color,#4caf50);color:#fff;border-color:var(--success-color,#4caf50)}
      .pill.off{background:var(--error-color,#f44336);color:#fff;border-color:var(--error-color,#f44336)}
      button.danger{background:var(--error-color,#f44336);color:#fff;border:none}
      .meta{display:flex;justify-content:space-between;gap:8px;color:var(--secondary-text-color);font-size:0.78rem;margin-top:8px}
      .empty{color:var(--secondary-text-color);padding:12px 0;text-align:center}
      .legend-target,.legend-current{font-size:0.7rem;fill:var(--primary-text-color)}
    </style><div class="card"><div class="head"><div class="title">${esc(this._config.title || (zone?.name || "Termostato"))}</div><button class="small" data-action="refresh" title="Aggiorna">⟳</button></div>${body}</div>`;
  }

  _zoneCard(zone) {
    const profiles = this._data?.profiles || [];
    const pinned = this._data?.pinned_profiles?.[zone.id] || "__auto__";
    const bypass = (this._data?.bypasses || []).find((b) => !b.zones?.length || b.zones.includes(zone.id));
    const disabled = this._busy === zone.id ? "disabled" : "";
    const profileOptions = [`<option value="__auto__" ${pinned === "__auto__" ? "selected" : ""}>Auto</option>`, ...profiles.map((p) => `<option value="${esc(p.id)}" ${pinned === p.id ? "selected" : ""}>${esc(p.name)}</option>`)].join("");
    const cfg = this._config;
    return `
      <div class="temp-row">
        <div class="temp-current">${formatTemp(zone.current_temperature)}</div>
        <div class="temp-target">${formatTemp(zone.target_temperature)}</div>
      </div>
      ${cfg.show_graph !== false ? renderChart(zone, this._profile(zone), this._data) : ""}
      ${cfg.show_slider ? `<div class="stepper">
        <button data-action="minus" data-zone="${esc(zone.id)}" ${disabled}>−</button>
        <input type="range" data-action="slider" data-zone="${esc(zone.id)}" min="${esc(zone.min_temp)}" max="${esc(zone.max_temp)}" step="0.5" value="${esc(round(zone.target_temperature) ?? zone.default_temp)}" ${disabled}>
        <button data-action="plus" data-zone="${esc(zone.id)}" ${disabled}>+</button>
      </div>` : ""}
      <div class="zone-actions">
        ${cfg.show_profile ? `<select data-action="profile" data-zone="${esc(zone.id)}" ${disabled}>${profileOptions}</select>` : ""}
        ${cfg.show_bypass ? `<button data-action="freeze" data-zone="${esc(zone.id)}" ${disabled}>Bypass ${cfg.bypass_minutes || 60}m</button>` : ""}
        ${bypass && cfg.show_bypass ? `<button class="danger" data-action="stop" data-zone="${esc(zone.id)}" ${disabled}>Ferma ${formatRemaining(bypass.remaining)}</button>` : ""}
        ${cfg.show_enable ? `<button class="pill ${zone.enabled ? "on" : "off"}" data-action="toggle" data-zone="${esc(zone.id)}" ${disabled}>${zone.enabled ? "Auto" : "Off"}</button>` : ""}
      </div>
      ${cfg.show_status ? `<div class="meta"><span>Profilo: ${esc(zone.active_profile_name || "--")}</span><span>Prossimo: ${formatTime(zone.next_change)}</span>${bypass ? `<span>Bypass: ${formatRemaining(bypass.remaining)}</span>` : ""}</div>` : ""}`;
  }

  _onClick(e) {
    const btn = e.target.closest("button[data-action]"); if (!btn) return;
    const action = btn.dataset.action, zoneId = btn.dataset.zone;
    if (action === "refresh") { this._load(); return; }
    if (action === "toggle") {
      const zone = this._data?.zones?.find((z) => z.id === zoneId);
      if (zone) this._call({ type: `${DOMAIN}/set_enabled`, enabled: !zone.enabled, zones: [zoneId] });
      return;
    }
    if (action === "stop") { this._call({ type: `${DOMAIN}/bypass/stop`, zones: [zoneId] }); return; }
    if (action === "freeze") { this._call({ type: `${DOMAIN}/bypass/start`, zones: [zoneId], duration: this._config.bypass_minutes || 60 }); return; }
    const zone = this._data?.zones?.find((z) => z.id === zoneId); if (!zone) return;
    if (action === "plus" || action === "minus") {
      const delta = action === "plus" ? 0.5 : -0.5;
      const base = round(zone.target_temperature) ?? round(zone.default_temp) ?? 20;
      this._call({ type: `${DOMAIN}/set_temperature`, zones: [zoneId], temperature: base + delta, duration: this._config.hold_minutes || 60 });
    }
  }

  _onInput(e) {
    const slider = e.target.closest("input[data-action='slider']"); if (!slider) return;
    const label = this.shadowRoot.querySelector(`[data-target-for="${slider.dataset.zone}"]`);
    if (label) label.textContent = formatTemp(Number(slider.value));
  }

  _onChange(e) {
    const t = e.target;
    if (t.matches("select[data-action='profile']")) { this._call({ type: `${DOMAIN}/set_profile`, profile: t.value, zones: [t.dataset.zone] }); return; }
    if (t.matches("input[data-action='slider']")) {
      const zone = this._data?.zones?.find((z) => z.id === t.dataset.zone);
      if (zone) this._call({ type: `${DOMAIN}/set_temperature`, zones: [zone.id], temperature: Number(t.value), duration: this._config.hold_minutes || 60 });
    }
  }
}

class HaThermoCardEditor extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "open" }); this._config = {}; this._zones = []; }
  set hass(hass) { this._hass = hass; this._loadZones(); }
  setConfig(config) { this._config = { title: "Termostato", show_graph: false, show_slider: true, show_profile: true, show_bypass: true, show_enable: true, show_status: true, bypass_minutes: 60, hold_minutes: 60, ...config }; this._render(); }
  async _loadZones() {
    if (!this._hass) return;
    try { const data = await callWS(this._hass, { type: `${DOMAIN}/get_config` }); this._zones = data?.zones || []; } catch (e) {}
    this._render();
  }
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
      <label>Titolo<input type="text" data-field="title" value="${esc(this._config.title || "")}"></label>
      <label>Termostato<select data-field="zone">${zoneOpts}<option value="${esc(this._config.zone || "")}" ${!this._zones.find(z=>z.id===this._config.zone)?'selected':''}>${esc(this._config.zone || "Scegli...")}</option></select></label>
      <fieldset><legend>Visualizzazione</legend>
        <label class="row"><input type="checkbox" data-field="show_graph" ${this._config.show_graph!==false?"checked":""}>Mostra grafico</label>
        <label class="row"><input type="checkbox" data-field="show_slider" ${this._config.show_slider!==false?"checked":""}>Mostra slider</label>
        <label class="row"><input type="checkbox" data-field="show_profile" ${this._config.show_profile!==false?"checked":""}>Mostra profilo</label>
        <label class="row"><input type="checkbox" data-field="show_bypass" ${this._config.show_bypass!==false?"checked":""}>Mostra bypass</label>
        <label class="row"><input type="checkbox" data-field="show_enable" ${this._config.show_enable!==false?"checked":""}>Mostra enable</label>
        <label class="row"><input type="checkbox" data-field="show_status" ${this._config.show_status!==false?"checked":""}>Mostra stato</label>
      </fieldset>
      <fieldset><legend>Durate</legend>
        <label>Minuti bypass rapido<input type="number" data-field="bypass_minutes" value="${esc(this._config.bypass_minutes||60)}"></label>
        <label>Minuti override<input type="number" data-field="hold_minutes" value="${esc(this._config.hold_minutes||60)}"></label>
      </fieldset>
    </div>`;
    this.shadowRoot.querySelectorAll("input,select").forEach((el) => el.addEventListener("change", () => this._changed()));
  }
  _changed() {
    const get = (f) => this.shadowRoot.querySelector(`[data-field="${f}"]`);
    const isCheckbox = (f) => get(f)?.type === "checkbox";
    const config = { ...this._config, title: get("title")?.value, zone: get("zone")?.value };
    ["show_graph","show_slider","show_profile","show_bypass","show_enable","show_status"].forEach(k => { if (isCheckbox(k)) config[k] = get(k)?.checked; });
    ["bypass_minutes","hold_minutes"].forEach(k => { const v = Number(get(k)?.value); if (v) config[k] = v; });
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }
}

if (!customElements.get("ha-thermo-card-editor")) customElements.define("ha-thermo-card-editor", HaThermoCardEditor);
if (!customElements.get("ha-thermo-card")) customElements.define("ha-thermo-card", HaThermoCard);
window.customCards = window.customCards || [];
if (!window.customCards.some(c => c.type === "ha-thermo-card")) {
  window.customCards.push({ type: "ha-thermo-card", name: "HA Thermo Controlli", description: "Controlla un termostato con slider, profilo e bypass.", preview: true, getEntitySuggestion: (hass, entityId) => entityId.startsWith("climate.") ? { config: { type: "custom:ha-thermo-card", zone: entityId } } : null });
}
