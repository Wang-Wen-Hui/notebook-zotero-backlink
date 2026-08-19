const STATUS_PATH = "/notebook-zotero-backlink/status";
const IMPORT_PATH = "/notebook-zotero-backlink/import";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Zotero-Allowed-Request",
};

type ImportPayload = {
  kind?: "selection" | "generated-output" | "citation-highlight";
  quote?: string;
  quoteHTML?: string;
  quoteCandidates?: string[];
  content?: string;
  contentHTML?: string;
  title?: string;
  sourceLabel?: string;
  notebookURL?: string;
};

type SelectedTarget = {
  parent: Zotero.Item;
  selected: Zotero.Item;
};

function sendJSON(callback: Function, status: number, data: object) {
  callback(status, "application/json", JSON.stringify(data), CORS_HEADERS);
}

function selectedTarget(): SelectedTarget | null {
  const pane = Zotero.getActiveZoteroPane();
  const selected = pane?.getSelectedItems?.()[0];
  if (!selected) return null;
  if (selected.isRegularItem()) return { parent: selected, selected };
  if (selected.isAttachment() && selected.parentID) {
    const parent = Zotero.Items.get(selected.parentID);
    if (parent?.isRegularItem()) return { parent, selected };
  }
  return null;
}

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeText(value: unknown, maxLength = 100000): string {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

const RICH_TEXT_TAGS = new Set([
  "a",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

const DROP_RICH_TEXT_TAGS = new Set([
  "button",
  "canvas",
  "form",
  "iframe",
  "input",
  "noscript",
  "script",
  "select",
  "style",
  "svg",
  "textarea",
]);

function safeLink(value: string): string {
  const link = value.trim();
  return /^(https?:\/\/|mailto:)/i.test(link) ? link : "";
}

function sanitizeRichNode(node: Node | null): string {
  if (!node) return "";
  if (node.nodeType === 3) {
    return escapeHTML(node.nodeValue || "");
  }
  if (node.nodeType !== 1) return "";

  const element = node as Element;
  const tag = element.tagName.toLocaleLowerCase();
  if (DROP_RICH_TEXT_TAGS.has(tag)) return "";
  const children = Array.from(element.childNodes)
    .map(sanitizeRichNode)
    .join("");
  if (!RICH_TEXT_TAGS.has(tag)) return children;
  if (tag === "br") return "<br>";
  if (tag === "a") {
    const href = safeLink(element.getAttribute("href") || "");
    return href ? `<a href="${escapeHTML(href)}">${children}</a>` : children;
  }
  return `<${tag}>${children}</${tag}>`;
}

function sanitizeRichHTML(value: unknown): string {
  const html = safeText(value, 200000);
  if (!html) return "";
  const document = new DOMParser().parseFromString(html, "text/html");
  return document.body
    ? Array.from(document.body.childNodes).map(sanitizeRichNode).join("")
    : "";
}

function notebookLink(url: string): string {
  return url
    ? `<p><a href="${escapeHTML(url)}">Open this Gemini Notebook</a></p>`
    : "";
}

async function createChildNote(payload: ImportPayload) {
  const target = selectedTarget();
  if (!target) {
    throw new Error("Select a regular Zotero item before saving evidence.");
  }

  const generated = payload.kind === "generated-output";
  const body = safeText(generated ? payload.content : payload.quote);
  if (!body) throw new Error("No Gemini Notebook text was received.");

  const sourceLabel = safeText(payload.sourceLabel || "Gemini Notebook", 1000);
  const notebookURL = safeText(payload.notebookURL, 4000);
  const requestedTitle = safeText(payload.title, 500);
  const title = generated
    ? requestedTitle || "Gemini Notebook output"
    : "Gemini Notebook evidence";
  const richBody = sanitizeRichHTML(
    generated ? payload.contentHTML : payload.quoteHTML,
  );
  const fallbackBody = escapeHTML(body).replace(/\n/g, "<br>");
  const bodyHTML = generated
    ? `<div>${richBody || fallbackBody}</div>`
    : `<blockquote>${richBody || fallbackBody}</blockquote>`;

  const note = new Zotero.Item("note");
  note.libraryID = target.parent.libraryID;
  note.parentID = target.parent.id;
  note.setNote(
    `<h2>${escapeHTML(title)}</h2>` +
      `<p><strong>Source:</strong> ${escapeHTML(sourceLabel)}</p>` +
      bodyHTML +
      `<p><em>Captured ${escapeHTML(new Date().toLocaleString())}</em></p>` +
      notebookLink(notebookURL),
  );
  await note.saveTx();
  return {
    success: true,
    noteID: note.id,
    parentItemID: target.parent.id,
    message: generated
      ? "右侧生成物已保存为 Zotero 子笔记。"
      : "选中文字已保存为 Zotero 子笔记。",
  };
}

function compactLabel(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/\.pdf$/i, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function candidatePDFAttachments(target: SelectedTarget): Zotero.Item[] {
  if (target.selected.isPDFAttachment()) return [target.selected];
  return target.parent
    .getAttachments()
    .map((id) => Zotero.Items.get(id))
    .filter((item): item is Zotero.Item => Boolean(item?.isPDFAttachment()));
}

function rankAttachments(items: Zotero.Item[], sourceLabel: string) {
  const source = compactLabel(sourceLabel);
  return items
    .map((item) => {
      const labels = [item.getDisplayTitle(), item.attachmentFilename || ""]
        .map(compactLabel)
        .filter(Boolean);
      const score = source
        ? Math.max(
            0,
            ...labels.map((label) =>
              label.includes(source) || source.includes(label) ? 100 : 0,
            ),
          )
        : 0;
      return { item, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}

function searchQueries(payload: ImportPayload): string[] {
  const values = [payload.quote, ...(payload.quoteCandidates || [])];
  const queries: string[] = [];
  for (const value of values) {
    const normalized = safeText(value, 3000).replace(/\s+/g, " ");
    if (normalized.length < 25) continue;
    const variants = [normalized];
    if (normalized.length > 500) variants.push(normalized.slice(0, 500));
    if (normalized.length > 240) variants.push(normalized.slice(0, 240));
    for (const variant of variants) {
      if (!queries.includes(variant)) queries.push(variant);
    }
  }
  return queries.slice(0, 18);
}

async function getReader(attachment: Zotero.Item): Promise<any> {
  const readers = (Zotero.Reader as any)._readers as any[];
  let reader = readers?.find((candidate) => candidate.itemID === attachment.id);
  if (!reader) {
    reader = await (Zotero.Reader.open as any)(attachment.id, undefined, {
      openInBackground: true,
    });
  }
  reader ||= (Zotero.Reader as any)._readers?.find(
    (candidate: any) => candidate.itemID === attachment.id,
  );
  if (!reader) throw new Error("Zotero could not open the selected PDF.");
  await reader._initPromise;
  const activeView =
    reader._internalReader?._activePrimaryView ||
    reader._internalReader?._lastView;
  if (!activeView?.initializedPromise) {
    throw new Error("Zotero PDF reader did not expose an initialized view.");
  }
  await activeView.initializedPromise;
  return reader;
}

async function findAnnotation(reader: any, query: string): Promise<any | null> {
  const internal = reader._internalReader;
  const activeView = internal?._activePrimaryView || internal?._lastView;
  if (!activeView?.setFindState) return null;
  const prior = internal._state.primaryViewFindState;
  activeView.setFindState({
    ...prior,
    popupOpen: false,
    active: true,
    query,
    highlightAll: false,
    caseSensitive: false,
    entireWord: false,
    index: null,
    result: null,
  });

  for (let attempt = 0; attempt < 160; attempt += 1) {
    await Zotero.Promise.delay(75);
    const state = internal._state.primaryViewFindState;
    if (state.query !== query) return null;
    if (state.result?.annotation) return state.result.annotation;
    const controller = activeView._findController;
    const selected = controller?.selected;
    if (selected?.pageIdx >= 0 && selected?.matchIdx >= 0) {
      const positions = await controller.getMatchPositionsAsync(
        selected.pageIdx,
      );
      const position = positions[selected.matchIdx];
      if (position?.rects?.length) {
        await activeView._ensureBasicPageData(selected.pageIdx);
        const meta = activeView.getAnnotationMeta(position);
        return {
          type: "highlight",
          text: query,
          position,
          sortIndex: meta.sortIndex,
          pageLabel: meta.pageLabel,
        };
      }
    }
    if (state.result && state.result.total === 0) return null;
  }
  return null;
}

async function showSearchFallback(
  reader: any,
  attachment: Zotero.Item,
  query: string,
): Promise<{ total: number; pageLabel?: string }> {
  // Bringing an already-open reader to the front can replace the active view,
  // so reacquire it before updating the reader UI.
  const foregroundReader =
    (await (Zotero.Reader.open as any)(attachment.id, undefined, {
      openInBackground: false,
    })) || reader;
  await foregroundReader._initPromise;

  const internal = foregroundReader._internalReader;
  const activeView = internal?._activePrimaryView || internal?._lastView;
  await activeView?.initializedPromise;

  // toggleFindPopup is responsible for rendering and focusing Zotero's visible
  // find bar. Updating only the PDF view starts a search but leaves the bar
  // hidden, which made the previous fallback look like a plain tab switch.
  internal?.toggleFindPopup?.({ primary: true, open: true });

  // The find popup keeps its own controlled React input. Setting reader state
  // immediately after opening the popup can be overwritten by the input's
  // initial empty state. Wait for the real input, then feed it through the same
  // DOM input event a user typing into Zotero would generate.
  const readerWindow = foregroundReader._iframeWindow as any;
  let input: any = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    input = readerWindow?.document?.querySelector(
      ".primary-view .find-popup input",
    );
    if (input) break;
    await Zotero.Promise.delay(50);
  }
  if (!input) return { total: 0 };

  const valueSetter = Object.getOwnPropertyDescriptor(
    readerWindow.HTMLInputElement.prototype,
    "value",
  )?.set;
  if (valueSetter) valueSetter.call(input, query);
  else input.value = query;
  input.dispatchEvent(
    new readerWindow.Event("input", { bubbles: true, composed: true }),
  );
  input.focus();
  input.select();

  for (let attempt = 0; attempt < 160; attempt += 1) {
    await Zotero.Promise.delay(75);
    const state = internal?._state?.primaryViewFindState;
    if (state?.query !== query) break;
    if (state?.result?.total > 0) {
      // Reopen/focus the bar after PDF.js has navigated to the first result.
      // This also selects the query so the location is unmistakable to users.
      internal.toggleFindPopup?.({ primary: true, open: true });
      input.select();
      return {
        total: state.result.total,
        pageLabel: state.result.currentPageLabel,
      };
    }
    if (state?.result?.total === 0) break;
  }

  return { total: 0 };
}

function closeReaderFind(reader: any) {
  const internal = reader?._internalReader;
  const activeView = internal?._activePrimaryView || internal?._lastView;
  if (!activeView?.setFindState) return;
  activeView.setFindState({
    ...internal._state.primaryViewFindState,
    popupOpen: false,
    active: false,
    result: null,
  });
}

async function queryExistsInFulltext(
  attachment: Zotero.Item,
  query: string,
): Promise<boolean> {
  const matches = await (Zotero.Fulltext as any).findTextInItems(
    [attachment.id],
    query,
    "phrase",
  );
  return matches.some((match: { id: number }) => match.id === attachment.id);
}

async function createPDFHighlight(payload: ImportPayload) {
  const target = selectedTarget();
  if (!target) {
    throw new Error("Select the target Zotero item or its PDF first.");
  }
  const attachments = rankAttachments(
    candidatePDFAttachments(target),
    safeText(payload.sourceLabel, 1000),
  );
  if (!attachments.length) {
    throw new Error("The selected Zotero item has no local PDF attachment.");
  }
  const queries = searchQueries(payload);
  if (!queries.length) {
    throw new Error(
      "No usable original quotation was found in the citation popup.",
    );
  }

  for (const attachment of attachments) {
    const reader = await getReader(attachment);
    let confirmedQuery = "";
    for (const query of queries) {
      if (!(await queryExistsInFulltext(attachment, query))) continue;
      confirmedQuery ||= query;
      const found = await findAnnotation(reader, query);
      if (!found?.position || !found.sortIndex) continue;

      const notebookURL = safeText(payload.notebookURL, 4000);
      const annotation = await (Zotero.Annotations.saveFromJSON as any)(
        attachment,
        {
          key: (Zotero as any).DataObjectUtilities.generateKey(),
          type: "highlight",
          text: found.text || query,
          comment: notebookURL
            ? `Matched from Gemini Notebook\n${notebookURL}`
            : "Matched from Gemini Notebook",
          color: "#ffd400",
          pageLabel:
            found.pageLabel || String((found.position.pageIndex || 0) + 1),
          sortIndex: found.sortIndex,
          position: found.position,
          tags: [{ name: "Gemini Notebook" }],
        },
      );

      closeReaderFind(reader);
      await reader.setAnnotations([annotation]);
      await (Zotero.Reader.open as any)(
        attachment.id,
        { annotationID: annotation.key },
        { openInBackground: false },
      );
      await reader.navigate({ annotationID: annotation.key });
      return {
        success: true,
        annotationID: annotation.id,
        attachmentID: attachment.id,
        pageLabel: annotation.annotationPageLabel,
        message: `已在 Zotero PDF 第 ${annotation.annotationPageLabel} 页创建黄色高亮。`,
      };
    }
    if (confirmedQuery) {
      const fallback = await showSearchFallback(
        reader,
        attachment,
        confirmedQuery,
      );
      if (fallback.total > 0) {
        const location = fallback.pageLabel
          ? `第 ${fallback.pageLabel} 页`
          : "首个结果";
        return {
          success: true,
          fallback: true,
          attachmentID: attachment.id,
          pageLabel: fallback.pageLabel,
          message: `已在 Zotero 打开查找框并定位到${location}；PDF 中共 ${fallback.total} 处匹配。蓝色搜索标记是临时定位，关闭查找框即可消失。`,
        };
      }
      throw new Error(
        `原文已在 Zotero 全文索引中命中，但 PDF 阅读器没有返回搜索结果。命中的短语：${confirmedQuery}`,
      );
    }
    closeReaderFind(reader);
  }

  throw new Error(
    "Zotero PDF 中没有找到这段原文，因此没有创建高亮。请确认引用弹窗对应当前文献。",
  );
}

export function registerEndpoints() {
  const statusEndpoint = (Zotero.Server.Endpoints[STATUS_PATH] =
    function () {});
  statusEndpoint.prototype = {
    supportedMethods: ["GET", "OPTIONS"],
    supportedDataTypes: ["application/json"],
    init(_data: unknown, callback: Function) {
      const target = selectedTarget();
      sendJSON(callback, 200, {
        ready: true,
        selectedItem: target
          ? {
              id: target.parent.id,
              key: target.parent.key,
              title: target.parent.getDisplayTitle(),
            }
          : null,
      });
    },
  };

  const importEndpoint = (Zotero.Server.Endpoints[IMPORT_PATH] =
    function () {});
  importEndpoint.prototype = {
    supportedMethods: ["POST", "OPTIONS"],
    supportedDataTypes: ["application/json"],
    async init(data: unknown, callback: Function) {
      try {
        const payload =
          typeof data === "string" ? JSON.parse(data) : (data as ImportPayload);
        const result =
          payload?.kind === "citation-highlight"
            ? await createPDFHighlight(payload)
            : await createChildNote(payload || {});
        sendJSON(callback, 201, result);
      } catch (error) {
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        );
        sendJSON(callback, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

export function unregisterEndpoints() {
  delete Zotero.Server.Endpoints[STATUS_PATH];
  delete Zotero.Server.Endpoints[IMPORT_PATH];
}
