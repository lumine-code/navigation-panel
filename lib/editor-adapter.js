const { CompositeDisposable, Disposable } = require("lumine");
const {
  captureEditorSnapshot,
  sameEditorSnapshot,
  cloneEditorHeaders,
  reusableEditorHeaders,
  captureMarkerState,
  sameMarkerState,
} = require("./editor-snapshot");

const SCANNERS = {
  "source.asciidoc": "./scanner-asciidoc",
  "text.bibtex": "./scanner-bibtex",
  "source.c": "./scanner-clike",
  "source.cs": "./scanner-clike",
  "source.cpp": "./scanner-clike",
  "source.js": "./scanner-javascript",
  "source.js.jsx": "./scanner-javascript",
  "source.ts": "./scanner-javascript",
  "source.tsx": "./scanner-javascript",
  "text.tex.latex": "./scanner-latex",
  "text.tex.latex.beamer": "./scanner-latex",
  "text.tex.latex.knitr": "./scanner-latex",
  "text.knitr": "./scanner-latex",
  "source.gfm": "./scanner-markdown",
  "text.md": "./scanner-markdown",
  "source.weave.md": "./scanner-markdown",
  "source.python": "./scanner-python",
  "source.python.ipy": "./scanner-python",
  "source.cython": "./scanner-python",
  "text.restructuredtext": "./scanner-rest",
  "source.sofistik": "./scanner-sofistik",
  "text.tasklist": "./scanner-tasklist",
  "source.sinumerik": "./scanner-sinumerik",
  "source.typst": "./scanner-typst",
};

class EditorAdapter {
  constructor({ traceVisible = () => false, markers = null } = {}) {
    this.traceVisible = traceVisible;
    this.markers = markers;
    this.managesEditorMarkers = Boolean(markers);
    this.snapshotCache = { entries: new WeakMap(), generation: 0 };
  }

  handlesItem(item) {
    return lumine.workspace.isTextEditor(item);
  }

  observeHeaders(editor, callback) {
    const observation = {};
    this.observation = observation;
    this.activeObserver?.destroy();
    this.activeObserver = null;
    const initialPublications = [];
    let initializing = true;
    const publish = (headers, options) => {
      if (initializing) initialPublications.push([headers, options]);
      else if (this.observation === observation) callback(headers, options);
    };
    const observer = new EditorHeaderObserver(editor, publish, {
      traceVisible: this.traceVisible,
      markers: this.markers,
      snapshotCache: this.snapshotCache,
    });
    // Finish installing cursor ownership before a synchronous cache hit can
    // reenter activation. A nested observation then tears this one down first.
    if (this.observation === observation) this.activeObserver = observer;
    else observer.destroy();
    initializing = false;
    for (const [headers, options] of initialPublications) {
      if (this.observation !== observation || observer.destroyed) break;
      callback(headers, options);
    }
    return new Disposable(() => {
      if (this.activeObserver === observer) {
        this.activeObserver = null;
      }
      if (this.observation === observation) this.observation = null;
      observer.destroy();
    });
  }

  clearCache() {
    this.snapshotCache.entries = new WeakMap();
    this.snapshotCache.generation++;
  }

  refreshVisible() {
    if (this.activeObserver) {
      return this.activeObserver.handleVisibleChange();
    }
    return false;
  }

  clearVisible() {
    return this.activeObserver?.clearVisibleItems() ?? false;
  }

  async navigateTo(editor, header, options = {}) {
    if (!editor || !header || !header.startPoint) return;
    if (options.addCursor) {
      editor.addCursorAtBufferPosition([header.startPoint.row, 0]);
      return;
    }
    const focus = options.focus !== false;
    if (focus) {
      const opened = await lumine.workspace.open(editor, { searchAllPanes: true });
      if (!opened) return;
    }
    const observer = this.activeObserver?.editor === editor ? this.activeObserver : null;
    if (observer) {
      observer.suppressCursorEmit = true;
    }
    try {
      editor.setCursorBufferPosition([header.startPoint.row, 0], {
        autoscroll: false,
      });
      editor.scrollToZone();
    } finally {
      if (observer) {
        observer.suppressCursorEmit = false;
        observer.updateVisibleItems.cancel();
        // Navigation updates both cursor and viewport state, including a
        // deliberate reveal when neither one's flags changed.
        observer.handleVisibleChange({ publishHeaders: true });
      }
    }
    if (focus) {
      lumine.views.getView(editor).focus();
    }
  }
}

