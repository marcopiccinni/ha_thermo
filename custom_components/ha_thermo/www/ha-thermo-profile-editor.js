import {
  DOMAIN,
  callWS,
  esc,
  slugProfileId,
  profileOptions,
} from "./ha-thermo-common.js?v=0.4.1"; // profile editor bundle

const BUILTIN = new Set(["comfort", "eco", "night", "away", "summer"]);
const MIN_T = 5;
const MAX_T = 30;
const STEP = 0.5;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const snap = (v) => Math.round(clamp(v, MIN_T, MAX_T) / STEP) * STEP;

export class HaThermoProfileEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._profiles = [];
    this._selectedId = null;
    this._hourly = Array(24).fill(20);
    this._baseline = [];
    this._selFrom = null;
    this._selTo = null;
    this._dragHour = null;
    this._dragAnchor = null;
    this._dirty = false;
    this._busy = false;
    this._status = "";
    this._unsub = null;
  }

  set hass(value) {
    this._hass = value;
    if (value && !this._profiles.length) this._load();
    else if (value && this._selectedId) this._paint();
  }

  connectedCallback() {
    if (!this._hass) this._paint();
  }

  disconnectedCallback() {
    this._unsub?.();
    this._unsub = null;
  }

  async _load() {
    if (!this._hass) return;
    try {
      const d = await callWS(this._hass, { type: `${DOMAIN}/get_config` });
      this._profiles = d?.profiles || [];
      if (!this._selectedId && this._profiles.length) {
        this._selectedId = this._profiles[0].id;
      }
      this._loadSelection();
      this._subscribe();
    } catch (e) {
      this._status = e?.message || "Errore caricamento";
    }
    this._paint();
  }

  _subscribe() {
    if (!this._hass?.connection?.subscribeEvents || this._unsub) return;
    const topics = [`${DOMAIN}_profiles_changed`];
    this._hass.connection
      .subscribeEvents(() => this._load(), topics[0])
      .then((unsub) => {
        this._unsub = unsub;
      })
      .catch(() => {});
  }

  _profile() {
    return this._profiles.find((p) => p.id === this._selectedId) || null;
  }

  _loadSelection() {
    const p = this._profile();
    if (!p) return;
    this._hourly = Array.isArray(p.hourly) && p.hourly.length === 24 ? p.hourly.map(Number) : Array(24).fill(20);
    this._baseline = [...this._hourly];
    this._dirty = false;
    this._selFrom = null;
    this._selTo = null;
  }

  _paint() {
    const p = this._profile();
    const name = p?.name || "—";
    const canDelete = p && !BUILTIN.has(p.id);
    this.shadowRoot.innerHTML = `<style>
      :host{display:block;font-size:var(--ha-font-size-m,14px);color:var(--primary-text-color)}
      .toolbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0 10px}
      .toolbar select{flex:1 1 140px;min-width:120px;padding:8px;border-radius:8px;border:1px solid var(--divider-color);background:var(--card-background-color,var(--ha-card-background,#fff))}
      .btn{padding:6px 10px;border-radius:8px;border:1px solid var(--divider-color);background:var(--card-background-color,#fff);cursor:pointer;font:inherit;color:inherit}
      .btn.primary{background:var(--primary-color);color:var(--text-primary-color,#fff);border-color:var(--primary-color)}
      .btn:disabled{opacity:0.45;cursor:not-allowed}
      .status{font-size:0.8rem;color:var(--secondary-text-color);min-height:1.2em;margin:4px 0}
      .status.ok{color:var(--success-color,var(--primary-color))}
      .status.err{color:var(--error-color,#c62828)}
      .chart-wrap{touch-action:none;user-select:none;border:1px solid var(--divider-color);border-radius:8px;padding:8px;background:var(--secondary-background-color,rgba(0,0,0,0.02))}
      .chart{width:100%;height:160px;display:block}
      .range-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0;font-size:0.85rem}
      .range-row input{width:4.5rem;padding:6px;border-radius:6px;border:1px solid var(--divider-color)}
      .hint{color:var(--secondary-text-color);font-size:0.75rem;margin-top:4px}
    </style>
    <div class="toolbar">
      <select data-sel aria-label="Profilo">${profileOptions(this._profiles, this._selectedId)}</select>
      <button type="button" class="btn" data-a="new">Nuovo</button>
      <button type="button" class="btn" data-a="dup">Duplica</button>
      <button type="button" class="btn" data-a="rename">Rinomina</button>
      <button type="button" class="btn" data-a="del" ${canDelete ? "" : "disabled"}>Elimina</button>
      <button type="button" class="btn primary" data-a="save" ${this._dirty && !this._busy ? "" : "disabled"}>Salva</button>
    </div>
    <div class="status ${this._statusClass()}">${esc(this._status || (this._dirty ? "Modifiche non salvate" : `Profilo: ${name}`))}</div>
    <div class="chart-wrap"><svg class="chart" data-chart viewBox="0 0 480 160"></svg></div>
    <div class="range-row">
      <span>Intervallo ore</span>
      <span data-range-label>—</span>
      <label>°C <input type="number" step="0.5" min="${MIN_T}" max="${MAX_T}" data-range-temp value="20"></label>
      <button type="button" class="btn" data-a="apply-range">Applica</button>
      <button type="button" class="btn" data-a="copy-toggle">Copia da…</button>
      <select data-copy-from hidden>${profileOptions(this._profiles, this._selectedId)}</select>
      <button type="button" class="btn" data-a="reset">Ripristina</button>
    </div>
    <div class="hint">Trascina le barre (0.5°). Tieni premuto e trascina sull’asse orario per selezionare ore.</div>`;

    this._wire();
    this._drawChart();
  }

  _statusClass() {
    if (this._status?.startsWith("✓")) return "ok";
    if (this._status?.startsWith("!")) return "err";
    return "";
  }

  _wire() {
    const root = this.shadowRoot;
    root.querySelector("[data-sel]")?.addEventListener("change", (e) => {
      if (this._dirty && !confirm("Scartare le modifiche non salvate?")) {
        e.target.value = this._selectedId;
        return;
      }
      this._selectedId = e.target.value;
      this._loadSelection();
      this._paint();
    });
    root.querySelectorAll("[data-a]").forEach((btn) =>
      btn.addEventListener("click", () => this._action(btn.dataset.a)),
    );
    root.querySelector("[data-range-temp]")?.addEventListener("change", () => this._applyRangeTemp());
    root.querySelector("[data-copy-from]")?.addEventListener("change", (e) => {
      const src = this._profiles.find((pr) => pr.id === e.target.value);
      if (src?.hourly?.length === 24) {
        this._hourly = src.hourly.map(Number);
        this._dirty = true;
        e.target.hidden = true;
        this._paint();
      }
    });
    const chart = root.querySelector("[data-chart]");
    if (chart) this._wireChart(chart);
  }

  _yForTemp(v, h, pad) {
    const span = MAX_T - MIN_T;
    return pad + (1 - (v - MIN_T) / span) * (h - 2 * pad);
  }

  _tempFromY(y, h, pad) {
    const rel = 1 - (y - pad) / (h - 2 * pad);
    return snap(MIN_T + rel * (MAX_T - MIN_T));
  }

  _hourFromX(x, w, pad) {
    const rel = clamp((x - pad) / (w - 2 * pad), 0, 1);
    return clamp(Math.floor(rel * 24), 0, 23);
  }

  _drawChart() {
    const svg = this.shadowRoot.querySelector("[data-chart]");
    if (!svg) return;
    const w = 480;
    const h = 160;
    const pad = 12;
    const barW = (w - 2 * pad) / 24;
    const selLo = this._selFrom == null ? null : Math.min(this._selFrom, this._selTo ?? this._selFrom);
    const selHi = this._selFrom == null ? null : Math.max(this._selFrom, this._selTo ?? this._selFrom);
    const bars = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const temp = this._hourly[hour];
      const x = pad + hour * barW;
      const y0 = h - pad;
      const y1 = this._yForTemp(temp, h, pad);
      const selected = selLo != null && hour >= selLo && hour <= selHi;
      const fill = selected ? "var(--primary-color)" : "var(--primary-color)";
      bars.push(
        `<rect data-h="${hour}" x="${x + 1}" y="${y1}" width="${Math.max(2, barW - 2)}" height="${Math.max(1, y0 - y1)}" fill="${fill}" opacity="${selected ? 1 : 0.75}" rx="2"/>
        <text x="${x + barW / 2}" y="${h - 2}" text-anchor="middle" font-size="9" fill="var(--secondary-text-color)">${String(hour).padStart(2, "0")}</text>`,
      );
    }
  const label = selLo != null ? `${selLo}–${selHi}` : "—";
    svg.innerHTML = bars.join("");
    const lbl = this.shadowRoot.querySelector("[data-range-label]");
    if (lbl) lbl.textContent = label;
  }

  _wireChart(svg) {
    const onPointer = (ev) => {
      const rect = svg.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) / rect.width) * 480;
      const y = ((ev.clientY - rect.top) / rect.height) * 160;
      const pad = 12;
      const hour = this._hourFromX(x, 480, pad);
      if (ev.type === "pointerdown") {
        if (y < 130) {
          this._dragHour = hour;
          this._dragAnchor = hour;
          const temp = this._tempFromY(y, 160, pad);
          this._hourly[hour] = temp;
          this._dirty = true;
        } else {
          this._selFrom = hour;
          this._selTo = hour;
        }
        svg.setPointerCapture(ev.pointerId);
      } else if (ev.type === "pointermove" && svg.hasPointerCapture(ev.pointerId)) {
        if (this._dragHour != null) {
          const temp = this._tempFromY(y, 160, pad);
          const lo = Math.min(this._dragAnchor ?? hour, hour);
          const hi = Math.max(this._dragAnchor ?? hour, hour);
          for (let h = lo; h <= hi; h += 1) this._hourly[h] = temp;
          this._dirty = true;
        } else if (this._selFrom != null) {
          this._selTo = hour;
        }
      } else if (ev.type === "pointerup" || ev.type === "pointercancel") {
        this._dragHour = null;
        this._dragAnchor = null;
        try {
          svg.releasePointerCapture(ev.pointerId);
        } catch (e) {
          /* ignore */
        }
      }
      this._drawChart();
      this._setStatus(this._dirty ? "Modifiche non salvate" : "");
      const saveBtn = this.shadowRoot.querySelector('[data-a="save"]');
      if (saveBtn) saveBtn.disabled = !this._dirty || this._busy;
    };
    svg.addEventListener("pointerdown", onPointer);
    svg.addEventListener("pointermove", onPointer);
    svg.addEventListener("pointerup", onPointer);
    svg.addEventListener("pointercancel", onPointer);
  }

  _applyRangeTemp() {
    const lo = this._selFrom == null ? null : Math.min(this._selFrom, this._selTo ?? this._selFrom);
    const hi = this._selFrom == null ? null : Math.max(this._selFrom, this._selTo ?? this._selFrom);
    if (lo == null) return;
    const input = this.shadowRoot.querySelector("[data-range-temp]");
    const v = snap(Number(input?.value ?? 20));
    for (let h = lo; h <= hi; h += 1) this._hourly[h] = v;
    this._dirty = true;
    this._paint();
  }

  async _action(kind) {
    if (!this._hass) return;
    if (kind === "save") return this._save();
    if (kind === "reset") {
      this._hourly = [...this._baseline];
      this._dirty = true;
      return this._paint();
    }
    if (kind === "new") {
      const name = prompt("Nome nuovo profilo");
      if (!name) return;
      const id = slugProfileId(name);
      const profile = { id, name, icon: "mdi:home-thermometer", hourly: Array(24).fill(20) };
      await this._run(() => callWS(this._hass, { type: `${DOMAIN}/profile/create`, profile }));
      this._selectedId = id;
      await this._load();
      this._dispatchUpdated();
      return;
    }
    if (kind === "dup") {
      const p = this._profile();
      if (!p) return;
      const name = prompt("Nome copia", `${p.name} (copia)`);
      if (!name) return;
      await this._run(() =>
        callWS(this._hass, { type: `${DOMAIN}/profile/clone`, source_id: p.id, name }),
      );
      await this._load();
      this._dispatchUpdated();
      return;
    }
    if (kind === "rename") {
      const p = this._profile();
      if (!p) return;
      const name = prompt("Nuovo nome", p.name);
      if (!name || name === p.name) return;
      await this._run(() =>
        callWS(this._hass, {
          type: `${DOMAIN}/profile/update`,
          profile: { ...p, name, hourly: [...this._hourly] },
        }),
      );
      await this._load();
      this._dispatchUpdated();
      return;
    }
    if (kind === "del") {
      const p = this._profile();
      if (!p || BUILTIN.has(p.id)) return;
      if (!confirm(`Eliminare il profilo "${p.name}"?`)) return;
      await this._run(() => callWS(this._hass, { type: `${DOMAIN}/profile/delete`, profile_id: p.id }));
      this._selectedId = this._profiles[0]?.id || null;
      await this._load();
      this._dispatchUpdated();
      return;
    }
    if (kind === "apply-range") {
      this._applyRangeTemp();
      return;
    }
    if (kind === "copy-toggle") {
      const sel = this.shadowRoot.querySelector("[data-copy-from]");
      if (sel) sel.hidden = !sel.hidden;
    }
  }

  async _save() {
    const p = this._profile();
    if (!p) return;
    const profile = { ...p, hourly: [...this._hourly] };
    await this._run(() => callWS(this._hass, { type: `${DOMAIN}/profile/update`, profile }));
    this._baseline = [...this._hourly];
    this._dirty = false;
    this._setStatus("✓ Salvato");
    await this._load();
    this._dispatchUpdated();
  }

  async _run(fn) {
    this._busy = true;
    this._setStatus("Salvataggio…");
    this._paint();
    try {
      await fn();
      this._setStatus("✓ Salvato");
    } catch (e) {
      this._setStatus(`! ${e?.message || e}`);
    } finally {
      this._busy = false;
      this._paint();
    }
  }

  _setStatus(msg) {
    this._status = msg;
    const el = this.shadowRoot.querySelector(".status");
    if (el) {
      el.textContent = msg;
      el.className = `status ${this._statusClass()}`;
    }
  }

  _dispatchUpdated() {
    this.dispatchEvent(
      new CustomEvent("ha-thermo-profiles-updated", {
        detail: { profiles: this._profiles },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

// Fix typos motion-div in template - need to fix the HTML in _paint

if (!customElements.get("ha-thermo-profile-editor")) {
  customElements.define("ha-thermo-profile-editor", HaThermoProfileEditor);
}
