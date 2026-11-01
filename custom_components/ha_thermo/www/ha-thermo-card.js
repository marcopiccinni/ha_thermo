const DOMAIN = "ha_thermo";
const EVENT_TYPES = [
  `${DOMAIN}_profile_changed`,
  `${DOMAIN}_bypass_started`,
  `${DOMAIN}_bypass_ended`,
  `${DOMAIN}_target_changed`,
  `${DOMAIN}_manual_override`,
];
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

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

const round = (value) => (value == null ? null : Math.round(value * 2) / 2);

const formatTemp = (value) =>
  value == null || Number.isNaN(Number(value))
    ? "--"
    : `${(Math.round(Number(value) * 10) / 10).toFixed(1)}°`;

const formatTime = (value) => {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatRemaining = (seconds) => {
  if (seconds == null) return "--";
  const total = Math.max(0, Math.round(Number(seconds)));
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
};

const todayKey = () => DAY_KEYS[new Date().getDay()];

class HaThermoCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.addEventListener("click", (event) => this._onClick(event));
    this.shadowRoot.addEventListener("change", (event) => this._onChange(event));
    this.shadowRoot.addEventListener("input", (event) => this._onInput(event));
    this._config = {};
    this._data = null;
    this._error = null;
    this._busy = null;
    this._hass = null;
    this._unsubs = [];
    this._timer = null;
    this._started = false;
  }

  static getStubConfig() {
    return { title: "Termostati" };
  }

  static getConfigElement() {
    return document.createElement("ha-thermo-card-editor");
  }

  setConfig(config) {
    if (!config) throw new Error("Configurazione non valida");
    this._config = { title: "Termostati", show_graph: true, ...config };
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
    return 4 + (this._data?.zones?.length || 1) * 4;
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

  async _load() {
    if (!this._hass) return;
    try {
      this._data = await this._hass.callWS({
        type: `${DOMAIN}/get_config`,
      });
      this._error = null;
    } catch (err) {
      this._error = err?.message || String(err);
    }
    this._render();
  }

  async _call(message) {
    if (!this._hass) return;
    try {
      await this._hass.callWS(message);
      await this._load();
    } catch (err) {
      this._error = err?.message || String(err);
      this._render();
    }
  }

  _zones() {
    const zones = this._data?.zones || [];
    const filter = this._config.zone;
    if (!filter) return zones;
    const values = Array.isArray(filter) ? filter : [filter];
    return zones.filter(
      (zone) =>
        values.includes(zone.id) ||
        values.includes(zone.climate_entity) ||
        values.includes(zone.name),
    );
  }

  _profile(zone) {
    const id = zone?.active_profile;
    if (!id) return null;
    return (this._data?.profiles || []).find((item) => item.id === id) || null;
  }

  _curve(zone) {
    const profile = this._profile(zone);
    if (!profile) {
      return Array.from(
        { length: 24 },
        () => zone.target_temperature ?? zone.default_temp ?? 20,
      );
    }
    const day = todayKey();
    const days = profile.days?.[zone.id] || [];
    if (days.length && !days.includes(day)) {
      return Array.from(
        { length: 24 },
        () =>
          profile.targets?.[zone.id] ??
          zone.target_temperature ??
          zone.default_temp ??
          20,
      );
    }
    const curve = profile.curves?.[zone.id]?.[day];
    if (Array.isArray(curve) && curve.length === 24) return curve;
    return Array.from(
      { length: 24 },
      () =>
        profile.targets?.[zone.id] ??
        zone.target_temperature ??
        zone.default_temp ??
        20,
    );
  }

  _chart(zone) {
    const low = Number(zone.min_temp ?? 5);
    const high = Number(zone.max_temp ?? 35);
    const span = Math.max(1, high - low);
    const y = (value) =>
      54 - ((Number(value ?? low) - low) / span) * 46;
    const curve = this._curve(zone);
    const points = curve
      .map((value, index) => `${2 + index * 10.26},${y(value).toFixed(2)}`)
      .join(" ");
    const targetY = y(zone.target_temperature).toFixed(2);
    const currentY =
      zone.current_temperature == null
        ? null
        : y(zone.current_temperature).toFixed(2);

    return `
      <svg class="chart" viewBox="0 0 240 58" preserveAspectRatio="none" role="img"
        aria-label="Curva del profilo e temperature">
        <line x1="0" y1="${targetY}" x2="240" y2="${targetY}" class="line-target"></line>
        ${
          currentY
            ? `<line x1="0" y1="${currentY}" x2="240" y2="${currentY}" class="line-current"></line>`
            : ""
        }
        <polyline points="${points}" class="line-curve"></polyline>
      </svg>
      <div class="legend">
        <span><i class="dot curve"></i>Curva</span>
        <span><i class="dot target"></i>Target</span>
        <span><i class="dot current"></i>Attuale</span>
      </div>`;
  }

  _zoneCard(zone) {
    const profiles = this._data?.profiles || [];
    const pinned = this._data?.pinned_profiles?.[zone.id] || "__auto__";
    const bypass = (this._data?.bypasses || []).find(
      (item) => !item.zones?.length || item.zones.includes(zone.id),
    );
    const disabled = this._busy === zone.id ? "disabled" : "";
    const profileOptions = [
      `<option value="__auto__" ${pinned === "__auto__" ? "selected" : ""}>Auto</option>`,
      ...profiles.map(
        (profile) =>
          `<option value="${esc(profile.id)}" ${
            pinned === profile.id ? "selected" : ""
          }>${esc(profile.name)}</option>`,
      ),
    ].join("");

    return `
      <section class="zone" data-zone="${esc(zone.id)}">
        <div class="zone-head">
          <div>
            <div class="zone-name">${esc(zone.name)}</div>
            <div class="muted">
              ${esc(zone.active_profile_name || "Nessun profilo")}
              ${zone.pinned ? "· fissato" : ""}
              ${zone.override_active ? "· override" : ""}
            </div>
          </div>
          <button class="pill ${zone.enabled ? "on" : "off"}"
            data-action="toggle" data-zone="${esc(zone.id)}" ${disabled}>
            ${zone.enabled ? "Auto" : "Off"}
          </button>
        </div>

        <div class="temp-row">
          <div class="temp-current">${formatTemp(zone.current_temperature)}</div>
          <div class="temp-target" data-target-for="${esc(zone.id)}">
            ${formatTemp(zone.target_temperature)}
          </div>
        </div>

        ${this._config.show_graph === false ? "" : this._chart(zone)}

        <div class="stepper">
          <button data-action="minus" data-zone="${esc(zone.id)}" ${disabled}>−</button>
          <input type="range" data-action="slider" data-zone="${esc(zone.id)}"
            min="${esc(zone.min_temp)}" max="${esc(zone.max_temp)}" step="0.5"
            value="${esc(round(zone.target_temperature) ?? zone.default_temp)}" ${disabled}>
          <button data-action="plus" data-zone="${esc(zone.id)}" ${disabled}>+</button>
        </div>

        <div class="zone-actions">
          <select data-action="profile" data-zone="${esc(zone.id)}" ${disabled}>
            ${profileOptions}
          </select>
          <button data-action="freeze" data-zone="${esc(zone.id)}" ${disabled}>
            Bypass 60m
          </button>
          ${
            bypass
              ? `<button class="danger" data-action="stop" data-zone="${esc(zone.id)}" ${disabled}>
                  Ferma ${formatRemaining(bypass.remaining)}
                </button>`
              : ""
          }
        </div>

        <div class="meta">
          <span>Prossimo cambio: ${formatTime(zone.next_change)}</span>
          ${
            bypass
              ? `<span>Bypass: ${formatRemaining(bypass.remaining)}</span>`
              : ""
          }
        </div>
      </section>`;
  }

  _render() {
    if (!this.shadowRoot) return;
    const zones = this._zones();
    const data = this._data;
    const body = !data
      ? `<div class="empty">${this._error ? esc(this._error) : "Caricamento…"}</div>`
      : !zones.length
        ? `<div class="empty">${this._error ? esc(this._error) : "Nessuna zona configurata."}</div>`
        : zones.map((zone) => this._zoneCard(zone)).join("");

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
        }
        .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .title { font-size: 1.2rem; font-weight: 600; }
        .refresh {
          border: 0; background: transparent; color: var(--secondary-text-color);
          font-size: 1.2rem; cursor: pointer; border-radius: 50%; padding: 4px 8px;
        }
        .refresh:hover { background: var(--secondary-background-color); }
        .zone {
          border-top: 1px solid var(--divider-color);
          padding-top: 12px;
          display: grid;
          gap: 10px;
        }
        .zone:first-of-type { border-top: 0; padding-top: 0; }
        .zone-head { display: flex; align-items: start; justify-content: space-between; gap: 8px; }
        .zone-name { font-weight: 600; font-size: 1.05rem; }
        .muted { color: var(--secondary-text-color); font-size: 0.82rem; }
        .temp-row { display: flex; align-items: baseline; gap: 12px; }
        .temp-current { font-size: 2rem; font-weight: 300; line-height: 1; }
        .temp-target { font-size: 1.15rem; color: var(--primary-color); font-weight: 600; }
        .chart { width: 100%; height: 58px; overflow: visible; margin-top: 2px; }
        .line-curve { fill: none; stroke: var(--primary-color); stroke-width: 2; opacity: 0.85; }
        .line-target { stroke: var(--secondary-text-color); stroke-width: 1; stroke-dasharray: 4 4; opacity: 0.7; }
        .line-current { stroke: var(--warning-color, #ff9800); stroke-width: 1; stroke-dasharray: 2 3; opacity: 0.9; }
        .legend { display: flex; gap: 12px; color: var(--secondary-text-color); font-size: 0.72rem; }
        .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 4px; }
        .dot.curve { background: var(--primary-color); }
        .dot.target { background: var(--secondary-text-color); }
        .dot.current { background: var(--warning-color, #ff9800); }
        .stepper { display: grid; grid-template-columns: 40px 1fr 40px; gap: 8px; align-items: center; }
        .stepper button {
          height: 40px; border-radius: 10px; border: 1px solid var(--divider-color);
          background: var(--secondary-background-color); color: var(--primary-text-color);
          font-size: 1.25rem; cursor: pointer;
        }
        .stepper input[type="range"] { width: 100%; accent-color: var(--primary-color); }
        .zone-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .zone-actions select {
          flex: 1 1 130px; min-height: 38px; border-radius: 8px; padding: 0 8px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color, #fff); color: var(--primary-text-color);
        }
        button {
          min-height: 38px; border-radius: 8px; padding: 0 12px; cursor: pointer;
          border: 1px solid var(--divider-color);
          background: var(--secondary-background-color); color: var(--primary-text-color);
        }
        button:hover { border-color: var(--primary-color); }
        button:disabled, select:disabled, input:disabled { opacity: 0.5; cursor: default; }
        button.danger { color: var(--error-color, #c62828); }
        .pill { border-radius: 999px; min-width: 64px; font-weight: 600; }
        .pill.on { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }
        .pill.off { opacity: 0.7; }
        .meta { display: flex; justify-content: space-between; gap: 8px; color: var(--secondary-text-color); font-size: 0.78rem; }
        .empty { color: var(--secondary-text-color); padding: 12px 0; }
      </style>
      <div class="card">
        <div class="head">
          <div class="title">${esc(this._config.title)}</div>
          <button class="refresh" data-action="refresh" title="Aggiorna">⟳</button>
        </div>
        ${body}
      </div>`;

  }

  _onClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const zoneId = button.dataset.zone;
    if (action === "refresh") {
      this._load();
      return;
    }
    if (action === "toggle") {
      const zone = this._data?.zones?.find((item) => item.id === zoneId);
      if (zone) {
        this._call({
          type: `${DOMAIN}/set_enabled`,
          enabled: !zone.enabled,
          zones: [zoneId],
        });
      }
      return;
    }
    if (action === "stop") {
      this._call({ type: `${DOMAIN}/bypass/stop`, zones: [zoneId] });
      return;
    }
    if (action === "freeze") {
      this._call({
        type: `${DOMAIN}/bypass/start`,
        zones: [zoneId],
        duration: this._config.bypass_minutes || 60,
      });
      return;
    }
    const zone = this._data?.zones?.find((item) => item.id === zoneId);
    if (!zone) return;
    if (action === "plus" || action === "minus") {
      const delta = action === "plus" ? 0.5 : -0.5;
      const base =
        round(zone.target_temperature) ?? round(zone.default_temp) ?? 20;
      this._setTemperature(zone, base + delta);
    }
  }

  _onInput(event) {
    const slider = event.target.closest("input[data-action='slider']");
    if (!slider) return;
    const label = this.shadowRoot.querySelector(
      `[data-target-for="${slider.dataset.zone}"]`,
    );
    if (label) label.textContent = formatTemp(Number(slider.value));
  }

  _onChange(event) {
    const target = event.target;
    if (target.matches("select[data-action='profile']")) {
      this._call({
        type: `${DOMAIN}/set_profile`,
        profile: target.value,
        zones: [target.dataset.zone],
      });
      return;
    }
    if (target.matches("input[data-action='slider']")) {
      const zone = this._data?.zones?.find(
        (item) => item.id === target.dataset.zone,
      );
      if (zone) this._setTemperature(zone, Number(target.value));
    }
  }

  _setTemperature(zone, temperature) {
    const value = Math.min(
      Number(zone.max_temp),
      Math.max(Number(zone.min_temp), Number(temperature)),
    );
    this._call({
      type: `${DOMAIN}/set_temperature`,
      zones: [zone.id],
      temperature: value,
      duration: this._config.hold_minutes || 60,
    });
  }
}

class HaThermoCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
  }

  set hass(hass) {
    this._hass = hass;
  }

  setConfig(config) {
    this._config = { title: "Termostati", show_graph: true, ...config };
    this._render();
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        .form { display: grid; gap: 12px; padding: 8px 0; }
        label { display: grid; gap: 4px; font-size: 0.9rem; }
        input[type="text"] {
          padding: 8px; border-radius: 6px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color);
        }
        .row { display: flex; align-items: center; gap: 8px; }
      </style>
      <div class="form">
        <label>Titolo
          <input type="text" data-field="title" value="${esc(this._config.title)}">
        </label>
        <label>Zona (id, entità o nome; vuoto = tutte)
          <input type="text" data-field="zone" value="${esc(this._config.zone || "")}">
        </label>
        <label>Minuti bypass rapido
          <input type="text" data-field="bypass_minutes" value="${esc(this._config.bypass_minutes || 60)}">
        </label>
        <label class="row">
          <input type="checkbox" data-field="show_graph" ${this._config.show_graph === false ? "" : "checked"}>
          Mostra grafico
        </label>
      </div>`;
    this.shadowRoot.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", () => this._changed());
    });
  }

  _changed() {
    const get = (field) =>
      this.shadowRoot.querySelector(`[data-field="${field}"]`);
    const config = {
      ...this._config,
      title: get("title").value,
      show_graph: get("show_graph").checked,
      bypass_minutes: Number(get("bypass_minutes").value) || 60,
    };
    const zone = get("zone").value.trim();
    if (zone) config.zone = zone;
    else delete config.zone;
    this._config = config;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

if (!customElements.get("ha-thermo-card-editor")) {
  customElements.define("ha-thermo-card-editor", HaThermoCardEditor);
}
if (!customElements.get("ha-thermo-card")) {
  customElements.define("ha-thermo-card", HaThermoCard);
}
window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "ha-thermo-card")) {
  window.customCards.push({
    type: "ha-thermo-card",
    name: "HA Thermo",
    description: "Termostati, profili, bypass e grafico della giornata.",
    preview: true,
  });
}
