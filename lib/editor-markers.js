const { getTextEditorHeaders } = require("./editor-adapter");

class EditorMarkers {
  constructor() {
    this.pendingRequests = new Set();
    this.destroyed = false;
    this.markerType = lumine.config.get("navigation-panel.editor.markerType");
    this.markLines = lumine.config.get("navigation-panel.editor.markLines");
    this.markerUserLevel = lumine.config.get("navigation-panel.editor.markerUserLevel");
  }

  destroy() {
    this.destroyed = true;
    for (const subscription of this.pendingRequests) subscription.dispose();
    this.pendingRequests.clear();
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
          invalidate: "inside",
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
    const buffer = editor.getBuffer();
    if (!buffer.navigationMarkerLayers) {
      return;
    }
    for (const layer of Object.values(buffer.navigationMarkerLayers)) {
      layer.clear();
    }
  }

  forEditor(editor) {
    if (!editor || this.destroyed) {
      return;
    }
    this.clear(editor);
    if (!this.markLines) {
      return;
    }
    const headers = getTextEditorHeaders(editor);
    if (typeof headers?.then === "function") {
      const buffer = editor.getBuffer();
      const mode = buffer.getLanguageMode();
      let changed = false;
      const subscription = buffer.onDidChange(() => {
        changed = true;
      });
      this.pendingRequests.add(subscription);
      return headers
        .then((settled) => {
          if (
            this.destroyed ||
            changed ||
            editor.isDestroyed() ||
            buffer.getLanguageMode() !== mode ||
            !this.markLines
          )
            return;
          this.refresh(editor, settled);
        })
        .catch(() => {})
        .finally(() => {
          this.pendingRequests.delete(subscription);
          subscription.dispose();
        });
    }
    this.refreshHeaders(editor, headers);
  }

  toggleLocal() {
    this.markLines = !this.markLines;
    for (const editor of lumine.workspace.getTextEditors()) {
      this.forEditor(editor);
    }
  }
}

module.exports = { EditorMarkers };
