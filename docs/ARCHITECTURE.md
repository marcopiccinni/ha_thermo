# Architettura

## Flusso

```text
Config entry / options
        │
        ▼
  ThermoManager ──────────────── ThermoStore (storage)
        │                              ▲
        │  risolve target              │ debounce 2s / flush
        ▼                              │
  ThermoCoordinator (ogni 10–300 s)    │
        │                              │
        ▼                              │
  climate.set_temperature  ──►  termostato reale
        │
        ▼
  entità sensor / binary_sensor / select / switch
        │
        ▼
  websocket_api  ──►  card Lovelace
```

Il manager è l’unico proprietario dello stato logico. Le entità leggono il manager tramite `CoordinatorEntity`; le card leggono lo stesso stato con `ha_thermo/get_config` e inviano comandi via websocket.

## Moduli

| Modulo | Responsabilità |
| --- | --- |
| `const.py` | Costanti, chiavi, default, eventi, nomi servizi, file card. |
| `models.py` | Dataclass pure: `Zone`, `Profile`, `Activator`, `Bypass`; normalizzazione, clone, validazione. |
| `schedule.py` | Risoluzione curva, match attivatori, prossimi cambi. Nessun import HA. |
| `bypass.py` | Parsing durate/scadenze, bypass attivo, secondi rimanenti. Nessun import HA. |
| `storage.py` | Wrapper su `homeassistant.helpers.storage.Store`, chiave per entry. |
| `manager.py` | Caricamento, merge zone, risoluzione target, applicazione, override, CRUD. |
| `coordinator.py` | `DataUpdateCoordinator` che chiama `manager.async_tick()` a intervalli. |
| `entity.py` | Base entity, `DeviceInfo` per hub e zone, disponibilità. |
| `sensor.py` | Temperatura attuale, target, prossimo cambio, bypass rimanente. |
| `binary_sensor.py` | Bypass e override per zona, bypass hub. |
| `select.py` | Profilo hub e per zona, con `Auto` = attivatori. |
| `switch.py` | Controllo automatico hub e per zona. |
| `config_flow.py` | Setup iniziale, opzioni, CRUD zone. |
| `services.py` | Registrazione servizi e schemi. |
| `websocket_api.py` | Comandi per le card. |
| `__init__.py` | Setup entry, piattaforme, registrazione servizi/websocket/card. |
| `www/*.js` | Card Lovelace vanilla, shadow DOM, nessuna build. |

## Modello dati

### Zone

`Zone` contiene id stabile, nome, entità climate, sensore opzionale, limiti e temperatura di fallback. I limiti vengono applicati a tutti i target prima della scrittura.

### Profili

Un profilo contiene, per ogni zona:

- `targets[zone]`: fallback per giorni disattivati;
- `curves[zone][day]`: lista di 24 float;
- `days[zone]`: giorni in cui la curva è attiva.

`hvac_mode` opzionale viene applicato una volta per cambio profilo. `clone()` crea una copia profonda e può limitarsi a un sottoinsieme di zone.

### Attivatori

Un attivatore seleziona un profilo quando:

- è abilitato;
- il giorno è incluso in `days`;
- l’ora corrente è nella fascia `start`–`end` (fascia che attraversa la mezzanotte supportata);
- la zona è inclusa in `zones` (lista vuota = tutte);
- la condizione opzionale corrisponde.

A parità di corrispondenza vince la priorità più alta. `next_activator_change` e `next_change` calcolano il prossimo cambio per le entità.

### Piano settimanale

`weekly_profiles[zone][day]` associa a ogni giorno (`mon`…`sun`) l’id di un profilo. È gestito dal tab *Pianificazione* della manager card e dai servizi `set_weekday_profile` / `clear_weekday_profile`; `__auto__` rimuove l’assegnazione. I gruppi `weekdays`, `weekend` e `all` vengono espansi da `expand_days` in `schedule.py`.

### Bypass

Un bypass ha `until`, `zones` (vuota = tutte), `temperature` oppure `offset`, e `source`. Se nessuno dei due valori è presente, il manager crea un bypass di freeze per ogni zona con il target corrente. I bypass scaduti vengono rimossi al tick successivo e generano `ha_thermo_bypass_ended`.

## Risoluzione del target

```text
disabled (globale o zona)  → nessuna scrittura
bypass                     → resolve(base)
override manuale           → temperatura override
profilo                    → curva oraria / fallback
```

`base` per un bypass a offset è il target del profilo attivo; se non esiste, è il target attuale del climate o il fallback della zona. Il risultato viene sempre limitato a `[zone.min_temp, zone.max_temp]`.

La scelta del profilo segue `resolve_profile_choice` (in `schedule.py`):

```text
override temporaneo (pin)
  → attivatori orari (end != None oppure start != 00:00)
  → piano settimanale del giorno
  → attivatori base a giornata intera (00:00 senza end)
  → ultimo profilo attivo
  → profilo predefinito
```

Quando un override scade o viene rimosso, `active_profiles` viene risolto di nuovo così la zona torna subito al piano settimanale.

## Applicazione

`_apply_zone` calcola il target, emette `ha_thermo_target_changed` quando cambia e decide se scrivere:

- scrittura se il target desiderato è cambiato;
- riasserzione se è passato `reassert_interval` e il climate è lontano più di 0,4 °C;
- `hvac_mode` del profilo applicato una volta per cambio profilo.

Prima di chiamare `climate.set_temperature` il manager salva il target desiderato e imposta una finestra di ignore di 10 secondi. Questo evita che l’eco del termostato venga interpretato come override manuale.

## Override manuale

`async_track_state_change_event` ascolta tutte le entità climate. Se il termostato cambia `temperature` al di fuori della finestra di ignore, senza bypass attivo e con controllo abilitato:

- viene creato un override con scadenza `manual_hold` minuti;
- viene emesso `ha_thermo_manual_override`;
- lo stato viene persistito.

Se `manual_hold` è 0 il rilevamento è disabilitato. Un nuovo comando HA Thermo rimuove l’override della zona.

## Persistenza

Chiave: `ha_thermo.state.<entry_id>`, versione 1.

Vengono salvati:

- profili, attivatori, bypass, piano settimanale (`weekly_profiles`);
- profilo attivo, pin manuali, override;
- stato globale e zone disabilitate.

Le impostazioni e le zone restano nelle opzioni della config entry; il manager le riconcilia con i profili salvati a ogni avvio (`_sync_zones`). Zone rimosse vengono eliminate da profili, pin, override, attivatori e bypass.

## Entità

`unique_id = <entry_id>_<zone_id>_<key>`.

L’id entità viene risolto dal registry (`entity_registry.async_get_entity_id`) e incluso nello snapshot `get_config`, così le card non devono indovinare nomi o slug.

## Websocket e card

Le card sono file statici registrati da `__init__.py` con `StaticPathConfig` e caricati con `add_extra_js_url`. Non serve HACS frontend né build. Le card:

- chiamano `ha_thermo/get_config` all’avvio e ogni 30 secondi;
- si aggiornano sugli eventi `ha_thermo_*`;
- usano shadow DOM, CSS variables di HA e HTML nativo;
- non inseriscono mai input dell’utente senza escaping.

## Aggiungere una funzionalità

1. Modello puro in `models.py` con `to_dict`/`from_dict`/`validate`.
2. Logica pura in `schedule.py` o `bypass.py` con test.
3. Metodo `async_*` nel manager, persistenza e notifica.
4. Servizio in `services.py` + `services.yaml` + traduzioni.
5. Comando websocket se serve alla UI.
6. UI nella card con fallback leggibile.
