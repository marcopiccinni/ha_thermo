# HA Thermo

Integrazione custom Home Assistant (HACS) per gestire i termostati tramite profili condivisi e bypass temporanei. Include due card Lovelace (`ha-thermo-card`, `ha-thermo-graph-card`).

**Una config entry per installazione**, con zone illimitate.

## Caratteristiche

- Profili condivisi tra tutte le card, con curva oraria 7×24 (24 valori per ogni giorno).
- Profili predefiniti: **Comfort 20 °C**, **Eco 19 °C**, **Notte 18 °C**, **Fuori casa 17 °C**, **Estate 26 °C**.
- Import/Export profili come file JSON.
- Bypass temporanei assoluti, a offset o con blocco del target corrente (freeze).
- Override manuale con hold configurabile e riasserzione periodica.
- Card termostato con slider, profilo, bypass e stato.
- Card grafico con storico da Home Assistant (temperature attuale e target).

## Installazione

### HACS (consigliato)

1. Aggiungi questo repository come custom repository in HACS.
2. Installa "HA Thermo".
3. Riavvia Home Assistant.

### Manuale

1. Copia `custom_components/ha_thermo` in `<config>/custom_components/`.
2. Riavvia Home Assistant.

## Configurazione

1. **Impostazioni** → **Dispositivi e servizi** → **Aggiungi integrazione** → **HA Thermo**.
2. Configura le zone dalle **Opzioni** dell'integrazione:
   - Aggiungi zone con id, nome, entità climate, sensore temperatura opzionale, min/max, default.
   - Modifica temperature predefinite dei profili.
   - Configura hold manuale, intervallo di riasserzione, scansione.

## Card Lovelace

### Controlli (`ha-thermo-card`)

Card per un singolo termostato con slider, profilo, bypass e stato.

```yaml
type: custom:ha-thermo-card
title: Studio
zone: climate.studio
show_graph: true
show_slider: true
show_weekly: true
show_status: true
```

| Opzione | Default | Descrizione |
| --- | --- | --- |
| `title` | `Termostato` | Titolo della card. |
| `zone` | — | Entità `climate` della zona. |
| `show_graph` | `true` | Mostra il grafico 24h del profilo di oggi. |
| `show_slider` | `true` | Mostra slider e pulsanti ± (override temperatura). |
| `show_weekly` | `true` | Pianificazione Lun–Dom (profilo condiviso per giorno). |
| `show_status` | `true` | Mostra profilo attivo. |

Profili condivisi (curve 24h): **Impostazioni → Dispositivi e servizi → HA Thermo → Configura → Profili condivisi**.

### Grafico (`ha-thermo-graph-card`)

Card con storico temperature da Home Assistant.

```yaml
type: custom:ha-thermo-graph-card
title: Studio
zone: climate.studio
hours_to_show: 24
height: 180
min_temp:
max_temp:
show_current: true
show_target: true
```

| Opzione | Default | Descrizione |
| --- | --- | --- |
| `title` | `Grafico` | Titolo della card. |
| `zone` | — | Entità `climate` della zona. |
| `hours_to_show` | `24` | Ore di storico (1-168). |
| `height` | `180` | Altezza grafico in px. |
| `min_temp` | auto | Minimo Y (vuoto = auto). |
| `max_temp` | auto | Massimo Y (vuoto = auto). |
| `show_current` | `true` | Mostra linea temperatura attuale. |
| `show_target` | `true` | Mostra linea target. |

## Logica di controllo

Per ogni zona il target effettivo viene risolto in questo ordine:

1. **Bypass attivo** → temperatura assoluta, offset sul target di profilo o freeze.
2. **Override manuale** → temperatura impostata a mano sul termostato, con scadenza.
3. **Profilo attivo** → curva oraria del giorno.
4. **Controllo disabilitato** → nessuna scrittura, il termostato resta com'è.

## Servizi

Tutti i servizi accettano `zones` come lista di id zona oppure entità `climate.*`. Se omesso, si applicano a tutte le zone.

### Imposta profilo

```yaml
action: ha_thermo.set_profile
data:
  profile: comfort
  zones: [climate.studio]
  duration: 120
```

Usa `profile: __auto__` per tornare a seguire il profilo attivo. `duration` è in minuti oppure `HH:MM`.

### Bypass

```yaml
action: ha_thermo.start_bypass
data:
  zones: [climate.studio]
  temperature: 22.5
  duration: 60
```

