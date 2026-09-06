# CATO VPN Manager

Controlla il client Linux Cato SDP da GNOME Shell e mostra lo stato corrente
della connessione.

## Stato

- grigio: servizio Cato spento;
- rosso: servizio attivo, Cato non connesso o in attesa di autenticazione;
- verde: Cato connesso;
- blu: Cato connesso con un profilo di routing riconosciuto;
- giallo: Cato connesso, ma le route sono parziali, ambigue o non riconosciute.

## Azioni del menu

- `Connetti` avvia il client Cato.
- `Connetti con nuova autenticazione` avvia Cato e richiede un nuovo login.
- `Disconnetti` ferma la connessione VPN.
- `Dettagli stato Cato` mostra l'ultimo output di `cato-sdp status`.
- `Aggiorna stato` richiede un nuovo controllo dello stato.

## Profili di routing

I profili di routing sono pensati per debug, troubleshooting e amministrazione
avanzata. Descrivono una configurazione di route attesa e vengono applicati
solo quando selezionati esplicitamente dal menu.

L'applicazione dei profili richiede l'helper opzionale. Senza helper,
l'estensione può comunque riconoscere i profili configurati dalla tabella di
routing corrente.

## Privacy

`cato-sdp status` può includere account, email e indirizzi IP. L'estensione
mantiene questo output in memoria e non lo scrive su disco.
