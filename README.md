# HA Thermo

[![Validate](https://github.com/marcopiccinni/ha_thermo/actions/workflows/validate.yml/badge.svg)](https://github.com/marcopiccinni/ha_thermo/actions/workflows/validate.yml)

Integrazione custom per Home Assistant che porta la programmazione settimanale per zona sopra i termostati che già possiedi. Nessun hardware dedicato: HA Thermo legge e comanda le entità `climate` esistenti.

> Progetto personale non ufficiale. Nessuna garanzia di funzionamento o continuità. Verifica sempre il comportamento dei tuoi termostati.

## Caratteristiche

- Profili settimanali indipendenti per zona, con curva oraria 7×24 (24 valori per ogni giorno).
- Giorni attivabili per singola zona: nei giorni disattivati vale il target di fallback.
- Profili predefiniti: **Comfort 20 °C**, **Eco 19 °C**, **Notte 18 °C**, **Fuori casa 16 °C**, **Estate 26 °C**.
- Profili clonabili con deep copy indipendente e selezione opzionale delle zone.
- Attivatori con giorni, fascia oraria, priorità, zone e condizione opzionale su un’entità.
- Bypass temporanei assoluti, a offset o con blocco del target corrente (freeze).
- Override manuale rilevato quando qualcuno cambia la temperatura dal termostato, con hold configurabile.
- Riasserzione periodica del target per i termostati che lo perdono.
- Controllo diretto delle entità `climate`, senza termostati virtuali.
- Due card Lovelace incluse, senza build e senza dipendenze esterne.
- Tutto lo stato persistente sopravvive al riavvio di Home Assistant.
- Interfaccia in italiano, codice e identificatori in inglese.

## Installazione

### HACS (repository custom)

1. HACS → Integrazioni → menu ⋮ → **Repository personalizzati**.
2. Aggiungi `https://github.com/marcopiccinni/ha_thermo` come categoria **Integration**.
3. Installa **HA Thermo** e riavvia Home Assistant.
4. Impostazioni → Dispositivi e servizi → **Aggiungi integrazione** → HA Thermo.

### Manuale

Copia la cartella `custom_components/ha_thermo` in `<config>/custom_components/ha_thermo`, riavvia Home Assistant e aggiungi l’integrazione dalla UI.

## Configurazione iniziale

1. Scegli uno o più termostati (`climate.*`).
2. Ogni termostato diventa una zona con un id stabile.
3. Dalle **Opzioni** puoi:
   - modificare hold manuale, intervallo di riasserzione, intervallo di scansione;
   - cambiare le temperature predefinite dei cinque profili;
   - aggiungere, modificare o rimuovere zone, sensore temperatura dedicato e limiti.

Le zone hanno un id interno stabile: rinominarle non rompe profili, attivatori o bypass.

## Logica di controllo

Per ogni zona il target effettivo viene risolto in questo ordine:

1. **Bypass attivo** → temperatura assoluta, offset sul target di profilo o freeze.
2. **Override manuale** → temperatura impostata a mano sul termostato, con scadenza.
3. **Profilo attivo** → curva oraria del giorno oppure fallback se il giorno è disattivato.
4. **Controllo disabilitato** → nessuna scrittura, il termostato resta com’è.

Il profilo attivo è scelto da:

1. profilo fissato manualmente sulla zona (con scadenza opzionale);
2. attivatore con priorità più alta che corrisponde a giorno, ora, zona e condizione;
3. ultimo profilo attivo;
4. profilo predefinito (`comfort` se presente).

I target vengono scritti solo quando cambiano o quando serve una riasserzione. Le scritture innescate da HA Thermo vengono ignorate per 10 secondi, così non generano falsi override manuali.

## Entità create

Per ogni zona:

| Entità | Descrizione |
| --- | --- |
| `sensor.<zona>_temperatura_attuale` | Temperatura ambiente dal sensore dedicato o dal termostato. |
| `sensor.<zona>_temperatura_target` | Target effettivo, con profilo, bypass e override negli attributi. |
| `sensor.<zona>_prossimo_cambio` | Prossimo cambio previsto. |
| `sensor.<zona>_bypass_rimanente` | Secondi rimanenti del bypass. |
| `binary_sensor.<zona>_bypass_attivo` | Bypass in corso. |
| `binary_sensor.<zona>_override_manuale` | Override manuale in corso. |
| `select.<zona>_profilo` | Profilo fissato o `Auto (attivatori)`. |
| `switch.<zona>_controllo_automatico` | Abilita il controllo della zona. |

Sul dispositivo hub:

- `binary_sensor.ha_thermo_bypass_attivo`
- `select.ha_thermo_profilo`
- `switch.ha_thermo_controllo_automatico`

Gli id esatti dipendono dal nome assegnato da Home Assistant. Le card usano gli `entity_id` reali dal registry.

## Card Lovelace

Le card vengono servite da `/ha_thermo/ha-thermo-card.js` e `/ha_thermo/ha-thermo-manager-card.js` e caricate automaticamente. Se usi la modalità YAML delle risorse, aggiungi:

```yaml
lovelace:
  resources:
    - url: /ha_thermo/ha-thermo-card.js?v=0.1.1
      type: module
    - url: /ha_thermo/ha-thermo-manager-card.js?v=0.1.1
      type: module
```

### Panoramica

```yaml
type: custom:ha-thermo-card
title: Termostati
show_graph: true
bypass_minutes: 60
hold_minutes: 60
```

Opzioni:

| Opzione | Default | Descrizione |
| --- | --- | --- |
| `title` | `Termostati` | Titolo della card. |
| `zone` | tutte | Id zona, entità climate o nome; accetta anche una lista. |
| `show_graph` | `true` | Mostra la curva del giorno con target e temperatura attuale. |
| `bypass_minutes` | `60` | Durata del pulsante bypass rapido. |
| `hold_minutes` | `60` | Durata dell’override quando usi slider e pulsanti. |

La card mostra temperatura attuale e target, curva del profilo attivo, slider, selettore profilo, bypass rapido e stato del prossimo cambio.

### Gestione

```yaml
type: custom:ha-thermo-manager-card
title: HA Thermo Manager
```

Quattro schede:

- **Zone**: stato, profilo, bypass rapido, abilitazione.
- **Profili**: crea, modifica, clona ed elimina profili; editor delle 24 ore per giorno e zona.
- **Attivatori**: crea e modifica regole con giorni, orari, priorità, zone e condizioni.
- **Bypass**: elenco attivi, stop e avvio con temperatura, offset, freeze, durata o scadenza.

Un esempio completo è in [`docs/dashboard-example.yaml`](docs/dashboard-example.yaml).

## Servizi

Tutti i servizi accettano `zones` come lista di id zona oppure entità `climate.*`. Se omesso, si applicano a tutte le zone.

### Imposta profilo

```yaml
action: ha_thermo.set_profile
data:
  profile: eco
  zones: [climate.studio]
  duration: 120
```

Usa `profile: __auto__` per tornare a seguire gli attivatori. `duration` è in minuti oppure `HH:MM`.

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

```yaml
action: ha_thermo.start_bypass
data:
  zones: [climate.camera]
  duration: 90
```

Senza `temperature` e `offset` il bypass congela il target corrente. Usa `source` per etichettare l’origine.

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

### Altri servizi

- `ha_thermo.enable` con `enabled` e `zones` opzionale.
- `ha_thermo.create_profile` / `ha_thermo.update_profile` con `profile` (oggetto completo).
- `ha_thermo.delete_profile` con `profile_id`.
- `ha_thermo.clone_profile` con `source_id`, `name` e `zones` opzionale.
- `ha_thermo.create_activator` / `ha_thermo.update_activator` con `activator`.
- `ha_thermo.delete_activator` con `activator_id`.
- `ha_thermo.reload`.

## Eventi

| Evento | Dati principali |
| --- | --- |
| `ha_thermo_profile_changed` | `zone_id`, `profile_id`, `profile_name`, `source` |
| `ha_thermo_bypass_started` | `bypass`, `zones` |
| `ha_thermo_bypass_ended` | `bypass`, `zones` |
| `ha_thermo_target_changed` | `zone_id`, `target`, `source` |
| `ha_thermo_manual_override` | `zone_id`, `temperature`, `until` |

Esempio di automazione:

```yaml
triggers:
  - trigger: event
    event_type: ha_thermo_manual_override
actions:
  - action: notify.mobile_app
    data:
      message: >-
        Override manuale in {{ trigger.event.data.zone_id }}:
        {{ trigger.event.data.temperature }} °C fino a {{ trigger.event.data.until }}
```

## Websocket

Le card usano queste API:

- `ha_thermo/get_config`
- `ha_thermo/set_profile`
- `ha_thermo/set_temperature`
- `ha_thermo/set_enabled`
- `ha_thermo/bypass/start`
- `ha_thermo/bypass/stop`
- `ha_thermo/profile/create|update|delete|clone`
- `ha_thermo/activator/create|update|delete`

## Struttura

```text
custom_components/ha_thermo/
├── __init__.py          setup, card statiche, servizi, websocket
├── config_flow.py       configurazione e opzioni
├── coordinator.py       scansione periodica
├── manager.py           risoluzione target e stato persistente
├── models.py            Zone, Profile, Activator, Bypass
├── schedule.py          curve, attivatori, prossimo cambio
├── bypass.py            durate e bypass attivi
├── storage.py           persistenza
├── services.py          servizi HA
├── websocket_api.py     API per le card
├── sensor.py            sensori
├── binary_sensor.py     bypass e override
├── select.py            profilo
├── switch.py            controllo automatico
├── www/                 card Lovelace
└── translations/        italiano e inglese
```

Dettagli in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Sviluppo

```bash
python3 -m pytest -q
ruff check custom_components tests
python3 -m compileall -q custom_components/ha_thermo
node --check custom_components/ha_thermo/www/ha-thermo-card.js
node --check custom_components/ha_thermo/www/ha-thermo-manager-card.js
```

I test coprono i moduli puri (`models`, `schedule`, `bypass`) senza richiedere Home Assistant.

## Limitazioni

- Non crea entità `climate`: comanda i termostati esistenti.
- Il rilevamento dell’override dipende dal fatto che il termostato aggiorni `temperature` quando viene cambiato localmente.
- La risoluzione avviene ogni 10–300 secondi (default 30); non è pensata per controllo sub-secondo.
- I termostati che ignorano `set_temperature` o cambiano modalità da soli possono richiedere riasserzioni più frequenti.
- Le card non usano la cronologia di Home Assistant: il grafico mostra la curva del profilo e le temperature correnti.

## Licenza

MIT. Vedi [LICENSE](LICENSE).
