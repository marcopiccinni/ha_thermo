# Changelog

## 0.3.11

- **Card controllo**: rimossa l’icona **ingranaggio** (`mdi:cog`) e l’apertura **more-info** dal climate in intestazione (la card grafico non aveva l’icona).

## 0.3.10

- **Grafici recorder (fix)**: storico sul **climate fisico** della zona (`zone.climate_entity`); merge degli attributi parziali (come History HA) così i cambi solo su `current_temperature` / `temperature` generano scalini; `significant_changes_only: false`; intestazione card con valori live dal dispositivo (non profilo integrazione). Fix backend `current_temperature` su attributo climate.
- **Legenda**: solo nome serie e colore (niente valori numerici né checkbox; niente toggle).
- **Configurazione**: tutto nell’**editor Lovelace** (zona/climate, serie grafico, sensori, intervallo, colori, **settimana Lun–Dom** con salvataggio `zone/weekly/set`); nessuna matita custom in card.

## 0.3.9

- **Grafici allineati allo storico HA**: mini grafico card controllo e **HA Thermo Grafico** usano il **recorder** (`history_during_period` con attributi completi, `significant_changes_only: false`), non più la curva profilo 0–23h.
- **Linee a gradino** (attuale blu, destinataria gialla), senza punti; asse X temporale (tick 6h, etichette data a mezzanotte); griglia Y ogni **1 °C** con margine ±1°; legenda con valore corrente e toggle serie; tooltip al passaggio.
- **Predefiniti**: **48h** grafico card, **24h** mini; overlay profilo **spento** di default (tratteggio opzionale). Selezione sensori ambiente invariata.

## 0.3.8

- **Card controllo – layout**: prima temperatura (slider solo in **Manuale**; in **Automatico** ambiente e setpoint in sola lettura), sotto **Automatico / Manuale** e pulsante **On/Off** sul climate (`turn_on` / `turn_off` o `hvac_mode`).
- **Settimana**: griglia giorni nascosta di default; si apre dall’icona **matita** (`mdi:pencil`) in intestazione; etichetta ridotta a «Settimana» (niente hint impostazioni).
- **Icone** intestazione: matita (pianificazione) e ingranaggio (more-info climate).

## 0.3.7

- **Card grafico**: storico reale dal **recorder** di Home Assistant (`history/history_during_period` con attributi), non più parsing errato di `state` sul climate (modalità HVAC → serie vuota) né risposta history indicizzata con `[0]`.
- **Setpoint a gradino** da attributi `temperature` / `target_temp_low`–`high`; **ambiente** da `current_temperature` o da **sensori `sensor.*` configurabili** (uno o più, virgola nell’editor).
- **Profilo di oggi** opzionale in tratteggio; asse Y con padding automatico; intervalli **6h / 12h / 24h / 48h / 7d**; tooltip; aggiornamento live su `state_changed` e eventi integrazione.
- **Editor visuale**: termostato/zona, sensori ambiente, intervallo, colori, overlay profilo.

## 0.3.6

- **Card controllo semplificata**: rimossi pulsanti *Bypass 60 min* e *Disattiva controllo* (servizi, entità `switch`/`binary_sensor` bypass e `ha_thermo.start_bypass` restano disponibili per automazioni).
- **Slider temperatura**: usa `set_temperature` invece del bypass temporaneo.
- **Profili globali**: gestione (crea/modifica/duplica/elimina, griglia oraria 00–23) spostata nel **flusso opzioni** dell'integrazione (Impostazioni → Dispositivi e servizi → HA Thermo → Configura → Profili condivisi). Aggiornamenti live su tutte le card.
- **Card**: restano collegamento termostato, auto/manuale, controllo temperatura e selezione profilo per giorno della settimana.

## 0.3.5

