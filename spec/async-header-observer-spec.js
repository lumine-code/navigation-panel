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
    expect(publish).toHaveBeenCalledWith(latest, { instant: true });
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
