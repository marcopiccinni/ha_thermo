# Changelog

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
