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
  renderChart,
  callWS,
  todayKey,
} from "./ha-thermo-common.js?v=0.3.8";

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
    this._weeklyOpen = false;
    this._prevHvacMode = null;
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
      show_slider: true,
      show_weekly: true,
      show_status: true,
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

  _activeProfile(zone) {
    const id = zone?.active_profile;
    return (this._data?.profiles || []).find((p) => p.id === id);
  }

  _climateIsOff(entityId) {
    const st = this._hass?.states?.[entityId];
    if (!st) return true;
    const mode = st.attributes?.hvac_mode ?? st.state;
    return mode === "off" || st.state === "off";
  }

  _weeklyBlock(zone, profiles, disabled) {
    if (this._config.show_weekly === false || !zone || !this._weeklyOpen) return "";
  if (zone.pinned) return "";
    const schedule = this._data?.weekly_profiles?.[zone.id] || {};
    const rows = WEEK_DAYS.map((day) => {
      const value = schedule[day] || "";
      return `<label class="weekly-day"><span>${DAY_LABELS[day]}</span><select data-action="weekly" data-day="${day}" data-zone="${esc(zone.id)}" ${disabled ? "disabled" : ""}>${profileOptions(profiles, value)}</select></label>`;
    }).join("");
    return `<div class="weekly-panel"><div class="weekly-title">Settimana</div><div class="weekly-grid">${rows}</div></div>`;
  }

  _tempBlock(zone, cfg, disabled, manual) {
    if (manual && cfg.show_slider !== false) {
      return `
        <div class="slider-row">
          <button type="button" data-action="down" ${disabled ? "disabled" : ""}>−</button>
          <input type="range" min="${zone.min_temp}" max="${zone.max_temp}" step="0.5" value="${zone.target_temperature || 20}" data-action="slider" ${disabled ? "disabled" : ""}>
          <button type="button" data-action="up" ${disabled ? "disabled" : ""}>+</button>
        </div>
        <div class="temp-display">${formatTemp(zone.current_temperature)} <span class="target">→ ${formatTemp(zone.target_temperature)}</span></div>`;
    }
    return `
        <div class="temp-readonly">
          <span class="ambient">${formatTemp(zone.current_temperature)}</span>
          <span class="sep">·</span>
          <span class="setpoint">${formatTemp(zone.target_temperature)} setpoint</span>
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

    const climateOff = zone ? this._climateIsOff(zone.climate_entity) : true;
    const weeklyEdit = cfg.show_weekly !== false && zone && !manual;
    const body = !this._data
      ? `<div class="empty">${this._error ? esc(this._error) : "Caricamento…"}</div>`
      : !zone
        ? `<div class="empty">Scegli il termostato (matita)</div>`
        : `
      <div class="head">
        <div>
          <div class="title">${esc(cfg.title || zone.name)}</div>
          <div class="sub">${manual ? "Manuale" : "Automatico"} · Oggi: ${esc(todayName || "--")}</div>
        </div>
        <div class="head-actions">
          ${weeklyEdit ? `<button type="button" class="icon-btn${this._weeklyOpen ? " active" : ""}" data-action="edit-weekly" title="Settimana"><ha-icon icon="mdi:pencil"></ha-icon></button>` : ""}
          <button type="button" class="icon-btn" data-action="settings" title="Termostato"><ha-icon icon="mdi:cog"></ha-icon></button>
        </div>
      </div>
      ${cfg.show_graph !== false ? renderChart(zone, this._activeProfile(zone), this._data) : ""}
      <div class="controls">
        ${this._tempBlock(zone, cfg, disabled, manual)}
        <div class="mode-row">
          <button type="button" class="toggle ${manual ? "" : "active"}" data-action="mode-auto">Automatico</button>
          <button type="button" class="toggle ${manual ? "active" : ""}" data-action="mode-manual">Manuale</button>
          <button type="button" class="toggle power ${climateOff ? "" : "active"}" data-action="power" title="${climateOff ? "Accendi" : "Spegni"}">${climateOff ? "Off" : "On"}</button>
        </div>
        ${this._weeklyBlock(zone, profiles, disabled)}
      </div>
      ${cfg.show_status !== false ? `<div class="meta">Profilo attivo: ${esc(zone.active_profile_name || "--")}</div>` : ""}`;

    this.shadowRoot.innerHTML = `<style>
      :host{display:block}
      .card{background:var(--ha-card-background,var(--card-background-color,#fff));color:var(--primary-text-color);border-radius:12px;border:1px solid var(--divider-color);padding:16px}
      .head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
      .head-actions{display:flex;gap:2px;align-items:center}
      .title{font-weight:600}
      .sub{font-size:0.8rem;color:var(--secondary-text-color)}
      .icon-btn{background:none;border:none;padding:6px;cursor:pointer;color:var(--secondary-text-color);border-radius:50%;display:inline-flex}
      .icon-btn:hover{background:rgba(var(--rgb-primary-color,3,169,244),0.12)}
      .icon-btn.active{color:var(--primary-color);background:rgba(var(--rgb-primary-color,3,169,244),0.16)}
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
      .weekly-panel{margin-top:4px;border-top:1px solid var(--divider-color);padding-top:10px}
      .weekly-title{font-weight:500;margin-bottom:6px;font-size:0.9rem}
      .weekly-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:6px;margin-top:6px}
      .weekly-day{display:grid;gap:2px;font-size:0.8rem}
      .weekly-day select{padding:4px;border-radius:6px;border:1px solid var(--divider-color)}
      .meta{font-size:0.8rem;color:var(--secondary-text-color);margin-top:8px}
      .empty{text-align:center;color:var(--secondary-text-color);padding:16px}
      .toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.85);color:#fff;padding:8px 14px;border-radius:8px;opacity:0;pointer-events:none;z-index:5}.toast.show{opacity:1}.toast.error{background:#c62828}
    </style><div class="card">${body}<div id="toast" class="toast"></div></div>`;
  }

  _onClick(e) {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const zone = this._zone();
    const action = btn.dataset.action;
    if (action === "settings" && zone) {
      this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: zone.climate_entity }, bubbles: true, composed: true }));
      return;
    }
    if (action === "edit-weekly") {
      this._weeklyOpen = !this._weeklyOpen;
      this._render();
      return;
    }
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
      this._weeklyOpen = false;
      this._call({ type: `${DOMAIN}/set_profile`, profile: "__auto__", zones: [zone.id] }, "Automatico");
      return;
    }
    if (action === "mode-manual" && zone) {
      this._weeklyOpen = false;
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
    if (!this._hass || !zone?.climate_entity) return;
    const eid = zone.climate_entity;
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
    if (t.matches("select[data-action='weekly']")) {
      const schedule = { ...(this._data?.weekly_profiles?.[t.dataset.zone] || {}) };
      schedule[t.dataset.day] = t.value;
      this._call(
        { type: `${DOMAIN}/zone/weekly/set`, zone_id: t.dataset.zone, schedule },
        "Settimana aggiornata",
      );
    }
  }
}

class HaThermoCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._zones = [];
  }
  set hass(h) {
    this._hass = h;
    if (!this._zones.length) this._loadZones();
  }
  setConfig(config) {
    this._config = { title: "Termostato", show_graph: true, show_slider: true, show_weekly: true, show_status: true, ...config };
    this._render();
  }
  async _loadZones() {
    if (!this._hass) return;
    try {
      const d = await callWS(this._hass, { type: `${DOMAIN}/get_config` });
      this._zones = d?.zones || [];
    } catch (e) {}
    this._render();
  }
  _render() {
    this.shadowRoot.innerHTML = `<style>label{display:grid;gap:4px;margin:8px 0;font-size:0.9rem}input,select{padding:6px}</style>
      <label>Titolo<input data-f="title" value="${esc(this._config.title || "")}"></label>
      <label>Zona<select data-f="zone">${getZoneOptions(this._zones, false)}</select></label>
      <label><input type="checkbox" data-f="show_graph" ${this._config.show_graph !== false ? "checked" : ""}> Mostra grafico</label>
      <label><input type="checkbox" data-f="show_slider" ${this._config.show_slider !== false ? "checked" : ""}> Mostra slider</label>
      <label><input type="checkbox" data-f="show_weekly" ${this._config.show_weekly !== false ? "checked" : ""}> Mostra settimana</label>`;
    this.shadowRoot.querySelectorAll("[data-f]").forEach((el) => el.addEventListener("change", () => this._emit()));
  }
  _emit() {
    const g = (k) => this.shadowRoot.querySelector(`[data-f="${k}"]`);
    const config = {
      ...this._config,
      title: g("title")?.value,
      zone: g("zone")?.value,
      show_graph: g("show_graph")?.checked,
      show_slider: g("show_slider")?.checked,
      show_weekly: g("show_weekly")?.checked,
    };
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
    description: "Termostato: automatico/manuale, temperatura e pianificazione settimanale profili.",
    preview: true,
    documentationURL: "https://github.com/marcopiccinni/ha_thermo",
  });
}
