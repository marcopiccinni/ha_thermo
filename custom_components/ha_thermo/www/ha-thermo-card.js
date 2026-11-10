import {
  DOMAIN,
  EVENT_TYPES,
  esc,
  formatTemp,
  formatRemaining,
  findZone,
  getZoneOptions,
  renderChart,
  callWS,
  newProfileDraft,
  flattenProfileZoneTemperature,
  profileZoneTemperature,
  slugProfileId,
} from "./ha-thermo-common.js?v=0.3.4";

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
    this._editingProfile = null;
    this._profileDraft = null;
    this._profilesOpen = false;
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
      title: "Termostati",
      show_graph: false,
      show_slider: true,
      show_profile: true,
      show_profiles_manager: true,
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
    return this._profilesOpen || this._editingProfile ? 10 : 6;
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
      .then((res) => {
        if (okText) this._toast(okText);
        if (msg.type?.includes("profile/") && res?.affected_zones?.length) {
          this._toast(`Profilo rimosso: ripristinato su ${res.fallback_profile}`, false);
        }
        return this._load();
      })
      .catch((e) => {
        this._toast(this._friendlyError(e), true);
        throw e;
      });
  }

  _friendlyError(err) {
    const code = err?.message || String(err);
    const map = {
      profile_default_protected: "I profili predefiniti non si possono eliminare",
      profile_last_one: "Deve restare almeno un profilo",
      unknown_profile: "Profilo sconosciuto",
      profile_exists: "Esiste già un profilo con questo id",
    };
    return map[code] || code;
  }

  _toast(txt, err = false) {
    const el = this.shadowRoot.getElementById("toast");
    if (!el) return;
    el.textContent = txt;
    el.classList.toggle("error", err);
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 3500);
  }

  _zone() {
    return findZone(this._data, this._config.zone);
  }

  _profile(zone) {
    const id = zone?.active_profile;
    return (this._data?.profiles || []).find((p) => p.id === id);
  }

  _selectedProfileId(zone) {
    if (!zone || !this._data) return "";
    const pinned = this._data.pinned_profiles?.[zone.id];
    if (pinned) return pinned;
    return this._data.active_profiles?.[zone.id] || zone.active_profile || "";
  }

  _profileOptions(profiles, selected) {
    return profiles
      .map((p) => `<option value="${esc(p.id)}" ${selected === p.id ? "selected" : ""}>${esc(p.name)}</option>`)
      .join("");
  }

  _profileManagerBlock(profiles, zone) {
    if (this._config.show_profiles_manager === false) return "";
    const rows = profiles
      .map((p) => {
        const assigned =
          zone &&
          (this._data?.active_profiles?.[zone.id] === p.id ||
            this._data?.pinned_profiles?.[zone.id] === p.id);
        return `<div class="profile-row">
          <span class="profile-name">${esc(p.name)}${assigned ? ' <span class="tag">in uso</span>' : ""}</span>
          <div class="profile-actions">
            <button type="button" data-action="profile-edit" data-id="${esc(p.id)}">Modifica</button>
            <button type="button" data-action="profile-clone" data-id="${esc(p.id)}" data-name="${esc(p.name)}">Duplica</button>
            <button type="button" data-action="profile-delete" data-id="${esc(p.id)}" data-name="${esc(p.name)}">Elimina</button>
          </div>
        </div>`;
      })
      .join("");
  return `<details class="profiles" ${this._profilesOpen ? "open" : ""}>
      <summary>Gestione profili (condivisi)</summary>
      <p class="hint">I profili sono globali: le modifiche compaiono in tutte le card e dashboard.</p>
      <button type="button" class="secondary" data-action="profile-new">+ Nuovo profilo</button>
      <div class="profile-list">${rows || '<div class="empty">Nessun profilo</div>'}</div>
      ${this._profileEditorBlock(zone)}
    </details>`;
  }

  _profileEditorBlock(zone) {
    if (!this._editingProfile) return "";
    const draft = this._profileDraft || {};
    const zoneId = zone?.id;
    const temp = zoneId ? profileZoneTemperature(draft, zoneId, zone.default_temp ?? 20) : 20;
    const title = this._editingProfile === "__new__" ? "Nuovo profilo" : `Modifica: ${esc(draft.name || "")}`;
    return `<div class="editor">
      <div class="editor-title">${title}</div>
      <label>Nome<input type="text" data-field="p-name" value="${esc(draft.name || "")}"></label>
      ${zoneId ? `<label>Temperatura zona (${esc(zone.name)})<input type="number" step="0.5" data-field="p-temp" value="${esc(temp)}"></label>` : ""}
      <p class="hint">La temperatura imposta la curva oraria costante per questa zona (tutti i giorni). Curve avanzate: import/export JSON via servizi.</p>
      <div class="editor-actions">
        <button type="button" data-action="profile-save">Salva</button>
        <button type="button" data-action="profile-cancel">Annulla</button>
      </div>
    </div>`;
  }

  _render() {
    if (!this.shadowRoot) return;
    const zone = this._zone();
    const cfg = this._config;
    const disabled = !this._data || !zone || !zone.enabled;
    const profiles = this._data?.profiles || [];
    const selected = this._selectedProfileId(zone);
    const profileOptions = this._profileOptions(profiles, selected);
    const manual = Boolean(zone?.pinned);
    const modeLabel = manual ? "Manuale (override profilo)" : "Automatico (segue profilo)";
    const body = !this._data
      ? `<div class="empty">${this._error ? esc(this._error) : "Caricamento…"}</div>`
      : !zone
        ? `<div class="empty">Scegli il termostato con la matita</div>`
        : `
      <div class="head">
        <div>
          <div class="title">${esc(cfg.title || zone.name || "Termostato")}</div>
          <div class="mode">${esc(modeLabel)} · ${zone.enabled ? "Controllo attivo" : "Controllo disattivato"}</div>
        </div>
        <button type="button" class="icon-btn" data-action="settings" title="Impostazioni">⚙️</button>
      </div>
      ${cfg.show_graph !== false ? renderChart(zone, this._profile(zone), this._data, { show_target: true, show_current: true, height: 180 }) : ""}
      <div class="controls">
        ${cfg.show_slider ? `
        <div class="slider-row">
          <button type="button" data-action="down" ${disabled ? "disabled" : ""}>−</button>
          <input type="range" min="${zone.min_temp}" max="${zone.max_temp}" step="0.5" value="${zone.target_temperature || 20}" data-action="slider" ${disabled ? "disabled" : ""}>
          <button type="button" data-action="up" ${disabled ? "disabled" : ""}>+</button>
        </div>
        <div class="temp-display">${formatTemp(zone.current_temperature)} <span class="target">→ ${formatTemp(zone.target_temperature)}</span></div>
        ` : ""}
        <div class="mode-row">
          <button type="button" class="toggle ${manual ? "" : "active"}" data-action="mode-auto" ${disabled ? "disabled" : ""}>Automatico</button>
          <button type="button" class="toggle ${manual ? "active" : ""}" data-action="mode-manual" ${disabled ? "disabled" : ""}>Manuale</button>
        </div>
        ${cfg.show_profile !== false ? `<label class="select-label">Profilo<select data-action="zone-profile" data-zone="${esc(zone.id)}" ${disabled ? "disabled" : ""}>${profileOptions}</select></label>` : ""}
        ${cfg.show_bypass ? `
        <div class="bypass-row">
          <button type="button" data-action="bypass" data-zone="${esc(zone.id)}" ${disabled ? "disabled" : ""}>Bypass ${cfg.bypass_minutes}m</button>
          ${zone.bypass_active ? `<button type="button" class="danger" data-action="stop-bypass" data-zone="${esc(zone.id)}">Ferma</button>` : ""}
        </div>
        ` : ""}
        ${cfg.show_enable ? `<button type="button" class="toggle ${zone.enabled ? "active" : ""}" data-action="enable" data-zone="${esc(zone.id)}">${zone.enabled ? "Disattiva controllo" : "Attiva controllo"}</button>` : ""}
        ${this._profileManagerBlock(profiles, zone)}
      </div>
      ${cfg.show_status !== false ? `<div class="meta"><span>Profilo attivo: ${esc(zone.active_profile_name || "--")}</span>${zone.bypass_active ? `<span>Bypass: ${formatRemaining(zone.bypass_remaining)}</span>` : ""}</div>` : ""}
    `;
    this.shadowRoot.innerHTML = `<style>
      :host{display:block}
      .card{background:var(--ha-card-background,var(--card-background-color,#fff));color:var(--primary-text-color);border-radius:var(--ha-card-border-radius,12px);border:var(--ha-card-border-width,1px) solid var(--ha-card-border-color,var(--divider-color,transparent));box-shadow:var(--ha-card-box-shadow,none);padding:16px}
      .head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;gap:8px}
      .title{font-weight:600;font-size:1.05rem}
      .mode{font-size:0.8rem;color:var(--secondary-text-color);margin-top:2px}
      .icon-btn{background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--primary-text-color)}
      .controls{display:grid;gap:8px;margin:12px 0}
      .slider-row{display:flex;align-items:center;gap:8px}
      .slider-row button{width:36px;height:36px;border-radius:6px;border:1px solid var(--divider-color);background:var(--card-background-color,#fff);font-size:1.2rem;cursor:pointer}
      .slider-row button:disabled{opacity:0.4;cursor:not-allowed}
      .slider-row input[type=range]{flex:1}
      .temp-display{text-align:center;font-size:1.5rem;margin:8px 0}.target{font-size:1rem;color:var(--secondary-text-color)}
      .mode-row{display:flex;gap:8px}
      .select-label{display:grid;gap:4px;font-size:0.9rem}
      select,button.toggle,button.secondary{width:100%;padding:8px;border-radius:6px;border:1px solid var(--divider-color);background:var(--card-background-color,#fff);font-size:1rem;cursor:pointer}
      button.toggle.active,button.secondary{background:var(--primary-color);color:var(--text-primary-color,#fff);border-color:var(--primary-color)}
      .bypass-row{display:flex;gap:8px}
      .bypass-row button{flex:1;padding:8px;border-radius:6px;border:1px solid var(--divider-color);background:var(--card-background-color,#fff);cursor:pointer}
      .bypass-row button.danger{background:var(--error-color,#f44336);color:#fff;border:none}
      .profiles{margin-top:8px;border-top:1px solid var(--divider-color);padding-top:8px}
      .profiles summary{cursor:pointer;font-weight:500}
      .hint{font-size:0.75rem;color:var(--secondary-text-color);margin:6px 0}
      .profile-list{display:grid;gap:6px;margin:8px 0}
      .profile-row{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:0.85rem;border:1px solid var(--divider-color);border-radius:8px;padding:6px 8px}
      .profile-actions{display:flex;gap:4px;flex-wrap:wrap}
      .profile-actions button{width:auto;padding:4px 8px;font-size:0.75rem}
      .tag{font-size:0.7rem;color:var(--primary-color)}
      .editor{margin-top:10px;padding:10px;border:1px dashed var(--divider-color);border-radius:8px;display:grid;gap:8px}
      .editor-title{font-weight:600}
      .editor label{display:grid;gap:4px;font-size:0.85rem}
      .editor input{padding:6px;border-radius:6px;border:1px solid var(--divider-color)}
      .editor-actions{display:flex;gap:8px}
      .editor-actions button{flex:1}
      .meta{display:flex;gap:12px;font-size:0.8rem;color:var(--secondary-text-color);margin-top:8px;flex-wrap:wrap}
      .empty{color:var(--secondary-text-color);padding:12px 0;text-align:center}
      .toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:8px 16px;border-radius:8px;opacity:0;pointer-events:none;transition:opacity .3s;z-index:10;max-width:90vw}.toast.show{opacity:1}.toast.error{background:rgba(244,67,54,0.92)}
    </style><div class="card">${body}<div id="toast" class="toast"></div></div>`;
    const details = this.shadowRoot.querySelector("details.profiles");
    if (details) {
      details.addEventListener("toggle", () => {
        this._profilesOpen = details.open;
      });
    }
  }

  _onClick(e) {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const zone = this._zone();

    if (action === "settings") {
      this.dispatchEvent(
        new CustomEvent("hass-more-info", {
          detail: { entityId: zone?.climate_entity },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }
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
    if (action === "bypass") {
      this._call(
        { type: `${DOMAIN}/bypass/start`, zones: [btn.dataset.zone], duration: this._config.bypass_minutes },
        "Bypass avviato",
      );
      return;
    }
    if (action === "stop-bypass") {
      this._call({ type: `${DOMAIN}/bypass/stop`, zones: [btn.dataset.zone] }, "Bypass fermato");
      return;
    }
    if (action === "enable") {
      if (!zone) return;
      this._call(
        { type: `${DOMAIN}/set_enabled`, enabled: !zone.enabled, zones: [zone.id] },
        "Stato aggiornato",
      );
      return;
    }
    if (action === "mode-auto") {
      if (!zone) return;
      this._call({ type: `${DOMAIN}/set_profile`, profile: "__auto__", zones: [zone.id] }, "Modalità automatica");
      return;
    }
    if (action === "mode-manual") {
      if (!zone) return;
      const profileId = this._selectedProfileId(zone) || this._data?.active_profiles?.[zone.id];
      if (!profileId) {
        this._toast("Seleziona prima un profilo", true);
        return;
      }
      this._call({ type: `${DOMAIN}/set_profile`, profile: profileId, zones: [zone.id] }, "Modalità manuale");
      return;
    }
    if (action === "profile-new") {
      this._profilesOpen = true;
      this._editingProfile = "__new__";
      const z = this._zone();
      this._profileDraft = newProfileDraft("Nuovo profilo", z?.id || "zone", z?.default_temp ?? 20);
      this._render();
      return;
    }
    if (action === "profile-edit") {
      const profile = (this._data?.profiles || []).find((p) => p.id === btn.dataset.id);
      if (!profile) return;
      this._profilesOpen = true;
      this._editingProfile = profile.id;
      this._profileDraft = JSON.parse(JSON.stringify(profile));
      this._render();
      return;
    }
    if (action === "profile-clone") {
      const name = `${btn.dataset.name || "Profilo"} (copia)`;
      this._call(
        {
          type: `${DOMAIN}/profile/clone`,
          source_id: btn.dataset.id,
          name,
          zones: zone ? [zone.id] : [],
        },
        "Profilo duplicato",
      );
      return;
    }
    if (action === "profile-delete") {
      const name = btn.dataset.name || btn.dataset.id;
      if (!window.confirm(`Eliminare il profilo "${name}"? I termostati che lo usano passeranno a un profilo predefinito.`)) return;
      this._call({ type: `${DOMAIN}/profile/delete`, profile_id: btn.dataset.id });
      return;
    }
    if (action === "profile-cancel") {
      this._editingProfile = null;
      this._profileDraft = null;
      this._render();
      return;
    }
    if (action === "profile-save") {
      this._saveProfileDraft();
      return;
    }
  }

  _saveProfileDraft() {
    const zone = this._zone();
    const nameInput = this.shadowRoot.querySelector('[data-field="p-name"]');
    const tempInput = this.shadowRoot.querySelector('[data-field="p-temp"]');
    const name = (nameInput?.value || "").trim() || "Profilo";
    let draft = JSON.parse(JSON.stringify(this._profileDraft || {}));
    draft.name = name;
    if (this._editingProfile === "__new__") {
      draft.id = slugProfileId(name);
    }
    if (zone && tempInput) {
      draft = flattenProfileZoneTemperature(draft, zone.id, Number(tempInput.value));
    }
    const isNew = this._editingProfile === "__new__";
    const msg = isNew
      ? { type: `${DOMAIN}/profile/create`, profile: draft }
      : { type: `${DOMAIN}/profile/update`, profile: draft };
    this._call(msg, isNew ? "Profilo creato" : "Profilo aggiornato").then(() => {
      this._editingProfile = null;
      this._profileDraft = null;
    });
  }

  _onChange(e) {
    const t = e.target;
    if (t.matches("input[type=range][data-action='slider']")) {
      const zone = this._zone();
      if (!zone) return;
      this._call(
        {
          type: `${DOMAIN}/bypass/start`,
          zones: [zone.id],
          temperature: parseFloat(t.value),
          duration: this._config.bypass_minutes,
        },
        "Temperatura impostata",
      );
      return;
    }
    if (t.matches("select[data-action='zone-profile']")) {
      const zoneId = t.dataset.zone;
      const profileId = t.value;
      const pinned = Boolean(this._data?.pinned_profiles?.[zoneId]);
      if (pinned) {
        this._call({ type: `${DOMAIN}/set_profile`, profile: profileId, zones: [zoneId] }, "Profilo bloccato (manuale)");
      } else {
        this._call({ type: `${DOMAIN}/profile/assign`, profile: profileId, zones: [zoneId] }, "Profilo assegnato");
      }
    }
  }
}

class HaThermoCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
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
    this._config = {
      title: "Termostato",
      show_graph: false,
      show_slider: true,
      show_profile: true,
      show_profiles_manager: true,
      show_bypass: true,
      show_enable: true,
      show_status: true,
      bypass_minutes: 60,
      hold_minutes: 60,
      ...config,
    };
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
    const allOpt = '<option value="all">Tutte le zone</option>',
      zoneOpts = getZoneOptions(this._zones, false);
    this.shadowRoot.innerHTML = `<style>.form{display:grid;gap:12px;padding:8px 0}label{display:grid;gap:4px;font-size:0.9rem}input,select{padding:6px;border-radius:6px;border:1px solid var(--divider-color)}</style><div class="form">
      <label>Titolo<input type="text" data-field="title" value="${esc(this._config.title || "")}"></label>
      <label>Zona<select data-field="zone">${allOpt}${zoneOpts}</select></label>
      <label class="row"><input type="checkbox" data-field="show_graph" ${this._config.show_graph !== false ? "checked" : ""}>Mostra grafico</label>
      <label class="row"><input type="checkbox" data-field="show_slider" ${this._config.show_slider !== false ? "checked" : ""}>Mostra slider</label>
      <label class="row"><input type="checkbox" data-field="show_profile" ${this._config.show_profile !== false ? "checked" : ""}>Mostra selezione profilo</label>
      <label class="row"><input type="checkbox" data-field="show_profiles_manager" ${this._config.show_profiles_manager !== false ? "checked" : ""}>Mostra gestione profili</label>
      <label class="row"><input type="checkbox" data-field="show_bypass" ${this._config.show_bypass !== false ? "checked" : ""}>Mostra bypass</label>
      <label class="row"><input type="checkbox" data-field="show_enable" ${this._config.show_enable !== false ? "checked" : ""}>Mostra enable</label>
      <label class="row"><input type="checkbox" data-field="show_status" ${this._config.show_status !== false ? "checked" : ""}>Mostra stato</label>
      <label>Minuti bypass<input type="number" data-field="bypass_minutes" value="${esc(this._config.bypass_minutes || 60)}"></label>
      <label>Minuti hold<input type="number" data-field="hold_minutes" value="${esc(this._config.hold_minutes || 60)}"></label>
    </div>`;
    this.shadowRoot.querySelectorAll("input,select").forEach((el) => el.addEventListener("change", () => this._changed()));
  }
  _changed() {
    const get = (f) => this.shadowRoot.querySelector(`[data-field="${f}"]`);
    const checks = ["show_graph", "show_slider", "show_profile", "show_profiles_manager", "show_bypass", "show_enable", "show_status"];
    const config = { ...this._config, title: get("title")?.value, zone: get("zone")?.value };
    checks.forEach((k) => {
      config[k] = get(k)?.checked;
    });
    ["bypass_minutes", "hold_minutes"].forEach((k) => {
      const v = Number(get(k)?.value);
      if (v > 0) config[k] = v;
    });
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
    description: "Controllo termostato, profili condivisi, bypass e modalità auto/manuale.",
    preview: true,
    documentationURL: "https://github.com/marcopiccinni/ha_thermo",
  });
}
