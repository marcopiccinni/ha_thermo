# Changelog

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
