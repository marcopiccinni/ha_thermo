# Changelog

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
