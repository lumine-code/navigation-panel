const { Disposable } = require("lumine");

class AdapterManager {
  constructor() {
    this.registry = new Set();
    this.active = null;
    this._headersDispose = null;
  }

  consume(adapter) {
    this.registry.add(adapter);
    return new Disposable(() => this.registry.delete(adapter));
  }

  getForItem(item) {
    for (const adapter of this.registry) {
      if (adapter.handlesItem?.(item)) return adapter;
    }
    return null;
  }

  subscribe(adapter, item, { onHeaders }) {
    this.unsubscribe();
    this.active = adapter;

    this._headersDispose = adapter.observeHeaders(item, onHeaders);
  }

  unsubscribe() {
    if (this._headersDispose) {
      this._headersDispose.dispose();
      this._headersDispose = null;
    }
    this.active = null;
  }

  buildHeaders(rawHeaders, paneItem) {
    if (!Array.isArray(rawHeaders)) return null;
    if (!isAdapterTree(rawHeaders)) return null;
    const adapter = this.active;
    if (!adapter) return null;
    const traceByVisibility = hasAdapterVisibility(rawHeaders);
    const maxDepth = Math.min(64, lumine.config.get("navigation-panel.editor.maxHeadingDepth"));
    const identity = createHeaderIdentity(rawHeaders);
    const headers = augmentAdapterItems(
      rawHeaders,
      paneItem,
      adapter,
      traceByVisibility,
      maxDepth,
      identity,
    );
    if (rawHeaders.outlineStatus)
      Object.defineProperty(headers, "outlineStatus", { value: rawHeaders.outlineStatus });
    return headers;
  }
}

function isAdapterTree(items) {
  return items.every(
    (item) => item && Array.isArray(item.children) && isAdapterTree(item.children),
  );
}

function hasAdapterVisibility(items) {
  return items.some(
    (item) =>
      item &&
      (item.visible !== undefined ||
        item.visibility !== undefined ||
        hasAdapterVisibility(Array.isArray(item.children) ? item.children : [])),
  );
}

function createHeaderIdentity(items) {
  const usedIds = new Set();
  const occurrences = new Map();
  const reserve = (headers) => {
    for (const header of headers) {
      if (header.id != null) usedIds.add(header.id);
      reserve(header.children);
    }
  };
  reserve(items);

  return (source) => {
    if (source.id != null) return source.id;
    const base = JSON.stringify([
      source.filePath ?? "",
      source.startPoint?.row ?? null,
      source.startPoint?.column ?? null,
      source.startPoint ? "" : String(source.text || "").trim(),
    ]);
    let occurrence = occurrences.get(base) ?? 0;
    let id;
    do {
      id = `header:${base}:${occurrence++}`;
    } while (usedIds.has(id));
    occurrences.set(base, occurrence);
    usedIds.add(id);
    return id;
  };
}

function augmentAdapterItems(
  items,
  paneItem,
  adapter,
  traceByVisibility,
  maxDepth,
  identity,
  revel = 1,
) {
  if (maxDepth < revel) return [];

  return items.map((item) => {
    const source = item || {};
    const startPoint = source.startPoint;
    const header = {
      ...source,
      id: identity(source),
      text: String(source.text || "").trim(),
      level: source.level ?? revel,
      revel,
      classList: Array.isArray(source.classList) ? source.classList : [],
      children: augmentAdapterItems(
        Array.isArray(source.children) ? source.children : [],
        paneItem,
        adapter,
        traceByVisibility,
        maxDepth,
        identity,
        revel + 1,
      ),
      startPoint,
      endPoint: source.endPoint || startPoint,
      lastRow: source.lastRow ?? startPoint?.row,
      currentCount: source.currentCount ?? (source.current ? 1 : 0),
      stackCount: source.stackCount ?? (source.active || source.current ? 1 : 0),
      visibility: source.visibility ?? (source.visible ? 1 : 0),
      traceByVisibility,
    };
    header.navigate = (options) => adapter.navigateTo(paneItem, header, options);
    return header;
  });
}

module.exports = { AdapterManager };
