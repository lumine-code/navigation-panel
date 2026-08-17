const { CompositeDisposable, Disposable } = require("lumine");

// The `marker.layer` provider: the document headers on the overview maps.
//
// Fed by this package's own `navigation.headers` service — main.js connects
// the same provider object it hands to other packages, so the layer sees
// exactly what an external consumer would.
module.exports = {
  activate() {
    this.naviService = null;
    // Layers handed over by the marker hub, keyed by editor. The hub builds
    // exactly one layer per editor, however many overview maps draw it.
    this.layers = new Map();
    this.disposables = new CompositeDisposable(
      // Subscribed once for the package rather than once per editor: the depth
      // limit is the same answer everywhere.
      lumine.config.observe("navigation-panel.marker.maxDepth", (value) => {
        this.maxDepth = value;
        for (const layer of this.layers.values()) {
          layer.update();
        }
      }),
    );
  },

  deactivate() {
    this.naviService = null;
    this.layers.clear();
    this.disposables.dispose();
  },

  // Compared by buffer rather than by editor: a split pane is a second editor
  // on the same buffer, and both should carry the markers.
  getHeaders(editor) {
    if (!this.naviService) {
      return [];
    }
    const naviEditor = this.naviService.getEditor();
    if (!naviEditor || naviEditor.buffer !== editor.buffer) {
      return [];
    }
    return this.naviService.getFlattenHeaders?.() || [];
  },

  connect(naviService) {
    this.naviService = naviService;
    const subscription = naviService.onDidUpdateHeaders?.((naviEditor) => {
      if (!naviEditor) return;
      for (const [editor, layer] of this.layers) {
        if (naviEditor.buffer !== editor.buffer) continue;
        layer.cache.set("data", this.getHeaders(editor));
        layer.update();
      }
    });
    return new Disposable(() => {
      this.naviService = null;
      subscription?.dispose();
    });
  },

  provideMarkerLayer() {
    return {
      name: "navigation",
      description: "Navigation-panel header markers",
      enabled: "navigation-panel.marker.enabled",
      threshold: "navigation-panel.marker.threshold",
      initialize: (layer) => {
        this.layers.set(layer.editor, layer);
        // A layer can attach long after the panel last published, so seed
        // it instead of leaving it blank until the next update.
        layer.cache.set("data", this.getHeaders(layer.editor));
        layer.disposables.add(new Disposable(() => this.layers.delete(layer.editor)));
      },
      getItems: ({ editor, cache }) => {
        const items = [];
        for (const header of cache.get("data") || []) {
          if (this.maxDepth && header.revel > this.maxDepth) {
            continue;
          }
          if (!header.startPoint) {
            continue;
          }
          items.push({
            row: editor.screenPositionForBufferPosition(header.startPoint).row,
            cls: `navigation-marker navigation-marker-${header.revel}`,
          });
        }
        return items;
      },
    };
  },
};
