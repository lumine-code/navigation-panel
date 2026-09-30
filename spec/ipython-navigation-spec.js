const path = require("path");

function flatten(headers) {
  return headers.flatMap((header) => [header, ...flatten(header.children)]);
}

function pollUntil(condition) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (condition()) resolve();
      else if (performance.now() - start > 15000)
        reject(new Error("Navigation headers did not settle"));
      else requestAnimationFrame(check);
    };
    check();
  });
}

describe("IPython document navigation integration", () => {
  let editor, main, symbols, registration, headerSubscription;
  const packagePath = (name) => path.resolve(__dirname, "..", "..", name);
  const headersFor = () => require("../lib/editor-adapter").getTextEditorHeaders(editor);

  async function open(source) {
    editor = await lumine.workspace.open("navigation-cells.ipy");
    editor.setText(source);
    lumine.grammars.assignLanguageMode(editor.getBuffer(), "source.python.ipy");
    await editor.getBuffer().getLanguageMode().atGrammarSettlement();
  }

  async function getSymbols() {
    return symbols.getSymbols({ editor, type: "file", signal: new AbortController().signal });
  }

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    for (const name of ["language-python", "language-ipython", "symbol-tree-sitter"]) {
      const pkg = await lumine.packages.activatePackage(packagePath(name));
      if (name === "symbol-tree-sitter") symbols = pkg.mainModule.provideSymbol();
    }
    main = (await lumine.packages.activatePackage(path.resolve(__dirname, ".."))).mainModule;
  });

  afterEach(() => {
    headerSubscription?.dispose();
    headerSubscription = null;
    registration?.dispose();
    registration = null;
    editor?.destroy();
  });

  it("publishes typed names, exact marker rows and hierarchy through the real panel service", async () => {
    await open(
      [
        "# %% Top",
        "class Model: #$$p# Class body",
        "    def work(self): #$$$p# Runner",
        "        return 1",
        "# %%% [markdown] Notes",
        "# Heading",
        "  # %% False Markdown cell",
        "#$# False Markdown annotation",
        "# %%%% [raw] Bytes",
        "raw <bytes>",
        "  # %% False raw cell",
        "#$# False raw annotation",
        "# %% [code] Code",
        'value = """',
        "# %% False string cell",
        "#$# False string annotation",
        '"""',
        "values = [",
        "# %% False bracket cell",
        "1,",
        "]",
        "# %% [md] Short",
        "# content",
        "# %% [raw]",
        "opaque bytes",
        "# %% [code]",
        "value = 2",
        "# %%",
        "value = 3",
        "# %% md",
        "a = 1",
        "# %% markdown notes",
        "a = 2",
        "# %% raw Bytes",
        "a = 3",
      ].join("\n"),
    );
    const scans = spyOn(editor, "scan").and.callThrough();
    const copies = spyOn(editor.getBuffer().getLanguageMode().tree, "copy").and.callThrough();
    const service = main.provideNavigationHeaders();
    headerSubscription = service.onDidUpdateHeaders(() => {});
    await pollUntil(() =>
      service.getFlattenHeaders().some((header) => header.text === "raw Bytes"),
    );
    const headers = service.getFlattenHeaders();
    expect(service.getEditor()).toBe(editor);
    expect(
      headers.map((header) => [header.text, header.startPoint.row, header.level, header.revel]),
    ).toEqual([
      ["Top", 0, 1, 1],
      ["class Model Class body", 1, 2, 2],
      ["def work Runner", 2, 3, 3],
      ["Notes", 4, 2, 2],
      ["Bytes", 8, 3, 3],
      ["Code", 12, 1, 1],
      ["Short", 21, 1, 1],
      ["md", 29, 1, 1],
      ["markdown notes", 31, 1, 1],
      ["raw Bytes", 33, 1, 1],
    ]);
    expect(headers[0].children.map((header) => header.text)).toEqual([
      "class Model Class body",
      "Notes",
    ]);
    expect(headers.every((header) => header.startPoint.column === 0)).toBe(true);
    expect(
      headers.filter((header) => header.classList.includes("cell")).map((header) => header.text),
    ).toEqual(["Top", "Notes", "Bytes", "Code", "Short", "md", "markdown notes", "raw Bytes"]);
    await main.navigateToHeader(
      headers.find((header) => header.text === "Bytes"),
      { focus: false },
    );
    expect(editor.getCursorBufferPosition().toArray()).toEqual([8, 0]);
    const provided = await getSymbols();
    expect(
      provided
        .filter((symbol) => symbol.tag === "cell")
        .map((symbol) => [symbol.name, symbol.position.row]),
    ).toEqual([
      ["Top", 0],
      ["Notes", 4],
      ["Bytes", 8],
      ["Code", 12],
      ["Short", 21],
      ["md", 29],
      ["markdown notes", 31],
      ["raw Bytes", 33],
    ]);
    expect(provided.some((symbol) => symbol.tag === "class" && symbol.name === "Model")).toBe(true);
    expect(provided.some((symbol) => symbol.tag === "function" && symbol.name === "work")).toBe(
      true,
    );
    expect(scans).not.toHaveBeenCalled();
    expect(copies).not.toHaveBeenCalled();
  });

  it("keeps complete long marker prefixes and sparse percent hierarchy", async () => {
    const gap = "\t".repeat(4097);
    const percent = "%".repeat(257);
    await open(
      `#${gap}%% Gap\nvalue = 1\n# ${percent} [markdown] Many levels\nbody\n# %%% [raw] Child\nbytes`,
    );
    const headers = flatten(await headersFor());
    expect(
      headers.map((header) => [header.text, header.level, header.revel, header.startPoint.row]),
    ).toEqual([
      ["Gap", 1, 1, 0],
      ["Many levels", 256, 2, 2],
      ["Child", 2, 2, 4],
    ]);
    expect(headers[0].endPoint.column).toBe(editor.lineTextForBufferRow(0).length);
    expect(
      (await getSymbols()).filter((symbol) => symbol.tag === "cell").map((symbol) => symbol.name),
    ).toEqual(["Gap", "Many levels", "Child"]);
  });

  it("omits every unnamed type but keeps bare type titles and legacy annotations", async () => {
    await open(
      "# %%\n# %% [markdown]\n# %% [md]\n# %% [raw]\n# %% [code]\n# %% md\nvalue = 1\n# %% markdown\nvalue = 2\n# %% raw\nvalue = 3\n#%%$# Legacy\n#%%$$# Child\n",
    );
    const headers = flatten(await headersFor());
    expect(headers.map((header) => [header.text, header.level])).toEqual([
      ["md", 1],
      ["markdown", 1],
      ["raw", 1],
      ["Legacy", 1],
      ["Child", 2],
    ]);
  });

  it("excludes indented markers and markers after a physical line continuation", async () => {
    await open(
      "# %% Real\nif True:\n    # %% Indented\n    value = 1\nvalue = 1 + \\\n# %% Continued\n2\n# %% [raw] Next\nbytes\n",
    );
    expect(flatten(await headersFor()).map((header) => header.text)).toEqual(["Real", "Next"]);
  });

  it("treats percent markers in an original-language notebook fragment as content", async () => {
    editor = lumine.workspace.buildTextEditor();
    registration = lumine.textEditors.add(editor, { role: "fragment" });
    const source =
      "# %% [raw] Content\n# %%% Title\n#%%$$# Legacy cell\n#$# Real annotation\nvalue = 1";
    editor.setText(source);
    lumine.grammars.assignLanguageMode(editor.getBuffer(), "source.python");
    await editor.getBuffer().getLanguageMode().atGrammarSettlement();
    expect(flatten(await headersFor()).map((header) => header.text)).toEqual(["Real annotation"]);
    expect((await getSymbols()).some((symbol) => symbol.tag === "cell")).toBe(false);
    expect(editor.getText()).toBe(source);
  });

  it("retries a bounded traversal when a marker changes during its yield", async () => {
    await open(
      Array.from({ length: 600 }, (_, index) => `# %% Cell ${index}\nvalue = ${index}`).join("\n"),
    );
    const pending = headersFor();
    setImmediate(() =>
      editor.setTextInBufferRange(
        [
          [0, 0],
          [0, editor.lineTextForBufferRow(0).length],
        ],
        "# %% [raw] Fresh",
      ),
    );
    const headers = flatten(await pending);
    expect(headers.length).toBe(600);
    expect(headers[0].text).toBe("Fresh");
    expect(headers[1].text).toBe("Cell 1");
  });

  it("does not recreate markers when a pending outline finishes after package deactivation", async () => {
    await open("# %% Section\nvalue = 1\n");
    const service = main.provideNavigationHeaders();
    headerSubscription = service.onDidUpdateHeaders(() => {});
    await pollUntil(() => service.getFlattenHeaders().length === 1);
    const markers = main.markers;
    const { ScannerPython } = require("../lib/scanner-python");
    const headers = await headersFor();
    let resume;
    const gate = new Promise((resolve) => {
      resume = resolve;
    });
    spyOn(ScannerPython.prototype, "getIPythonHeaders").and.returnValue(gate);
    const refresh = spyOn(markers, "refreshHeaders").and.callThrough();
    const pending = markers.forEditor(editor);

    await lumine.packages.deactivatePackage("navigation-panel");
    expect(markers.pendingRequests.size).toBe(0);
    resume(headers);
    await pending;

    expect(refresh).not.toHaveBeenCalled();
    expect(
      Object.values(editor.getBuffer().navigationMarkerLayers).every(
        (layer) => layer.getMarkerCount() === 0,
      ),
    ).toBe(true);
  });

  it("drops an old IPython outline when its grammar changes during a traversal", async () => {
    await open(
      Array.from({ length: 600 }, (_, index) => `# %% Old ${index}\nvalue = ${index}`).join("\n"),
    );
    await headersFor();
    const pending = headersFor();
    setImmediate(() => {
      expect(
        lumine.grammars.assignLanguageMode(
          editor.getBuffer(),
          lumine.grammars.nullGrammar.scopeName,
        ),
      ).toBe(true);
    });

    expect(await pending).toEqual([]);
    expect(await headersFor()).toBeNull();
  });

  it("releases a pending traversal when its editor closes", async () => {
    await open(
      Array.from({ length: 600 }, (_, index) => `# %% Old ${index}\nvalue = ${index}`).join("\n"),
    );
    const pending = headersFor();
    setImmediate(() => editor.destroy());

    expect(await pending).toEqual([]);
    expect(editor.isDestroyed()).toBe(true);
  });

  it("shares one pending outline traversal between concurrent editor consumers", async () => {
    await open("# %% Section\nvalue = 1\n");
    await headersFor();
    const { ScannerPython } = require("../lib/scanner-python");
    const first = new ScannerPython(editor);
    const second = new ScannerPython(editor);
    const build = spyOn(first, "getIPythonHeaders").and.callThrough();
    const firstRequest = first.getHeaders();
    const secondRequest = second.getHeaders();

    expect(firstRequest).toBe(secondRequest);
    const headers = await firstRequest;
    expect(build).toHaveBeenCalledTimes(1);
    expect(headers[0].text).toBe("Section");
  });
});