class EditorHeaderObserver {
  constructor(editor, callback, { traceVisible, markers, snapshotCache = null }) {
    this.editor = editor;
    this.callback = callback;
    this.traceVisible = traceVisible;
    this.markers = markers;
    this.editorView = lumine.views.getView(editor);
    this.snapshotCache = snapshotCache;
    this.scannerSnapshot = this.captureSnapshot();
    this.scanner = createScanner(editor);
    this.disposables = new CompositeDisposable();
    this.headers = null;
    this.changedRanges = [];
    this.isUpdating = false;
    this.pendingUpdate = null;
    this.destroyed = false;
    this.lastScrollTop = undefined;
    this.scrollBoundary = null;
    this.pendingVisibilityChanges = [];
    this.updateVisibleItems = throttle(() => this.handleVisibleChange(), 50);
    this.suppressCursorEmit = false;
    this.cursorEmitPending = false;
    this.cursorEmitGeneration = 0;
    this.pendingCursorChanges = new Map();
    this.headerPaths = new WeakMap();
    this.indexedHeaders = null;

    this.subscribe();
    this.update({ instant: true });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scanAbort?.abort();
    this.pendingUpdate = null;
    this.cursorEmitPending = false;
    this.cursorEmitGeneration++;
    this.pendingCursorChanges.clear();
    this.headerPaths = new WeakMap();
    this.indexedHeaders = null;
    this.updateVisibleItems.cancel();
    this.disposables.dispose();
    this.disposeCursorState();
  }

  subscribe() {
    this.disposables.add(
      this.editor.getBuffer().onDidChange((event) => {
        this.snapshotCache?.entries.delete(this.editor);
        // Edits before updateDocument runs are part of the snapshot we have
        // yet to read. Only an already-started scan can become stale.
        if (this.scanStarted) {
          this.scanAbort?.abort();
          this.pendingUpdate = null;
        }
        this.changedRanges.push(event.newRange);
      }),
    );
    this.disposables.add(
      this.editor.onDidStopChanging(() => {
        const shouldScrollInstantly = this.changedRanges.some((range) =>
          this.isRangeVisible(range),
        );
        this.changedRanges = [];
        this.update({ instant: shouldScrollInstantly ? true : null });
      }),
    );
    this.disposables.add(
      this.editor.observeCursors((cursor) => {
        cursor.navigationItems = [];
        if (this.headers) {
          this.findCursorItems(cursor, cursor.getBufferPosition().row);
          this.scheduleCursorEmit();
        }
        cursor.navigationDisposeODCP = cursor.onDidChangePosition((event) => {
          if (event.textChanged || event.oldBufferPosition.row === event.newBufferPosition.row) {
            return;
          }
          this.clearCursorItems(cursor);
          // An earlier cursor listener can move the cursor again reentrantly.
          // Read its live row so the resumed outer event cannot restore stale
          // navigation state from its snapshot.
          this.findCursorItems(cursor, cursor.getBufferPosition().row);
          if (this.suppressCursorEmit || this.headers === null) {
            return;
          }
          this.scheduleCursorEmit();
        });
        cursor.navigationDisposeODD = cursor.onDidDestroy(() => {
          this.clearCursorItems(cursor);
          cursor.navigationDisposeODCP.dispose();
          cursor.navigationDisposeODD.dispose();
          if (this.headers === null) {
            return;
          }
          this.scheduleCursorEmit();
        });
      }),
    );
    const onViewportChange = () => {
      if (this.traceVisible()) this.updateVisibleItems();
    };
    this.disposables.add(
      this.editorView.onDidChangeScrollTop(onViewportChange),
      this.editorView.onDidChangeScrollGeometry(onViewportChange),
    );
    this.disposables.add(
      this.editor.onDidChangeGrammar(() => {
        this.refreshScanner();
      }),
      lumine.config.onDidChange("navigation-panel", () => {
        const snapshot = this.captureSnapshot();
        if (
          snapshot.grammar !== this.scannerSnapshot.grammar ||
          snapshot.config !== this.scannerSnapshot.config
        )
          this.refreshScanner();
      }),
      this.editor.onDidDestroy(() => {
        this.snapshotCache?.entries.delete(this.editor);
        this.destroy();
      }),
    );
  }

  captureSnapshot() {
    const scannerName = SCANNERS[this.editor.getGrammar().scopeName]?.replace("./scanner-", "");
    return captureEditorSnapshot(this.editor, scannerName);
  }

  refreshScanner() {
    this.scanAbort?.abort();
    this.snapshotCache?.entries.delete(this.editor);
    this.scannerSnapshot = this.captureSnapshot();
    this.scanner = createScanner(this.editor);
    this.update({ instant: true });
  }

