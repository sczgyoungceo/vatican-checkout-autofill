(() => {
  if (globalThis.__VATICAN_CHECKOUT_AUTOFILL_LOADED__) return;
  globalThis.__VATICAN_CHECKOUT_AUTOFILL_LOADED__ = true;

  const BANNER_ID = "vatican-checkout-autofill-status";
  const LOG_KEY = "vaticanAutofillLastLog";
  let activeLog = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "VATICAN_AUTOFILL") return;

    sendResponse({ ok: true, started: true });

    runAutofill(message.payload).catch((error) => {
      console.error("[Vatican Autofill]", error);
      addLog("error", "Errore non gestito", {
        message: error?.message,
        stack: error?.stack
      });
      saveLog();
      showBanner(`Errore: ${error?.message || "compilazione non riuscita"}`, "error", 12000);
    });
  });

  async function runAutofill(data) {
    startLog(data);

    if (location.hostname !== "tickets.museivaticani.va" ||
        !location.pathname.startsWith("/home/checkout")) {
      throw new Error("URL checkout non valida.");
    }

    if (data.waitCloudflare) {
      const state = getCloudflareState();

      if (state === "pending") {
        showBanner(
          "Completa manualmente Cloudflare. Il modulo verrÃ  compilato appena la verifica termina.",
          "waiting"
        );

        const completed = await waitForCloudflare(5 * 60 * 1000);

        if (!completed) {
          throw new Error("Cloudflare non Ã¨ stato completato entro 5 minuti.");
        }
      }
    }

    showBanner("Compilazione dei campi in corso...", "working");
    addLog("snapshot", "Controlli visibili prima della compilazione", collectPageSnapshot());

    const results = [];

    results.push(await fillSelectLike({
      value: data.gender || "Maschio",
      tokens: ["sesso", "sex", "gender"],
      label: "Sesso",
      optionAliases: ["maschio", "male", "m"],
      directSelector: '[data-cy="managerSex"]',
      optionSelector: '[data-cy="managerSexSection"]'
    }));

    results.push(await fillSelectLike({
      value: data.country || "Italia",
      tokens: ["paese", "country", "nazione", "nazionalita", "nationality"],
      label: "Paese",
      optionAliases: ["italia", "italy"],
      directSelector: '[data-cy="managerCountry"]',
      optionSelector: '[data-cy="managerCountrySection"]'
    }));

    results.push(await fillSelectLike({
      value: data.language || "Italiano",
      tokens: ["lingua", "language", "idioma"],
      label: "Lingua",
      optionAliases: ["italiano", "italian"],
      directSelector: '[data-cy="managerLanguage"]',
      optionSelector: '[data-cy="managerLanguageSection"]'
    }));

    results.push(fillTextField({
      value: data.city,
      preferredSelector: "textarea",
      tokens: ["citta", "city", "comune", "localita", "luogo", "roma"],
      label: "CittÃ ",
      allowFirstVisibleFallback: true
    }));

    results.push(fillDate(data.birthDate));

    results.push(fillTextField({
      value: data.email,
      preferredSelector: 'input[type="email"], input[autocomplete="email"]',
      tokens: ["email", "e-mail", "posta elettronica"],
      label: "Email",
      allowFirstVisibleFallback: true
    }));

    results.push(fillConfirmEmail(data.email));

    results.push(fillTextField({
      value: data.phone,
      preferredSelector: '[data-cy="managerPhone"], input[type="tel"], input[autocomplete="tel"]',
      tokens: ["telefono", "phone", "telephone", "telephonenumber", "cellulare", "mobile", "tel"],
      label: "Telefono",
      allowFirstVisibleFallback: true
    }));

    results.push(fillParticipants(data.participantsText));

    // Il consenso marketing viene selezionato prima delle norme:
    // il checkbox delle norme puÃ² aprire un popup/modale.
    results.push(setCheckboxByText({
      desired: Boolean(data.marketing),
      tokens: [
        "ricevere informazioni",
        "informazioni via email",
        "comunicazioni commerciali",
        "newsletter",
        "marketing",
        "promozionali"
      ],
      excludedTokens: ["norme", "condizioni", "acquisto"],
      label: "Consenso email"
    }));

    const missingBeforeTerms = results.filter((result) => !result.ok);

    if (data.terms) {
      showBanner(
        missingBeforeTerms.length
          ? `Compilazione parziale. Ora seleziono le norme per ultimo. Campi non riconosciuti: ${missingBeforeTerms.map(r => r.label).join(", ")}.`
          : "Campi compilati. Seleziono le norme generali per ultimo.",
        missingBeforeTerms.length ? "warning" : "success",
        12000
      );

      // Deve essere l'ultima interazione con la pagina per non cliccare fuori
      // dall'eventuale popup aperto dal sito.
      const termsResult = setCheckboxByText({
        desired: true,
        tokens: [
          "norme generali di acquisto",
          "norme generali",
          "condizioni generali di acquisto",
          "condizioni di acquisto",
          "termini e condizioni",
          "terms and conditions"
        ],
        excludedTokens: [
          "newsletter",
          "marketing",
          "ricevere informazioni",
          "promozionali"
        ],
        label: "Norme generali"
      });

      results.push(termsResult);
      addLog("result", "Risultato compilazione", { results });
      await saveLog();
      return;
    }

    const missing = results.filter((result) => !result.ok);

    showBanner(
      missing.length
        ? `Compilazione parziale. Campi non riconosciuti: ${missing.map(r => r.label).join(", ")}.`
        : "Compilazione completata. Controlla i dati prima di proseguire.",
      missing.length ? "warning" : "success",
      12000
    );
    addLog("result", "Risultato compilazione", { results });
    await saveLog();
  }

  function getCloudflareState() {
    const responseField = document.querySelector(
      'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]'
    );

    const hasChallengeFrame = [...document.querySelectorAll("iframe")].some((frame) => {
      const source = frame.getAttribute("src") || "";
      const title = frame.getAttribute("title") || "";
      const descriptor = normalize(`${source} ${title}`);
      return descriptor.includes("cloudflare") ||
             descriptor.includes("turnstile") ||
             descriptor.includes("challenge");
    });

    if (responseField?.value?.trim()) return "complete";
    if (responseField || hasChallengeFrame) return "pending";
    return "absent";
  }

  async function waitForCloudflare(timeoutMs) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const state = getCloudflareState();

      if (state === "complete" || state === "absent") {
        showBanner("Cloudflare completato. Avvio compilazione...", "success", 2500);
        await sleep(500);
        return true;
      }

      await sleep(500);
    }

    return false;
  }

  async function fillSelectLike({
    value,
    tokens,
    label,
    optionAliases = [],
    directSelector = "",
    optionSelector = ""
  }) {
    if (!value) return fail(label);

    addLog("select", `Avvio select ${label}`, {
      value,
      tokens,
      optionAliases,
      directSelector,
      optionSelector,
      directCandidates: directSelector ? getCandidateSummaries(directSelector, tokens) : [],
      nativeCandidates: getCandidateSummaries("select", tokens),
      customCandidates: getCandidateSummaries(
        'mat-select, [role="combobox"], .mat-mdc-select, .mat-select',
        tokens
      )
    });

    if (directSelector) {
      const directResult = await fillCustomDropdownByInput({
        selector: directSelector,
        value,
        aliases: optionAliases,
        label,
        optionSelector
      });

      if (directResult.ok) return directResult;
    }

    const nativeSelect = findBestElement("select", tokens, true);

    if (nativeSelect) {
      addLog("select", `Select nativa scelta per ${label}`, {
        element: summarizeElement(nativeSelect),
        options: [...nativeSelect.options].map(summarizeOption)
      });

      const option = findMatchingOption([...nativeSelect.options], value, optionAliases);

      if (option) {
        setSelectValue(nativeSelect, option.value);
        addLog("select", `Opzione nativa selezionata per ${label}`, {
          option: summarizeOption(option)
        });
        return success(label);
      }

      addLog("select", `Nessuna opzione nativa corrisponde a ${label}`, {
        value,
        optionAliases
      });
    }

    const customSelect = findBestElement(
      'mat-select, [role="combobox"], .mat-mdc-select, .mat-select',
      tokens,
      true
    );

    if (customSelect) {
      addLog("select", `Select custom scelta per ${label}`, {
        element: summarizeElement(customSelect)
      });
      customSelect.scrollIntoView({ block: "center", inline: "nearest" });
      customSelect.click();
      await sleep(350);

      const options = [...document.querySelectorAll(
        'mat-option, [role="option"], .mat-mdc-option, .mat-option'
      )].filter(isVisible);

      addLog("select", `Opzioni custom visibili per ${label}`, {
        count: options.length,
        options: options.map(summarizeElement)
      });

      const option = findMatchingOption(options, value, optionAliases);

      if (option) {
        option.click();
        await sleep(200);
        addLog("select", `Opzione custom selezionata per ${label}`, {
          option: summarizeElement(option)
        });
        return success(label);
      }

      addLog("select", `Nessuna opzione custom corrisponde a ${label}`, {
        value,
        optionAliases
      });

      document.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true
      }));
    }

    const countryInput = findBestElement(
      'input:not([type]), input[type="text"], input[role="combobox"]',
      tokens,
      false
    );

    if (countryInput) {
      setInputValue(countryInput, value);
      addLog("select", `Compilato input fallback per ${label}`, {
        element: summarizeElement(countryInput)
      });
      return success(label);
    }

    addLog("select", `Select non riconosciuta per ${label}`, {
      value,
      tokens
    });
    return fail(label);
  }

  async function fillCustomDropdownByInput({
    selector,
    value,
    aliases,
    label,
    optionSelector = ""
  }) {
    const input = document.querySelector(selector);

    if (!input || !isVisible(input)) {
      addLog("select", `Input diretto non trovato per ${label}`, { selector });
      return fail(label);
    }

    addLog("select", `Input diretto scelto per ${label}`, {
      element: summarizeElement(input)
    });

    input.scrollIntoView({ block: "center", inline: "nearest" });
    clickElementLikeUser(input);
    await sleep(250);

    let options = getVisibleDropdownOptions(input, optionSelector);

    if (!options.length) {
      const clickableParent = input.closest(".muvaSelect, .select, [class*='select'], [class*='Select']") ||
        input.parentElement;

      if (clickableParent) {
        clickElementLikeUser(clickableParent);
        await sleep(250);
        options = getVisibleDropdownOptions(input, optionSelector);
      }
    }

    addLog("select", `Opzioni visibili dopo click diretto per ${label}`, {
      count: options.length,
      options: options.slice(0, 80).map(summarizeElement)
    });

    let option = findMatchingOption(options, value, aliases);

    if (!option) {
      option = await findOptionWhileScrolling(input, value, aliases, optionSelector);
    }

    if (!option) {
      closeOpenDropdown();
      return fail(label);
    }

    option.scrollIntoView({ block: "center", inline: "nearest" });
    await sleep(80);
    clickElementLikeUser(option);
    await sleep(150);

    addLog("select", `Opzione diretta selezionata per ${label}`, {
      option: summarizeElement(option),
      inputAfter: summarizeElement(input)
    });

    return success(label);
  }

  function clickElementLikeUser(element) {
    element.focus?.();
    element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    element.click();
  }

  async function findOptionWhileScrolling(anchor, value, aliases, optionSelector) {
    let options = getVisibleDropdownOptions(anchor, optionSelector);
    let scrollContainer = findDropdownScrollContainer(options[0] || anchor);

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const option = findMatchingOption(options, value, aliases);

      if (option) {
        option.scrollIntoView({ block: "center", inline: "nearest" });
        await sleep(100);
        return option;
      }

      if (scrollContainer && scrollContainer.scrollHeight > scrollContainer.clientHeight) {
        scrollContainer.scrollTop += Math.max(120, scrollContainer.clientHeight * 0.85);
        scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
      } else {
        anchor.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true,
          deltaY: 320
        }));
      }

      await sleep(120);
      options = getVisibleDropdownOptions(anchor, optionSelector);
      scrollContainer = scrollContainer || findDropdownScrollContainer(options[0] || anchor);
    }

    addLog("select", "Opzione non trovata dopo scroll dropdown", {
      value,
      aliases,
      optionSelector,
      lastOptions: options.slice(0, 80).map(summarizeElement)
    });

    return null;
  }

  function getVisibleDropdownOptions(anchor, optionSelector = "") {
    const anchorRect = anchor.getBoundingClientRect();
    const selector = optionSelector ||
      '[role="option"], mat-option, .mat-mdc-option, .mat-option, li, button, [data-cy], div, span';
    const candidates = [...document.querySelectorAll(selector)]
      .filter((element) => element !== anchor && isVisible(element))
      .filter((element) => {
        const text = cleanText(element.textContent);
        if (!text || text.length > 120) return false;
        if (element.querySelector("input, textarea, select")) return false;

        if (optionSelector) return true;

        const rect = element.getBoundingClientRect();
        const nearAnchor = rect.bottom >= anchorRect.top - 40 &&
          rect.top <= anchorRect.bottom + 450 &&
          rect.right >= anchorRect.left - 80 &&
          rect.left <= anchorRect.right + 160;

        const inOverlay = Boolean(element.closest(
          ".cdk-overlay-container, .cdk-overlay-pane, [class*='overlay'], [class*='dropdown'], [class*='select'], [class*='option']"
        ));

        return nearAnchor || inOverlay;
      });

    return [...new Set(candidates)];
  }

  function findDropdownScrollContainer(element) {
    let current = element?.parentElement;

    while (current && current !== document.body) {
      if (current.scrollHeight > current.clientHeight + 8) {
        return current;
      }

      current = current.parentElement;
    }

    return document.scrollingElement;
  }

  function closeOpenDropdown() {
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true
    }));
  }

  function fillParticipants(rawText) {
    const participants = parseParticipants(rawText);

    addLog("participants", "Partecipanti interpretati", {
      count: participants.length,
      participants
    });

    if (!participants.length) return success("Partecipanti");

    const results = [];
    const manager = participants[0];

    results.push(fillDirectInput("[data-cy=\"managerName\"]", manager.firstName, "Nome referente"));
    results.push(fillDirectInput("[data-cy=\"managerSurname\"]", manager.lastName, "Cognome referente"));

    participants.forEach((participant, index) => {
      results.push(fillDirectInput(`#participantName_${index}`, participant.firstName, `Nome partecipante ${index + 1}`));
      results.push(fillDirectInput(`#participantSurname_${index}`, participant.lastName, `Cognome partecipante ${index + 1}`));
    });

    const failed = results.filter((result) => !result.ok);
    return failed.length ? fail(`Partecipanti: ${failed.map((result) => result.label).join(", ")}`) : success("Partecipanti");
  }

  function fillDirectInput(selector, value, label) {
    if (!value) return fail(label);

    const element = document.querySelector(selector);
    if (!element || element.disabled || !isVisible(element)) return fail(label);

    setInputValue(element, value);
    return success(label);
  }

  function parseParticipants(rawText = "") {
    const text = String(rawText).trim();
    if (!text) return [];

    const travelerPattern = /Traveler\s*\d+\s*:\s*First Name\s*:\s*(.*?)\s+Last Name\s*:\s*(.*?)(?=\s+Date of Birth\s*:|\s+Traveler\s*\d+\s*:|$)/gis;
    const travelers = [];
    let match;

    while ((match = travelerPattern.exec(text))) {
      const firstName = cleanPersonName(match[1]);
      const lastName = cleanPersonName(match[2]);
      if (firstName && lastName) travelers.push({ firstName, lastName });
    }

    const travelerBlockPattern = /Traveler\s*\d+\s*:\s*First Name\s*:\s*.*?(?=\s+Traveler\s*\d+\s*:|\r?\n|$)/gis;
    const remainder = text.replace(travelerBlockPattern, "\n");
    const lineParticipants = remainder
      .split(/\r?\n/)
      .map((line) => parseParticipantLine(line))
      .filter(Boolean);

    return [...travelers, ...lineParticipants];
  }

  function parseParticipantLine(line) {
    let cleaned = String(line)
      .replace(/^\s*\d+\s*[).:-]\s*/, "")
      .replace(/\([^)]*\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[^)]*\)/gi, "")
      .replace(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\b/gi, "")
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "")
      .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, "")
      .replace(/[\s-]+$/g, "")
      .trim();

    if (!cleaned) return null;

    if (cleaned.includes(",")) {
      const [lastName, ...firstParts] = cleaned.split(",");
      const firstName = cleanPersonName(firstParts.join(","));
      const surname = cleanPersonName(lastName);
      return firstName && surname ? { firstName, lastName: surname } : null;
    }

    cleaned = cleaned.replace(/\s+-\s+.*$/g, "").trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return null;

    return {
      firstName: cleanPersonName(parts.slice(0, -1).join(" ")),
      lastName: cleanPersonName(parts.at(-1))
    };
  }

  function cleanPersonName(value = "") {
    return String(value)
      .replace(/\s+/g, " ")
      .replace(/^[-:;,\s]+|[-:;,\s]+$/g, "")
      .trim();
  }

  function fillTextField({
    value,
    preferredSelector,
    tokens,
    label,
    allowFirstVisibleFallback = false
  }) {
    if (!value) return fail(label);

    let element = findBestElement(preferredSelector, tokens, allowFirstVisibleFallback);

    if (!element) {
      element = findBestElement(
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea',
        tokens,
        false
      );
    }

    if (!element) return fail(label);

    setInputValue(element, value);
    return success(label);
  }

  function fillConfirmEmail(value) {
    if (!value) return fail("Conferma email");

    const emailFields = [...document.querySelectorAll(
      'input[type="email"], input[autocomplete="email"], input:not([type="hidden"])'
    )]
      .filter((element) => !element.disabled && isVisible(element))
      .map((element) => ({
        element,
        descriptor: normalize(getElementDescriptor(element))
      }))
      .filter(({ descriptor }) => descriptor.includes("email") || descriptor.includes("e-mail"));

    addLog("email", "Campi email candidati", {
      count: emailFields.length,
      fields: emailFields.map(({ element, descriptor }) => ({
        element: summarizeElement(element),
        descriptor
      }))
    });

    const explicit = emailFields.find(({ descriptor }) => (
      descriptor.includes("conferma") ||
      descriptor.includes("confirm") ||
      descriptor.includes("ripeti") ||
      descriptor.includes("repeat")
    ));

    if (explicit) {
      setInputValue(explicit.element, value);
      return success("Conferma email");
    }

    const secondEmail = emailFields.find(({ element }) => element.value.trim() !== value);

    if (emailFields.length >= 2 && secondEmail) {
      setInputValue(secondEmail.element, value);
      return success("Conferma email");
    }

    return fail("Conferma email");
  }

  function fillDate(isoDate) {
    if (!isoDate) return fail("Data di nascita");

    const [year, month, day] = isoDate.split("-");
    if (!year || !month || !day) return fail("Data di nascita");

    const tokens = [
      "data di nascita",
      "date of birth",
      "birth date",
      "nascita",
      "dob"
    ];

    addLog("date", "Avvio data di nascita", {
      isoDate,
      expected: { day, month, year },
      inputCandidates: getCandidateSummaries(
        'input:not([type="hidden"])',
        ["data di nascita", "nascita", "birth", "giorno", "day", "gg", "mese", "month", "mm", "anno", "year", "aaaa", "yyyy"]
      )
    });

    const directDateElement = document.querySelector('[data-cy="dateCalendar"]');

    if (directDateElement && isVisible(directDateElement)) {
      const value = `${day}/${month}/${year}`;
      setDateInputValue(directDateElement, value);
      addLog("date", "Campo data diretto compilato", {
        element: summarizeElement(directDateElement),
        value
      });
      return success("Data di nascita");
    }

    const dayInput = findDatePartElement(["giorno", "day", "gg"], tokens);
    const monthInput = findDatePartElement(["mese", "month", "mm"], tokens);
    const yearInput = findDatePartElement(["anno", "year", "aaaa", "yyyy"], tokens);

    addLog("date", "Parti data individuate", {
      dayInput: summarizeElement(dayInput),
      monthInput: summarizeElement(monthInput),
      yearInput: summarizeElement(yearInput)
    });

    if (dayInput && monthInput && yearInput &&
        new Set([dayInput, monthInput, yearInput]).size === 3) {
      setInputValue(dayInput, day);
      setInputValue(monthInput, month);
      setInputValue(yearInput, year);
      return success("Data di nascita");
    }

    const dateElement = findBestElement(
      'input[type="date"], input[matdatepicker], input[matinput], input[type="text"]',
      tokens,
      false
    );

    if (dateElement && !looksLikeDatePart(dateElement)) {
      const value = dateElement.type === "date"
        ? `${year}-${month}-${day}`
        : `${day}/${month}/${year}`;

      setDateInputValue(dateElement, value);
      addLog("date", "Campo data completo compilato", {
        element: summarizeElement(dateElement),
        value
      });
      return success("Data di nascita");
    }

    addLog("date", "Data di nascita non compilata", {
      dateElement: summarizeElement(dateElement),
      rejectedAsDatePart: dateElement ? looksLikeDatePart(dateElement) : false
    });
    return fail("Data di nascita");
  }

  function setDateInputValue(element, value) {
    const wasReadonly = element.hasAttribute("readonly");

    if (wasReadonly) {
      element.removeAttribute("readonly");
    }

    element.focus();
    setInputValue(element, value);
    element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));
    element.dispatchEvent(new Event("dateInput", { bubbles: true }));
    element.dispatchEvent(new Event("dateChange", { bubbles: true }));

    if (wasReadonly) {
      element.setAttribute("readonly", "true");
    }
  }

  function findDatePartElement(partTokens, dateTokens) {
    const candidates = [...document.querySelectorAll('input:not([type="hidden"])')]
      .filter((element) => !element.disabled && isVisible(element));

    let best = null;
    let bestScore = 0;

    for (const element of candidates) {
      const descriptor = normalize(getElementDescriptor(element));
      const partScore = calculateScore(descriptor, partTokens);

      if (partScore <= 0) continue;

      const dateScore = calculateScore(descriptor, dateTokens);
      const score = partScore + dateScore;

      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    }

    return best;
  }

  function looksLikeDatePart(element) {
    const descriptor = normalize(getElementDescriptor(element));
    return [
      "giorno",
      "day",
      "gg",
      "mese",
      "month",
      "mm",
      "anno",
      "year",
      "aaaa",
      "yyyy"
    ].some((token) => descriptor.includes(token));
  }

  function findMatchingOption(options, value, aliases = []) {
    const wantedValues = [value, ...aliases].map(normalize).filter(Boolean);

    return options.find((item) => {
      const text = normalize(`${item.textContent || ""} ${item.value || ""}`);
      return wantedValues.some((wanted) => {
        if (text === wanted ||
            text.startsWith(`${wanted} `) ||
            text.endsWith(` ${wanted}`) ||
            text.includes(` ${wanted} `)) {
          return true;
        }

        return wanted.length > 2 && text.includes(wanted);
      });
    });
  }

  function setCheckboxByText({
    desired,
    tokens,
    excludedTokens = [],
    label
  }) {
    const checkboxes = [...document.querySelectorAll('input[type="checkbox"]')]
      .filter((element) => !element.disabled);

    let best = null;
    let bestScore = 0;

    for (const checkbox of checkboxes) {
      const descriptor = normalize(getElementDescriptor(checkbox));

      if (excludedTokens.some((token) => descriptor.includes(normalize(token)))) {
        continue;
      }

      const score = calculateScore(descriptor, tokens);

      if (score > bestScore) {
        best = checkbox;
        bestScore = score;
      }
    }

    if (!best || bestScore <= 0) return fail(label);

    if (best.checked !== desired) {
      best.scrollIntoView({ block: "center", inline: "nearest" });
      best.click();
    }

    return success(label);
  }

  function findBestElement(selector, tokens, allowFirstVisibleFallback) {
    const candidates = [...document.querySelectorAll(selector)]
      .filter((element) => !element.disabled && isVisible(element));

    if (!candidates.length) return null;

    let best = null;
    let bestScore = 0;

    for (const element of candidates) {
      const descriptor = normalize(getElementDescriptor(element));
      const score = calculateScore(descriptor, tokens);

      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    }

    if (best && bestScore > 0) return best;
    if (allowFirstVisibleFallback && candidates.length === 1) return candidates[0];

    return null;
  }

  function calculateScore(descriptor, tokens) {
    let score = 0;

    for (const token of tokens) {
      const normalizedToken = normalize(token);
      if (!normalizedToken) continue;

      if (descriptor === normalizedToken) {
        score += 20;
      } else if (descriptor.includes(normalizedToken)) {
        score += normalizedToken.includes(" ") ? 10 : 4;
      }
    }

    return score;
  }

  function getElementDescriptor(element) {
    const parts = [
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.getAttribute("name"),
      element.getAttribute("id"),
      element.getAttribute("autocomplete"),
      element.getAttribute("formcontrolname"),
      element.getAttribute("data-testid"),
      element.getAttribute("title")
    ];

    if (element.id) {
      try {
        const associatedLabels = document.querySelectorAll(
          `label[for="${CSS.escape(element.id)}"]`
        );
        associatedLabels.forEach((label) => parts.push(label.textContent));
      } catch {
        // ID non utilizzabile come selettore: si continua con gli altri dati.
      }
    }

    const closestControl = element.closest(
      "mat-form-field, mat-checkbox, .mat-mdc-form-field, .mat-form-field, " +
      ".mdc-form-field, .form-group, .form-field, .field, [class*='checkbox']"
    );

    if (closestControl) {
      parts.push(closestControl.textContent);
    }

    const parent = element.parentElement;
    if (parent && parent.textContent.length < 250) {
      parts.push(parent.textContent);
    }

    const previous = element.previousElementSibling;
    if (previous && previous.textContent.length < 120) {
      parts.push(previous.textContent);
    }

    return parts.filter(Boolean).join(" ");
  }

  function setInputValue(element, value) {
    element.scrollIntoView({ block: "center", inline: "nearest" });

    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;

    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

    if (setter) {
      setter.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function setSelectValue(element, value) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value"
    )?.set;

    if (setter) {
      setter.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;

    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;

    return element.getClientRects().length > 0;
  }

  function normalize(value = "") {
    return String(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function success(label) {
    return { ok: true, label };
  }

  function fail(label) {
    return { ok: false, label };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function startLog(data) {
    activeLog = {
      version: "1.0.0-debug",
      createdAt: new Date().toISOString(),
      url: location.href,
      userAgent: navigator.userAgent,
      payload: {
        gender: data?.gender,
        country: data?.country,
        language: data?.language,
        city: data?.city,
        birthDate: data?.birthDate,
        hasEmail: Boolean(data?.email),
        hasPhone: Boolean(data?.phone),
        marketing: Boolean(data?.marketing),
        terms: Boolean(data?.terms),
        waitCloudflare: Boolean(data?.waitCloudflare)
      },
      entries: []
    };
  }

  function addLog(type, message, details = {}) {
    if (!activeLog) return;

    activeLog.entries.push({
      at: new Date().toISOString(),
      type,
      message,
      details
    });
  }

  async function saveLog() {
    if (!activeLog ||
        typeof chrome === "undefined" ||
        !chrome.storage?.local) {
      return;
    }

    activeLog.savedAt = new Date().toISOString();
    await chrome.storage.local.set({ [LOG_KEY]: activeLog });
  }

  function collectPageSnapshot() {
    return {
      title: document.title,
      readyState: document.readyState,
      activeElement: summarizeElement(document.activeElement),
      counts: {
        inputs: document.querySelectorAll("input").length,
        textareas: document.querySelectorAll("textarea").length,
        nativeSelects: document.querySelectorAll("select").length,
        matSelects: document.querySelectorAll("mat-select, .mat-mdc-select, .mat-select").length,
        comboboxes: document.querySelectorAll('[role="combobox"]').length,
        matOptions: document.querySelectorAll('mat-option, [role="option"], .mat-mdc-option, .mat-option').length
      },
      controls: [...document.querySelectorAll(
        'input, textarea, select, mat-select, [role="combobox"], .mat-mdc-select, .mat-select'
      )]
        .filter(isVisible)
        .slice(0, 150)
        .map(summarizeElement)
    };
  }

  function getCandidateSummaries(selector, tokens = []) {
    return [...document.querySelectorAll(selector)]
      .filter((element) => !element.disabled && isVisible(element))
      .slice(0, 80)
      .map((element) => {
        const descriptor = normalize(getElementDescriptor(element));
        return {
          ...summarizeElement(element),
          descriptor,
          score: calculateScore(descriptor, tokens)
        };
      });
  }

  function summarizeOption(option) {
    if (!option) return null;

    return {
      text: cleanText(option.textContent),
      value: option.value ?? option.getAttribute("value") ?? "",
      selected: Boolean(option.selected),
      disabled: Boolean(option.disabled)
    };
  }

  function summarizeElement(element) {
    if (!(element instanceof Element)) return null;

    const rect = element.getBoundingClientRect();
    const value = "value" in element ? String(element.value || "") : "";

    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || "",
      name: element.getAttribute("name") || "",
      type: element.getAttribute("type") || "",
      role: element.getAttribute("role") || "",
      className: String(element.className || "").slice(0, 180),
      formcontrolname: element.getAttribute("formcontrolname") || "",
      ariaLabel: element.getAttribute("aria-label") || "",
      ariaLabelledBy: element.getAttribute("aria-labelledby") || "",
      placeholder: element.getAttribute("placeholder") || "",
      autocomplete: element.getAttribute("autocomplete") || "",
      title: element.getAttribute("title") || "",
      text: cleanText(element.textContent).slice(0, 240),
      descriptor: cleanText(getElementDescriptor(element)).slice(0, 500),
      html: sanitizeOuterHtml(element),
      valueLength: value.length,
      valuePreview: value ? `${value.slice(0, 2)}***` : "",
      checked: "checked" in element ? Boolean(element.checked) : undefined,
      disabled: Boolean(element.disabled),
      visible: isVisible(element),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  }

  function cleanText(value = "") {
    return String(value)
      .replace(/\s+/g, " ")
      .trim();
  }

  function sanitizeOuterHtml(element) {
    const clone = element.cloneNode(true);

    clone.querySelectorAll?.("input, textarea, select").forEach((control) => {
      control.setAttribute("value", "***");
      if (control instanceof HTMLTextAreaElement) {
        control.textContent = "***";
      }
    });

    if ("value" in clone) {
      clone.setAttribute("value", "***");
    }

    return cleanText(clone.outerHTML).slice(0, 1200);
  }

  function showBanner(message, state = "working", removeAfter = 0) {
    let banner = document.getElementById(BANNER_ID);

    if (!banner) {
      banner = document.createElement("div");
      banner.id = BANNER_ID;
      banner.setAttribute("role", "status");
      banner.style.position = "fixed";
      banner.style.top = "16px";
      banner.style.right = "16px";
      banner.style.zIndex = "2147483647";
      banner.style.maxWidth = "420px";
      banner.style.padding = "12px 14px";
      banner.style.borderRadius = "8px";
      banner.style.boxShadow = "0 4px 18px rgba(0,0,0,.22)";
      banner.style.font = "600 13px/1.45 Arial, Helvetica, sans-serif";
      banner.style.color = "#ffffff";
      document.documentElement.appendChild(banner);
    }

    const backgrounds = {
      working: "#1a73e8",
      waiting: "#6f42c1",
      success: "#137333",
      warning: "#9a6700",
      error: "#b3261e"
    };

    banner.style.background = backgrounds[state] || backgrounds.working;
    banner.textContent = message;

    if (removeAfter > 0) {
      window.setTimeout(() => banner.remove(), removeAfter);
    }
  }
})();




