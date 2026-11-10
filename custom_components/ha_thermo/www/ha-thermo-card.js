import {
  DOMAIN,
  EVENT_TYPES,
  DAY_KEYS,
  DAY_LABELS,
  esc,
  formatTemp,
  formatRemaining,
  findZone,
  getZoneOptions,
  renderChart,
  callWS,
} from "./ha-thermo-common.js?v=0.3.3";

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
    this._config = {
      title: "Termostati",
      show_graph: false,
      show_slider: true,
      show_profile: true,
      show_weekly: true,
      show_bypass: true,
      show_enable: true,
      show_status: true,
      bypass_minutes: 60,
      hold_minutes: 60,
      ...config,
    };
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
    window.clearInterval(this._timer);
    this._timer = null;
    this._unsubs.forEach((u) => { try { u(); } catch (e) {} });
    this._unsubs = [];
  }

  getCardSize() { return 6; }

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

  _call(msg, ok) {
    if (!this._hass) return;
    this._hass.callWS(msg).then(() => { this._load(true); }).catch((e) => { this._toast(e?.message || String(e), true); });
  }

  _toast(txt, err = false) {
    const el = this.shadowRoot.getElementById("toast");
    if (!el) return;
    el.textContent = txt;
    el.classList.toggle("error", err);
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 3000);
  }

  _zone() { return findZone(this._data, this._config.zone); }

  _profile(zone) {
    const id = zone?.active_profile;
    return (this._data?.profiles || []).find((p) => p.id === id);
  }

  _profileOptions(profiles, selected) {
    return [
      `<option value="__auto__" ${selected === "__auto__" ? "selected" : ""}>Auto (pianificazione)</option>`,
      ...profiles.map((p) => `<option value="${esc(p.id)}" ${selected === p.id ? "selected" : ""}>${esc(p.name)}</option>`),
    ].join("");
  }

  _weeklyBlock(zone, profiles, disabled) {
    if (!this._config.show_weekly || zone?.pinned) return "";
    const schedule = this._data?.weekly_schedules?.[zone.id] || {};
    const rows = DAY_KEYS.map((day) => {
      const value = schedule[day] || "";
      return `<label class="weekly-day"><span>${DAY_LABELS[day]}</span><select data-action="weekly" data-day="${day}" data-zone="${esc(zone.id)}" ${disabled ? "disabled" : ""}>${this._profileOptions(profiles, value || "__auto__")}</select></label>`;
    }).join("");
    return `<details class="weekly" open><summary>Pianificazione settimanale (modalità automatica)</summary><div class="weekly-grid">${rows}</div></details>`;
  }

  _render() {
    if (!this.shadowRoot) return;
    const zone = this._zone();
    const cfg = this._config;
    const disabled = !this._data || !zone || !zone.enabled;
    const profiles = this._data?.profiles || [];
    const pinId = zone ? this._data?.pinned_profiles?.[zone.id] : null;
    const profileValue = pinId || "__auto__";
    const profileOptions = this._profileOptions(profiles, profileValue);
    const modeLabel = zone?.pinned ? "Manuale" : "Automatico";
    const body = !this._data ? `<div class="empty">${this._error ? esc(this._error) : "Caricamento…"}</div>` : !zone ? `<div class="empty">Scegli il termostato con la matita</div>` : `
      <div class="head">
        <div>
          <div class="title">${esc(cfg.title || zone.name || "Termostato")}</div>
          <div class="mode">${esc(modeLabel)} · ${zone.enabled ? "Controllo attivo" : "Controllo disattivato"}</div>
        </div>
        <button class="icon-btn" data-action="settings" title="Impostazioni">⚙️</button>
      </div>
      ${cfg.show_graph !== false ? renderChart(zone, this._profile(zone), this._data, { show_target: true, show_current: true, height: 180 }) : ""}
      <div class="controls">
        ${cfg.show_slider ? `
        <div class="slider-row">
          <button data-action="down" ${disabled ? "disabled" : ""}>−</button>
          <input type="range" min="${zone.min_temp}" max="${zone.max_temp}" step="0.5" value="${zone.target_temperature || 20}" data-action="slider" ${disabled ? "disabled" : ""}>
          <button data-action="up" ${disabled ? "disabled" : ""}>+</button>
        </div>
        <div class="temp-display">${formatTemp(zone.current_temperature)} <span class="target">→ ${formatTemp(zone.target_temperature)}</span></div>
        ` : ""}
        ${cfg.show_profile ? `<select data-action="profile" data-zone="${esc(zone.id)}" ${disabled ? "disabled" : ""}>${profileOptions}</select>` : ""}
        ${cfg.show_bypass ? `
        <div class="bypass-row">
          <button data-action="bypass" data-zone="${esc(zone.id)}" ${disabled ? "disabled" : ""}>Bypass ${cfg.bypass_minutes}m</button>
          ${zone.bypass_active ? `<button class="danger" data-action="stop-bypass" data-zone="${esc(zone.id)}">Ferma</button>` : ""}
        </div>
        ` : ""}
        ${cfg.show_enable ? `<button class="toggle ${zone.enabled ? "active" : ""}" data-action="enable" data-zone="${esc(zone.id)}">${zone.enabled ? "Disattiva controllo" : "Attiva controllo"}</button>` : ""}
        ${this._weeklyBlock(zone, profiles, disabled)}
      </div>
      ${cfg.show_status ? `<div class="meta"><span>Profilo: ${esc(zone.active_profile_name || "--")}</span>${zone.bypass_active ? `<span>Bypass: ${formatRemaining(zone.bypass_remaining)}</span>` : ""}</div>` : ""}
    `;
    this.shadowRoot.innerHTML = `<style>
      :host{display:block}
      .card{background:var(--ha-card-background,var(--card-background-color,#fff));color:var(--primary-text-color);border-radius:var(--ha-card-border-radius,12px);border:var(--ha-card-border-width,1px) solid var(--ha-card-border-color,var(--divider-color,transparent));box-shadow:var(--ha-card-box-shadow,none);padding:16px}
      .head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
      .title{font-weight:600;font-size:1.05rem}
      .mode{font-size:0.8rem;color:var(--secondary-text-color);margin-top:2px}
      .weekly{margin-top:8px;border-top:1px solid var(--divider-color);padding-top:8px}
      .weekly summary{cursor:pointer;font-weight:500;margin-bottom:8px}
      .weekly-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
      .weekly-day{display:grid;gap:4px;font-size:0.8rem}
      .weekly-day select{font-size:0.85rem}
      .icon-btn{background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--primary-text-color)}
      .controls{display:grid;gap:8px;margin:12px 0}
      .slider-row{display:flex;align-items:center;gap:8px}
      .slider-row button{width:36px;height:36px;border-radius:6px;border:1px solid var(--divider-color);background:var(--card-background-color,#fff);font-size:1.2rem;cursor:pointer}
      .slider-row button:disabled{opacity:0.4;cursor:not-allowed}
      .slider-row input[type=range]{flex:1}
      .temp-display{text-align:center;font-size:1.5rem;margin:8px 0}.target{font-size:1rem;color:var(--secondary-text-color)}
      select,button.toggle{width:100%;padding:8px;border-radius:6px;border:1px solid var(--divider-color);background:var(--card-background-color,#fff);font-size:1rem}
      button.toggle.active{background:var(--primary-color);color:#fff;border-color:var(--primary-color)}
      .bypass-row{display:flex;gap:8px}
      .bypass-row button{flex:1;padding:8px;border-radius:6px;border:1px solid var(--divider-color);background:var(--card-background-color,#fff);cursor:pointer}
      .bypass-row button.danger{background:var(--error-color,#f44336);color:#fff;border:none}
      .meta{display:flex;gap:12px;font-size:0.8rem;color:var(--secondary-text-color);margin-top:8px;flex-wrap:wrap}
      .empty{color:var(--secondary-text-color);padding:12px 0;text-align:center}
      .toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#fff;padding:8px 16px;border-radius:8px;opacity:0;pointer-events:none;transition:opacity .3s}.toast.show{opacity:1}.toast.error{background:rgba(244,67,54,0.9)}
    </style><div class="card">${body}<div id="toast" class="toast"></div></div>`;
  }

  _onClick(e) {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "settings") { this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: this._zone()?.climate_entity }, bubbles: true, composed: true })); return; }
    if (action === "up" || action === "down") {
      const slider = this.shadowRoot.querySelector("input[type=range]");
      if (!slider) return;
      const step = parseFloat(slider.step || "0.5");
      let val = parseFloat(slider.value);
      val += action === "up" ? step : -step;
      slider.value = val;
      slider.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (action === "slider") {
      const zone = this._zone();
      if (!zone) return;
      this._call({ type: `${DOMAIN}/bypass/start`, zones: [zone.id], temperature: parseFloat(btn.closest(".slider-row").querySelector("input").value), duration: this._config.bypass_minutes }, "Temperatura impostata");
      return;
    }
    if (action === "profile") {
      const select = e.target;
      this._call({ type: `${DOMAIN}/set_profile`, profile: select.value, zones: [select.dataset.zone] }, "Profilo impostato");
      return;
    }
    if (action === "bypass") {
      this._call({ type: `${DOMAIN}/bypass/start`, zones: [btn.dataset.zone], duration: this._config.bypass_minutes }, "Bypass avviato");
      return;
    }
    if (action === "stop-bypass") {
      this._call({ type: `${DOMAIN}/bypass/stop`, zones: [btn.dataset.zone] }, "Bypass fermato");
      return;
    }
    if (action === "enable") {
      const zone = this._zone();
      if (!zone) return;
      this._call({ type: `${DOMAIN}/set_enabled`, enabled: !zone.enabled, zones: [zone.id] }, "Stato aggiornato");
      return;
    }
  }

  _onChange(e) {
    const t = e.target;
    if (t.matches("select[data-action='profile']")) {
      this._call({ type: `${DOMAIN}/set_profile`, profile: t.value, zones: [t.dataset.zone] }, "Profilo impostato");
      return;
    }
    if (t.matches("select[data-action='weekly']")) {
      const zone = this._zone();
      if (!zone) return;
      const schedule = { ...(this._data?.weekly_schedules?.[zone.id] || {}) };
      if (t.value === "__auto__") delete schedule[t.dataset.day];
      else schedule[t.dataset.day] = t.value;
      this._call({ type: `${DOMAIN}/weekly/set`, zone_id: zone.id, schedule }, "Pianificazione aggiornata");
    }
  }

  _onInput(e) {
    // No-op for now
  }
}

