const { CompositeDisposable } = require("lumine");
const { getTextEditorHeaders } = require("./editor-adapter");

class EditorMarkers {
  constructor() {
    this.markerType = lumine.config.get("navigation-panel.editor.markerType");
    this.markLines = lumine.config.get("navigation-panel.editor.markLines");
    this.markerUserLevel = lumine.config.get("navigation-panel.editor.markerUserLevel");
    this.pendingScans = new Map();
  }

  refresh(editor, headers) {
    this.clear(editor);
    if (!headers) {
      return;
    }
    this.refreshHeaders(editor, headers);
  }

  refreshHeaders(editor, headers) {
    if (!headers) {
      return;
    }
    for (const item of headers) {
      const deep = this.markerUserLevel ? item.level : item.revel;
      const layer = this.ensureLayer(editor, deep);
      if (layer) {
        layer.markRange([item.startPoint, item.endPoint], {
          exclusive: true,
          // Keep the decoration through edits until the next scan, but hide it
          // immediately when the entire heading is removed or replaced.
          invalidate: "surround",
        });
        this.refreshHeaders(editor, item.children);
      }
    }
  }

  ensureLayer(editor, index) {
    const buffer = editor.getBuffer();
    if (!buffer.navigationMarkerLayers) {
      buffer.navigationMarkerLayers = {};
    }

    if (!buffer.navigationMarkerLayers[index]) {
      buffer.navigationMarkerLayers[index] = buffer.addMarkerLayer({
        role: `navigation-marker-${index}`,
      });
      for (const ed of lumine.workspace.getTextEditors()) {
        if (ed.getBuffer() === buffer) {
          this.decorateLayer(ed, buffer.navigationMarkerLayers[index], index);
        }
      }
    }
    return buffer.navigationMarkerLayers[index];
  }

  decorateLayer(editor, layer, index) {
    for (const decoType of this.markerType.split("&")) {
      editor.decorateMarkerLayer(layer, {
        type: decoType,
        class: `navigation-marker-${index} navigation-marker ${decoType}-decoration`,
      });
    }
  }

  clear(editor) {
    if (!editor) {
      return;
    }
    this.pendingScans.get(editor)?.abort();
    this.pendingScans.delete(editor);
    const buffer = editor.getBuffer();
    if (!buffer.navigationMarkerLayers) {
      return;
    }
    for (const layer of Object.values(buffer.navigationMarkerLayers)) {
      layer.clear();
    }
  }

  async forEditor(editor) {
    if (!editor) {
      return;
    }
    this.clear(editor);
    if (!this.markLines) {
      return;
    }
    const controller = new AbortController();
    this.pendingScans.set(editor, controller);
    const subscriptions = new CompositeDisposable(
      editor.getBuffer().onDidChange(() => controller.abort()),
      editor.onDidChangeGrammar(() => controller.abort()),
      editor.onDidDestroy(() => controller.abort()),
    );
    try {
      let headers = getTextEditorHeaders(editor, { signal: controller.signal });
      if (headers?.then) headers = await headers;
      if (!controller.signal.aborted && !editor.isDestroyed()) {
        this.refreshHeaders(editor, headers);
      }
    } catch {
      /* ignore scanner errors */
    } finally {
      subscriptions.dispose();
      if (this.pendingScans.get(editor) === controller) this.pendingScans.delete(editor);
    }
  }

  toggleLocal() {
    this.markLines = !this.markLines;
    for (const editor of lumine.workspace.getTextEditors()) {
      this.forEditor(editor);
    }
  }
}

module.exports = { EditorMarkers };
