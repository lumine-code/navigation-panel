const { CompositeDisposable, Disposable } = require("lumine");
const { AdapterManager } = require("./adapter-manager");
const { EditorAdapter } = require("./editor-adapter");
const EditorFolds = require("./editor-folds");
const { NavigationList } = require("./navi-list");
const { EditorMarkers } = require("./editor-markers");
const { NavigationTree } = require("./navi-tree");
const etch = require("@lumine-code/etch");

// Etch holds its scheduler per copy of the library, and this package resolves
// its own copy — so the assignment the editor makes on core's copy never
// reaches it. Point it at the view registry before anything renders, or this
// package's DOM writes land on an animation frame of their own alongside the
// editor's and force a synchronous reflow.
etch.setScheduler(lumine.views);

const EMPTY_HEADERS_DELAY = 75;

module.exports = {
  activate() {
    this.disposables = new CompositeDisposable();
    this.onDidUpdateCallbacks = new Set();
    this.navigationTree = new NavigationTree();
    this.navigationList = new NavigationList({
      getItems: () => this.getVisibleHeaderListItems(),
      hasHeaders: () => Boolean(this.headers),
      didConfirmSelection: (item) => this.navigateToHeader(item),
      didScrollSelection: (item) => this.navigateToHeader(item, { focus: false }),
    });
    this.headers = null;
    this.editor = null;
    this.currentHeaderIndex = -1;
    this.emptyHeadersTimer = null;
    this.adapterManager = new AdapterManager();
    this.markers = new EditorMarkers();
    this.builtinEditorAdapter = new EditorAdapter({
      traceVisible: () => this.traceVisible,
      markers: this.markers,
    });
    const foldSection = (level) => EditorFolds.foldSectionAt(this.editor, this.headers, level);
    const foldAsTable = (className) =>
      EditorFolds.foldAsTable(this.editor, this.headers, className);

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
          didDispatch: () => EditorFolds.toggleSection(this.editor, this.headers),
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
          didDispatch: () => EditorFolds.unfold(this.editor, this.headers),
        },
        "navigation-panel:unfold-all": {
          description: "Unfold every section in the file.",
          didDispatch: () => EditorFolds.unfoldAll(this.editor, this.headers),
        },
        "navigation-panel:markers-toggle": {
          description: "Show or hide the header markers in every open editor.",
          didDispatch: () => this.markers.toggleLocal(),
        },
      }),
    );

    this.disposables.add(
      lumine.config.observe("navigation-panel.panel.traceVisible", (value) => {
        this.traceVisible = value;
        if (!value) {
          this.setVisibleItemByPredicate(this.headers, () => false);
          this.navigationTree.update(this.headers);
        }
      }),
    );

    this.disposables.add(
      lumine.workspace.observeTextEditors((editor) => {
        const buffer = editor.getBuffer();
        if (!("navigationMarkerLayers" in buffer)) {
          buffer.navigationMarkerLayers = {};
        } else {
          // Decorate existing layers for this new editor
          for (const [index, layer] of Object.entries(buffer.navigationMarkerLayers)) {
            this.markers.decorateLayer(editor, layer, index);
          }
        }
        this.markers.forEditor(editor);
      }),
    );

    this.disposables.add(
      lumine.workspace.getCenter().observeActivePaneItem((item) => {
        if (!item) {
          this.unsubscribe();
          this.navigationTree.update(null);
        } else if (this.editor === item) {
          return;
        } else if (this.adapterManager.getForItem(item)) {
          this.adapterSubscribe(this.adapterManager.getForItem(item), item);
        } else if (lumine.workspace.isTextEditor(item)) {
          this.adapterSubscribe(this.builtinEditorAdapter, item);
        } else {
          this.unsubscribe();
          this.navigationTree.update(null);
        }
      }),
    );
  },

  deactivate() {
    for (let editor of lumine.workspace.getTextEditors()) {
      this.markers.clear(editor);
    }
    this.unsubscribe();
    this.navigationList.destroy();
    this.navigationTree.destroy();
    this.disposables.dispose();
  },

  unsubscribe() {
    this.cancelEmptyHeadersUpdate();
    this.adapterManager.unsubscribe();
    this.editor = null;
    this.headers = null;
    this.navigationList.markDirty();
  },

  consumeNavigationAdapter(adapter) {
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
    this.navigationTree.update(this.headers, props);

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
        this.navigationTree.update(headers, { instant: true });
      }
    }, EMPTY_HEADERS_DELAY);
  },

  cancelEmptyHeadersUpdate() {
    if (!this.emptyHeadersTimer) return;
    clearTimeout(this.emptyHeadersTimer);
    this.emptyHeadersTimer = null;
  },

  open(userOptions) {
    let options = {
      location: lumine.config.get("navigation-panel.panel.defaultSide"),
      searchAllPanes: true,
    };
    lumine.workspace.open(this.navigationTree, { ...options, ...userOptions }).then(() => {
      this.navigationTree.focusHeaderList();
      this.builtinEditorAdapter.refreshVisible();
      this.navigationTree.instant = true;
      this.navigationTree.scrollToCurrent();
    });
  },

  hide() {
    let previouslyFocusedElement = document.activeElement;
    lumine.workspace.hide(this.navigationTree);
    previouslyFocusedElement.focus();
  },

  toggle() {
    let previouslyFocusedElement = document.activeElement;
    lumine.workspace.toggle(this.navigationTree).then(() => {
      previouslyFocusedElement.focus();
      this.builtinEditorAdapter.refreshVisible();
      this.navigationTree.instant = true;
      this.navigationTree.scrollToCurrent();
    });
  },

  toggleFocus() {
    const el = this.navigationTree.element;
    const isVisible = el && (el.offsetWidth !== 0 || el.offsetHeight !== 0);
    if (!isVisible) {
      this.open();
    } else if (el.contains(document.activeElement)) {
      lumine.workspace.getCenter().activate();
    } else {
      this.navigationTree.focusHeaderList();
    }
  },

  list() {
    this.navigationList.toggle();
  },

  onDidUpdateHeaders(callback) {
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
      this.navigateToHeader(header);
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
    const t = this.navigationTree;
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
    item.navigate(options);
  },

  provideNavigationHeaders() {
    return {
      getEditor: () => {
        return this.editor;
      },
      getFlattenHeaders: () => {
        return this.getFlattenHeaders();
      },
      onDidUpdateHeaders: (callback) => {
        return this.onDidUpdateHeaders(callback);
      },
      observeHeaders: (callback) => {
        return this.observeHeaders(callback);
      },
    };
  },
};