```yaml
action: ha_thermo.start_bypass
data:
  zones: [climate.soggiorno]
  offset: -1.5
  until: "2026-11-02T22:00:00+01:00"
```

Senza `temperature` e `offset` il bypass congela il target corrente. Usa `source` per etichettare l'origine.

```yaml
action: ha_thermo.stop_bypass
data:
  zones: [climate.studio]
```

### Temperatura temporanea

```yaml
action: ha_thermo.set_temperature
data:
  zones: [climate.studio]
  temperature: 21.5
  duration: 45
```

### Abilita controllo

```yaml
action: ha_thermo.enable
data:
  enabled: false
  zones: [climate.studio]
```

### Gestione profili

- `ha_thermo.create_profile` / `ha_thermo.update_profile` con `profile` (oggetto completo).
- `ha_thermo.delete_profile` con `profile_id`.
- `ha_thermo.clone_profile` con `source_id`, `name` e `zones` opzionale.
- `ha_thermo.reload`.

## Automazioni esempio

### Fuori casa (override temperatura illimitato)

```yaml
alias: Fuori casa - temperature ridotte
trigger:
  - platform: state
    entity_id: person.marco
    to: not_home
condition:
  - condition: state
    entity_id: person.anna
    state: not_home
action:
  - action: ha_thermo.set_temperature
    data:
      zones: [climate.studio, climate.soggiorno]
      temperature: 17
```

### Ritorno a casa (ripristina profilo)

```yaml
alias: Ritorno a casa - ripristina
trigger:
  - platform: state
    entity_id: person.marco
    from: not_home
action:
  - action: ha_thermo.set_profile
    data:
      profile: comfort
      zones: [climate.studio, climate.soggiorno]
```

### Disattivazione completa (l'integrazione non scrive)

```yaml
alias: Vacanze - disattiva controllo
trigger:
  - platform: time
    at: "08:00:00"
action:
  - action: ha_thermo.enable
    data:
      enabled: false
      zones: [climate.studio]
```

```yaml
alias: Ritorno vacanze - riattiva
trigger:
  - platform: time
    at: "18:00:00"
action:
  - action: ha_thermo.enable
    data:
      enabled: true
      zones: [climate.studio]
  # L'integrazione reimposta automaticamente il profilo attivo
```

## Entità create

Per ogni zona:

| Entità | Descrizione |
| --- | --- |
| `sensor.<zona>_temperatura_attuale` | Temperatura ambiente dal sensore dedicato o dal termostato. |
| `sensor.<zona>_temperatura_target` | Target effettivo. |
| `sensor.<zona>_prossimo_cambio` | Prossimo cambio previsto (ogni ora). |
| `sensor.<zona>_bypass_rimanente` | Secondi rimanenti del bypass. |
| `binary_sensor.<zona>_bypass_attivo` | Bypass in corso. |
| `binary_sensor.<zona>_override_manuale` | Override manuale in corso. |
| `select.<zona>_profilo` | Profilo fissato o `Auto`. |
| `switch.<zona>_controllo_automatico` | Abilita il controllo della zona. |

## Import/Export profili

Dalle impostazioni della card termostato (matita) → Gestione profili:

- **Esporta**: scarica un file JSON con tutti i profili.
- **Importa**: carica un file JSON o incolla il contenuto testuale.

Formato JSON compatto:

```json
{
  "profiles": [
    {"id":"comfort","name":"Comfort","icon":"mdi:home-thermometer","hvac_mode":"heat","targets":{"studio":20},"curves":{"studio":{"mon":[20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20]}},"days":{"studio":["mon","tue","wed","thu","fri","sat","sun"]}}
  ]
}
```

## Struttura

```text
custom_components/ha_thermo/
├── __init__.py          setup, card statiche, servizi, websocket
├── config_flow.py       configurazione e opzioni
├── coordinator.py       scansione periodica
├── manager.py           risoluzione target e stato persistente
├── models.py            Zone, Profile, Bypass
├── bypass.py            helper per bypass temporanei
├── storage.py           Store versionato
├── entity.py            base entity
├── sensor.py / binary_sensor.py / select.py / switch.py
├── services.py          servizi HA
├── websocket_api.py     API per le card
├── const.py             costanti
├── strings.json         traduzioni
└── www/
    ├── ha-thermo-card.js
    ├── ha-thermo-graph-card.js
    └── ha-thermo-common.js
```

## Sviluppo

```bash
python -m compileall custom_components/ha_thermo
ruff check custom_components
node --check custom_components/ha_thermo/www/*.js
python -m pytest -q
```

## Licenza

MIT
