const path = require("path");
const { CompositeDisposable, Emitter } = require("lumine");

// Activate by path: resolving by name would need this checkout linked into
// ~/.lumine/packages-dev first.
const packageRoot = path.join(__dirname, "..");

describe("navigation-panel marker layer", () => {
  let workspaceElement, editor, mainModule, markerLayer, attached;

  beforeEach(async () => {
    workspaceElement = lumine.views.getView(lumine.workspace);
    jasmine.attachToDOM(workspaceElement);
    editor = await lumine.workspace.open();
    editor.setText(Array(30).fill("lorem ipsum").join("\n"));
    // The harness keeps one config for the whole window, so a depth another
    // spec set would leak into this one.
    lumine.config.unset("navigation-panel.marker.maxDepth");
    lumine.config.unset("navigation-panel.marker.threshold");
    const pack = await lumine.packages.activatePackage(packageRoot);
    mainModule = pack.mainModule;
    markerLayer = mainModule.markerLayer;
    // Disconnect the real navigation.headers service wired by activate(), so
    // the fakes below stand in its place.
    mainModule.markerLayerConnection.dispose();
    mainModule.markerLayerConnection = null;
    attached = [];
  });

  afterEach(async () => {
    for (const layer of attached) {
      layer.disposables.dispose();
    }
    await lumine.packages.deactivatePackage("navigation-panel");
  });

  function createNaviService(targetEditor, headers) {
    const emitter = new Emitter();
    return {
      emitter,
      getEditor: () => targetEditor,
      getFlattenHeaders: () => headers,
      onDidUpdateHeaders: (callback) => {
        return emitter.on("did-update-headers", ({ editor, headers }) => callback(editor, headers));
      },
    };
  }

  function createLayer(layerEditor, provider = mainModule.provideMarkerLayer()) {
    const layer = {
      editor: layerEditor,
      props: provider,
      cache: new Map(),
      items: [],
      disposables: new CompositeDisposable(),
      update: jasmine.createSpy("update"),
    };
    // Attach through the provider contract, exactly like a marker host does.
    provider.initialize(layer);
    attached.push(layer);
    return layer;
  }

  describe("activation", () => {
    it("activates and observes its configuration", () => {
      expect(lumine.packages.isPackageActive("navigation-panel")).toBe(true);
      expect(markerLayer.maxDepth).toBe(0);

      lumine.config.set("navigation-panel.marker.maxDepth", 3);
      expect(markerLayer.maxDepth).toBe(3);
    });
  });

  describe("marker layer provider", () => {
    let provider;

    beforeEach(() => {
      provider = mainModule.provideMarkerLayer();
    });

    it("describes the navigation layer", () => {
      expect(provider.name).toBe("navigation");
      expect(provider.enabled).toBe("navigation-panel.marker.enabled");
      expect(provider.threshold).toBe("navigation-panel.marker.threshold");
      expect(typeof provider.initialize).toBe("function");
      expect(typeof provider.getItems).toBe("function");
    });

    it("re-runs the layer when the max depth changes", () => {
      const layer = createLayer(editor, provider);

      lumine.config.set("navigation-panel.marker.maxDepth", 4);
      expect(layer.update).toHaveBeenCalled();
    });

    it("maps cached headers to marker items with level classes", () => {
      const layer = createLayer(editor, provider);
      layer.cache.set("data", [
        { revel: 1, startPoint: { row: 2, column: 0 } },
        { revel: 3, startPoint: { row: 10, column: 0 } },
      ]);

      const items = provider.getItems(layer);
      expect(items).toEqual([
        { row: 2, cls: "navigation-marker navigation-marker-1" },
        { row: 10, cls: "navigation-marker navigation-marker-3" },
      ]);
    });

    it("skips headers without a start point", () => {
      const layer = createLayer(editor, provider);
      layer.cache.set("data", [{ revel: 1 }, { revel: 2, startPoint: { row: 5, column: 0 } }]);

      const items = provider.getItems(layer);
      expect(items.length).toBe(1);
      expect(items[0].row).toBe(5);
    });

    it("filters headers deeper than maxDepth", () => {
      lumine.config.set("navigation-panel.marker.maxDepth", 2);
      const layer = createLayer(editor, provider);
      layer.cache.set("data", [
        { revel: 1, startPoint: { row: 1, column: 0 } },
        { revel: 2, startPoint: { row: 2, column: 0 } },
        { revel: 3, startPoint: { row: 3, column: 0 } },
      ]);

      const items = provider.getItems(layer);
      expect(items.map((item) => item.row)).toEqual([1, 2]);
    });

    it("returns no items without cached data", () => {
      const layer = createLayer(editor, provider);
      expect(provider.getItems(layer)).toEqual([]);
    });
  });

  describe("the navigation.headers connection", () => {
    it("returns headers only for the buffer tracked by the navigation panel", () => {
      const headers = [{ revel: 1, startPoint: { row: 0, column: 0 } }];
      const service = createNaviService(editor, headers);
      const disposable = markerLayer.connect(service);

      expect(markerLayer.getHeaders(editor)).toEqual(headers);

      const otherEditor = lumine.workspace.buildTextEditor();
      expect(markerLayer.getHeaders(otherEditor)).toEqual([]);

      disposable.dispose();
      otherEditor.destroy();
    });

    it("returns no headers when no service is connected", () => {
      expect(markerLayer.getHeaders(editor)).toEqual([]);
    });

    it("pushes fresh headers into the navigation layer on header updates", () => {
      const headers = [{ revel: 2, startPoint: { row: 4, column: 0 } }];
      const service = createNaviService(editor, headers);
      const disposable = markerLayer.connect(service);

      const layer = createLayer(editor);

      service.emitter.emit("did-update-headers", { editor, headers });

      expect(layer.cache.get("data")).toEqual(headers);
      expect(layer.update).toHaveBeenCalled();

      disposable.dispose();
    });

    it("detaches the service on disposal", () => {
      const service = createNaviService(editor, []);
      const disposable = markerLayer.connect(service);
      expect(markerLayer.naviService).toBe(service);

      disposable.dispose();
      expect(markerLayer.naviService).toBe(null);
      expect(markerLayer.getHeaders(editor)).toEqual([]);
    });
  });

  describe("layer tracking", () => {
    it("forgets the editor once its layer detaches", () => {
      const provider = mainModule.provideMarkerLayer();
      const layer = createLayer(editor, provider);
      expect(markerLayer.layers.get(editor)).toBe(layer);

      layer.disposables.dispose();
      expect(markerLayer.layers.has(editor)).toBe(false);
    });
  });
});
