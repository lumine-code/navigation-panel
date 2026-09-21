const { CompositeDisposable, Disposable } = require("lumine");

let runtime;
let treeRuntime;

function ensureTreeRuntime() {
  if (treeRuntime) return treeRuntime;

  // The pane item is part of the public opener contract, so keep only this
  // small view module available synchronously. Adapter/scanner/marker modules
  // remain behind ensurePanelRuntime().
  const etch = require("@lumine-code/etch");
  etch.setScheduler(lumine.views);
  treeRuntime = {
    NavigationTree: require("./navi-tree").NavigationTree,
  };
  return treeRuntime;
}

function ensureRuntime() {
  if (runtime) return runtime;

  // Keep the panel's parser/adapters and Etch renderer out of the bootstrap.
  // A restored pane or the first command crosses this boundary and all later
  // callers share the same constructors for the package generation.
  const { NavigationTree } = ensureTreeRuntime();
  runtime = {
    AdapterManager: require("./adapter-manager").AdapterManager,
    EditorAdapter: require("./editor-adapter").EditorAdapter,
    EditorFolds: require("./editor-folds"),
    NavigationList: require("./navi-list").NavigationList,
    EditorMarkers: require("./editor-markers").EditorMarkers,
    NavigationTree,
    markerLayer: require("./marker-layer"),
  };
  return runtime;
}

function ensureNavigationTree(main) {
  if (main.navigationTree) return main.navigationTree;
  const { NavigationTree } = ensureTreeRuntime();
  const tree = new NavigationTree();
  main.navigationTree = tree;
  tree.onDidDestroy(() => {
    if (main.navigationTree === tree) main.navigationTree = null;
  });
  tree.update(main.headers, { instant: true });
  return tree;
}

function ensurePanelObjects(main) {
  if (main._objectsReady) return;
  const AdapterManager = require("./adapter-manager").AdapterManager;
  const EditorAdapter = require("./editor-adapter").EditorAdapter;
  const NavigationList = require("./navi-list").NavigationList;
  const EditorMarkers = require("./editor-markers").EditorMarkers;

  main.onDidUpdateCallbacks = new Set();
  main.navigationList = new NavigationList({
    getItems: () => main.getVisibleHeaderListItems(),
    hasHeaders: () => Boolean(main.headers),
    didConfirmSelection: (item) => main.navigateToHeader(item),
    didScrollSelection: (item) => main.navigateToHeader(item, { focus: false }),
  });
  main.adapterManager = new AdapterManager();
  for (const adapter of main.navigationAdapters || []) main.adapterManager.consume(adapter);
  main.markers = new EditorMarkers();
  main.builtinEditorAdapter = new EditorAdapter({
    traceVisible: () => main.traceVisible,
    markers: main.markers,
  });
  main._objectsReady = true;
}

const EMPTY_HEADERS_DELAY = 75;

// The package is present in every window, but most windows never open the
// navigation tree. Keep the parser, etch view classes, marker layer and the
// editor sweep out of the measured activation path. The first command,
// deserializer or service operation that needs the panel crosses this boundary
// and all later callers share the same runtime for this package generation.
function ensurePanelRuntime(main) {
  if (main._runtimeReady) return ensureRuntime();

  ensurePanelObjects(main);

  const { markerLayer } = ensureRuntime();
  main.editor = null;
  main.currentHeaderIndex = -1;
  main.emptyHeadersTimer = null;
  main._runtimeReady = true;

  // The tree is created on demand by an opener/command. Restored trees call
  // getNavigationTree() after package activation, which also keeps that path
  // outside the activation stopwatch.
  main.disposables.add(
    lumine.config.observe("navigation-panel.panel.traceVisible", (value) => {
      main.traceVisible = value;
      if (!value) {
        main.setVisibleItemByPredicate(main.headers, () => false);
        main.navigationTree?.update(main.headers);
      }
    }),
    lumine.workspace.observeTextEditors((editor) => {
      const buffer = editor.getBuffer();
      if (!("navigationMarkerLayers" in buffer)) {
        buffer.navigationMarkerLayers = {};
      } else {
        for (const [index, layer] of Object.entries(buffer.navigationMarkerLayers)) {
          main.markers.decorateLayer(editor, layer, index);
        }
      }
      main.markers.forEditor(editor);
    }),
    lumine.workspace.getCenter().observeActivePaneItem((item) => {
      if (!item) {
        main.unsubscribe();
        main.navigationTree?.update(null);
      } else if (main.editor === item) {
        return;
      } else if (main.adapterManager.getForItem(item)) {
        main.adapterSubscribe(main.adapterManager.getForItem(item), item);
      } else if (lumine.workspace.isTextEditor(item)) {
        main.adapterSubscribe(main.builtinEditorAdapter, item);
      } else {
        main.unsubscribe();
        main.navigationTree?.update(null);
      }
    }),
  );

  // The scrollbar/minimap layer consumes this package's own
  // `navigation.headers` service. Connect the same facade handed to external
  // consumers, but only after the panel runtime is actually needed.
  markerLayer.activate();
  main.markerLayerConnection = markerLayer.connect(main.provideNavigationHeaders());
  return ensureRuntime();
}