class HaThermoCardEditor extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "open" }); this._config = {}; this._zones = []; this._loaded = false; }
  set hass(h) { this._hass = h; if (!this._loaded) { this._loaded = true; this._loadZones(); } }
  setConfig(config) { this._config = { title: "Termostato", show_graph: false, show_slider: true, show_profile: true, show_weekly: true, show_bypass: true, show_enable: true, show_status: true, bypass_minutes: 60, hold_minutes: 60, ...config }; this._render(); }
  async _loadZones() { if (!this._hass) return; try { const d = await callWS(this._hass, { type: `${DOMAIN}/get_config` }); this._zones = d?.zones || []; } catch (e) {} this._render(); }
  _render() {
    const allOpt = '<option value="all">Tutte le zone</option>', zoneOpts = getZoneOptions(this._zones, false);
    this.shadowRoot.innerHTML = `<style>.form{display:grid;gap:12px;padding:8px 0}label{display:grid;gap:4px;font-size:0.9rem}input,select{padding:6px;border-radius:6px;border:1px solid var(--divider-color)}</style><div class="form">
      <label>Titolo<input type="text" data-field="title" value="${esc(this._config.title || "")}"></label>
      <label>Zona<select data-field="zone">${allOpt}${zoneOpts}</select></label>
      <label class="row"><input type="checkbox" data-field="show_graph" ${this._config.show_graph !== false ? "checked" : ""}>Mostra grafico</label>
      <label class="row"><input type="checkbox" data-field="show_slider" ${this._config.show_slider !== false ? "checked" : ""}>Mostra slider</label>
      <label class="row"><input type="checkbox" data-field="show_profile" ${this._config.show_profile !== false ? "checked" : ""}>Mostra profilo</label>
      <label class="row"><input type="checkbox" data-field="show_weekly" ${this._config.show_weekly !== false ? "checked" : ""}>Mostra pianificazione settimanale</label>
      <label class="row"><input type="checkbox" data-field="show_bypass" ${this._config.show_bypass !== false ? "checked" : ""}>Mostra bypass</label>
      <label class="row"><input type="checkbox" data-field="show_enable" ${this._config.show_enable !== false ? "checked" : ""}>Mostra enable</label>
      <label class="row"><input type="checkbox" data-field="show_status" ${this._config.show_status !== false ? "checked" : ""}>Mostra stato</label>
      <label>Minuti bypass<input type="number" data-field="bypass_minutes" value="${esc(this._config.bypass_minutes || 60)}"></label>
      <label>Minuti hold<input type="number" data-field="hold_minutes" value="${esc(this._config.hold_minutes || 60)}"></label>
    </div>`;
    this.shadowRoot.querySelectorAll("input,select").forEach(el => el.addEventListener("change", () => this._changed()));
  }
  _changed() {
    const get = (f) => this.shadowRoot.querySelector(`[data-field="${f}"]`);
    const isCheckbox = (k) => ["show_graph", "show_slider", "show_profile", "show_weekly", "show_bypass", "show_enable", "show_status"].includes(k);
    const config = { ...this._config, title: get("title")?.value, zone: get("zone")?.value };
    ["show_graph", "show_slider", "show_profile", "show_weekly", "show_bypass", "show_enable", "show_status"].forEach(k => { if (isCheckbox(k)) config[k] = get(k)?.checked; });
    ["bypass_minutes", "hold_minutes"].forEach(k => { const v = Number(get(k)?.value); if (v > 0) config[k] = v; });
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }
}

if (!customElements.get("ha-thermo-card")) customElements.define("ha-thermo-card", HaThermoCard);
if (!customElements.get("ha-thermo-card-editor")) customElements.define("ha-thermo-card-editor", HaThermoCardEditor);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "ha-thermo-card")) {
  window.customCards.push({
    type: "ha-thermo-card",
    name: "HA Thermo",
    description: "Controllo termostato, profili, bypass e pianificazione settimanale.",
    preview: true,
    documentationURL: "https://github.com/marcopiccinni/ha_thermo",
  });
}
