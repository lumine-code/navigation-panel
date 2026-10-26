const path = require("node:path");

const packageRoot = path.join(__dirname, "..");

function flatten(headers) {
  return headers.flatMap((header) => [header, ...flatten(header.children)]);
}

describe("SOFiSTiK heading scans", () => {
  let editor, ScannerSofistik;

  beforeEach(async () => {
    await lumine.packages.activatePackage(packageRoot);
    ({ ScannerSofistik } = require("../lib/scanner-sofistik"));
    lumine.config.set("navigation-panel.sofistik.icons", false);
    lumine.config.set("navigation-panel.sofistik.showInBlock", false);
    lumine.config.set("navigation-panel.editor.maxHeadingDepth", 9);
    editor = lumine.workspace.buildTextEditor();
  });

  afterEach(() => {
    editor.destroy();
    lumine.config.unset("navigation-panel.sofistik.icons");
    lumine.config.unset("navigation-panel.sofistik.showInBlock");
    lumine.config.unset("navigation-panel.editor.maxHeadingDepth");
  });

  it("searches sparse snapshots without eager full-result lists or legacy scans", async () => {
    const lines = Array(12000).fill("NODE 1 X 0 Y 0 Z 0");
    lines[0] = "!$! First";
    lines[11999] = "!$! Last";
    editor.setText(lines.join("\n"));
    const find = spyOn(editor.getBuffer(), "findAllInRange").and.callThrough();
    const scan = spyOn(editor, "scanInBufferRange").and.callThrough();
    spyOn(editor, "scan").and.throwError("A full synchronous scan blocks input");

    const headers = flatten(await new ScannerSofistik(editor).getHeaders());

    expect(headers.map(({ text }) => text)).toEqual(["First", "Last"]);
    expect(headers.map(({ startPoint }) => startPoint.row)).toEqual([0, 11999]);
    expect(scan).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });

  it("preserves define nesting, heading order and HEAD lookahead across windows", async () => {
    const lines = Array(6148).fill("NODE 1 X 0");
    lines[0] = "!$! Root";
    lines[2047] = "#define outer";
    lines[2048] = "!$$! Hidden outer";
    lines[2050] = "#define inner";
    lines[2051] = "!$$! Hidden inner";
    lines[2052] = "#enddef";
    lines[4095] = "!$$! Still hidden";
    lines[4096] = "#enddef";
    lines[6143] = "+prog aqua urs:1";
    lines[6144] = "head Real program title";
    lines[6145] = "! ! --- Program section ---";
    lines[6146] = "$ graphics 1 | picture 2 | layer 3 : Plot";
    lines[6147] = "!$! Last";
    editor.setText(lines.join("\n"));
    const scanner = new ScannerSofistik(editor);

    for (let iteration = 0; iteration < 2; iteration++) {
      const headers = flatten(await scanner.getHeaders());
      expect(headers.map(({ text }) => text)).toEqual([
        "Root",
        "aqua: Real program title",
        "Program section",
        "1-2-3: Plot",
        "Last",
      ]);
      expect(headers.map(({ startPoint }) => startPoint.row)).toEqual([0, 6143, 6145, 6146, 6147]);
      expect(headers.map(({ lastRow }) => lastRow)).toEqual([6142, 6144, 6145, 6146, 6148]);
    }

    lumine.config.set("navigation-panel.sofistik.showInBlock", true);
    const all = flatten(await new ScannerSofistik(editor).getHeaders());
    expect(all.map(({ text }) => text)).toContain("Hidden inner");
    expect(all.map(({ text }) => text)).toContain("Still hidden");
  });

  it("retains ordinary match and replacement callbacks for chapter toggles", async () => {
    editor.setText("!+!chapter First\n!-!chapter Last");
    const scanner = new ScannerSofistik(editor);
    const objects = [];
    const parse = scanner.parse.bind(scanner);
    spyOn(scanner, "parse").and.callFake((object) => {
      objects.push(object);
      return parse(object);
    });

    await scanner.getHeaders();
    expect(objects.map(({ matchText }) => matchText)).toEqual([
      "!+!chapter First",
      "!-!chapter Last",
    ]);
    const icon = { srcElement: {} };
    scanner.toggleChapter(icon, objects[0]);
    scanner.toggleChapter(icon, objects[1]);
    expect(editor.getText()).toBe("!-!chapter First\n!+!chapter Last");
  });

  it("stops an aborted search before parsing or queuing another window", async () => {
    editor.setText(Array(10000).fill("!$! Heading").join("\n"));
    const scanner = new ScannerSofistik(editor);
    const parse = spyOn(scanner, "parse").and.callThrough();
    const controller = new AbortController();
    const pending = scanner.getHeaders({ signal: controller.signal });
    const before = parse.calls.count();
    controller.abort();

    await expectAsync(pending).toBeRejectedWith(jasmine.objectContaining({ name: "AbortError" }));
    expect(parse.calls.count()).toBe(before);
    expect(before).toBeLessThan(5000);
  });

  it("rejects an edited snapshot even when called without an observer signal", async () => {
    editor.setText("!$! Before\n" + "body\n".repeat(20000));
    const pending = new ScannerSofistik(editor).getHeaders();
    editor.insertText("changed");

    await expectAsync(pending).toBeRejectedWith(jasmine.objectContaining({ name: "AbortError" }));
  });
});