  async update(props) {
    if (this.destroyed) return;
    if (!this.scanner) {
      this.scanAbort?.abort();
      this.pendingUpdate = null;
      this.headers = null;
      this.ensureHeaderPaths();
      this.scrollBoundary = null;
      this.lastScrollTop = undefined;
      this.snapshotCache?.entries.delete(this.editor);
      this.editorSnapshot = { ...this.captureSnapshot(), reusable: false };
      this.markers?.clear(this.editor);
      for (const cursor of this.editor.getCursors()) this.clearCursorItems(cursor);
      this.emit(props);
      return;
    }
    if (this.isUpdating) {
      this.scanAbort?.abort();
      this.pendingUpdate = props;
      return;
    }

    this.isUpdating = true;
    const scanner = this.scanner;
    const cacheGeneration = this.snapshotCache?.generation;
    const controller = new AbortController();
    this.scanAbort = controller;
    let cancelWait;
    const cancelled = new Promise((resolve) => (cancelWait = resolve));
    controller.signal.addEventListener("abort", cancelWait, { once: true });
    let snapshot;
    const current = () =>
      !this.destroyed &&
      !controller.signal.aborted &&
      this.scanner === scanner &&
      !this.editor.isDestroyed() &&
      (!snapshot || sameEditorSnapshot(snapshot, this.captureSnapshot()));

    try {
      snapshot = this.captureSnapshot();
      let cached = this.snapshotCache?.entries.get(this.editor);
      if (!sameEditorSnapshot(cached?.snapshot, snapshot)) cached = null;
      let headers;
      if (cached) {
        headers = cloneEditorHeaders(cached.headers, this.editor);
      } else {
        // Edits queued before the document update belong to the scan we are
        // about to read; capture their revision after that boundary.
        snapshot = null;
        await new Promise((resolve) => lumine.views.updateDocument(resolve));
        if (!current()) return;
        snapshot = this.captureSnapshot();
        this.scanStarted = true;
        headers = scanner.getHeaders({ signal: controller.signal });
        if (headers?.then) headers = await Promise.race([headers, cancelled]);
        if (!current()) return;
      }
      if (
        !cached ||
        !sameMarkerState(cached.markers, captureMarkerState(this.editor, this.markers))
      )
        await this.refreshMarkers(headers);
      if (!current()) return;

      // Cursor and viewport events may run while marker work settles. Keep
      // describing the published tree until the new structure can be emitted
      // synchronously with its reconciled cursor and visibility state.
      this.headers = headers;
      this.ensureHeaderPaths();
      for (const cursor of this.editor.getCursors()) {
        this.clearCursorItems(cursor);
        this.findCursorItems(cursor, cursor.getBufferPosition().row);
      }
      this.markVisibleItems();
      this.lastScrollTop = this.traceVisible() ? this.editorView.getScrollTop() : undefined;
      const reusable = cached ? cached.reusable : reusableEditorHeaders(headers);
      this.editorSnapshot = { ...snapshot, reusable };
      if (this.snapshotCache && this.snapshotCache.generation === cacheGeneration) {
        this.snapshotCache.entries.set(this.editor, {
          snapshot,
          headers: cached ? cached.headers : cloneEditorHeaders(headers, this.editor),
          markers: captureMarkerState(this.editor, this.markers),
          reusable,
        });
      }
      this.emit(props);
    } catch {
      /* ignore scanner errors */
    } finally {
      controller.signal.removeEventListener("abort", cancelWait);
      this.scanStarted = false;
      if (this.scanAbort === controller) this.scanAbort = null;
      this.isUpdating = false;
      if (!this.destroyed && this.pendingUpdate) {
        const pending = this.pendingUpdate;
        this.pendingUpdate = null;
        this.update(pending);
      }
    }
  }

  emit(props = {}) {
    if (this.destroyed) {
      return;
    }
    // An immediate publish supersedes a cursor publish queued earlier in this
    // turn. Its microtask sees the cleared flag and becomes a no-op.
    this.cursorEmitPending = false;
    this.cursorEmitGeneration = (this.cursorEmitGeneration ?? 0) + 1;
    if (props.stateChanges || props.visibilityChanges) {
      const cursorChanges = this.takeCursorChanges();
      if (props.stateChanges || cursorChanges.length) {
        const { visibilityChanges, ...options } = props;
        props = {
          ...options,
          stateChanges: mergeStateChanges(
            cursorChanges,
            options.stateChanges || visibilityChanges || [],
          ),
        };
      }
    } else {
      this.pendingCursorChanges?.clear();
      if (this.editorSnapshot) props = { ...props, editorSnapshot: this.editorSnapshot };
    }
    this.callback(props.stateChanges || props.visibilityChanges ? null : this.headers, {
      ...props,
      scrollBoundary: this.traceVisible() ? this.scrollBoundary : null,
    });
  }

