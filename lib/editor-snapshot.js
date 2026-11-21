function captureEditorSnapshot(editor, scannerName) {
  const grammar = editor.getGrammar();
  const scopeName = grammar.scopeName;
  const settings = {
    scopeName,
    maxDepth: Math.min(64, lumine.config.get("navigation-panel.editor.maxHeadingDepth")),
    scanner: scannerName,
    enabled: lumine.config.get(`navigation-panel.scanners.${scannerName}`) !== false,
    latex:
      scannerName === "latex" ? lumine.config.get("navigation-panel.latex.commands") : undefined,
    sofistik:
      scannerName === "sofistik" ? lumine.config.get("navigation-panel.sofistik") : undefined,
    tasklist:
      scannerName === "tasklist"
        ? lumine.config.get("navigation-panel.tasklist.useHeaders")
        : undefined,
  };
  return {
    buffer: editor.getBuffer(),
    revision: editor.getBuffer().getTextRevision(),
    grammar,
    config: JSON.stringify(settings),
  };
}

function sameEditorSnapshot(first, second) {
  return Boolean(
    first &&
    second &&
    first.buffer === second.buffer &&
    first.revision === second.revision &&
    first.grammar === second.grammar &&
    first.config === second.config,
  );
}

function cloneDisplay(display) {
  if (Array.isArray(display)) return display.map(cloneDisplay);
  if (!display || typeof display !== "object") return display;
  if (display.tag && Array.isArray(display.children)) {
    // Etch mutates rendered nodes. Recreate their virtual nodes while keeping
    // the scanner's action callbacks bound to this same text editor.
    const props = display.props ? { ...display.props } : null;
    if (props?.on) props.on = { ...props.on };
    return require("@lumine-code/etch").dom(
      display.tag,
      props,
      ...display.children.map(cloneDisplay),
    );
  }
  return Object.hasOwn(display, "text") ? display.text : display;
}

function cloneEditorHeaders(headers, editor) {
  const clone = (items) =>
    items.map((item) => ({
      ...item,
      editor,
      startPoint: item.startPoint ? { ...item.startPoint } : undefined,
      endPoint: item.endPoint ? { ...item.endPoint } : undefined,
      classList: item.classList?.slice(),
      display: cloneDisplay(item.display),
      children: clone(item.children),
      currentCount: 0,
      stackCount: 0,
      visibility: 0,
    }));
  const result = clone(headers);
  if (headers.outlineStatus)
    Object.defineProperty(result, "outlineStatus", { value: { ...headers.outlineStatus } });
  return result;
}

function reusableEditorHeaders(headers) {
  const dataOnly = (value, seen = new Set()) => {
    if (value == null) return true;
    if (typeof value !== "object") return typeof value !== "function";
    if (seen.has(value)) return false;
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      return false;
    seen.add(value);
    const result = Object.values(value).every((child) => dataOnly(child, seen));
    seen.delete(value);
    return result;
  };
  return headers.every((item) =>
    Object.entries(item).every(([field, value]) => {
      if (field === "editor") return true;
      if (field === "children") return reusableEditorHeaders(value);
      if (field === "display" && value != null) return false;
      if (field === "startPoint" || field === "endPoint")
        return value == null || (Number.isFinite(value.row) && Number.isFinite(value.column));
      return dataOnly(value);
    }),
  );
}

function captureMarkerState(editor, markers) {
  if (!markers) return null;
  try {
    return {
      markers,
      markLines: markers.markLines,
      markerType: markers.markerType,
      markerUserLevel: markers.markerUserLevel,
      layers: Object.entries(editor.getBuffer().navigationMarkerLayers || {}).map(([id, layer]) => [
        id,
        layer,
        layer.getMarkerCount(),
      ]),
    };
  } catch {
    return undefined;
  }
}

function sameMarkerState(first, second) {
  if (first === undefined || second === undefined) return false;
  if (!first || !second) return first === second;
  return (
    first.markers === second.markers &&
    first.markLines === second.markLines &&
    first.markerType === second.markerType &&
    first.markerUserLevel === second.markerUserLevel &&
    first.layers.length === second.layers.length &&
    first.layers.every((row, index) =>
      row.every((value, column) => value === second.layers[index][column]),
    )
  );
}

module.exports = {
  captureEditorSnapshot,
  sameEditorSnapshot,
  cloneEditorHeaders,
  reusableEditorHeaders,
  captureMarkerState,
  sameMarkerState,
};
