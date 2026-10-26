describe("bounded document outlines", () => {
  let editor, Markdown, Bibtex;
  beforeEach(async () => {
    jasmine.useRealClock();
    await lumine.packages.activatePackage("navigation-panel");
    editor = lumine.workspace.buildTextEditor();
    Markdown = require("../lib/scanner-markdown").ScannerMarkdown;
    Bibtex = require("../lib/scanner-bibtex").ScannerBibtex;
  });
  afterEach(() => editor?.destroy());

  function guardedSnapshot() {
    const buffer = editor.getBuffer(),
      source = buffer.getTextSnapshot();
    const read = jasmine.createSpy("bounded slice").and.callFake((start, end) => {
      if (end - start > 65536) throw new Error("unbounded source slice");
      return source.slice(start, end);
    });
    const wrapped = { length: source.length, lineCount: source.lineCount, slice: read };
    for (const name of ["reader", "lineStart", "positionAt", "charCodeAt"])
      wrapped[name] = source[name].bind(source);
    spyOn(buffer, "getTextSnapshot").and.returnValue(wrapped);
    spyOn(editor, "getText").and.throwError("whole document read");
    return read;
  }

  it("omits an oversized regex context without matching its prefix and scans later headings", async () => {
    editor.setText("# " + "x".repeat(70000) + "\n# Complete\n");
    const read = guardedSnapshot();
    const headers = await new Markdown(editor).getHeaders();
    expect(headers.map((header) => header.text)).toEqual(["Complete"]);
    expect(headers[0].startPoint).toEqual({ row: 1, column: 0 });
    expect(headers.outlineStatus).toEqual({
      complete: false,
      omittedRows: 1,
      headingLimit: false,
      labelPreviews: 0,
    });
    expect(read).toHaveBeenCalled();
  });

  it("retains a bounded dense outline with an explicit incomplete state", async () => {
    editor.setText("# Heading\n".repeat(7000));
    const headers = await new Markdown(editor).getHeaders();
    expect(headers.length).toBe(5000);
    expect(headers.at(-1).startPoint.row).toBe(4999);
    expect(headers.at(-1).lastRow).toBe(4999);
    expect(headers.outlineStatus.complete).toBeFalse();
    expect(headers.outlineStatus.headingLimit).toBeTrue();
  });

  it("retains reStructuredText style order after a giant omitted heading", async () => {
    const Rest = require("../lib/scanner-rest").ScannerRest;
    editor.setText("a".repeat(70000) + "\n===\nSecond\n---\nSame\n===");
    const headers = await new Rest(editor).getHeaders();
    expect(headers.map((header) => [header.text, header.level])).toEqual([
      ["Second", 2],
      ["Same", 1],
    ]);
    expect(headers.outlineStatus.omittedRows).toBe(1);
  });

  it("elides labels at complete UTF-16 boundaries without changing navigation ranges", () => {
    editor.setText("# " + "a".repeat(1023) + "😀" + "z".repeat(20));
    const [header] = new Markdown(editor).getHeaders();
    expect(header.text).toBe("a".repeat(1023) + "…");
    expect(header.endPoint.column).toBe(1047);
  });

  it("does not invent a logical row boundary at lone CR or Unicode separators", () => {
    editor.setText("before\r# not a heading\ntext\u2028# also not a heading\n# Real");
    expect(new Markdown(editor).getHeaders().map((header) => header.text)).toEqual(["Real"]);
  });

  it("retains fence state when an oversized Markdown or Typst fence row is omitted", async () => {
    const Typst = require("../lib/scanner-typst").ScannerTypst;
    for (const [Scanner, marker] of [
      [Markdown, "#"],
      [Typst, "="],
    ]) {
      editor.setText("```" + "x".repeat(70000) + `\n${marker} Hidden\n\`\`\`\n${marker} Visible`);
      const headers = await new Scanner(editor).getHeaders();
      expect(headers.map((header) => header.text)).toEqual(["Visible"]);
      expect(headers.outlineStatus.omittedRows).toBe(1);
    }
  });

  it("retains SOFiSTiK define nesting across an oversized declaration", async () => {
    const Sofistik = require("../lib/scanner-sofistik").ScannerSofistik;
    lumine.config.set("navigation-panel.sofistik.showInBlock", false);
    editor.setText("#define " + "x".repeat(70000) + "\n!$! Hidden\n#enddef\n!$! Visible");
    const headers = await new Sofistik(editor).getHeaders();
    expect(headers.map((header) => header.text)).toEqual(["Visible"]);
    expect(headers.outlineStatus.omittedRows).toBe(1);
  });

  it("balances giant BibTeX bodies without flattening their rows or mistaking nested entries", async () => {
    editor.setText(
      "@article{first, title={" +
        "x".repeat(1024 * 1024) +
        "\n@book{nested, title={Hidden}}\n}}\n@book{last, title={Last}}",
    );
    guardedSnapshot();
    const headers = await new Bibtex(editor).getHeaders();
    expect(headers.map((header) => header.text)).toEqual(["article: first", "book: last"]);
    expect(headers.map((header) => header.startPoint.row)).toEqual([0, 3]);
    expect(headers.outlineStatus.complete).toBeTrue();
  });

  it("cancels while scanning a giant BibTeX token or unfinished body", async () => {
    for (const source of [
      "@" + "a".repeat(1024 * 1024),
      "@book{key, title={" + "x".repeat(1024 * 1024),
    ]) {
      editor.setText(source);
      const controller = new AbortController();
      const pending = new Bibtex(editor).getHeaders({ signal: controller.signal });
      controller.abort();
      await expectAsync(pending).toBeRejectedWith(jasmine.objectContaining({ name: "AbortError" }));
    }
  });

  it("preserves incomplete metadata through the adapter and renders its counts", async () => {
    editor.setText("# " + "x".repeat(70000) + "\n# Complete");
    const raw = await new Markdown(editor).getHeaders();
    const Manager = require("../lib/adapter-manager").AdapterManager;
    const manager = new Manager();
    manager.active = { navigateTo() {} };
    const headers = manager.buildHeaders(raw, editor);
    expect(headers.outlineStatus).toBe(raw.outlineStatus);
    const Tree = require("../lib/navi-tree").NavigationTree;
    const tree = new Tree();
    try {
      tree.update(headers, { instant: true });
      await require("@lumine-code/etch").getScheduler().getNextUpdatePromise();
      const status = tree.element.querySelector(".navigation-outline-status");
      expect(status.textContent).toContain("Incomplete outline");
      expect(status.textContent).toContain("1 oversized row");
    } finally {
      tree.destroy();
    }
  });
});