  scheduleCursorEmit() {
    if (this.cursorEmitPending || this.destroyed) return;
    this.cursorEmitPending = true;
    const generation = (this.cursorEmitGeneration = (this.cursorEmitGeneration ?? 0) + 1);
    queueMicrotask(() => {
      if (!this.cursorEmitPending || this.cursorEmitGeneration !== generation) return;
      this.cursorEmitPending = false;
      if (this.destroyed || this.suppressCursorEmit || this.headers === null) return;
      const stateChanges = this.takeCursorChanges();
      if (stateChanges.length) this.emit({ stateChanges });
    });
  }

  ensureHeaderPaths() {
    if (this.indexedHeaders === this.headers && this.headerPaths) return;
    this.indexedHeaders = this.headers;
    this.headerPaths = new WeakMap();
    this.pendingCursorChanges = new Map();
    const indexItems = (items, parentPath) => {
      for (let index = 0; index < (items?.length ?? 0); index++) {
        const item = items[index];
        const path = [...parentPath, index];
        this.headerPaths.set(item, path);
        indexItems(item.children, path);
      }
    };
    indexItems(this.headers, []);
  }

  trackCursorState(item) {
    this.ensureHeaderPaths();
    if (!this.headerPaths.has(item) || this.pendingCursorChanges.has(item)) return;
    this.pendingCursorChanges.set(item, {
      currentCount: item.currentCount,
      stackCount: item.stackCount,
    });
  }

  takeCursorChanges() {
    this.ensureHeaderPaths();
    const changes = [];
    for (const [item, previous] of this.pendingCursorChanges) {
      if (item.currentCount !== previous.currentCount || item.stackCount !== previous.stackCount) {
        changes.push({
          path: this.headerPaths.get(item),
          currentCount: item.currentCount,
          stackCount: item.stackCount,
        });
      }
    }
    this.pendingCursorChanges.clear();
    return changes;
  }

  async refreshMarkers(headers = null) {
    if (this.destroyed || !this.markers) {
      return;
    }
    if (!this.markers.markLines || !this.scanner) {
      this.markers.clear(this.editor);
      return;
    }
    if (!headers) {
      headers = this.headers;
    }
    if (headers) {
      this.markers.refresh(this.editor, headers);
    } else {
      this.markers.clear(this.editor);
    }
  }

  isRangeVisible(range) {
    const [firstVisibleRow, lastVisibleRow] = getVisibleBufferRowRange(this.editor);
    return range.start.row <= lastVisibleRow && range.end.row >= firstVisibleRow;
  }

  clearCursorItems(cursor) {
    if (!cursor.navigationItems) {
      cursor.navigationItems = [];
    }
    if (cursor.navigationItems.length > 0) {
      this.trackCursorState(cursor.navigationItems[0]);
      cursor.navigationItems[0].currentCount -= 1;
      for (let item of cursor.navigationItems) {
        this.trackCursorState(item);
        item.stackCount -= 1;
      }
    }
    cursor.navigationItems = [];
  }

  findCursorItems(cursor, cursorRow) {
    if (this.headers === null) {
      return;
    }
    this.lookupState(cursor.navigationItems, cursorRow, this.headers);
  }

  lookupState(navigationItems, cursorRow, headers) {
    for (let i = headers.length - 1; i >= 0; i--) {
      const item = headers[i];
      if (item.startPoint.row <= cursorRow) {
        this.lookupState(navigationItems, cursorRow, item.children);
        this.trackCursorState(item);
        if (navigationItems.length === 0) {
          item.currentCount += 1;
        }
        item.stackCount += 1;
        navigationItems.push(item);
        break;
      }
    }
  }

  handleVisibleChange({ publishHeaders = false } = {}) {
    if (this.destroyed) return false;
    // This method is also called directly after navigation and when the panel
    // opens. Keep the visibility gate here rather than only in the scroll
    // subscription so a hidden panel never pays for viewport translation.
    if (!this.traceVisible() || !this.scanner || !this.headers) {
      if (publishHeaders) this.emit({ stateChanges: [] });
      return publishHeaders;
    }
    const scrollTop = this.editorView.getScrollTop();
    let direction = 0;
    if (this.lastScrollTop !== undefined) {
      direction = scrollTop - this.lastScrollTop;
    }
    this.lastScrollTop = scrollTop;
    const changed = this.markVisibleItems();
    // The viewport can move throughout the preamble without changing a single
    // header flag. Keep following its boundary after a manual panel scroll too.
    if (!changed && this.scrollBoundary !== "start" && !publishHeaders) return false;
    const props = { scrollDirection: direction };
    if (publishHeaders) props.stateChanges = this.pendingVisibilityChanges;
    else props.visibilityChanges = this.pendingVisibilityChanges;
    this.emit(props);
    return true;
  }