module.exports = {
  initialize() {
    // Deserializers run after initialize(), but may run before activate(). Keep
    // the singleton slot and the data its constructor reads available for that
    // startup path; activate() must then wire the same restored tree.
    this.disposables ||= new CompositeDisposable();
    this.navigationTree = null;
    this.headers = null;
  },

  activate() {
    this.disposables ||= new CompositeDisposable();
    this._runtimeReady = false;
    this.editor = null;
    this.currentHeaderIndex = -1;
    this.emptyHeadersTimer = null;
    this.navigationAdapters = new Set();
    const foldSection = (level) => {
      const { EditorFolds } = ensureRuntime();
      ensurePanelRuntime(this);
      return EditorFolds.foldSectionAt(this.editor, this.headers, level);
    };
    const foldAsTable = (className) => {
      const { EditorFolds } = ensureRuntime();
      ensurePanelRuntime(this);
      return EditorFolds.foldAsTable(this.editor, this.headers, className);
    };

    this.disposables.add(
      lumine.commands.add("lumine-workspace", {
        "navigation-panel:open": {
          description: "Show the panel for the active editor.",
          didDispatch: () => this.open(),
        },
        "navigation-panel:open-and-split-down": {
          description: "Show the panel in a pane split below the editor.",
          didDispatch: () => this.open({ split: "down" }),
        },
        "navigation-panel:hide": () => this.hide(),
        "navigation-panel:toggle": () => this.toggle(),
        "navigation-panel:toggle-focus": () => this.toggleFocus(),
        "navigation-panel:list": {
          description: "Jump to a header through a filterable list.",
          didDispatch: () => this.list(),
        },
        "navigation-panel:next-header": {
          description: "Move the cursor to the next header in the file.",
          didDispatch: () => this.navigateHeader(1),
        },
        "navigation-panel:previous-header": {
          description: "Move the cursor to the previous header in the file.",
          didDispatch: () => this.navigateHeader(-1),
        },
        "navigation-panel:fold-toggle": {
          description: "Fold or unfold the section holding the cursor.",
          didDispatch: () => {
            ensurePanelRuntime(this);
            return ensureRuntime().EditorFolds.toggleSection(this.editor, this.headers);
          },
        },
        "navigation-panel:fold-section": {
          description: "Fold the section holding the cursor.",
          didDispatch: () => foldSection(),
        },
        // Written out rather than generated over 1..9: a loop would keep the
        // nine parallel by construction, but it would also put every one of
        // them past what the command check can read.
        "navigation-panel:fold-section-at-1": {
          description: "Fold the section holding the cursor at heading level 1.",
          didDispatch: () => foldSection(1),
        },
        "navigation-panel:fold-section-at-2": {
          description: "Fold the section holding the cursor at heading level 2.",
          didDispatch: () => foldSection(2),
        },
        "navigation-panel:fold-section-at-3": {
          description: "Fold the section holding the cursor at heading level 3.",
          didDispatch: () => foldSection(3),
        },
        "navigation-panel:fold-section-at-4": {
          description: "Fold the section holding the cursor at heading level 4.",
          didDispatch: () => foldSection(4),
        },
        "navigation-panel:fold-section-at-5": {
          description: "Fold the section holding the cursor at heading level 5.",
          didDispatch: () => foldSection(5),
        },
        "navigation-panel:fold-section-at-6": {
          description: "Fold the section holding the cursor at heading level 6.",
          didDispatch: () => foldSection(6),
        },
        "navigation-panel:fold-section-at-7": {
          description: "Fold the section holding the cursor at heading level 7.",
          didDispatch: () => foldSection(7),
        },
        "navigation-panel:fold-section-at-8": {
          description: "Fold the section holding the cursor at heading level 8.",
          didDispatch: () => foldSection(8),
        },
        "navigation-panel:fold-section-at-9": {
          description: "Fold the section holding the cursor at heading level 9.",
          didDispatch: () => foldSection(9),
        },
        "navigation-panel:fold-as-table": {
          description: "Fold everything so the file reads as a list of its headings.",
          didDispatch: () => foldAsTable(),
        },
        "navigation-panel:fold-all-infos": {
          description: "Fold everything but the headings marked as information.",
          didDispatch: () => foldAsTable("info"),
        },
        "navigation-panel:fold-all-successes": {
          description: "Fold everything but the headings marked as successes.",
          didDispatch: () => foldAsTable("success"),
        },
        "navigation-panel:fold-all-warnings": {
          description: "Fold everything but the headings marked as warnings.",
          didDispatch: () => foldAsTable("warning"),
        },
        "navigation-panel:fold-all-errors": {
          description: "Fold everything but the headings marked as errors.",
          didDispatch: () => foldAsTable("error"),
        },
        "navigation-panel:unfold": {
          description: "Unfold the section holding the cursor.",
          didDispatch: () => {
            ensurePanelRuntime(this);
            return ensureRuntime().EditorFolds.unfold(this.editor, this.headers);
          },
        },
        "navigation-panel:unfold-all": {
          description: "Unfold every section in the file.",
          didDispatch: () => {
            ensurePanelRuntime(this);
            return ensureRuntime().EditorFolds.unfoldAll(this.editor, this.headers);
          },
        },
        "navigation-panel:markers-toggle": {
          description: "Show or hide the header markers in every open editor.",
          didDispatch: () => {
            ensurePanelRuntime(this);
            return this.markers.toggleLocal();
          },
        },
      }),
    );

    // The list model is part of the package's public command/service surface
    // (item actions and adapter consumers receive it immediately). Keep that
    // small model alive, but leave the tree renderer, marker layer and editor
    // sweep behind ensurePanelRuntime().
    ensurePanelObjects(this);
    // Workspace restoration and pane-copy semantics require a stable item
    // identity as soon as the package is active. The tree itself is cheap
    // compared with the scanner/marker runtime, so create only this model now.
    ensureNavigationTree(this);

    // Workspace announces the first real editor through the public hook. This
    // wakes the scanner/observer side only when the panel can actually be
    // useful; replay covers a package activated after the first editor.
    if (lumine.hooks?.on) {
      this.disposables.add(
        lumine.hooks.on("core:text-editor-used", () => ensurePanelRuntime(this)),
      );
    }
  },

  deactivate() {
    if (!this.disposables) {
      this.navigationTree?.destroy();
      this.navigationTree = null;
      return;
    }
    if (this._runtimeReady) {
      const { markerLayer } = ensureRuntime();
      for (let editor of lumine.workspace.getTextEditors()) {
        this.markers.clear(editor);
      }
      this.markerLayerConnection?.dispose();
      this.markerLayerConnection = null;
      markerLayer.deactivate();
      this.unsubscribe();
    }
    this.navigationList?.destroy();
    this.navigationTree?.destroy();
    this.navigationTree = null;
    this._runtimeReady = false;
    this._objectsReady = false;
    this.navigationAdapters?.clear();
    this.disposables.dispose();
    this.disposables = null;
  },

  getNavigationTree() {
    ensurePanelRuntime(this);
    return ensureNavigationTree(this);
  },

  deserializeNavigationTree() {
    return this.getNavigationTree();
  },

  unsubscribe() {
    this.cancelEmptyHeadersUpdate();
    this.adapterManager.unsubscribe();
    this.editor = null;
    this.headers = null;
    this.navigationList.markDirty();
  },

  consumeNavigationAdapter(adapter) {
    this.navigationAdapters.add(adapter);
    // An adapter is an actual request to navigate a non-text pane item, so its
    // observer must be live immediately even when no text-editor hook has run.
    if (!this._runtimeReady) ensurePanelRuntime(this);
    const item = lumine.workspace.getCenter().getActivePaneItem();
    if (item && adapter.handlesItem?.(item)) {
      this.adapterSubscribe(adapter, item);
    }
    return this.adapterManager.consume(adapter);
  },

  adapterSubscribe(adapter, item) {
    // A pane split with copyActiveItem yields a new item sharing the previous
    // editor's buffer; its headers will be identical, so keep the current tree
    // instead of flashing the empty placeholder while the copy is scanned
    const sameBuffer =
      this.editor &&
      typeof this.editor.getBuffer === "function" &&
      typeof item.getBuffer === "function" &&
      this.editor.getBuffer() === item.getBuffer();
    this.unsubscribe();
    this.editor = item;
    this.headers = [];
    this.navigationList.markDirty();
    if (!sameBuffer) {
      this.scheduleEmptyHeadersUpdate(this.headers);
    }
    this.adapterManager.subscribe(adapter, item, {
      onHeaders: (headers, options) => {
        if (this.editor !== item || this.adapterManager.active !== adapter) return;
        this.updateAdapterHeaders(headers, options);
      },
    });
  },

  updateAdapterHeaders(rawHeaders, props = {}) {
    this.cancelEmptyHeadersUpdate();
    this.headers = this.adapterManager.buildHeaders(rawHeaders, this.editor);
    this.navigationList.markDirty();
    this.navigationTree?.update(this.headers, props);

    if (
      lumine.workspace.isTextEditor(this.editor) &&
      !this.adapterManager.active?.managesEditorMarkers
    ) {
      if (this.markers.markLines && this.headers) {
        this.markers.refresh(this.editor, this.headers);
      } else {
        this.markers.clear(this.editor);
      }
    }

    for (let callback of this.onDidUpdateCallbacks) {
      callback(this.editor, this.headers);
    }
  },

  scheduleEmptyHeadersUpdate(headers) {
    this.cancelEmptyHeadersUpdate();
    this.emptyHeadersTimer = setTimeout(() => {
      this.emptyHeadersTimer = null;
      if (this.headers === headers) {
        this.navigationTree?.update(headers, { instant: true });
      }
    }, EMPTY_HEADERS_DELAY);
  },

  cancelEmptyHeadersUpdate() {
    if (!this.emptyHeadersTimer) return;
    clearTimeout(this.emptyHeadersTimer);
    this.emptyHeadersTimer = null;
  },

  open(userOptions) {
    const tree = this.getNavigationTree();
    let options = {
      location: lumine.config.get("navigation-panel.panel.defaultSide"),
      searchAllPanes: true,
    };
    lumine.workspace.open(tree, { ...options, ...userOptions }).then(() => {
      if (this.navigationTree !== tree) return;
      tree.focusHeaderList();
      this.builtinEditorAdapter.refreshVisible();
      tree.instant = true;
      tree.scrollToCurrent();
    });
  },

  hide() {
    const tree = this.navigationTree;
    if (!tree) return;
    let previouslyFocusedElement = document.activeElement;
    lumine.workspace.hide(tree);
    previouslyFocusedElement.focus();
  },

  toggle() {
    const tree = this.getNavigationTree();
    let previouslyFocusedElement = document.activeElement;
    lumine.workspace.toggle(tree).then(() => {
      if (this.navigationTree !== tree) return;
      previouslyFocusedElement.focus();
      this.builtinEditorAdapter.refreshVisible();
      tree.instant = true;
      tree.scrollToCurrent();
    });
  },

  toggleFocus() {
    const tree = this.getNavigationTree();
    const el = tree.element;
    const isVisible = el && (el.offsetWidth !== 0 || el.offsetHeight !== 0);
    if (!isVisible) {
      this.open();
    } else if (el.contains(document.activeElement)) {
      lumine.workspace.getCenter().activate();
    } else {
      tree.focusHeaderList();
    }
  },

  list() {
    ensurePanelRuntime(this);
    this.navigationList.toggle();
  },

  onDidUpdateHeaders(callback) {
    ensurePanelRuntime(this);
    this.onDidUpdateCallbacks.add(callback);
    return new Disposable(() => {
      this.onDidUpdateCallbacks.delete(callback);
    });
  },

  observeHeaders(callback) {
    callback(this.editor, this.headers);
    return this.onDidUpdateHeaders(callback);
  },

  setVisibleItemByPredicate(headers, isVisible) {
    if (!headers) return;
    for (const header of headers) {
      header.visibility = isVisible(header) ? 1 : 0;
      this.setVisibleItemByPredicate(header.children, isVisible);
    }
  },

  getFlattenHeaders() {
    let items = [];
    if (this.headers) {
      this._getFlattenHeaders(items, this.headers);
    }
    return items;
  },

  _getFlattenHeaders(items, headers) {
    for (let item of headers) {
      items.push(item);
      this._getFlattenHeaders(items, item.children);
    }
  },

  navigateHeader(direction) {
    const visibleHeaders = this.getVisibleHeadersFromTree();
    if (!visibleHeaders.length) return;

    // Initialize or update current index
    if (this.currentHeaderIndex === -1) {
      // Find the current header based on cursor position
      this.currentHeaderIndex = this.findCurrentHeaderIndex(visibleHeaders);
      if (this.currentHeaderIndex === -1) {
        this.currentHeaderIndex = direction > 0 ? 0 : visibleHeaders.length - 1;
      }
    } else {
      // Move to next/previous header
      this.currentHeaderIndex += direction;

      // Wrap around
      if (this.currentHeaderIndex >= visibleHeaders.length) {
        this.currentHeaderIndex = 0;
      } else if (this.currentHeaderIndex < 0) {
        this.currentHeaderIndex = visibleHeaders.length - 1;
      }
    }

    // Navigate to the selected header
    const header = visibleHeaders[this.currentHeaderIndex];
    if (header) {
      return this.navigateToHeader(header);
    }
  },

  getVisibleHeadersFromTree() {
    if (!this.headers) return [];
    const items = [];
    this._collectVisibleHeaders(items, this.headers);
    return items;
  },

  getVisibleHeaderListItems() {
    if (!this.headers) return [];
    const items = [];
    this._collectVisibleHeaderListItems(items, this.headers, []);
    return items;
  },

  _collectVisibleHeaderListItems(items, headers, parents) {
    for (const header of headers) {
      const visible = this.isHeaderVisible(header);
      const path = [...parents, header.text.trim()].filter(Boolean);

      if (visible) {
        items.push({
          ...header,
          text: path.join(" > "),
          children: [],
        });
      }

      if (header.children && header.children.length > 0) {
        this._collectVisibleHeaderListItems(items, header.children, path);
      }
    }
  },

  _collectVisibleHeaders(items, headers) {
    for (const header of headers) {
      const visible = this.isHeaderVisible(header);

      if (visible) {
        items.push(header);
        if (header.children && header.children.length > 0) {
          this._collectVisibleHeaders(items, header.children);
        }
      }
    }
  },

  isHeaderVisible(header) {
    if (!header.classList) return true;
    const t = this.getNavigationTree();
    if (header.classList.includes("info") && !t.info) return false;
    if (header.classList.includes("success") && !t.success) return false;
    if (header.classList.includes("warning") && !t.warning) return false;
    if (header.classList.includes("error") && !t.error) return false;
    if (header.classList.length === 0 && !t.standard) return false;
    return true;
  },

  findCurrentHeaderIndex(visibleHeaders) {
    if (!this.editor) return -1;
    const currentRow = this.editor.getCursorBufferPosition().row;

    for (let i = 0; i < visibleHeaders.length; i++) {
      const item = visibleHeaders[i];
      if (item.startPoint && item.startPoint.row === currentRow) {
        return i;
      }
    }

    return -1;
  },

  navigateToHeader(item, options = {}) {
    if (!item || !item.navigate) return;
    return item.navigate(options);
  },

  provideNavigationHeaders() {
    const main = this;
    return {
      getEditor: () => {
        return main.editor || null;
      },
      getFlattenHeaders: () => {
        return main.getFlattenHeaders();
      },
      onDidUpdateHeaders: (callback) => {
        return main.onDidUpdateHeaders(callback);
      },
      observeHeaders: (callback) => {
        return main.observeHeaders(callback);
      },
    };
  },

  provideMarkerLayer() {
    if (!this._markerLayerProvider) {
      const main = this;
      this._markerLayerProvider = {
        name: "navigation",
        description: "Navigation-panel header markers",
        enabled: "navigation-panel.marker.enabled",
        threshold: "navigation-panel.marker.threshold",
        initialize(layer) {
          ensurePanelRuntime(main);
          return ensureRuntime().markerLayer.provideMarkerLayer().initialize(layer);
        },
        getItems(args) {
          ensurePanelRuntime(main);
          return ensureRuntime().markerLayer.provideMarkerLayer().getItems(args);
        },
      };
    }
    return this._markerLayerProvider;
  },

  get markerLayer() {
    ensurePanelRuntime(this);
    return ensureRuntime().markerLayer;
  },
};
