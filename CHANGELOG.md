# Changelog

## 0.3.0

- **Pianificazione settimanale per zona**: per ogni giorno si sceglie il profilo da seguire (tab *Pianificazione* della manager card). `Auto` lascia decidere attivatori e profilo predefinito.
- **Nuovi servizi**: `ha_thermo.set_weekday_profile`, `ha_thermo.clear_weekday_profile`, `ha_thermo.set_profile_override`, `ha_thermo.clear_profile_override`. I giorni accettano `mon`…`sun` o i gruppi `weekdays`, `weekend`, `all`.
- **Override temporaneo di profilo** da servizio/automazione: alla scadenza (o con `clear_profile_override`) la zona torna al profilo pianificato del giorno.
- **Nuova precedenza di risoluzione**: override → attivatori orari → piano settimanale → attivatori base a giornata intera → ultimo profilo → default.
- **Nuovi eventi**: `ha_thermo_profile_override_started`, `ha_thermo_profile_override_ended`, `ha_thermo_weekly_changed`.
- **Websocket**: `ha_thermo/weekly/set`, `ha_thermo/weekly/clear`, `ha_thermo/override/set`, `ha_thermo/override/clear`.
- **Editor profilo con input HTML nativi**: le 24 temperature orarie sono campi numerici modificabili con frecce o digitazione; nessun ridisegno durante la modifica per non perdere il focus.
- Attributi extra sull'entità `select` di zona: `profile_source`, `weekly_profile_today`, `pinned_until`.
- Grafico 24h con scala adattiva e serie previsionale del target per zona.

## 0.2.1

- Ripristinato il metodo `_fire` mancante che causava l'errore "ThermoManager object has no attribute '_fire'" durante la configurazione iniziale.

## 0.2.0

- **Tre card Lovelace separate**: `ha-thermo-card` (controlli), `ha-thermo-graph-card` (grafico 24h), `ha-thermo-manager-card` (gestione). Ogni card può essere configurata per un singolo termostato.
- **Card per termostato**: ogni istanza mostra un solo termostato; se non configurato, viene usato l'unico disponibile o mostrato un messaggio di configurazione.
- **Editor visuale ricco**: selezione termostato da dropdown, titolo automatico, toggle per grafico/slider/profilo/bypass/enable/stato, durate bypass e override.
- **Modifica impostazioni zona dalla matita**: nome, entità climate, sensore temperatura, min/max, temperatura default (solo admin). Le modifiche vengono salvate nelle opzioni della config entry e l'integrazione si ricarica automaticamente.
- **Manager filtrata**: la card manager può essere limitata a una zona specifica oppure mostrare tutte le zone (default "Tutte" per compatibilità).
- **Registrazione affidabile delle card**: le card vengono registrate come risorse Lovelace persistenti in modalità storage, con fallback per modalità YAML. Risolto il problema per cui le card non comparivano nel selettore.
- **Suggerimenti nel card picker**: le card vengono suggerite quando si seleziona un'entità `climate`.
- **Compatibilità**: le dashboard esistenti con `ha-thermo-card` senza `zone` mostreranno un messaggio "Scegli il termostato"; è necessario duplicare la card per ogni termostato. La manager senza `zone` resta globale. Il parametro `show_graph: true` sulla card controlli è supportato come modalità combinata deprecata.

## 0.1.1

- Corretto il clone di profili e attivatori quando il nome è vuoto.
- Corretto il refresh del coordinatore dopo le modifiche.
- Il device hub viene creato prima delle zone, evitando il warning `via_device`.
- Rimossa l'assegnazione automatica delle aree Home Assistant (`suggested_area`).

## 0.1.0

Prima versione.

- Integrazione custom `ha_thermo` con configurazione da UI e una sola config entry.
- Zone illimitate basate su entità `climate`, sensore temperatura opzionale e limiti per zona.
- Profili settimanali 7×24 per zona con fallback e giorni attivabili.
- Profili predefiniti Comfort, Eco, Notte, Fuori casa ed Estate.
- Clonazione profili con deep copy e selezione opzionale delle zone.
- Attivatori con giorni, fascia oraria, priorità, zone e condizione.
- Bypass assoluti, a offset e freeze, con durata o scadenza assoluta.
- Override manuale con hold configurabile e riasserzione periodica.
- Entità sensor, binary_sensor, select e switch per ogni zona più hub.
- Servizi completi per profili, attivatori, bypass, temperatura e abilitazione.
- Websocket API e card Lovelace `ha-thermo-card` e `ha-thermo-manager-card`.
- Persistenza dello stato e ripristino dopo riavvio.
- Traduzioni italiano e inglese.
- Test dei moduli puri e CI con hassfest, HACS, ruff e pytest.

## 0.2.2

- Corretta la versione negli import delle card (`?v=0.2.2` per cache busting).

## 0.2.3

- Corretto errore di sintassi JavaScript in ha-thermo-manager-card.js (parentesi mancante nell'editor).

## 0.2.4

- Corretto dropdown termostato duplicato negli editor delle card.

## 0.2.5

- Fix: creazione e modifica profili funzionante (inizializzazione curve per tutte le zone).
- Fix: grafici mostrano curva 24h corretta invece di linea retta.
- Fix: messaggio "Nessun dato" quando le curve non sono disponibili.
- Fix: salvataggio profili aggiorna correttamente la lista.

## 0.2.6

- Fix: pulsanti "Crea profilo" e "Modifica profilo" funzionanti (rimosso errore "Too much recursion").
- Fix: editor profili gestisce correttamente zone e giorni.
- Fix: salvataggio profili e attivatori ricarica correttamente la lista.

## 0.2.7

- Fix: clona profilo inviava campi errati (`new_id`/`new_name` invece di `source_id`/`name`) causando errore "not a valid option".

## 0.2.8

- Grafico: scala verticale adattiva ai dati (le oscillazioni ora sono visibili).
- Grafico: nuova linea "programma" calcolata dal backend per tutte le 24 ore (attivatori + curve), con griglia e ore.
- Grafico: punti orari e fallback quando manca una curva.

## 0.2.9

- Fix: i campi di testo (nome profilo, icona, nome attivatore, ecc.) non perdono piu il focus a ogni lettera.
- Fix: campi attivatore (giorni/zone/priorita/orari) ora leggono correttamente i valori (dataset corretto).
- Fix: gli editor visivi delle card non si ridisegnano a ogni aggiornamento di stato.
- Fix: il refresh periodico non interrompe la modifica di una bozza aperta.
