const { CompositeDisposable, Disposable } = require("lumine");

// The `marker.layer` provider: the document headers on the overview maps.
//
// Fed by this package's own `navigation.headers` service — main.js connects
// the same provider object it hands to other packages, so the layer sees
// exactly what an external consumer would.
module.exports = {
  activate() {
    this.naviService = null;
    this.connection = null;
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
    this.connection = null;
    for (const layer of this.layers.values()) layer.cache.get("bufferMarkers")?.destroy();
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

  setHeaders(layer, data) {
    const headers = data.filter((header) => header.startPoint);
    const anchors = layer.cache.get("anchors") || [];
    // Cursor-state publications rebuild the header wrappers but retain their
    // source Points. Keep their live anchors until a new scan publishes new
    // coordinates, even if the old Points no longer name the moved headings.
    const unchanged =
      anchors.length === headers.length &&
      headers.every(
        ({ startPoint }, index) =>
          anchors[index].sourcePoint === startPoint &&
          anchors[index].sourceRow === startPoint.row &&
          anchors[index].sourceColumn === startPoint.column,
      );
    if (unchanged) {
      for (let index = 0; index < anchors.length; index++) {
        anchors[index].revel = headers[index].revel;
      }
    } else {
      const bufferMarkers = layer.cache.get("bufferMarkers");
      bufferMarkers.clear();
      layer.cache.set(
        "anchors",
        headers.map(({ startPoint, revel }) => ({
          sourcePoint: startPoint,
          sourceRow: startPoint.row,
          sourceColumn: startPoint.column,
          revel,
          marker: bufferMarkers.markPosition(startPoint, { invalidate: "never" }),
        })),
      );
    }
    layer.cache.set("data", data);
  },

  connect(naviService) {
    const connection = {};
    this.connection = connection;
    this.naviService = naviService;
    const subscription = naviService.onDidUpdateHeaders?.((naviEditor) => {
      if (this.connection !== connection) return;
      if (!naviEditor) return;
      for (const [editor, layer] of this.layers) {
        if (naviEditor.buffer !== editor.buffer) continue;
        this.setHeaders(layer, this.getHeaders(editor));
        layer.update();
      }
    });
    for (const [editor, layer] of this.layers) {
      this.setHeaders(layer, this.getHeaders(editor));
      layer.update();
    }
    return new Disposable(() => {
      subscription?.dispose();
      if (this.connection !== connection) return;
      this.connection = null;
      this.naviService = null;
      for (const layer of this.layers.values()) {
        this.setHeaders(layer, []);
        layer.update();
      }
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
        const bufferMarkers = layer.editor.getBuffer().addMarkerLayer({
          maintainHistory: false,
          role: "navigation-overview-anchors",
        });
        layer.cache.set("bufferMarkers", bufferMarkers);
        layer.disposables.add(
          new Disposable(() => {
            if (this.layers.get(layer.editor) === layer) this.layers.delete(layer.editor);
            bufferMarkers.destroy();
          }),
        );
        // A layer can attach long after the panel last published, so seed
        // it instead of leaving it blank until the next update.
        this.setHeaders(layer, this.getHeaders(layer.editor));
      },
      getItems: ({ editor, cache }) => {
        const items = [];
        for (const { marker, revel } of cache.get("anchors") || []) {
          if (this.maxDepth && revel > this.maxDepth) {
            continue;
          }
          if (marker.isDestroyed()) {
            continue;
          }
          items.push({
            row: editor.screenPositionForBufferPosition(marker.getStartPosition()).row,
            cls: `navigation-marker navigation-marker-${revel}`,
          });
        }
        return items;
      },
    };
  },
};
