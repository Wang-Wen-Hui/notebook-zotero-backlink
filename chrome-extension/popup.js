const endpoint = "http://127.0.0.1:23119/notebook-zotero-backlink";
const itemLine = document.getElementById("selected-item");
const statusLine = document.getElementById("status");
const buttons = Array.from(document.querySelectorAll("button[data-action]"));

async function getSelectedItem() {
  const response = await fetch(endpoint + "/status", {
    headers: { "Zotero-Allowed-Request": "1" },
  });
  if (!response.ok) throw new Error("Zotero plugin is not responding.");
  return response.json();
}

async function initialise() {
  try {
    const state = await getSelectedItem();
    if (!state.selectedItem) {
      itemLine.textContent = "Select a regular Zotero item or its PDF first.";
      return;
    }
    itemLine.textContent = "Target: " + state.selectedItem.title;
    buttons.forEach((button) => (button.disabled = false));
  } catch (error) {
    itemLine.textContent = error.message;
  }
}

async function importIntoZotero(payload) {
  const response = await fetch(endpoint + "/import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Zotero-Allowed-Request": "1",
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Zotero rejected the request.");
  return result;
}

async function runAction(button) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  statusLine.textContent = button.dataset.working;
  const captured = await chrome.tabs.sendMessage(tab.id, {
    action: button.dataset.action,
  });
  if (captured?.error) throw new Error(captured.error);
  if (!captured?.quote && !captured?.content) {
    throw new Error("No Notebook content was captured.");
  }
  const result = await importIntoZotero(captured);
  statusLine.textContent = result.message || "Saved to Zotero.";
}

buttons.forEach((button) => {
  button.addEventListener("click", async () => {
    buttons.forEach((item) => (item.disabled = true));
    try {
      await runAction(button);
    } catch (error) {
      statusLine.textContent = error.message;
    } finally {
      buttons.forEach((item) => (item.disabled = false));
    }
  });
});

initialise();
