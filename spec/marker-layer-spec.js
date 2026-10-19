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
      markerLayer.setHeaders(layer, [
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
      markerLayer.setHeaders(layer, [
        { revel: 1 },
        { revel: 2, startPoint: { row: 5, column: 0 } },
      ]);

      const items = provider.getItems(layer);
      expect(items.length).toBe(1);
      expect(items[0].row).toBe(5);
    });

    it("filters headers deeper than maxDepth", () => {
      lumine.config.set("navigation-panel.marker.maxDepth", 2);
      const layer = createLayer(editor, provider);
      markerLayer.setHeaders(layer, [
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

    it("tracks repeated newline edits before the next header scan without polling the producer", () => {
      const headers = [{ revel: 1, startPoint: { row: 4, column: 0 } }];
      const layer = createLayer(editor, provider);
      const service = createNaviService(editor, headers);
      spyOn(service, "getFlattenHeaders").and.callThrough();
      const disposable = markerLayer.connect(service);
      const stopped = jasmine.createSpy("stopped");
      const stopSubscription = editor.onDidStopChanging(stopped);

      editor.getBuffer().insert([0, 0], "\n");
      expect(provider.getItems(layer)[0].row).toBe(5);
      editor.getBuffer().insert([0, 0], "\n");
      expect(provider.getItems(layer)[0].row).toBe(6);
      expect(service.getFlattenHeaders).toHaveBeenCalledTimes(1);
      expect(stopped).not.toHaveBeenCalled();
      expect(headers[0].startPoint.row).toBe(4);

      // Cursor state can republish wrappers around the preceding scan's Points.
      service.getFlattenHeaders.and.returnValue([{ ...headers[0] }]);
      service.emitter.emit("did-update-headers", { editor });
      expect(provider.getItems(layer)[0].row).toBe(6);

      const oldAnchor = layer.cache.get("anchors")[0].marker;
      service.getFlattenHeaders.and.returnValue([{ revel: 2, startPoint: { row: 8, column: 0 } }]);
      service.emitter.emit("did-update-headers", { editor });
      expect(oldAnchor.isDestroyed()).toBe(true);
      expect(provider.getItems(layer)).toEqual([
        { row: 8, cls: "navigation-marker navigation-marker-2" },
      ]);

      stopSubscription.dispose();
      disposable.dispose();
    });

    it("projects moved header anchors through folds and changing soft wraps", () => {
      editor.setText(
        ["x".repeat(100), "before", "fold", "hidden", "end", "heading", "tail"].join("\n"),
      );
      editor.displayLayer.reset({ softWrapColumn: 10 });
      editor.foldBufferRowRange(2, 4);
      const layer = createLayer(editor, provider);
      const service = createNaviService(editor, [{ revel: 1, startPoint: { row: 5, column: 0 } }]);
      const disposable = markerLayer.connect(service);
      const before = provider.getItems(layer)[0].row;
      expect(before).toBeGreaterThan(5);

      editor.getBuffer().insert([1, 0], "\n\n");

      const moved = provider.getItems(layer)[0].row;
      expect(moved).toBe(before + 2);
      expect(moved).toBe(editor.screenPositionForBufferPosition([7, 0]).row);

      editor.displayLayer.reset({ softWrapColumn: 20 });
      expect(provider.getItems(layer)[0].row).toBe(
        editor.screenPositionForBufferPosition([7, 0]).row,
      );
      expect(provider.getItems(layer)[0].row).toBeLessThan(moved);

      disposable.dispose();
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

    it("seeds existing navigation layers on connection", () => {
      const headers = [{ revel: 2, startPoint: { row: 4, column: 0 } }];
      const layer = createLayer(editor);
      const service = createNaviService(editor, headers);
      const disposable = markerLayer.connect(service);

      expect(layer.cache.get("data")).toEqual(headers);
      expect(layer.update).toHaveBeenCalledTimes(1);

      disposable.dispose();
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
      const layer = createLayer(editor);
      const service = createNaviService(editor, [{ revel: 1, startPoint: { row: 4, column: 0 } }]);
      const disposable = markerLayer.connect(service);
      expect(markerLayer.naviService).toBe(service);
      layer.update.calls.reset();
      const bufferMarkers = layer.cache.get("bufferMarkers");
      expect(bufferMarkers.getMarkers().length).toBe(1);

      disposable.dispose();
      expect(markerLayer.naviService).toBe(null);
      expect(markerLayer.getHeaders(editor)).toEqual([]);
      expect(layer.cache.get("data")).toEqual([]);
      expect(bufferMarkers.getMarkers()).toEqual([]);
      expect(layer.update).toHaveBeenCalledTimes(1);
    });

    it("ignores updates and disposal from a replaced service connection", () => {
      const layer = createLayer(editor);
      const firstService = createNaviService(editor, [
        { revel: 1, startPoint: { row: 2, column: 0 } },
      ]);
      const nextHeaders = [{ revel: 2, startPoint: { row: 6, column: 0 } }];
      const nextService = createNaviService(editor, nextHeaders);
      const firstConnection = markerLayer.connect(firstService);
      const nextConnection = markerLayer.connect(nextService);
      layer.update.calls.reset();

      firstService.emitter.emit("did-update-headers", { editor });
      firstConnection.dispose();

      expect(markerLayer.naviService).toBe(nextService);
      expect(layer.cache.get("data")).toEqual(nextHeaders);
      expect(layer.update).not.toHaveBeenCalled();

      nextConnection.dispose();
      expect(layer.cache.get("data")).toEqual([]);
      expect(layer.update).toHaveBeenCalledTimes(1);
    });

    it("keeps a newer connection when the same service object reconnects", () => {
      const headers = [{ revel: 1, startPoint: { row: 3, column: 0 } }];
      const layer = createLayer(editor);
      const service = createNaviService(editor, headers);
      const firstConnection = markerLayer.connect(service);
      const nextConnection = markerLayer.connect(service);
      layer.update.calls.reset();

      firstConnection.dispose();

      expect(markerLayer.naviService).toBe(service);
      expect(layer.cache.get("data")).toEqual(headers);
      expect(layer.update).not.toHaveBeenCalled();

      nextConnection.dispose();
    });

    it("retains cached headers for inactive editors during normal document switches", () => {
      const headers = [{ revel: 1, startPoint: { row: 3, column: 0 } }];
      const otherHeaders = [{ revel: 2, startPoint: { row: 1, column: 0 } }];
      const otherEditor = lumine.workspace.buildTextEditor();
      otherEditor.setText("first\nsecond");
      const layer = createLayer(editor);
      const otherLayer = createLayer(otherEditor);
      const service = createNaviService(editor, headers);
      const disposable = markerLayer.connect(service);
      layer.update.calls.reset();
      otherLayer.update.calls.reset();
      service.getEditor = () => otherEditor;
      service.getFlattenHeaders = () => otherHeaders;

      service.emitter.emit("did-update-headers", { editor: otherEditor });

      expect(layer.cache.get("data")).toEqual(headers);
      expect(layer.update).not.toHaveBeenCalled();
      expect(otherLayer.cache.get("data")).toEqual(otherHeaders);
      expect(otherLayer.update).toHaveBeenCalledTimes(1);

      disposable.dispose();
      otherEditor.destroy();
    });
  });

  describe("layer tracking", () => {
    it("forgets the editor once its layer detaches", () => {
      const provider = mainModule.provideMarkerLayer();
      const layer = createLayer(editor, provider);
      expect(markerLayer.layers.get(editor)).toBe(layer);
      const bufferMarkers = layer.cache.get("bufferMarkers");

      layer.disposables.dispose();
      expect(markerLayer.layers.has(editor)).toBe(false);
      expect(bufferMarkers.isDestroyed()).toBe(true);
      expect(editor.getBuffer().getMarkerLayer(bufferMarkers.id)).toBeUndefined();
    });
  });
});
