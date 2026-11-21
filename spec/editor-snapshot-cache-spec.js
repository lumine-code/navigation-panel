const path = require("node:path");

describe("cached text editor outline snapshots", () => {
  let adapter,
    editor,
    grammar,
    publish,
    scan,
    markers,
    viewport,
    scrollTop,
    tracing,
    leases,
    extras;

  function headings(owner) {
    const heading = (row, lastRow) => ({
      text: owner.lineTextForBufferRow(row),
      startPoint: { row, column: 0 },
      endPoint: { row, column: 5 },
      lastRow,
      editor: owner,
      level: 1,
      revel: 1,
      children: [],
      classList: [],
      currentCount: 0,
      stackCount: 0,
    });
    const result = [heading(0, 5), heading(6, 11)];
    Object.defineProperty(result, "outlineStatus", {
      value: { complete: false, omittedRows: 1, headingLimit: false, labelPreviews: 0 },
    });
    return result;
  }

  function setTextAndWait(owner, text) {
    return new Promise((resolve) => {
      const observation = owner.onDidStopChanging(() => {
        observation.dispose();
        resolve();
      });
      owner.setText(text);
      owner.setCursorBufferPosition([0, 0], { autoscroll: false });
    });
  }

  beforeEach(async () => {
    jasmine.useRealClock();
    await lumine.packages.activatePackage(path.resolve(__dirname, ".."));
    const { EditorAdapter } = require("../lib/editor-adapter");
    const { EditorMarkers } = require("../lib/editor-markers");
    const { ScannerJavascript } = require("../lib/scanner-javascript");
    leases = [];
    extras = [];
    editor = lumine.workspace.buildTextEditor();
    await setTextAndWait(
      editor,
      Array.from({ length: 12 }, (_, row) => `Heading ${row}`).join("\n"),
    );
    grammar = { scopeName: "source.js" };
    spyOn(editor, "getGrammar").and.callFake(() => grammar);
    viewport = spyOn(editor, "getVisibleRowRange").and.returnValue([0, 3]);
    scrollTop = spyOn(lumine.views.getView(editor), "getScrollTop").and.returnValue(0);
    tracing = true;
    publish = jasmine.createSpy("cached outline publication");
    scan = spyOn(ScannerJavascript.prototype, "getHeaders").and.callFake(function () {
      return headings(this.editor);
    });
    markers = new EditorMarkers();
    markers.markLines = true;
    spyOn(markers, "refresh").and.callThrough();
    adapter = new EditorAdapter({ traceVisible: () => tracing, markers });
  });

  afterEach(() => {
    for (const lease of leases) lease.dispose();
    adapter.clearCache();
    for (const extra of extras) extra.destroy();
    editor.destroy();
  });

  async function observe(owner = editor, callback = publish) {
    const lease = adapter.observeHeaders(owner, callback);
    leases.push(lease);
    const observer = adapter.activeObserver;
    await conditionPromise(() => !observer.isUpdating);
    return { observer, lease };
  }

  it("replays an unchanged editor synchronously without scanning or repainting current markers", async () => {
    const initial = await observe();
    const first = publish.calls.mostRecent().args[0];
    initial.lease.dispose();
    publish.calls.reset();
    scan.calls.reset();
    markers.refresh.calls.reset();

    const lease = adapter.observeHeaders(editor, publish);
    leases.push(lease);
    expect(publish).toHaveBeenCalledTimes(1);
    const [restored, options] = publish.calls.mostRecent().args;
    expect(restored).not.toBe(first);
    expect(restored[0]).not.toBe(first[0]);
    expect(restored[0].startPoint).not.toBe(first[0].startPoint);
    expect(restored.outlineStatus).toEqual(first.outlineStatus);
    expect(Object.keys(restored)).not.toContain("outlineStatus");
    expect(options.editorSnapshot.buffer).toBe(editor.getBuffer());
    expect(options.editorSnapshot.revision).toBe(editor.getBuffer().getTextRevision());
    expect(options.editorSnapshot.grammar).toBe(grammar);
    expect(typeof options.editorSnapshot.config).toBe("string");
    expect(options.editorSnapshot.reusable).toBe(true);
    expect(scan).not.toHaveBeenCalled();
    expect(markers.refresh).not.toHaveBeenCalled();
  });

  it("reconciles current cursors and viewport instead of replaying cached state", async () => {
    const { lease } = await observe();
    lease.dispose();
    editor.setCursorBufferPosition([6, 0], { autoscroll: false });
    viewport.and.returnValue([6, 9]);
    scrollTop.and.returnValue(500);
    publish.calls.reset();
    scan.calls.reset();
    await observe();
    const headers = publish.calls.mostRecent().args[0];
    expect(headers[0].currentCount).toBe(0);
    expect(headers[0].stackCount).toBe(0);
    expect(headers[0].visibility).toBe(0);
    expect(headers[1].currentCount).toBe(1);
    expect(headers[1].stackCount).toBe(1);
    expect(headers[1].visibility).toBe(1);
    expect(adapter.activeObserver.lastScrollTop).toBe(500);
    expect(scan).not.toHaveBeenCalled();
  });

  it("refreshes cleared marker layers from the cached outline without rescanning", async () => {
    const { lease } = await observe();
    lease.dispose();
    markers.clear(editor);
    markers.refresh.calls.reset();
    scan.calls.reset();
    await observe();
    expect(scan).not.toHaveBeenCalled();
    expect(markers.refresh).toHaveBeenCalledTimes(1);
    expect(editor.getBuffer().navigationMarkerLayers[1].getMarkerCount()).toBe(2);
  });

  it("honors the current runtime marker toggle on a cache hit", async () => {
    const { lease } = await observe();
    lease.dispose();
    markers.markLines = false;
    markers.refresh.calls.reset();
    scan.calls.reset();
    await observe();
    expect(scan).not.toHaveBeenCalled();
    expect(markers.refresh).not.toHaveBeenCalled();
    expect(editor.getBuffer().navigationMarkerLayers[1].getMarkerCount()).toBe(0);
  });

  it("invalidates an inactive editor snapshot after a real buffer edit", async () => {
    const { lease } = await observe();
    lease.dispose();
    await setTextAndWait(editor, "Changed\n" + Array(11).fill("body").join("\n"));
    scan.calls.reset();
    await observe();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(publish.calls.mostRecent().args[0][0].text).toBe("Changed");
  });

  it("invalidates inactive snapshots after grammar identity and scanner settings change", async () => {
    let { lease } = await observe();
    lease.dispose();
    grammar = { scopeName: "source.js" };
    scan.calls.reset();
    ({ lease } = await observe());
    expect(scan).toHaveBeenCalledTimes(1);
    lease.dispose();
    const depth = lumine.config.get("navigation-panel.editor.maxHeadingDepth");
    lumine.config.set("navigation-panel.editor.maxHeadingDepth", depth === 1 ? 2 : 1);
    scan.calls.reset();
    await observe();
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("refreshes relevant active configuration while ignoring panel settings and other scanners", async () => {
    await observe();
    scan.calls.reset();
    const side = lumine.config.get("navigation-panel.panel.defaultSide");
    lumine.config.set("navigation-panel.panel.defaultSide", side === "left" ? "right" : "left");
    lumine.config.set("navigation-panel.scanners.python", false);
    await Promise.resolve();
    expect(scan).not.toHaveBeenCalled();
    const depth = lumine.config.get("navigation-panel.editor.maxHeadingDepth");
    const changedDepth = depth === 1 ? 2 : 1;
    lumine.config.set("navigation-panel.editor.maxHeadingDepth", changedDepth);
    await conditionPromise(() => scan.calls.count() === 1 && !adapter.activeObserver.isUpdating);
    expect(publish.calls.mostRecent().args[1].editorSnapshot.config).toContain(
      `"maxDepth":${changedDepth}`,
    );
  });

  it("does not retain snapshots while its scanner is disabled", async () => {
    await observe();
    lumine.config.set("navigation-panel.scanners.javascript", false);
    expect(publish.calls.mostRecent().args[0]).toBeNull();
    expect(adapter.snapshotCache.entries.get(editor)).toBeUndefined();
    expect(publish.calls.mostRecent().args[1].editorSnapshot.reusable).toBe(false);
    scan.calls.reset();
    lumine.config.set("navigation-panel.scanners.javascript", true);
    await conditionPromise(() => scan.calls.count() === 1 && !adapter.activeObserver.isUpdating);
  });

  it("keeps shared-buffer editors in separate cache entries and preserves bound SOFiSTiK actions", async () => {
    grammar = { scopeName: "source.sofistik" };
    await setTextAndWait(editor, "+prog aqua\nEND\n");
    const { ScannerSofistik } = require("../lib/scanner-sofistik");
    const sofistikScan = spyOn(ScannerSofistik.prototype, "getHeaders").and.callThrough();
    let { lease } = await observe();
    expect(publish.calls.mostRecent().args[1].editorSnapshot.reusable).toBe(false);
    lease.dispose();
    const sibling = editor.copy();
    extras.push(sibling);
    spyOn(sibling, "getGrammar").and.callFake(() => grammar);
    spyOn(sibling, "getVisibleRowRange").and.returnValue([0, 1]);
    ({ lease } = await observe(sibling));
    lease.dispose();
    expect(sofistikScan).toHaveBeenCalledTimes(2);
    await observe();
    expect(sofistikScan).toHaveBeenCalledTimes(2);
    const firstEdit = spyOn(editor, "setTextInBufferRange").and.callThrough();
    const secondEdit = spyOn(sibling, "setTextInBufferRange").and.callThrough();
    publish.calls.mostRecent().args[0][0].toggleProg();
    expect(firstEdit).toHaveBeenCalledTimes(1);
    expect(secondEdit).not.toHaveBeenCalled();
    expect(editor.lineTextForBufferRow(0)).toBe("-prog aqua");
  });

  it("does not cache a cancelled asynchronous scan or deliver its late result", async () => {
    let finish;
    scan.and.callFake(() => new Promise((resolve) => (finish = resolve)));
    const lease = adapter.observeHeaders(editor, publish);
    leases.push(lease);
    await conditionPromise(() => finish);
    lease.dispose();
    finish(headings(editor));
    await flushMicrotasks();
    expect(publish).not.toHaveBeenCalled();
    expect(adapter.snapshotCache.entries.get(editor)).toBeUndefined();
    scan.and.callFake(function () {
      return headings(this.editor);
    });
    await observe();
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed scan", async () => {
    scan.and.throwError("Failed scan");
    const { lease } = await observe();
    expect(adapter.snapshotCache.entries.get(editor)).toBeUndefined();
    expect(publish).not.toHaveBeenCalled();
    lease.dispose();
    scan.and.callFake(function () {
      return headings(this.editor);
    });
    await observe();
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("clears cache generations without allowing an older pending scan to repopulate them", async () => {
    let finish;
    scan.and.callFake(() => new Promise((resolve) => (finish = resolve)));
    const lease = adapter.observeHeaders(editor, publish);
    leases.push(lease);
    await conditionPromise(() => finish);
    adapter.clearCache();
    finish(headings(editor));
    await conditionPromise(() => !adapter.activeObserver.isUpdating);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(adapter.snapshotCache.entries.get(editor)).toBeUndefined();
  });

  it("does not overwrite a newer active observer after a reentrant synchronous cache hit", async () => {
    const { lease } = await observe();
    lease.dispose();
    const other = lumine.workspace.buildTextEditor();
    extras.push(other);
    let replacement;
    const old = adapter.observeHeaders(editor, () => {
      replacement = adapter.observeHeaders(other, () => {});
    });
    leases.push(old, replacement);
    expect(adapter.activeObserver.editor).toBe(other);
    old.dispose();
    expect(adapter.activeObserver.editor).toBe(other);
  });

  it("retains one cursor owner when cached publication reenters the same editor through another item", async () => {
    const { lease } = await observe();
    lease.dispose();
    const other = lumine.workspace.buildTextEditor();
    extras.push(other);
    const latest = jasmine.createSpy("latest editor publication");
    let middle, current;
    const original = adapter.observeHeaders(editor, () => {
      middle = adapter.observeHeaders(other, () => {
        current = adapter.observeHeaders(editor, latest);
      });
    });
    leases.push(original, middle, current);
    expect(adapter.activeObserver.editor).toBe(editor);
    expect(latest).toHaveBeenCalledTimes(1);
    latest.calls.reset();
    original.dispose();
    middle.dispose();
    editor.setCursorBufferPosition([6, 0], { autoscroll: false });
    await Promise.resolve();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(latest.calls.mostRecent().args[0]).toBeNull();
    expect(adapter.activeObserver.headers[1].currentCount).toBe(1);
    current.dispose();
    latest.calls.reset();
    editor.setCursorBufferPosition([0, 0], { autoscroll: false });
    await Promise.resolve();
    expect(latest).not.toHaveBeenCalled();
  });
});
