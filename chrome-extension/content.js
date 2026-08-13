let lastSelection = "";
let lastInteractionTarget = null;
let lastCitation = null;
let citationScanScheduled = false;

const normalizeText = (value) =>
  String(value || "")
    .replace(/\u00ad/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Notebook renders inline formulas as many nested DOM nodes. Browser selection
// text can therefore contain hard line breaks between pieces such as k/cat,
// K/M, and s/−1. A Zotero note would preserve those artificial breaks. Flatten
// selection whitespace and let Zotero wrap the resulting paragraph naturally.
const cleanSelectionText = (value) =>
  normalizeText(value)
    .replace(/\s+([，。！？；：、,.!?;:)\]}])/g, "$1")
    .replace(/([(\[{])\s+/g, "$1")
    .replace(/\bk\s+cat\b/gi, "kcat")
    .replace(/\bK\s+M\b/g, "KM")
    .replace(/\b([A-Za-z])\s+([−–-])\s*(\d+)\b/g, "$1$2$3")
    .replace(/\s*=\s*/g, " = ")
    .trim();

const isVisible = (element) => {
  if (!(element instanceof Element)) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.top < innerHeight &&
    style.visibility !== "hidden" &&
    style.display !== "none"
  );
};

document.addEventListener("selectionchange", () => {
  const selected = window.getSelection()?.toString().trim() || "";
  if (selected) lastSelection = selected;
});

document.addEventListener(
  "pointerdown",
  (event) => {
    if (event.target instanceof Element) lastInteractionTarget = event.target;
  },
  true,
);

function notebookTitle() {
  const heading = Array.from(
    document.querySelectorAll("h1, [role='heading'][aria-level='1']"),
  ).find(isVisible);
  return normalizeText(heading?.textContent) || document.title || "Gemini Notebook";
}

function meaningfulAncestors(start) {
  const candidates = [];
  let element = start;
  while (element && element !== document.body) {
    if (isVisible(element)) {
      const rect = element.getBoundingClientRect();
      const text = normalizeText(element.innerText || element.textContent);
      if (
        text.length >= 120 &&
        text.length <= 50000 &&
        rect.width >= 320 &&
        rect.width <= innerWidth * 0.92 &&
        rect.height >= 180
      ) {
        candidates.push({ element, rect, text });
      }
    }
    element = element.parentElement;
  }
  return candidates;
}

function findGeneratedOutputPanel() {
  const marker = Array.from(document.querySelectorAll("body *")).find((element) => {
    if (!isVisible(element)) return false;
    const text = normalizeText(element.textContent);
    return (
      text === "Saved responses are view only" ||
      text === "Convert to source" ||
      text === "Export to Docs"
    );
  });

  const starts = [marker, lastInteractionTarget].filter(Boolean);
  let best = null;
  for (const start of starts) {
    for (const candidate of meaningfulAncestors(start)) {
      const markerBonus = /Saved responses are view only|Convert to source/.test(
        candidate.text,
      )
        ? 5000
        : 0;
      const widthBonus = candidate.rect.width <= innerWidth * 0.7 ? 500 : 0;
      const score = markerBonus + widthBonus - candidate.text.length / 100;
      if (!best || score > best.score) best = { ...candidate, score };
    }
  }
  return best?.element || null;
}

function cleanGeneratedText(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        ![
          "Saved responses are view only",
          "Convert to source",
          "Convert all notes to source",
          "Export to Docs",
          "Export to Sheets",
          "Delete",
        ].includes(line),
    )
    .join("\n")
    .trim();
}

function captureGeneratedOutput() {
  const panel = findGeneratedOutputPanel();
  if (!panel) {
    return { error: "Open a Studio note, click inside its text, then try again." };
  }
  const content = cleanGeneratedText(panel.innerText || panel.textContent);
  if (content.length < 80) {
    return { error: "The opened Studio output could not be read." };
  }
  const heading = Array.from(
    panel.querySelectorAll("h1, h2, h3, [role='heading']"),
  ).find(isVisible);
  const firstLine = content.split("\n").find(Boolean);
  return {
    kind: "generated-output",
    title: normalizeText(heading?.textContent) || firstLine || "Gemini Notebook output",
    content,
    sourceLabel: notebookTitle(),
    notebookURL: location.href,
  };
}

function textWithoutCitationMarkers(element) {
  const clone = element.cloneNode(true);
  const originals = [element, ...element.querySelectorAll("*")];
  const copies = [clone, ...clone.querySelectorAll("*")];

  originals.forEach((original, index) => {
    const copy = copies[index];
    if (!copy || !(original instanceof Element)) return;
    const text = normalizeText(original.textContent);
    if (!/^\[?\d{1,3}\]?$/.test(text)) return;

    const style = getComputedStyle(original);
    const parentStyle = original.parentElement
      ? getComputedStyle(original.parentElement)
      : null;
    const fontSize = Number.parseFloat(style.fontSize) || 0;
    const parentFontSize = Number.parseFloat(parentStyle?.fontSize || "0") || 0;
    const rect = original.getBoundingClientRect();
    const aria = `${original.getAttribute("aria-label") || ""} ${
      original.getAttribute("data-tooltip") || ""
    }`.toLocaleLowerCase();
    const semanticMarker =
      original.matches("sup, button, [role='button'], a") ||
      /citation|source|reference|引用|来源/.test(aria);
    const visualMarker =
      style.verticalAlign === "super" ||
      (parentFontSize > 0 && fontSize <= parentFontSize * 0.85) ||
      (rect.width <= 38 && rect.height <= 28 && style.cursor === "pointer");

    if (semanticMarker || visualMarker) copy.remove();
  });

  return normalizeText(clone.textContent);
}

function citationTextCandidates(container) {
  const candidates = [];
  for (const element of container.querySelectorAll("p, li, div, span")) {
    if (!isVisible(element)) continue;
    const raw = normalizeText(element.innerText || element.textContent);
    if (raw.length < 35 || raw.length > 2000) continue;
    const childHasSameText = Array.from(element.children).some(
      (child) => normalizeText(child.textContent) === raw,
    );
    if (childHasSameText) continue;

    const cleaned = textWithoutCitationMarkers(element);
    for (const value of [cleaned, raw]) {
      if (value.length >= 35 && !candidates.includes(value)) candidates.push(value);
    }
  }
  return candidates.sort((a, b) => b.length - a.length).slice(0, 18);
}

function searchTextVariants(text) {
  const normalized = normalizeText(text)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
  const variants = [normalized];
  const asciiDashes = normalized.replace(/[‐‑‒–—−]/g, "-");
  if (!variants.includes(asciiDashes)) variants.push(asciiDashes);
  return variants;
}

function wordWindows(text, windowSize = 8) {
  const words = normalizeText(text).split(/\s+/).filter(Boolean);
  if (words.length <= windowSize) return words.length ? [words.join(" ")] : [];

  const windows = [];
  const maxOffset = Math.min(words.length - windowSize, 48);
  for (let offset = 0; offset <= maxOffset; offset += 4) {
    const raw = words.slice(offset, offset + windowSize).join(" ");
    for (const value of searchTextVariants(raw)) {
      if (!windows.includes(value)) windows.push(value);
    }
  }
  return windows;
}

function findCitationPopup() {
  const viewSource = Array.from(document.querySelectorAll("a, button, body *")).find(
    (element) =>
      isVisible(element) && normalizeText(element.textContent) === "View source",
  );
  if (!viewSource) return null;

  let element = viewSource.parentElement;
  let best = null;
  while (element && element !== document.body) {
    if (isVisible(element)) {
      const rect = element.getBoundingClientRect();
      const text = normalizeText(element.innerText || element.textContent);
      if (
        text.length >= 80 &&
        text.length <= 10000 &&
        rect.width >= 240 &&
        rect.width <= 900 &&
        rect.height >= 120
      ) {
        best = element;
        if (rect.height >= 220) break;
      }
    }
    element = element.parentElement;
  }
  return best;
}

function captureVisibleCitation() {
  const popup = findCitationPopup();
  if (!popup) return null;
  const lines = String(popup.innerText || popup.textContent)
    .split("\n")
    .map(normalizeText)
    .filter((line) => line && line !== "View source");
  const sourceLabel = lines[0] || "Notebook source";
  const fullCandidates = citationTextCandidates(popup).filter(
    (text) => text !== sourceLabel && text !== "View source",
  );
  if (!fullCandidates.length) {
    fullCandidates.push(...lines.slice(1).filter((line) => line.length >= 35));
  }
  const searchWindows = fullCandidates.flatMap((text) => wordWindows(text));
  const quoteCandidates = [...new Set([...searchWindows, ...fullCandidates])];
  return {
    kind: "citation-highlight",
    quote: searchWindows[0] || quoteCandidates[0] || "",
    quoteCandidates,
    fullQuote: fullCandidates[0] || "",
    sourceLabel,
    notebookURL: location.href,
  };
}

function updateCitationCache() {
  citationScanScheduled = false;
  const captured = captureVisibleCitation();
  if (captured?.quote && captured.quoteCandidates?.length) {
    lastCitation = { ...captured, capturedAt: Date.now() };
  }
}

function scheduleCitationScan() {
  if (citationScanScheduled) return;
  citationScanScheduled = true;
  requestAnimationFrame(updateCitationCache);
}

function captureCitation() {
  const visible = captureVisibleCitation();
  if (visible?.quote) {
    lastCitation = { ...visible, capturedAt: Date.now() };
    return visible;
  }
  if (lastCitation) {
    return {
      ...lastCitation,
      notebookURL: location.href,
    };
  }
  return {
    error: "Hover over a numbered citation until View source appears, then open this extension.",
  };
}

document.addEventListener("pointerover", scheduleCitationScan, true);
new MutationObserver(scheduleCitationScan).observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "captureSelection") {
    const selection = window.getSelection()?.toString().trim() || lastSelection;
    sendResponse({
      kind: "selection",
      quote: cleanSelectionText(selection),
      sourceLabel: notebookTitle(),
      notebookURL: location.href,
    });
  } else if (message.action === "captureGeneratedOutput") {
    sendResponse(captureGeneratedOutput());
  } else if (message.action === "captureCitation") {
    sendResponse(captureCitation());
  }
});
