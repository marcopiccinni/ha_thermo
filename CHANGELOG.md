# Changelog

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