  markVisibleItems() {
    if (!this.traceVisible() || !this.headers) {
      return false;
    }
    let firstBufferRow, lastBufferRow;
    try {
      [firstBufferRow, lastBufferRow] = getVisibleBufferRowRange(this.editor);
    } catch {
      return false;
    }
    if (!Number.isFinite(firstBufferRow) || !Number.isFinite(lastBufferRow)) return false;
    const changes = [];
    const boundary = lastBufferRow < this.headers[0]?.startPoint?.row ? "start" : null;
    const boundaryChanged = this.scrollBoundary !== boundary;
    this.scrollBoundary = boundary;
    const changed = setVisibleItems(this.headers, firstBufferRow, lastBufferRow, [], changes);
    this.pendingVisibilityChanges = changes;
    return changed || boundaryChanged;
  }

  clearVisibleItems() {
    this.scrollBoundary = null;
    this.pendingVisibilityChanges = [];
    return clearVisibleItems(this.headers);
  }

  disposeCursorState() {
    for (const cursor of this.editor.getCursors()) {
      if (cursor.navigationDisposeODCP) {
        cursor.navigationDisposeODCP.dispose();
      }
      if (cursor.navigationDisposeODD) {
        cursor.navigationDisposeODD.dispose();
      }
      delete cursor.navigationItems;
    }
  }
}

function mergeStateChanges(...groups) {
  const changes = new Map();
  for (const group of groups) {
    for (const change of group) {
      const key = change.path.join(",");
      changes.set(key, { ...changes.get(key), ...change });
    }
  }
  return [...changes.values()];
}

function createScanner(editor) {
  if (!editor) return null;
  const scopeName = editor.getGrammar().scopeName;
  const scannerPath = SCANNERS[scopeName];
  const scannerName = scannerPath?.replace("./scanner-", "");
  if (!scannerPath || lumine.config.get(`navigation-panel.scanners.${scannerName}`) === false) {
    return null;
  }
  const Scanner = Object.values(require(scannerPath))[0];
  return new Scanner(editor);
}

function getTextEditorHeaders(editor, options) {
  const scanner = createScanner(editor);
  return scanner ? scanner.getHeaders(options) : null;
}

function getVisibleBufferRowRange(editor) {
  const [firstScreenRow, lastScreenRow] = editor.getVisibleRowRange();
  const firstBufferRow = editor.bufferPositionForScreenPosition([firstScreenRow, 0]).row;
  // Infinity includes the continuation of a soft-wrapped final row and the
  // far edge of a fold placeholder without converting every header.
  const lastBufferRow = editor.bufferPositionForScreenPosition([lastScreenRow, Infinity]).row;
  return [firstBufferRow, lastBufferRow];
}

function setVisibleItems(headers, firstBufferRow, lastBufferRow, parentPath, changes) {
  if (!headers) return false;
  let changed = false;
  for (let index = 0; index < headers.length; index++) {
    const header = headers[index];
    const path = [...parentPath, index];
    if (header.startPoint) {
      const visible =
        header.startPoint.row <= lastBufferRow && header.lastRow >= firstBufferRow ? 1 : 0;
      if (header.visibility !== visible) {
        header.visibility = visible;
        changes.push({ path, visibility: visible });
        changed = true;
      }
    }
    if (setVisibleItems(header.children, firstBufferRow, lastBufferRow, path, changes)) {
      changed = true;
    }
  }
  return changed;
}

function clearVisibleItems(headers) {
  if (!headers) return false;
  let changed = false;
  for (const header of headers) {
    if (header.visibility !== 0) {
      header.visibility = 0;
      changed = true;
    }
    if (clearVisibleItems(header.children)) changed = true;
  }
  return changed;
}

function throttle(func, timeout) {
  let timer = null;
  const wrapped = function (...args) {
    if (timer) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      func.apply(this, args);
    }, timeout);
  };
  wrapped.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return wrapped;
}

module.exports = {
  EditorAdapter,
  EditorHeaderObserver,
  getTextEditorHeaders,
};