- **Profili = sola curva 24h condivisa** (`hourly[0..23]`): niente più curve per zona/giorno dentro il profilo.
- **Pianificazione per termostato**: ogni giorno (Lun–Dom) sceglie quale profilo condiviso usare (`weekly_profiles`), API `ha_thermo/zone/weekly/set`.
- **Editor profili** nella card: griglia oraria 00–23, crea/modifica/duplica/elimina; sincronizzazione live via `ha_thermo_profiles_changed` / `ha_thermo_zone_schedule_changed`.
- **Migrazione storage schema 2**: profili legacy → orari (Lun rappresentativo; se i giorni differivano si creano profili aggiuntivi `Nome (Gio)` ecc.); assegnazioni 0.3.4 → tutti i giorni; 0.3.3 `weekly_schedules` → mappa settimanale.
- **Eliminazione profilo**: giorni/zone che lo usavano → **Comfort** (invariato).

## 0.3.4

- **Rimossa** la pianificazione “un profilo per giorno per termostato” introdotta in 0.3.3 (`weekly_schedules`, API `weekly/set` e relativa UI).
- **Gestione profili condivisi** dalla card: crea, modifica, duplica ed elimina profili globali (storage integrazione); aggiornamenti visibili subito su tutte le card tramite evento `ha_thermo_profiles_changed` e `get_config`.
- **Modalità automatica / manuale**: in automatico il profilo scelto viene **assegnato** (`profile/assign`); in manuale si **blocca** l’override (`set_profile`).
- **Eliminazione profili**: i profili predefiniti (Comfort, Eco, …) non sono eliminabili; per i profili custom i termostati che li usavano passano al profilo di fallback (di default Comfort).

## 0.3.3

- **Fix critico Lovelace**: corretti i percorsi dei bundle in `CARD_FILES` (erano `www/...` rispetto alla cartella `www`, quindi i file non venivano serviti su `/ha_thermo/…` e le risorse andavano in 404).
- **Registrazione frontend (HA 2026.x)**: nuovo modulo `frontend.py` con `async_register_static_paths` / fallback legacy, attesa caricamento risorse Lovelace, aggiornamento cache-bust `?v=` e fallback YAML tramite `add_extra_js_url`.
- **Card picker**: aggiunta registrazione `window.customCards` per `ha-thermo-card` e `ha-thermo-graph-card` (nome, descrizione, anteprima, editor).
- **Card controllo**: pianificazione settimanale per giorno (modalità automatica), distinzione manuale/automatico, fix slider ±0.5°C.
- **Backend**: API WebSocket `ha_thermo/weekly/set` e persistenza `weekly_schedules`.

## 0.3.0

Riscrittura completa per semplificare l'integrazione.

- **Profili condivisi**: un unico repository di profili accessibile da tutte le card termostato.
- **Import/Export profili**: scarica e carica i profili come file JSON compatto.
- **Card termostato semplificata**: mostra temperatura attuale, target, slider manuale, selezione profilo, bypass e enable.
- **Card grafico con storico HA**: usa le API `recorder/history` di Home Assistant per mostrare lo storico di temperatura attuale e target (configurabile: ore, min/max).
- **Niente pianificazione settimanale complessa**: ogni card gestisce il proprio termostato in modo indipendente.
- **Bypass temporanei**: durata fissa o custom, con temperatura assoluta o offset.
- **Override manuale**: rileva i cambi dal termostato e applica un hold temporaneo.
- **Automazioni**: usa `ha_thermo.set_temperature` per override illimitati, oppure `ha_thermo.enable` per disattivare/riattivare il controllo.
- **Rimossa manager card**: configurazione zone dalle opzioni dell'integrazione, gestione profili dalla card singola.

## 0.2.9

Fix: i campi di testo non perdono più il focus ad ogni lettera; corretti i campi attivatore (giorni/zone/priorità/orari).

## 0.2.8

Grafico con scala adattiva e forecast 24h.

## 0.2.7

Fix: clona profilo usa source_id/name.

## 0.2.6

Fix: pulsanti Crea/Modifica profilo funzionanti.
