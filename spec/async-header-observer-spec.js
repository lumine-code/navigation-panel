const path = require("node:path");

const packageRoot = path.join(__dirname, "..");

describe("Asynchronous navigation headings", () => {
  let editor, observer, publish, markers;

  beforeEach(async () => {
    await lumine.packages.activatePackage(packageRoot);
    const { EditorHeaderObserver } = require("../lib/editor-adapter");
    editor = lumine.workspace.buildTextEditor();
    editor.setText("old source");
    publish = jasmine.createSpy("publish");
    markers = { markLines: true, refresh: jasmine.createSpy("refresh"), clear: () => {} };
    observer = new EditorHeaderObserver(editor, publish, {
      traceVisible: () => false,
      markers,
    });
    await conditionPromise(() => !observer.isUpdating);
    publish.calls.reset();
  });

  afterEach(() => {
    observer.destroy();
    editor.destroy();
  });

  async function startDelayedScan() {
    let finish, signal;
    observer.scanner = {
      getHeaders(options) {
        signal = options.signal;
        return new Promise((resolve) => (finish = resolve));
      },
    };
    const pending = observer.update({ instant: true });
    await conditionPromise(() => finish);
    return {
      signal,
      finish: async () => {
        finish([{ text: "Stale", children: [], startPoint: { row: 0, column: 0 } }]);
        await pending;
      },
    };
  }

  it("cancels on the first edit and keeps the previous headers until the next idle scan", async () => {
    const previous = [{ text: "Previous" }];
    observer.headers = previous;
    const scan = await startDelayedScan();

    editor.insertText("x");
    expect(scan.signal.aborted).toBe(true);
    await scan.finish();

    expect(observer.headers).toBe(previous);
    expect(markers.refresh).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("never publishes or paints a scan completed after teardown", async () => {
    const scan = await startDelayedScan();
    observer.destroy();
    expect(scan.signal.aborted).toBe(true);
    await scan.finish();

    expect(markers.refresh).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("runs a replacement after discarding the superseded scan", async () => {
    const scan = await startDelayedScan();
    const latest = [];
    observer.scanner = { getHeaders: () => latest };
    observer.update({ instant: true });
    expect(scan.signal.aborted).toBe(true);
    await scan.finish();
    await conditionPromise(() => !observer.isUpdating);

    expect(observer.headers).toBe(latest);
    expect(markers.refresh.calls.count()).toBe(1);
    expect(markers.refresh).toHaveBeenCalledWith(editor, latest);
    expect(publish.calls.count()).toBe(1);
    expect(publish).toHaveBeenCalledWith(latest, { instant: true, scrollBoundary: null });
  });

  it("publishes the complete scan before cursor state triggered by marker refresh", async () => {
    editor.setText("first\nbody\nsecond");
    const headers = [
      {
        text: "First",
        children: [],
        startPoint: { row: 0, column: 0 },
        currentCount: 0,
        stackCount: 0,
      },
      {
        text: "Second",
        children: [],
        startPoint: { row: 2, column: 0 },
        currentCount: 0,
        stackCount: 0,
      },
    ];
    observer.scanner = { getHeaders: () => headers };
    markers.refresh.and.callFake(() => {
      editor.setCursorBufferPosition([2, 0], { autoscroll: false });
    });
    await observer.update({ instant: true });
    await flushMicrotasks();

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.calls.first().args[0]).toBe(headers);
    expect(publish.calls.first().args[1].stateChanges).toBeUndefined();
    expect(headers[0].currentCount).toBe(0);
    expect(headers[1].currentCount).toBe(1);
  });

  it("resumes after None without waiting for an obsolete scanner to settle", async () => {
    await lumine.packages.activatePackage("language-javascript");
    const grammar = lumine.grammars.grammarForScopeName("source.js");
    lumine.grammars.assignGrammar(editor, grammar);
    await conditionPromise(() => !observer.isUpdating);
    markers.refresh.calls.reset();
    publish.calls.reset();
    const scan = await startDelayedScan();

    lumine.grammars.assignGrammar(editor, lumine.grammars.nullGrammar);
    expect(observer.headers).toBeNull();
    expect(scan.signal.aborted).toBe(true);
    lumine.grammars.assignGrammar(editor, grammar);
    await conditionPromise(() => observer.headers?.length === 0 && !observer.isUpdating);
    const latest = observer.headers;
    expect(markers.refresh).toHaveBeenCalledWith(editor, latest);

    await scan.finish();
    expect(observer.headers).toBe(latest);
    expect(publish.calls.mostRecent().args[0]).toBe(latest);
  });

  it("cancels standalone marker scans when their markers are cleared", async () => {
    const { EditorMarkers } = require("../lib/editor-markers");
    const { ScannerSofistik } = require("../lib/scanner-sofistik");
    const standalone = new EditorMarkers();
    standalone.markLines = true;
    spyOn(editor, "getGrammar").and.returnValue({ scopeName: "source.sofistik" });
    let finish, signal;
    spyOn(ScannerSofistik.prototype, "getHeaders").and.callFake((options) => {
      signal = options.signal;
      return new Promise((resolve) => (finish = resolve));
    });
    const refresh = spyOn(standalone, "refreshHeaders");

    const pending = standalone.forEditor(editor);
    standalone.clear(editor);
    expect(signal.aborted).toBe(true);
    finish([]);
    await pending;

    expect(refresh).not.toHaveBeenCalled();
    expect(standalone.pendingScans.size).toBe(0);
  });
});
