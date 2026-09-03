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
3. Verifica o modifica i dati del referente.
4. Scrivi o incolla nel campo **Partecipanti** il testo.
5. Premi **Compila checkout**.
6. Se compare Cloudflare, completalo manualmente.
7. L'estensione prosegue appena rileva il token di verifica.
8. Compila nome e cognome del referente usando il primo partecipante e poi
   compila tutti i partecipanti presenti nel checkout.
9. Seleziona i consensi richiesti senza inviare il modulo.
10. Controlla sempre i dati prima di proseguire con l'acquisto.

## Formato dei partecipanti

Il testo può essere copiato direttamente dal gestionale e incollato nella
textarea **Partecipanti**, senza dover eliminare manualmente date, righe vuote o
annotazioni.

Formato tipico supportato:

```text
4 pax
Luca marzo July 2 1970
Marco Blu Oct 19 1962
giulio rossi July 14 1945 disabile
marco verdi Mar 29, 1945 assistente
```

Sono supportate anche date numeriche con barra normale, barra rovesciata o
trattino:

```text
merola, mario 12\02\1996
Manarin, Jhon 3/18/1960
Mario Rossi 1996-02-12
```

Le date vengono riconosciute e rimosse automaticamente. Sono ignorate anche:

- righe riepilogative come `4 pax`;
- righe vuote;
- entità HTML come `&#x20;` e `&nbsp;`;
- indicazioni come `disabile`, `disability`, `disabled`, `assistente`,
  `assistant`, `companion`, `accompagnatore` e `carer`.

È possibile usare questi formati:

```text
Nome Cognome
Cognome, Nome
Traveler 1: First Name: Nome Last Name: Cognome Date of Birth: 1996-02-12
```

Per nomi composti, tutte le parole prima del cognome vengono inserite nel campo
Nome:

```text
daniele Nicola munoz
```

diventa `Nome: daniele Nicola` e `Cognome: munoz`.

Le particelle più comuni dei cognomi composti vengono riconosciute:

```text
Luca De Angelis
```

diventa `Nome: Luca` e `Cognome: De Angelis`.

Quando nome e cognome potrebbero essere ambigui, usare il formato più sicuro
`Cognome, Nome`:

```text
Di Maria, Maria Teresa
D'Amico, Nicolò
```

La prima persona riconosciuta viene usata anche come referente della
prenotazione. Il contenuto della textarea non viene conservato quando si preme
**Salva**; deve essere incollato per ogni nuova prenotazione.

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
