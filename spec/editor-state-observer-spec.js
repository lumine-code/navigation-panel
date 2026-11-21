describe("text editor outline state publications", () => {
  let editor, observer, publish, scan, markers, viewport, scrollTop, tracing;

  function headers() {
    const heading = (text, row, lastRow, children = []) => ({
      text,
      startPoint: { row, column: 0 },
      lastRow,
      children,
      currentCount: 0,
      stackCount: 0,
      visibility: 0,
    });
    return [heading("First", 0, 5, [heading("Child", 2, 5)]), heading("Second", 6, 2001)];
  }

  beforeEach(async () => {
    jasmine.useRealClock();
    const { EditorHeaderObserver } = require("../lib/editor-adapter");
    editor = lumine.workspace.buildTextEditor();
    const stoppedChanging = new Promise((resolve) => {
      const observation = editor.onDidStopChanging(() => {
        observation.dispose();
        resolve();
      });
    });
    editor.setText(Array.from({ length: 2002 }, (_, row) => `line ${row}`).join("\n"));
    editor.setCursorBufferPosition([0, 0], { autoscroll: false });
    await stoppedChanging;
    viewport = spyOn(editor, "getVisibleRowRange").and.returnValue([0, 3]);
    scrollTop = spyOn(lumine.views.getView(editor), "getScrollTop").and.returnValue(0);
    tracing = true;
    publish = jasmine.createSpy("publish editor outline");
    markers = { markLines: true, refresh: jasmine.createSpy("refresh"), clear() {} };
    observer = new EditorHeaderObserver(editor, publish, {
      traceVisible: () => tracing,
      markers,
    });
    scan = jasmine.createSpy("scan").and.callFake(headers);
    observer.scanner = { getHeaders: scan };
    await observer.update({ instant: true });
    publish.calls.reset();
    scan.calls.reset();
    markers.refresh.calls.reset();
    viewport.calls.reset();
    scrollTop.calls.reset();
  });

  afterEach(() => {
    observer.destroy();
    editor.destroy();
  });

  it("publishes only affected cursor entries and reuses the structural path index", async () => {
    const tree = observer.headers;
    const paths = observer.headerPaths;
    editor.setCursorBufferPosition([2, 0], { autoscroll: false });
    await Promise.resolve();
    expect(publish).toHaveBeenCalledOnceWith(null, {
      scrollBoundary: null,
      stateChanges: [
        { path: [0], currentCount: 0, stackCount: 1 },
        { path: [0, 0], currentCount: 1, stackCount: 1 },
      ],
    });
    expect(observer.headers).toBe(tree);
    expect(observer.headerPaths).toBe(paths);
    expect(scan).not.toHaveBeenCalled();
    expect(markers.refresh).not.toHaveBeenCalled();
    expect(viewport).not.toHaveBeenCalled();
    expect(scrollTop).not.toHaveBeenCalled();
  });

  it("does not publish movement within a section or a burst returning to its original section", async () => {
    editor.setCursorBufferPosition([2, 0], { autoscroll: false });
    await Promise.resolve();
    publish.calls.reset();
    editor.setCursorBufferPosition([3, 0], { autoscroll: false });
    await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();
    editor.setCursorBufferPosition([8, 0], { autoscroll: false });
    editor.setCursorBufferPosition([3, 0], { autoscroll: false });
    await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();
    expect(observer.headers[0].stackCount).toBe(1);
    expect(observer.headers[0].children[0].currentCount).toBe(1);
    expect(observer.headers[1].currentCount).toBe(0);
  });

  it("coalesces a thousand cursor additions and removals with exact shared ancestor counts", async () => {
    editor.setSelectedBufferRanges(
      Array.from({ length: 1000 }, (_, row) => [
        [row, 0],
        [row, 0],
      ]),
    );
    await Promise.resolve();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.calls.mostRecent().args[0]).toBeNull();
    expect(observer.headers[0].currentCount).toBe(2);
    expect(observer.headers[0].stackCount).toBe(6);
    expect(observer.headers[0].children[0].currentCount).toBe(4);
    expect(observer.headers[1].currentCount).toBe(994);
    publish.calls.reset();
    editor.setSelectedBufferRanges([
      [
        [3, 0],
        [3, 0],
      ],
    ]);
    await Promise.resolve();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(observer.headers[0].currentCount).toBe(0);
    expect(observer.headers[0].stackCount).toBe(1);
    expect(observer.headers[0].children[0].currentCount).toBe(1);
    expect(observer.headers[1].currentCount).toBe(0);
    expect(scan).not.toHaveBeenCalled();
  });

  it("merges a pending cursor publication into synchronous viewport changes", async () => {
    editor.setCursorBufferPosition([6, 0], { autoscroll: false });
    viewport.and.returnValue([6, 9]);
    scrollTop.and.returnValue(120);
    expect(observer.handleVisibleChange()).toBe(true);
    await Promise.resolve();
    expect(publish).toHaveBeenCalledOnceWith(null, {
      scrollBoundary: null,
      scrollDirection: 120,
      stateChanges: [
        { path: [0], currentCount: 0, stackCount: 0, visibility: 0 },
        { path: [1], currentCount: 1, stackCount: 1, visibility: 1 },
        { path: [0, 0], visibility: 0 },
      ],
    });
    expect(observer.cursorEmitPending).toBe(false);
    expect(observer.pendingCursorChanges.size).toBe(0);
    expect(scan).not.toHaveBeenCalled();
  });

  it("uses the initial viewport baseline for the first scroll direction", () => {
    viewport.and.returnValue([6, 9]);
    scrollTop.and.returnValue(120);
    observer.handleVisibleChange();
    expect(publish).toHaveBeenCalledOnceWith(null, {
      scrollBoundary: null,
      scrollDirection: 120,
      visibilityChanges: [
        { path: [0], visibility: 0 },
        { path: [0, 0], visibility: 0 },
        { path: [1], visibility: 1 },
      ],
    });
  });

  it("updates visibility after geometry changes without rescanning at a fixed scroll top", async () => {
    viewport.and.returnValue([0, 9]);
    observer.editorView.emitter.emit("did-change-scroll-geometry");
    await conditionPromise(() => publish.calls.count() > 0);
    expect(publish).toHaveBeenCalledOnceWith(null, {
      scrollBoundary: null,
      scrollDirection: 0,
      visibilityChanges: [{ path: [1], visibility: 1 }],
    });
    expect(scan).not.toHaveBeenCalled();
  });

  it("keeps viewport work gated while tracing is hidden", async () => {
    tracing = false;
    editor.setCursorBufferPosition([6, 0], { autoscroll: false });
    observer.editorView.emitter.emit("did-change-scroll-geometry");
    observer.editorView.emitter.emit("did-change-scroll-top");
    observer.handleVisibleChange();
    await Promise.resolve();
    expect(publish.calls.mostRecent().args[0]).toBeNull();
    expect(publish.calls.mostRecent().args[1].stateChanges.length).toBeGreaterThan(0);
    expect(viewport).not.toHaveBeenCalled();
    expect(scrollTop).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
  });

  it("does not read viewport geometry or scroll positions during a hidden full scan", async () => {
    tracing = false;
    await observer.update({ instant: true });
    expect(viewport).not.toHaveBeenCalled();
    expect(scrollTop).not.toHaveBeenCalled();
    expect(publish.calls.mostRecent().args[0]).toBe(observer.headers);
    expect(observer.lastScrollTop).toBeUndefined();
  });

  it("publishes deliberate navigation as state, including an unchanged destination", async () => {
    const { EditorAdapter } = require("../lib/editor-adapter");
    const adapter = new EditorAdapter();
    adapter.activeObserver = observer;
    tracing = false;
    spyOn(editor, "scrollToZone");
    await adapter.navigateTo(editor, observer.headers[1], { focus: false });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.calls.mostRecent().args[0]).toBeNull();
    expect(publish.calls.mostRecent().args[1].stateChanges.length).toBeGreaterThan(0);
    publish.calls.reset();
    await adapter.navigateTo(editor, observer.headers[1], { focus: false });
    expect(publish).toHaveBeenCalledOnceWith(null, { scrollBoundary: null, stateChanges: [] });
    expect(scan).not.toHaveBeenCalled();
    expect(viewport).not.toHaveBeenCalled();
  });

  it("supersedes a queued state patch with a complete structural publication", async () => {
    editor.setCursorBufferPosition([6, 0], { autoscroll: false });
    observer.emit({ instant: true });
    await Promise.resolve();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.calls.mostRecent().args[0]).toBe(observer.headers);
    expect(publish.calls.mostRecent().args[1]).toEqual(
      jasmine.objectContaining({ instant: true, scrollBoundary: null }),
    );
    expect(observer.pendingCursorChanges.size).toBe(0);
  });

  it("retains final counts after an earlier listener moves a cursor reentrantly", async () => {
    observer.destroy();
    const cursor = editor.getLastCursor();
    let moved = false;
    const reentrant = cursor.onDidChangePosition(() => {
      if (moved) return;
      moved = true;
      cursor.setBufferPosition([6, 0]);
    });
    const { EditorHeaderObserver } = require("../lib/editor-adapter");
    observer = new EditorHeaderObserver(editor, publish, {
      traceVisible: () => tracing,
      markers,
    });
    observer.scanner = { getHeaders: scan };
    await observer.update({ instant: true });
    publish.calls.reset();
    try {
      cursor.setBufferPosition([2, 0]);
      await Promise.resolve();
      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish.calls.mostRecent().args[0]).toBeNull();
      expect(cursor.navigationItems[0]).toBe(observer.headers[1]);
      expect(observer.headers[0].currentCount).toBe(0);
      expect(observer.headers[0].stackCount).toBe(0);
      expect(observer.headers[0].children[0].currentCount).toBe(0);
      expect(observer.headers[1].currentCount).toBe(1);
      expect(observer.headers[1].stackCount).toBe(1);
    } finally {
      reentrant.dispose();
    }
  });

  it("keeps the published tree and its cursor deltas when marker refresh fails", async () => {
    const previous = observer.headers;
    const paths = observer.headerPaths;
    markers.refresh.and.callFake(() => {
      editor.setCursorBufferPosition([6, 0], { autoscroll: false });
      throw new Error("Marker refresh failed");
    });
    await observer.update({ instant: true });
    expect(observer.headers).toBe(previous);
    expect(observer.headerPaths).toBe(paths);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.calls.mostRecent().args[0]).toBeNull();
    expect(previous[1].currentCount).toBe(1);
    publish.calls.reset();
    editor.setCursorBufferPosition([2, 0], { autoscroll: false });
    await Promise.resolve();
    expect(publish.calls.mostRecent().args[1].stateChanges).toEqual(
      jasmine.arrayContaining([{ path: [0, 0], currentCount: 1, stackCount: 1 }]),
    );
  });

  it("keeps cursor publications on the old tree while a replacement is cancelled", async () => {
    const previous = observer.headers;
    const paths = observer.headerPaths;
    let finish;
    spyOn(observer, "refreshMarkers").and.callFake(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const pending = observer.update({ instant: true });
    await conditionPromise(() => finish);
    editor.setCursorBufferPosition([6, 0], { autoscroll: false });
    await Promise.resolve();
    expect(observer.headers).toBe(previous);
    expect(observer.headerPaths).toBe(paths);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.calls.mostRecent().args[0]).toBeNull();
    observer.scanAbort.abort();
    finish();
    await pending;
    expect(observer.headers).toBe(previous);
    expect(observer.headerPaths).toBe(paths);
    expect(publish).toHaveBeenCalledTimes(1);
    publish.calls.reset();
    editor.setCursorBufferPosition([2, 0], { autoscroll: false });
    await Promise.resolve();
    expect(publish.calls.mostRecent().args[1].stateChanges).toEqual(
      jasmine.arrayContaining([{ path: [0, 0], currentCount: 1, stackCount: 1 }]),
    );
  });

  it("cancels queued cursor and viewport publications on teardown", async () => {
    editor.setCursorBufferPosition([6, 0], { autoscroll: false });
    observer.editorView.emitter.emit("did-change-scroll-geometry");
    observer.destroy();
    await Promise.resolve();
    observer.handleVisibleChange();
    expect(publish).not.toHaveBeenCalled();
    expect(observer.pendingCursorChanges.size).toBe(0);
    expect(scan).not.toHaveBeenCalled();
  });
});
