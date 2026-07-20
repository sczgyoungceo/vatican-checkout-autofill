# Vatican Checkout Autofill

Estensione Chrome Manifest V3 per compilare i dati ricorrenti nella pagina:

https://tickets.museivaticani.va/home/checkout

## Installazione

1. Estrai il file ZIP.
2. Apri Chrome.
3. Vai a `chrome://extensions`.
4. Attiva **Modalità sviluppatore**.
5. Premi **Carica estensione non pacchettizzata**.
6. Seleziona la cartella `vatican-checkout-autofill`.
7. Fissa l'estensione nella barra di Chrome.

## Utilizzo

1. Arriva alla pagina checkout dei Musei Vaticani.
2. Premi l'icona dell'estensione.
3. Verifica o modifica i dati.
4. Premi **Compila checkout**.
5. Se compare Cloudflare, completalo manualmente.
6. L'estensione prosegue appena rileva il token di verifica.
7. Controlla sempre i dati prima di proseguire con l'acquisto.

## Comportamento dei checkbox

Il consenso per le informazioni via email viene selezionato prima.

Le norme generali di acquisto vengono selezionate come ultima interazione, perché
il sito può aprire un popup e può annullare il checkbox quando si clicca fuori.
Chiudi quel popup esclusivamente con il comando previsto dal sito, non cliccando
sullo sfondo.

## Cloudflare

L'estensione non tenta di cliccare, risolvere o aggirare Cloudflare Turnstile.
Può soltanto:

- rilevare la presenza del widget;
- attendere che l'utente completi la verifica;
- proseguire quando il campo `cf-turnstile-response` contiene un token.

## Sicurezza

- Funziona solo sul dominio `tickets.museivaticani.va`.
- Non invia dati a server esterni.
- Salva i valori con `chrome.storage.local` nel profilo locale del browser.
- Non preme il pulsante finale di acquisto o pagamento.

## Se un campo non viene riconosciuto

Il checkout è un'app Angular e i suoi ID `mat-mdc-*` possono cambiare.
L'estensione cerca quindi i campi usando etichette, placeholder, tipo e testo
del relativo componente, non un ID numerico fisso.

Per correggere un campo:

1. Apri DevTools con `F12`.
2. Usa lo strumento di selezione elemento.
3. Seleziona il campo non compilato.
4. Copia `OuterHTML`.
5. Aggiorna i token o il selettore corrispondente in `content.js`.
