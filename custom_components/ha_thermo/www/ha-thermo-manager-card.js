const DOMAIN = "ha_thermo";
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS = {
  mon: "Lun",
  tue: "Mar",
  wed: "Mer",
  thu: "Gio",
  fri: "Ven",
  sat: "Sab",
  sun: "Dom",
};
const HVAC_MODES = ["", "off", "heat", "cool", "heat_cool", "auto", "dry", "fan_only"];
const EVENT_TYPES = [
  `${DOMAIN}_profile_changed`,
  `${DOMAIN}_bypass_started`,
  `${DOMAIN}_bypass_ended`,
  `${DOMAIN}_target_changed`,
  `${DOMAIN}_manual_override`,
];

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char];
  });

const formatTemp = (value) =>
  value == null || Number.isNaN(Number(value))
    ? "--"
    : `${(Math.round(Number(value) * 10) / 10).toFixed(1)}°`;

const formatTime = (value) => {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("it-IT", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatRemaining = (seconds) => {
  if (seconds == null) return "--";
  const minutes = Math.max(0, Math.round(Number(seconds) / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
};

const blankCurve = (value) => Array.from({ length: 24 }, () => Number(value) || 20);

class HaThermoManagerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.addEventListener("click", (event) => this._onClick(event));
    this.shadowRoot.addEventListener("change", (event) => this._onChange(event));
    this.shadowRoot.addEventListener("input", (event) => this._onInput(event));
    this._config = {};
    this._data = null;
    this._error = null;
    this._tab = "zones";
    this._profileDraft = null;
    this._profileIsNew = false;
    this._editZone = null;
    this._editDay = "mon";
    this._activatorDraft = null;
    this._activatorIsNew = false;
    this._dirty = false;
    this._hass = null;
    this._unsubs = [];
    this._timer = null;
    this._started = false;
    this._toastTimer = null;
  }

  static getStubConfig() {
    return { title: "HA Thermo Manager" };
  }

  static getConfigElement() {
    return document.createElement("ha-thermo-manager-card-editor");
  }

  setConfig(config) {
    if (!config) throw new Error("Configurazione non valida");
    this._config = { title: "HA Thermo Manager", ...config };
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
    window.clearTimeout(this._toastTimer);
    this._timer = null;
    this._unsubs.forEach((unsub) => {
      try {
        unsub();
      } catch (err) {
        console.debug(err);
      }
    });
    this._unsubs = [];
  }

  getCardSize() {
    return 8;
  }

  async _subscribe() {
    for (const eventType of EVENT_TYPES) {
      try {
        const unsub = await this._hass.connection.subscribeEvents(
          () => this._load(),
          eventType,
        );
        this._unsubs.push(unsub);
      } catch (err) {
        console.debug(err);
      }
    }
  }

  async _load(force = false) {
    if (!this._hass) return;
    if (this._dirty && !force) return;
    try {
      this._data = await this._hass.callWS({ type: `${DOMAIN}/get_config` });
      this._error = null;
    } catch (err) {
      this._error = err?.message || String(err);
    }
    this._render();
  }

  async _ws(message, success) {
    if (!this._hass) return false;
    try {
      await this._hass.callWS(message);
      this._dirty = false;
      await this._load(true);
      this._toast(success || "Fatto");
      return true;
    } catch (err) {
      this._toast(err?.message || String(err), true);
      return false;
    }
  }

  _toast(text, error = false) {
    const element = this.shadowRoot.getElementById("toast");
    if (!element) return;
    element.textContent = text;
    element.classList.toggle("error", error);
    element.classList.add("show");
    window.clearTimeout(this._toastTimer);
    this._toastTimer = window.setTimeout(() => {
      element.classList.remove("show");
    }, 3200);
  }

  _zones() {
    return this._data?.zones || [];
  }

  _zone(id) {
    return this._zones().find((zone) => zone.id === id);
  }

  _zoneName(id) {
    return this._zone(id)?.name || id;
  }

  _profileName(id) {
    return (this._data?.profiles || []).find((item) => item.id === id)?.name || id;
  }

  _blankProfile() {
    const profile = {
      id: "",
      name: "Nuovo profilo",
      icon: "mdi:home-thermometer",
      hvac_mode: null,
      targets: {},
      curves: {},
      days: {},
    };
    this._ensureProfile(profile);
    return profile;
  }

  _ensureProfile(profile) {
    const zones = this._zones();
    const first = zones[0];
    this._editZone =
      this._editZone && zones.some((zone) => zone.id === this._editZone)
        ? this._editZone
        : first?.id;
    if (!this._editZone) return profile;
    for (const zone of zones) {
      const fallback =
        profile.targets?.[zone.id] ?? zone.default_temp ?? 20;
      profile.targets[zone.id] = Number(fallback);
      if (!Array.isArray(profile.days?.[zone.id])) {
        profile.days[zone.id] = [...DAYS];
      }
      profile.curves[zone.id] = profile.curves[zone.id] || {};
      for (const day of DAYS) {
        const curve = profile.curves[zone.id][day];
        if (!Array.isArray(curve) || curve.length !== 24) {
          profile.curves[zone.id][day] = blankCurve(profile.targets[zone.id]);
        }
      }
    }
    return profile;
  }

  _blankActivator() {
    return {
      id: "",
      name: "Nuovo attivatore",
      profile_id: this._data?.profiles?.[0]?.id || "",
      zones: [],
      days: [...DAYS],
      start: "06:00",
      end: null,
      priority: 0,
      enabled: true,
      condition_entity: null,
      condition_state: null,
    };
  }

  _render() {
    if (!this.shadowRoot) return;
    let content;
    if (!this._data) {
      content = `<div class="empty">${this._error ? esc(this._error) : "Caricamento…"}</div>`;
    } else if (this._tab === "profiles") {
      content = this._profileDraft ? this._renderProfileEditor() : this._renderProfiles();
    } else if (this._tab === "activators") {
      content = this._activatorDraft
        ? this._renderActivatorEditor()
        : this._renderActivators();
    } else if (this._tab === "bypasses") {
      content = this._renderBypasses();
    } else {
      content = this._renderZones();
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .card {
          background: var(--ha-card-background, var(--card-background-color, #fff));
          color: var(--primary-text-color);
          border-radius: var(--ha-card-border-radius, 12px);
          border: var(--ha-card-border-width, 1px) solid
            var(--ha-card-border-color, var(--divider-color, transparent));
          box-shadow: var(--ha-card-box-shadow, none);
          padding: 16px;
          display: grid;
          gap: 14px;
          position: relative;
        }
        .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
        .title { font-size: 1.2rem; font-weight: 600; }
        .head-actions { display: flex; align-items: center; gap: 8px; }
        .tabs { display: flex; gap: 6px; flex-wrap: wrap; border-bottom: 1px solid var(--divider-color); }
        .tabs button { border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; }
        .tabs button.active { border-bottom-color: var(--primary-color); color: var(--primary-color); font-weight: 600; }
        .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); }
        .panel {
          border: 1px solid var(--divider-color); border-radius: 10px;
          padding: 12px; display: grid; gap: 10px;
        }
        .panel-head { display: flex; justify-content: space-between; align-items: start; gap: 8px; }
        .name { font-weight: 600; }
        .muted { color: var(--secondary-text-color); font-size: 0.8rem; }
        .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; font-size: 0.85rem; }
        .stats b { font-weight: 600; }
        .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .row > * { min-width: 0; }
        .grow { flex: 1 1 120px; }
        button {
          min-height: 36px; border-radius: 8px; padding: 0 12px; cursor: pointer;
          border: 1px solid var(--divider-color);
          background: var(--secondary-background-color); color: var(--primary-text-color);
        }
        button:hover { border-color: var(--primary-color); }
        button.primary { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
        button.danger { color: var(--error-color, #c62828); }
        button.small { min-height: 30px; padding: 0 8px; font-size: 0.8rem; }
        button.active { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
        input, select, textarea {
          min-height: 36px; border-radius: 8px; padding: 6px 8px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color, #fff); color: var(--primary-text-color);
          font: inherit;
        }
        input[type="checkbox"] { min-height: auto; width: 18px; height: 18px; accent-color: var(--primary-color); }
        label.field { display: grid; gap: 4px; font-size: 0.82rem; color: var(--secondary-text-color); }
        label.field input, label.field select { width: 100%; box-sizing: border-box; }
        .form-grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
        .zone-tabs, .day-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
        .zone-tabs button, .day-tabs button { min-height: 32px; padding: 0 10px; font-size: 0.85rem; }
        .checks { display: flex; gap: 8px 14px; flex-wrap: wrap; }
        .checks label { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: var(--primary-text-color); }
        .curve { display: grid; gap: 5px; grid-template-columns: repeat(12, minmax(44px, 1fr)); }
        .curve label { display: grid; gap: 2px; font-size: 0.68rem; color: var(--secondary-text-color); text-align: center; }
        .curve input { min-height: 30px; padding: 2px 4px; text-align: center; font-size: 0.8rem; }
        .list { display: grid; gap: 8px; }
        .list-row {
          display: flex; gap: 10px; justify-content: space-between; align-items: center;
          border: 1px solid var(--divider-color); border-radius: 10px; padding: 10px;
        }
        .list-main { display: grid; gap: 2px; }
        .empty { color: var(--secondary-text-color); padding: 12px 0; }
        .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
        .section-title { font-weight: 600; font-size: 0.95rem; }
        .hint { color: var(--secondary-text-color); font-size: 0.78rem; }
        .toast {
          position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 20px);
          background: var(--primary-text-color); color: var(--card-background-color, #fff);
          padding: 10px 16px; border-radius: 999px; opacity: 0; pointer-events: none;
          transition: opacity 0.2s, transform 0.2s; z-index: 10; font-size: 0.85rem;
          max-width: 80vw;
        }
        .toast.error { background: var(--error-color, #c62828); color: #fff; }
        .toast.show { opacity: 1; transform: translate(-50%, 0); }
        @media (max-width: 520px) { .curve { grid-template-columns: repeat(6, minmax(44px, 1fr)); } }
      </style>
      <div class="card">
        <div class="head">
          <div>
            <div class="title">${esc(this._config.title)}</div>
            <div class="muted">
              ${this._data ? `v${esc(this._data.version)} · ${this._zones().length} zone · ${(this._data.profiles || []).length} profili` : ""}
            </div>
          </div>
          <div class="head-actions">
            ${
              this._data
                ? `<button class="small ${this._data.enabled ? "active" : ""}" data-action="master">
                    ${this._data.enabled ? "Controllo attivo" : "Controllo spento"}
                  </button>`
                : ""
            }
            <button class="small" data-action="refresh">Aggiorna</button>
          </div>
        </div>
        <div class="tabs">
          ${this._tabButton("zones", "Zone")}
          ${this._tabButton("profiles", "Profili")}
          ${this._tabButton("activators", "Attivatori")}
          ${this._tabButton("bypasses", "Bypass")}
        </div>
        ${content}
        <div id="toast" class="toast"></div>
      </div>`;
  }

  _tabButton(tab, label) {
    return `<button class="${this._tab === tab ? "active" : ""}" data-action="tab" data-tab="${tab}">${label}</button>`;
  }

  _renderZones() {
    if (!this._zones().length) {
      return `<div class="empty">Nessuna zona. Aggiungile dalle opzioni dell'integrazione.</div>`;
    }
    return `<div class="grid">${this._zones()
      .map((zone) => {
        const profileOptions = [
          `<option value="__auto__" ${!zone.pinned ? "selected" : ""}>Auto (attivatori)</option>`,
          ...(this._data.profiles || []).map(
            (profile) =>
              `<option value="${esc(profile.id)}" ${
                zone.pinned && zone.active_profile === profile.id ? "selected" : ""
              }>${esc(profile.name)}</option>`,
          ),
        ].join("");
        return `
          <div class="panel">
            <div class="panel-head">
              <div>
                <div class="name">${esc(zone.name)}</div>
                <div class="muted">${esc(zone.climate_entity)}</div>
              </div>
              <button class="small ${zone.enabled ? "active" : ""}" data-action="zone-enable" data-zone="${esc(zone.id)}">
                ${zone.enabled ? "Auto" : "Off"}
              </button>
            </div>
            <div class="stats">
              <span>Attuale<br><b>${formatTemp(zone.current_temperature)}</b></span>
              <span>Target<br><b>${formatTemp(zone.target_temperature)}</b></span>
              <span>Profilo<br><b>${esc(zone.active_profile_name || "--")}</b></span>
              <span>Prossimo<br><b>${formatTime(zone.next_change)}</b></span>
              <span>Bypass<br><b>${zone.bypass_active ? formatRemaining(zone.bypass_remaining) : "no"}</b></span>
              <span>Override<br><b>${zone.override_active ? "sì" : "no"}</b></span>
            </div>
            <div class="row">
              <select class="grow" data-action="zone-profile" data-zone="${esc(zone.id)}">${profileOptions}</select>
            </div>
            <div class="row">
              <button data-action="zone-bypass" data-zone="${esc(zone.id)}">Bypass 60m</button>
              ${
                zone.bypass_active
                  ? `<button class="danger" data-action="zone-stop" data-zone="${esc(zone.id)}">Ferma bypass</button>`
                  : ""
              }
              <button class="small" data-action="zone-targets" data-zone="${esc(zone.id)}">Bypass…</button>
            </div>
          </div>`;
      })
      .join("")}</div>`;
  }

  _renderProfiles() {
    const profiles = this._data.profiles || [];
    const rows = profiles
      .map(
        (profile) => `
        <div class="list-row">
          <div class="list-main">
            <div><b>${esc(profile.name)}</b> <span class="muted">${esc(profile.id)}</span></div>
            <div class="muted">
              ${Object.keys(profile.targets || {}).length} zone ·
              ${esc(profile.hvac_mode || "modalità invariata")}
            </div>
          </div>
          <div class="row">
            <button class="small" data-action="profile-edit" data-id="${esc(profile.id)}">Modifica</button>
            <button class="small" data-action="profile-clone" data-id="${esc(profile.id)}">Clona</button>
            <button class="small danger" data-action="profile-delete" data-id="${esc(profile.id)}">Elimina</button>
          </div>
        </div>`,
      )
      .join("");
    return `
      <div class="toolbar">
        <div class="section-title">Profili</div>
        <button class="primary" data-action="profile-new">Nuovo profilo</button>
      </div>
      ${rows ? `<div class="list">${rows}</div>` : `<div class="empty">Nessun profilo.</div>`}`;
  }

  _renderProfileEditor() {
    const profile = this._ensureProfile(this._profileDraft);
    const zone = this._zone(this._editZone);
    if (!zone) {
      return `<div class="empty">Configura almeno una zona.</div>`;
    }
    this._editDay = DAYS.includes(this._editDay) ? this._editDay : "mon";
    const curve = profile.curves[zone.id][this._editDay];
    const enabledDays = profile.days[zone.id] || [];
    const hours = curve
      .map(
        (value, hour) => `
        <label>
          <span>${String(hour).padStart(2, "0")}</span>
          <input type="number" min="${esc(zone.min_temp)}" max="${esc(zone.max_temp)}"
            step="0.5" value="${esc(value)}" data-hour="${hour}">
        </label>`,
      )
      .join("");
    return `
      <div class="toolbar">
        <div class="section-title">${this._profileIsNew ? "Nuovo profilo" : "Modifica profilo"}</div>
        <div class="row">
          <button data-action="profile-cancel">Annulla</button>
          <button class="primary" data-action="profile-save">Salva</button>
        </div>
      </div>
      <div class="form-grid" data-editor="profile">
        <label class="field">Nome
          <input type="text" value="${esc(profile.name)}" data-draft="name">
        </label>
        <label class="field">Modalità HVAC
          <select data-draft="hvac_mode">
            ${HVAC_MODES.map(
              (mode) =>
                `<option value="${mode}" ${(profile.hvac_mode || "") === mode ? "selected" : ""}>${mode || "invariata"}</option>`,
            ).join("")}
          </select>
        </label>
        <label class="field">Icona
          <input type="text" value="${esc(profile.icon || "")}" data-draft="icon">
        </label>
      </div>
      <div class="zone-tabs">
        ${this._zones()
          .map(
            (item) =>
              `<button class="${item.id === zone.id ? "active" : ""}" data-action="profile-zone" data-zone="${esc(item.id)}">${esc(item.name)}</button>`,
          )
          .join("")}
      </div>
      <div class="form-grid">
        <label class="field">Target di fallback (${esc(zone.name)})
          <input type="number" min="${esc(zone.min_temp)}" max="${esc(zone.max_temp)}"
            step="0.5" value="${esc(profile.targets[zone.id])}" data-draft="target">
        </label>
        <label class="checks" style="align-self:end">
          <input type="checkbox" data-action="profile-day-enabled"
            ${enabledDays.includes(this._editDay) ? "checked" : ""}>
          Giorno attivo (${DAY_LABELS[this._editDay]})
        </label>
      </div>
      <div class="day-tabs">
        ${DAYS.map(
          (day) =>
            `<button class="${day === this._editDay ? "active" : ""}" data-action="profile-day" data-day="${day}">
              ${DAY_LABELS[day]}${enabledDays.includes(day) ? "" : " ·"}
            </button>`,
        ).join("")}
      </div>
      <div class="curve">${hours}</div>
      <div class="row">
        <button class="small" data-action="profile-fill">Riempi con fallback</button>
        <button class="small" data-action="profile-copy-day">Copia su tutti i giorni</button>
        <span class="hint">Il grafico usa 24 valori orari; il target di fallback vale per i giorni disattivati.</span>
      </div>`;
  }

  _renderActivators() {
    const activators = this._data.activators || [];
    const rows = activators
      .map(
        (activator) => `
        <div class="list-row">
          <div class="list-main">
            <div><b>${esc(activator.name)}</b> <span class="muted">→ ${esc(this._profileName(activator.profile_id))}</span></div>
            <div class="muted">
              ${activator.days.map((day) => DAY_LABELS[day] || day).join(" ")} ·
              ${esc(activator.start)}${activator.end ? `–${esc(activator.end)}` : ""} ·
              priorità ${esc(activator.priority)} ·
              ${activator.zones.length ? activator.zones.map((id) => esc(this._zoneName(id))).join(", ") : "tutte le zone"}
              ${activator.enabled ? "" : " · disattivato"}
              ${activator.condition_entity ? ` · se ${esc(activator.condition_entity)} = ${esc(activator.condition_state)}` : ""}
            </div>
          </div>
          <div class="row">
            <button class="small" data-action="activator-edit" data-id="${esc(activator.id)}">Modifica</button>
            <button class="small danger" data-action="activator-delete" data-id="${esc(activator.id)}">Elimina</button>
          </div>
        </div>`,
      )
      .join("");
    return `
      <div class="toolbar">
        <div class="section-title">Attivatori</div>
        <button class="primary" data-action="activator-new">Nuovo attivatore</button>
      </div>
      ${rows ? `<div class="list">${rows}</div>` : `<div class="empty">Nessun attivatore. Senza attivatori resta il profilo scelto manualmente o il default.</div>`}`;
  }

  _renderActivatorEditor() {
    const activator = this._activatorDraft;
    const profiles = this._data.profiles || [];
    if (!profiles.length) {
      return `<div class="empty">Crea prima un profilo.</div>`;
    }
    return `
      <div class="toolbar">
        <div class="section-title">${this._activatorIsNew ? "Nuovo attivatore" : "Modifica attivatore"}</div>
        <div class="row">
          <button data-action="activator-cancel">Annulla</button>
          <button class="primary" data-action="activator-save">Salva</button>
        </div>
      </div>
      <div class="form-grid" data-editor="activator">
        <label class="field">Nome
          <input type="text" value="${esc(activator.name)}" data-adraft="name">
        </label>
        <label class="field">Profilo
          <select data-adraft="profile_id">
            ${profiles
              .map(
                (profile) =>
                  `<option value="${esc(profile.id)}" ${profile.id === activator.profile_id ? "selected" : ""}>${esc(profile.name)}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label class="field">Inizio
          <input type="time" value="${esc(activator.start)}" data-adraft="start">
        </label>
        <label class="field">Fine (vuoto = tutto il giorno)
          <input type="time" value="${esc(activator.end || "")}" data-adraft="end">
        </label>
        <label class="field">Priorità
          <input type="number" step="1" value="${esc(activator.priority)}" data-adraft="priority">
        </label>
        <label class="field">Entità condizione
          <input type="text" value="${esc(activator.condition_entity || "")}" data-adraft="condition_entity">
        </label>
        <label class="field">Stato condizione
          <input type="text" value="${esc(activator.condition_state || "")}" data-adraft="condition_state">
        </label>
      </div>
      <label class="checks">
        <input type="checkbox" data-action="activator-enabled" ${activator.enabled ? "checked" : ""}>
        Attivatore abilitato
      </label>
      <div class="section-title">Giorni</div>
      <div class="checks">
        ${DAYS.map(
          (day) => `
          <label>
            <input type="checkbox" data-action="activator-day" data-day="${day}"
              ${activator.days.includes(day) ? "checked" : ""}>
            ${DAY_LABELS[day]}
          </label>`,
        ).join("")}
      </div>
      <div class="section-title">Zone</div>
      <div class="checks">
        ${this._zones()
          .map(
            (zone) => `
            <label>
              <input type="checkbox" data-action="activator-zone" data-zone="${esc(zone.id)}"
                ${activator.zones.includes(zone.id) ? "checked" : ""}>
              ${esc(zone.name)}
            </label>`,
          )
          .join("")}
      </div>
      <div class="hint">Nessuna zona selezionata = tutte le zone.</div>`;
  }

  _renderBypasses() {
    const bypasses = this._data.bypasses || [];
    const rows = bypasses
      .map(
        (bypass) => `
        <div class="list-row">
          <div class="list-main">
            <div><b>${bypass.zones.length ? bypass.zones.map((id) => esc(this._zoneName(id))).join(", ") : "Tutte le zone"}</b></div>
            <div class="muted">
              ${bypass.temperature != null ? `temperatura ${formatTemp(bypass.temperature)}` : ""}
              ${bypass.offset != null ? `offset ${bypass.offset > 0 ? "+" : ""}${esc(bypass.offset)}°` : ""}
              · fino a ${formatTime(bypass.until)} · ${formatRemaining(bypass.remaining)}
              · ${esc(bypass.source)}
            </div>
          </div>
          <button class="small danger" data-action="bypass-stop" data-zones="${esc((bypass.zones || []).join(","))}">Ferma</button>
        </div>`,
      )
      .join("");
    return `
      <div class="section-title">Bypass attivi</div>
      ${rows ? `<div class="list">${rows}</div>` : `<div class="empty">Nessun bypass attivo.</div>`}
      <div class="section-title">Avvia bypass</div>
      <div class="form-grid" data-bypass-form>
        <label class="field">Tipo
          <select data-bypass-mode>
            <option value="freeze">Blocca target corrente</option>
            <option value="temperature">Temperatura assoluta</option>
            <option value="offset">Offset sul profilo</option>
          </select>
        </label>
        <label class="field">Valore
          <input type="number" step="0.5" value="20" data-bypass-value>
        </label>
        <label class="field">Durata (minuti)
          <input type="number" step="1" min="1" value="60" data-bypass-duration>
        </label>
        <label class="field">Oppure fino a (ISO, es. 2026-11-02T22:00:00+01:00)
          <input type="text" value="" data-bypass-until>
        </label>
      </div>
      <div class="section-title">Zone</div>
      <div class="checks">
        ${this._zones()
          .map(
            (zone) => `
            <label>
              <input type="checkbox" data-bypass-zone data-zone="${esc(zone.id)}">
              ${esc(zone.name)}
            </label>`,
          )
          .join("")}
      </div>
      <div class="hint">Nessuna zona selezionata = tutte le zone. Se compili “fino a”, la durata viene ignorata.</div>
      <div class="row">
        <button class="primary" data-action="bypass-start">Avvia bypass</button>
      </div>`;
  }

  _onClick(event) {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "tab") {
      this._tab = target.dataset.tab;
      this._dirty = false;
      this._render();
      return;
    }
    if (action === "refresh") {
      this._dirty = false;
      this._load(true);
      return;
    }
    if (action === "master") {
      this._ws({
        type: `${DOMAIN}/set_enabled`,
        enabled: !this._data.enabled,
      });
      return;
    }
    if (action === "zone-enable") {
      const zone = this._zone(target.dataset.zone);
      if (zone) {
        this._ws({
          type: `${DOMAIN}/set_enabled`,
          enabled: !zone.enabled,
          zones: [zone.id],
        });
      }
      return;
    }
    if (action === "zone-bypass") {
      this._ws({
        type: `${DOMAIN}/bypass/start`,
        zones: [target.dataset.zone],
        duration: 60,
      });
      return;
    }
    if (action === "zone-targets") {
      this._tab = "bypasses";
      this._dirty = false;
      this._render();
      return;
    }
    if (action === "zone-stop") {
      this._ws({
        type: `${DOMAIN}/bypass/stop`,
        zones: [target.dataset.zone],
      });
      return;
    }
    if (action === "profile-new") {
      this._profileDraft = this._blankProfile();
      this._profileIsNew = true;
      this._editDay = "mon";
      this._dirty = false;
      this._render();
      return;
    }
    if (action === "profile-edit") {
      const source = (this._data.profiles || []).find(
        (item) => item.id === target.dataset.id,
      );
      if (!source) return;
      this._profileDraft = JSON.parse(JSON.stringify(source));
      this._profileIsNew = false;
      this._editDay = "mon";
      this._editZone = this._zones()[0]?.id || null;
      this._ensureProfile(this._profileDraft);
      this._dirty = false;
      this._render();
      return;
    }
    if (action === "profile-clone") {
      const source = (this._data.profiles || []).find(
        (item) => item.id === target.dataset.id,
      );
      if (!source) return;
      const name = window.prompt("Nome del nuovo profilo", `${source.name} copia`);
      if (!name) return;
      this._ws(
        {
          type: `${DOMAIN}/profile/clone`,
          source_id: source.id,
          name,
        },
        "Profilo clonato",
      );
      return;
    }
    if (action === "profile-delete") {
      const source = (this._data.profiles || []).find(
        (item) => item.id === target.dataset.id,
      );
      if (!source) return;
      if (!window.confirm(`Eliminare il profilo “${source.name}”?`)) return;
      this._ws({
        type: `${DOMAIN}/profile/delete`,
        profile_id: source.id,
      });
      return;
    }
    if (action === "profile-cancel") {
      this._profileDraft = null;
      this._dirty = false;
      this._render();
      return;
    }
    if (action === "profile-save") {
      this._saveProfile();
      return;
    }
    if (action === "profile-zone") {
      this._editZone = target.dataset.zone;
      this._render();
      return;
    }
    if (action === "profile-day") {
      this._editDay = target.dataset.day;
      this._render();
      return;
    }
    if (action === "profile-day-enabled") {
      const days = this._profileDraft.days[this._editZone];
      const day = this._editDay;
      this._profileDraft.days[this._editZone] = days.includes(day)
        ? days.filter((item) => item !== day)
        : [...days, day];
      this._dirty = true;
      this._render();
      return;
    }
    if (action === "profile-fill") {
      const fallback = this._profileDraft.targets[this._editZone];
      this._profileDraft.curves[this._editZone][this._editDay] = blankCurve(fallback);
      this._dirty = true;
      this._render();
      return;
    }
    if (action === "profile-copy-day") {
      const curve = this._profileDraft.curves[this._editZone][this._editDay];
      for (const day of DAYS) {
        this._profileDraft.curves[this._editZone][day] = [...curve];
      }
      this._toast("Curva copiata su tutti i giorni");
      this._dirty = true;
      return;
    }
    if (action === "activator-new") {
      this._activatorDraft = this._blankActivator();
      this._activatorIsNew = true;
      this._dirty = false;
      this._render();
      return;
    }
    if (action === "activator-edit") {
      const source = (this._data.activators || []).find(
        (item) => item.id === target.dataset.id,
      );
      if (!source) return;
      this._activatorDraft = JSON.parse(JSON.stringify(source));
      this._activatorIsNew = false;
      this._dirty = false;
      this._render();
      return;
    }
    if (action === "activator-delete") {
      const source = (this._data.activators || []).find(
        (item) => item.id === target.dataset.id,
      );
      if (!source) return;
      if (!window.confirm(`Eliminare l'attivatore “${source.name}”?`)) return;
      this._ws({
        type: `${DOMAIN}/activator/delete`,
        activator_id: source.id,
      });
      return;
    }
    if (action === "activator-cancel") {
      this._activatorDraft = null;
      this._dirty = false;
      this._render();
      return;
    }
    if (action === "activator-save") {
      this._saveActivator();
      return;
    }
    if (action === "activator-day") {
      const day = target.dataset.day;
      const days = this._activatorDraft.days;
      this._activatorDraft.days = days.includes(day)
        ? days.filter((item) => item !== day)
        : [...days, day];
      this._dirty = true;
      return;
    }
    if (action === "activator-zone") {
      const zone = target.dataset.zone;
      const zones = this._activatorDraft.zones;
      this._activatorDraft.zones = zones.includes(zone)
        ? zones.filter((item) => item !== zone)
        : [...zones, zone];
      this._dirty = true;
      return;
    }
    if (action === "bypass-stop") {
      const zones = target.dataset.zones
        ? target.dataset.zones.split(",").filter(Boolean)
        : null;
      const message = { type: `${DOMAIN}/bypass/stop` };
      if (zones && zones.length) message.zones = zones;
      this._ws(message, "Bypass fermato");
      return;
    }
    if (action === "bypass-start") {
      this._startBypass();
    }
  }

  _onInput(event) {
    const target = event.target;
    if (target.dataset.hour != null && this._profileDraft) {
      const hour = Number(target.dataset.hour);
      const value = Number(target.value);
      this._profileDraft.curves[this._editZone][this._editDay][hour] = value;
      this._dirty = true;
      return;
    }
    if (target.dataset.draft && this._profileDraft) {
      this._dirty = true;
      if (target.dataset.draft === "name") this._profileDraft.name = target.value;
      if (target.dataset.draft === "icon") this._profileDraft.icon = target.value;
      if (target.dataset.draft === "hvac_mode") {
        this._profileDraft.hvac_mode = target.value || null;
      }
      if (target.dataset.draft === "target") {
        this._profileDraft.targets[this._editZone] = Number(target.value);
      }
      return;
    }
    if (target.dataset.adraft && this._activatorDraft) {
      this._applyActivatorField(target);
      return;
    }
  }

  _onChange(event) {
    const target = event.target;
    if (target.dataset.action === "zone-profile") {
      this._ws({
        type: `${DOMAIN}/set_profile`,
        profile: target.value,
        zones: [target.dataset.zone],
      });
      return;
    }
    if (target.dataset.action === "activator-enabled") {
      this._activatorDraft.enabled = target.checked;
      this._dirty = true;
      return;
    }
    if (target.dataset.adraft && this._activatorDraft) {
      this._applyActivatorField(target);
      return;
    }
    if (target.dataset.draft && this._profileDraft) {
      this._onInput(event);
    }
  }

  _applyActivatorField(target) {
    const field = target.dataset.adraft;
    this._dirty = true;
    if (field === "priority") {
      this._activatorDraft.priority = Number(target.value) || 0;
    } else if (field === "end") {
      this._activatorDraft.end = target.value || null;
    } else if (field === "condition_entity" || field === "condition_state") {
      this._activatorDraft[field] = target.value.trim() || null;
    } else {
      this._activatorDraft[field] = target.value;
    }
  }

  _saveProfile() {
    const draft = this._ensureProfile(this._profileDraft);
    const name = String(draft.name || "").trim();
    if (!name) {
      this._toast("Inserisci un nome per il profilo", true);
      return;
    }
    draft.name = name;
    if (this._profileIsNew) delete draft.id;
    this._ws(
      {
        type: `${DOMAIN}/profile/${this._profileIsNew ? "create" : "update"}`,
        profile: draft,
      },
      "Profilo salvato",
    ).then((ok) => {
      if (!ok) return;
      this._profileDraft = null;
      this._dirty = false;
      this._render();
    });
  }

  _saveActivator() {
    const draft = this._activatorDraft;
    const root = this.shadowRoot;
    const get = (field) => root.querySelector(`[data-adraft="${field}"]`);
    draft.name = (get("name")?.value || "").trim();
    draft.profile_id = get("profile_id")?.value || "";
    draft.start = get("start")?.value || "00:00";
    draft.end = get("end")?.value || null;
    draft.priority = Number(get("priority")?.value) || 0;
    draft.condition_entity = (get("condition_entity")?.value || "").trim() || null;
    draft.condition_state = (get("condition_state")?.value || "").trim() || null;
    if (!draft.name) {
      this._toast("Inserisci un nome per l'attivatore", true);
      return;
    }
    if (!draft.profile_id) {
      this._toast("Scegli un profilo", true);
      return;
    }
    if (!draft.days.length) {
      this._toast("Seleziona almeno un giorno", true);
      return;
    }
    if (this._activatorIsNew) delete draft.id;
    this._ws(
      {
        type: `${DOMAIN}/activator/${this._activatorIsNew ? "create" : "update"}`,
        activator: draft,
      },
      "Attivatore salvato",
    ).then((ok) => {
      if (!ok) return;
      this._activatorDraft = null;
      this._dirty = false;
      this._render();
    });
  }

  _startBypass() {
    const root = this.shadowRoot;
    const mode = root.querySelector("[data-bypass-mode]")?.value || "freeze";
    const value = Number(root.querySelector("[data-bypass-value]")?.value || 0);
    const duration = Number(root.querySelector("[data-bypass-duration]")?.value || 0);
    const until = (root.querySelector("[data-bypass-until]")?.value || "").trim();
    const zones = [...root.querySelectorAll("[data-bypass-zone]:checked")].map(
      (input) => input.dataset.zone,
    );
    const message = {
      type: `${DOMAIN}/bypass/start`,
      zones,
      source: "card",
    };
    if (until) {
      message.until = until;
    } else if (duration > 0) {
      message.duration = duration;
    } else {
      this._toast("Indica una durata o una scadenza", true);
      return;
    }
    if (mode === "temperature") message.temperature = value;
    if (mode === "offset") message.offset = value;
    this._ws(message, "Bypass avviato");
  }
}

class HaThermoManagerCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
  }

  set hass(hass) {
    this._hass = hass;
  }

  setConfig(config) {
    this._config = { title: "HA Thermo Manager", ...config };
    this._render();
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        .form { display: grid; gap: 12px; padding: 8px 0; }
        label { display: grid; gap: 4px; font-size: 0.9rem; }
        input {
          padding: 8px; border-radius: 6px; border: 1px solid var(--divider-color);
          background: var(--card-background-color, #fff); color: var(--primary-text-color);
        }
      </style>
      <div class="form">
        <label>Titolo
          <input type="text" data-field="title" value="${esc(this._config.title)}">
        </label>
      </div>`;
    this.shadowRoot.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", () => {
        const config = {
          ...this._config,
          title: this.shadowRoot.querySelector("[data-field='title']").value,
        };
        this._config = config;
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config },
            bubbles: true,
            composed: true,
          }),
        );
      });
    });
  }
}

if (!customElements.get("ha-thermo-manager-card-editor")) {
  customElements.define(
    "ha-thermo-manager-card-editor",
    HaThermoManagerCardEditor,
  );
}
if (!customElements.get("ha-thermo-manager-card")) {
  customElements.define("ha-thermo-manager-card", HaThermoManagerCard);
}
window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "ha-thermo-manager-card")) {
  window.customCards.push({
    type: "ha-thermo-manager-card",
    name: "HA Thermo Manager",
    description: "Gestione grafica di profili, attivatori, zone e bypass.",
    preview: true,
  });
}
