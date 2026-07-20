const DEFAULTS = {
  gender: "Maschio",
  country: "Italia",
  language: "Italiano",
  city: "ROMA",
  birthDate: "1977-07-19",
  email: "crazy4rometour@gmail.com",
  phone: "3341832713",
  marketing: true,
  terms: true,
  waitCloudflare: true
};
const LOG_KEY = "vaticanAutofillLastLog";

const fieldIds = Object.keys(DEFAULTS);

document.addEventListener("DOMContentLoaded", async () => {
  const saved = await chrome.storage.local.get(DEFAULTS);

  for (const id of fieldIds) {
    const element = document.getElementById(id);
    if (!element) continue;

    if (element.type === "checkbox") {
      element.checked = Boolean(saved[id]);
    } else {
      element.value = saved[id] ?? "";
    }
  }

  document.getElementById("save").addEventListener("click", saveSettings);
  document.getElementById("fill").addEventListener("click", fillCheckout);
  document.getElementById("downloadLog").addEventListener("click", downloadLog);
});

function getPayload() {
  const payload = {};

  for (const id of fieldIds) {
    const element = document.getElementById(id);
    payload[id] = element.type === "checkbox" ? element.checked : element.value.trim();
  }

  return payload;
}

async function saveSettings() {
  await chrome.storage.local.set(getPayload());
  setStatus("Dati salvati nel profilo locale di Chrome.");
}

async function fillCheckout() {
  const button = document.getElementById("fill");
  button.disabled = true;
  setStatus("Avvio compilazione...");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id || !tab.url) {
      throw new Error("Scheda attiva non disponibile.");
    }

    const url = new URL(tab.url);
    const validHost = url.hostname === "tickets.museivaticani.va";
    const validPath = url.pathname.startsWith("/home/checkout");

    if (!validHost || !validPath) {
      throw new Error("Apri https://tickets.museivaticani.va/home/checkout");
    }

    const payload = getPayload();
    await chrome.storage.local.set(payload);

    const participantsText = document.getElementById("participantsText")?.value.trim();
    if (participantsText) {
      payload.participantsText = participantsText;
    }

    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "VATICAN_AUTOFILL",
        payload
      });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });

      await chrome.tabs.sendMessage(tab.id, {
        type: "VATICAN_AUTOFILL",
        payload
      });
    }

    setStatus(
      payload.waitCloudflare
        ? "Avviato. Se Cloudflare Ã¨ presente, completalo manualmente: la compilazione proseguirÃ  da sola."
        : "Compilazione avviata nella pagina."
    );
  } catch (error) {
    setStatus(error?.message || "Errore durante la compilazione.", true);
  } finally {
    button.disabled = false;
  }
}

function setStatus(message, isError = false) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.style.color = isError ? "#b3261e" : "#137333";
}

async function downloadLog() {
  const saved = await chrome.storage.local.get(LOG_KEY);
  const log = saved[LOG_KEY];

  if (!log) {
    setStatus("Nessun log trovato. Premi prima Compila checkout sulla pagina.", true);
    return;
  }

  const blob = new Blob([JSON.stringify(log, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  anchor.href = url;
  anchor.download = `vatican-autofill-log-${stamp}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus("Log scaricato.");
}

