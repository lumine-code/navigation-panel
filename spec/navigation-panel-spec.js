const fs = require("fs");
const path = require("path");
const { Disposable } = require("lumine");

// Activate by path: resolving by name would need this checkout linked into
// ~/.lumine/packages-dev first.
const packageRoot = path.join(__dirname, "..");

// The spec runner freezes setTimeout, so etch renders are awaited by polling
// on animation frames instead of timers.
function pollUntil(condition, timeoutMs = 15000) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (condition()) {
        resolve();
      } else if (performance.now() - start > timeoutMs) {
        reject(new Error("Timed out waiting for condition"));
      } else {
        requestAnimationFrame(check);
      }
    };
    check();
  });
}

describe("navigation-panel", () => {
  let workspaceElement, mainModule;

  beforeEach(async () => {
    workspaceElement = lumine.views.getView(lumine.workspace);
    jasmine.attachToDOM(workspaceElement);
    const pkg = await lumine.packages.activatePackage(packageRoot);
    mainModule = pkg.mainModule;
  });

  function createFakeAdapterSetup() {
    const fakeItem = {
      element: document.createElement("div"),
      getTitle: () => "Fake Document",
    };
    const headers = [
      {
        text: "Chapter One",
        level: 1,
        classList: [],
        startPoint: { row: 0, column: 0 },
        children: [
          {
            text: "Section A",
            level: 2,
            classList: [],
            startPoint: { row: 2, column: 0 },
            children: [],
          },
        ],
      },
      {
        text: "Chapter Two",
        level: 1,
        classList: [],
        startPoint: { row: 5, column: 0 },
        children: [],
      },
    ];
    const navigateTo = jasmine.createSpy("navigateTo");
    const adapter = {
      handlesItem: (item) => item === fakeItem,
      observeHeaders: (item, callback) => {
        callback(headers, { instant: true });
        return new Disposable(() => {});
      },
      navigateTo,
    };
    return { fakeItem, headers, adapter, navigateTo };
  }

  describe("navigation.adapter consumption", () => {
    it("renders outline entries provided by an adapter", async () => {
      const { fakeItem, adapter } = createFakeAdapterSetup();
      mainModule.consumeNavigationAdapter(adapter);

      const pane = lumine.workspace.getCenter().getActivePane();
      pane.addItem(fakeItem);
      pane.activateItem(fakeItem);

      mainModule.open();
      const treeElement = mainModule.navigationTree.element;
      await pollUntil(() => treeElement.querySelectorAll(".navigation-text").length === 3);

      const texts = Array.from(treeElement.querySelectorAll(".navigation-text")).map((el) =>
        el.textContent.trim(),
      );
      expect(texts).toEqual(["Chapter One", "Section A", "Chapter Two"]);
    });

    it("navigates through the adapter when an entry is clicked", async () => {
      const { fakeItem, adapter, navigateTo } = createFakeAdapterSetup();
      mainModule.consumeNavigationAdapter(adapter);

      const pane = lumine.workspace.getCenter().getActivePane();
      pane.addItem(fakeItem);
      pane.activateItem(fakeItem);

      mainModule.open();
      const treeElement = mainModule.navigationTree.element;
      await pollUntil(() => treeElement.querySelectorAll(".navigation-text").length === 3);

      const entries = treeElement.querySelectorAll(".navigation-text");
      entries[2].dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(navigateTo).toHaveBeenCalled();
      const [calledItem, calledHeader] = navigateTo.calls.mostRecent().args;
      expect(calledItem).toBe(fakeItem);
      expect(calledHeader.text).toBe("Chapter Two");
    });

    it("clears the outline when the active item has no adapter", async () => {
      const { fakeItem, adapter } = createFakeAdapterSetup();
      mainModule.consumeNavigationAdapter(adapter);

      const pane = lumine.workspace.getCenter().getActivePane();
      pane.addItem(fakeItem);
      pane.activateItem(fakeItem);
      await pollUntil(() => mainModule.headers && mainModule.headers.length === 2);

      const plainItem = {
        element: document.createElement("div"),
        getTitle: () => "Plain",
      };
      pane.addItem(plainItem);
      pane.activateItem(plainItem);

      expect(mainModule.headers).toBeNull();
    });

    it("reads the heading-depth limit once per tree build", () => {
      const { AdapterManager } = require("../lib/adapter-manager");
      const manager = new AdapterManager();
      const { fakeItem, headers, adapter } = createFakeAdapterSetup();
      manager.active = adapter;
      const configGet = spyOn(lumine.config, "get").and.callThrough();

      const built = manager.buildHeaders(headers, fakeItem);

      const depthReads = configGet.calls
        .allArgs()
        .filter(([key]) => key === "navigation-panel.editor.maxHeadingDepth");
      expect(depthReads.length).toBe(1);
      expect(built[0].children[0].text).toBe("Section A");
    });
  });

  describe("built-in editor cursor updates", () => {
    let editor;
    const cursorRanges = () =>
      Array.from({ length: 1000 }, (_, index) => [
        [index * 2, 4],
        [index * 2, 4],
      ]);

    beforeEach(async () => {
      await lumine.packages.activatePackage("language-javascript");
      editor = await lumine.workspace.open();
      editor.setGrammar(lumine.grammars.grammarForScopeName("source.js"));
      editor.setText(
        Array.from(
          { length: 2000 },
          (_, row) =>
            `function function${row}() {}` + (row % 2 === 0 ? ` //$f// Header ${row / 2}` : ""),
        ).join("\n"),
      );
      await editor.getBuffer().getLanguageMode().ready;
      await pollUntil(() => mainModule.editor === editor && mainModule.headers?.length === 1000);
    });

    it("activates a focused destination through the workspace before moving its cursor", async () => {
      const open = spyOn(lumine.workspace, "open").and.callThrough();

      await mainModule.builtinEditorAdapter.navigateTo(editor, {
        startPoint: { row: 6, column: 0 },
      });

      expect(open).toHaveBeenCalledWith(editor, { searchAllPanes: true });
      expect(editor.getCursorBufferPosition()).toEqual([6, 0]);
    });

    it("publishes bulk cursor additions and removals once", async () => {
      const updateHeaders = spyOn(mainModule, "updateAdapterHeaders");

      editor.setSelectedBufferRanges(cursorRanges());
      await Promise.resolve();
      expect(updateHeaders.calls.count()).toBe(1);

      updateHeaders.calls.reset();
      editor.consolidateSelections();
      await Promise.resolve();
      expect(updateHeaders.calls.count()).toBe(1);
    });

    it("ignores horizontal cursor bursts and publishes vertical ones once", async () => {
      editor.setSelectedBufferRanges(cursorRanges());
      await Promise.resolve();
      const observer = mainModule.builtinEditorAdapter.activeObserver;
      const clearCursorItems = spyOn(observer, "clearCursorItems").and.callThrough();
      const findCursorItems = spyOn(observer, "findCursorItems").and.callThrough();
      const updateHeaders = spyOn(mainModule, "updateAdapterHeaders");

      editor.selectRight();
      await Promise.resolve();
      editor.selectLeft();
      await Promise.resolve();
      expect(updateHeaders).not.toHaveBeenCalled();
      expect(clearCursorItems).not.toHaveBeenCalled();
      expect(findCursorItems).not.toHaveBeenCalled();

      editor.selectDown();
      await Promise.resolve();
      expect(updateHeaders.calls.count()).toBe(1);
      expect(clearCursorItems.calls.count()).toBe(1000);
      expect(findCursorItems.calls.count()).toBe(1000);
      expect(editor.getCursors().length).toBe(1000);
    });
  });

  it("keeps the final cursor row after a reentrant move", async () => {
    const { EditorHeaderObserver } = require("../lib/editor-adapter");
    const editor = lumine.workspace.buildTextEditor();
    editor.setText("zero\none\ntwo");
    const cursor = editor.getLastCursor();
    let movedReentrantly = false;
    cursor.onDidChangePosition(() => {
      if (movedReentrantly) return;
      movedReentrantly = true;
      cursor.setBufferPosition([2, 0]);
    });
    const publish = jasmine.createSpy("publish");
    const observer = new EditorHeaderObserver(editor, publish, {
      traceVisible: () => false,
      markers: null,
    });
    observer.headers = [
      {
        startPoint: { row: 0, column: 0 },
        children: [],
        currentCount: 0,
        stackCount: 0,
      },
      {
        startPoint: { row: 2, column: 0 },
        children: [],
        currentCount: 0,
        stackCount: 0,
      },
    ];
    observer.findCursorItems(cursor, 0);
    publish.calls.reset();

    try {
      cursor.setBufferPosition([1, 0]);
      await Promise.resolve();

      expect(cursor.getBufferPosition()).toEqual([2, 0]);
      expect(cursor.navigationItems[0].startPoint.row).toBe(2);
      expect(publish.calls.count()).toBe(1);
    } finally {
      observer.destroy();
      editor.destroy();
    }
  });

  describe("built-in markdown scanner", () => {
    it("builds a nested header tree from markdown text", async () => {
      const { ScannerMarkdown } = require("../lib/scanner-markdown");
      const editor = await lumine.workspace.open();
      editor.setText("# One\n\ntext\n\n## Sub\n\n```\n# not a header\n```\n\n# Two\n");

      const scanner = new ScannerMarkdown(editor);
      const headers = scanner.getHeaders();

      expect(headers.length).toBe(2);
      expect(headers[0].text).toBe("One");
      expect(headers[0].children.length).toBe(1);
      expect(headers[0].children[0].text).toBe("Sub");
      expect(headers[1].text).toBe("Two");

      const repeatedHeaders = scanner.getHeaders();
      expect(repeatedHeaders.map((header) => header.text)).toEqual(["One", "Two"]);
      expect(repeatedHeaders[0].children.map((header) => header.text)).toEqual(["Sub"]);
    });
  });

  describe("stateful built-in scanners", () => {
    it("resets Typst raw-block state before every scan", async () => {
      const { ScannerTypst } = require("../lib/scanner-typst");
      const editor = await lumine.workspace.open();
      editor.setText("= One\n\n```typ\n= Hidden\n```\n\n== Two\n");
      const scanner = new ScannerTypst(editor);

      for (let iteration = 0; iteration < 2; iteration++) {
        const headers = scanner.getHeaders();
        expect(headers.map((header) => header.text)).toEqual(["One"]);
        expect(headers[0].children.map((header) => header.text)).toEqual(["Two"]);
      }
    });

    it("resets reStructuredText section levels before every scan", async () => {
      const { ScannerRest } = require("../lib/scanner-rest");
      const editor = await lumine.workspace.open();
      editor.setText("Title\n=====\n\nSection\n-------\n");
      const scanner = new ScannerRest(editor);

      for (let iteration = 0; iteration < 2; iteration++) {
        const headers = scanner.getHeaders();
        expect(headers.map((header) => header.text)).toEqual(["Title"]);
        expect(headers[0].children.map((header) => header.text)).toEqual(["Section"]);
      }
    });
  });

  describe("built-in scanner contract", () => {
    it("runs one scan after setup and passes every raw match to parse in order", () => {
      const { ScannerAbstract } = require("../lib/scanner-abstract");
      const calls = [];
      const matches = [
        {
          level: 1,
          text: "First",
          classList: ["first"],
          range: {
            start: { row: 1, column: 0 },
            end: { row: 1, column: 5 },
          },
        },
        {
          ignored: true,
          range: {
            start: { row: 4, column: 0 },
            end: { row: 4, column: 7 },
          },
        },
        {
          level: 1,
          text: "Last",
          classList: ["last"],
          range: {
            start: { row: 8, column: 0 },
            end: { row: 8, column: 4 },
          },
        },
      ];

      class ScannerWithCustomSource extends ScannerAbstract {
        beforeScan() {
          calls.push("beforeScan");
        }

        scan(callback) {
          calls.push("scan");
          for (const match of matches) callback(match);
        }

        parse(match) {
          calls.push(match);
          return match.ignored ? undefined : super.parse(match);
        }
      }

      const scanner = new ScannerWithCustomSource({ getLineCount: () => 12 });
      const headers = scanner.getHeaders();

      expect(calls).toEqual(["beforeScan", "scan", ...matches]);
      expect(headers.map((header) => header.text)).toEqual(["First", "Last"]);
      expect(headers[0].lastRow).toBe(7);
      expect(headers[1].lastRow).toBe(12);
    });
  });

  describe("built-in BibTeX scanner", () => {
    async function scan(text) {
      const { ScannerBibtex } = require("../lib/scanner-bibtex");
      const editor = await lumine.workspace.open();
      editor.setText(text);
      return new ScannerBibtex(editor).getHeaders();
    }

    function flatten(headers) {
      return headers.flatMap((header) => [header, ...flatten(header.children)]);
    }

    it("scans the language-bibtex fixture through the built-in adapter", async () => {
      const { getTextEditorHeaders } = require("../lib/editor-adapter");
      const bibtexPath =
        lumine.packages.resolvePackagePath("language-bibtex") ??
        path.resolve(__dirname, "..", "..", "language-bibtex");
      const bibtexPackage = await lumine.packages.activatePackage(bibtexPath);
      const grammar = lumine.grammars.grammarForScopeName("text.bibtex");
      const fixture = fs.readFileSync(
        path.join(bibtexPackage.path, "spec", "fixtures", "sample.bib"),
        "utf8",
      );
      const editor = await lumine.workspace.open();
      editor.setGrammar(grammar);
      editor.setText(fixture);

      expect(grammar).toBeTruthy();
      expect(getTextEditorHeaders(editor).map((header) => header.text)).toEqual([
        "article: knuth1984",
        "book: ross1988",
      ]);
    });

    for (const [name, newline] of [
      ["LF", "\n"],
      ["CRLF", "\r\n"],
    ]) {
      it(`supports braces and parentheses with ${name} line endings`, async () => {
        const headers = await scan(
          [
            '@article{braced, title = "Braced"}',
            '@book(parenthesized)key, title = "Parenthesized")',
          ].join(newline),
        );

        expect(headers.map((header) => header.text)).toEqual([
          "article: braced",
          "book: parenthesized)key",
        ]);
        expect(headers.map((header) => header.startPoint.row)).toEqual([0, 1]);
      });
    }

    it("accepts multiline openers and keys while keeping a one-line directive range", async () => {
      const headers = await scan(
        ["@ArTiClE", "  {", "    multiline-key", "    ,", '    title = "Title"', "  }"].join("\n"),
      );

      expect(headers.length).toBe(1);
      expect(headers[0].text).toBe("ArTiClE: multiline-key");
      expect(headers[0].startPoint).toEqual({ row: 0, column: 0 });
      expect(headers[0].endPoint).toEqual({ row: 0, column: 8 });
    });

    it("accepts a UTF-8 BOM before the first directive", async () => {
      const headers = await scan('\ufeff@BOOK{Bird1987, title = "Bird"}');

      expect(headers.map((header) => header.text)).toEqual(["BOOK: Bird1987"]);
      expect(headers[0].startPoint).toEqual({ row: 0, column: 0 });
    });

    it("skips special directives case-insensitively and entries without keys", async () => {
      const headers = await scan(
        [
          '@STRING{publisher = "Press"}',
          '@pReAmBlE("preamble")',
          '@Comment{ @article{fake-comment, title = "Fake"} }',
          '@comment{ an unmatched " quote and @book{nested-comment, text} }',
          "@COMMENT ignored text",
          '@article{, title = "Empty"}',
          '@book{missing-delimiter title = "Missing"}',
          '@misc{real, title = "Real"}',
        ].join("\n"),
      );

      expect(headers.map((header) => header.text)).toEqual(["misc: real"]);
    });

    it("ignores entry-like text inside nested, quoted, and escaped values", async () => {
      const headers = await scan(
        String.raw`@article{outer,
  title = {A 6" widget and @book{fake-nested, title = Fake}},
  note = "Escaped quote \" and @misc{fake-quoted,",
  annotation = "Nested {6" widget and @inproceedings(fake-parenthesized,} text"
}
@book(real, title = "Real")`,
      );

      expect(headers.map((header) => header.text)).toEqual(["article: outer", "book: real"]);
    });

    it("recovers at a following directive after an unterminated entry", async () => {
      const headers = await scan(
        [
          "@article{broken,",
          '  title = "unterminated',
          '@book{recovered, title = "Recovered"}',
        ].join("\n"),
      );

      expect(headers.map((header) => header.text)).toEqual(["article: broken", "book: recovered"]);
      expect(headers.map((header) => header.startPoint.row)).toEqual([0, 2]);
    });

    it("bounds recovery work for many unterminated comments", async () => {
      const brokenComments = Array.from(
        { length: 1000 },
        (_, index) => `@comment{unterminated-${index}`,
      );
      const headers = await scan(
        [...brokenComments, '@book{recovered, title = "Recovered"}'].join("\n"),
      );

      expect(headers).toEqual([]);
    });

    it("fully balances the first entry recovered after malformed input", async () => {
      const headers = await scan(
        [
          "@comment{broken-0",
          "@comment{broken-1",
          "@comment{broken-2",
          "@article{recovered,",
          "  note = {",
          "    @book{fake, title={Fake}}",
          "  }",
          "}",
          "@misc{real, title={Real}}",
        ].join("\n"),
      );

      expect(headers.map((header) => header.text)).toEqual(["article: recovered", "misc: real"]);
    });

    it("keeps top-level percent markers, their hierarchy, classes, and line ranges", async () => {
      const lines = [
        "Lead %$*% Bibliography",
        "%$$+% Sources",
        '@article{first, title = "First"}',
        "%$-% Warnings",
        "%$!% Errors",
        "%$_% Separator",
      ];
      const headers = await scan(lines.join("\n"));
      const flat = flatten(headers);

      expect(headers.map((header) => header.text)).toEqual([
        "Lead Bibliography",
        "Warnings",
        "Errors",
        "Separator",
      ]);
      expect(headers[0].children[0].text).toBe("Sources");
      expect(headers[0].children[0].children[0].text).toBe("article: first");
      expect(flat.map((header) => header.classList)).toEqual([
        ["info"],
        ["success"],
        [],
        ["warning"],
        ["error"],
        ["separator"],
      ]);
      expect(flat.map((header) => header.startPoint)).toEqual(
        lines.map((_, row) => ({ row, column: 0 })),
      );
      expect(flat.map((header) => header.endPoint)).toEqual(
        lines.map((line, row) => ({ row, column: line.length })),
      );
    });

    it("does not treat percent markers inside entries as navigation headers", async () => {
      const headers = await scan(
        [
          "@article{outer,",
          '  title = "Outer",',
          "  % } does not close the entry",
          "  %$!% Not a marker",
          "  note = {",
          '    @book{fake, title = "Fake"}',
          "  }",
          "}",
          "%$*% Real marker",
        ].join("\n"),
      );

      expect(headers.map((header) => header.text)).toEqual(["article: outer", "Real marker"]);
      expect(headers.map((header) => header.classList)).toEqual([[], ["info"]]);
    });
  });

  describe("built-in python scanner", () => {
    async function scan(text) {
      const { ScannerPython } = require("../lib/scanner-python");
      const editor = await lumine.workspace.open();
      editor.setText(text);
      return new ScannerPython(editor).getHeaders();
    }

    it("uses the percent count as the level of named cell markers", async () => {
      const headers = await scan(
        ["# %% Top", "# %%% Child", "# %%%% Grandchild", "\t#%%    Second top   "].join("\n"),
      );

      expect(headers.length).toBe(2);
      expect(headers[0].text).toBe("Top");
      expect(headers[0].level).toBe(1);
      expect(headers[0].classList).toEqual(["cell"]);
      expect(headers[0].children[0].text).toBe("Child");
      expect(headers[0].children[0].level).toBe(2);
      expect(headers[0].children[0].children[0].text).toBe("Grandchild");
      expect(headers[0].children[0].children[0].level).toBe(3);
      expect(headers[1].text).toBe("Second top");
      expect(headers[1].level).toBe(1);
      expect(headers[1].classList).toEqual(["cell"]);
    });

    it("removes an immediate markdown cell type from the title", async () => {
      const headers = await scan(
        [
          "# %% md Short",
          "# %% markdown Long",
          "# %% [md] Bracketed short",
          "# %% [markdown] Bracketed long",
        ].join("\n"),
      );

      expect(headers.map((header) => header.text)).toEqual([
        "Short",
        "Long",
        "Bracketed short",
        "Bracketed long",
      ]);
      expect(headers.every((header) => header.classList.includes("cell"))).toBe(true);
    });

    it("omits unnamed cell markers, including markers with only a cell type", async () => {
      const headers = await scan(
        [
          "# %%",
          "# %%   ",
          "# %% md",
          "# %% markdown",
          "# %% [md]",
          "# %% [markdown]",
          "# %% Named",
        ].join("\n"),
      );

      expect(headers.map((header) => header.text)).toEqual(["Named"]);
    });

    it("preserves legacy Python headers and cell markers", async () => {
      const headers = await scan(
        "#$# Legacy top\n#%%$# Legacy cell peer\n#%%$$# Legacy cell child",
      );

      expect(headers.length).toBe(2);
      expect(headers[0].text).toBe("Legacy top");
      expect(headers[0].level).toBe(1);
      expect(headers[0].classList).toEqual([]);
      expect(headers[1].text).toBe("Legacy cell peer");
      expect(headers[1].level).toBe(1);
      expect(headers[1].classList).toEqual(["cell"]);
      expect(headers[1].children[0].text).toBe("Legacy cell child");
      expect(headers[1].children[0].level).toBe(2);
      expect(headers[1].children[0].classList).toEqual(["cell"]);
    });

    // The IPython grammar is a dialect of python with its own scope, so it has
    // to be mapped to the python scanner explicitly — scanner lookup is an
    // exact scope match, not a selector.
    it("scans editors using the IPython grammar", async () => {
      const { getTextEditorHeaders } = require("../lib/editor-adapter");
      await lumine.packages.activatePackage("language-ipython");
      const grammar = lumine.grammars.grammarForScopeName("source.python.ipy");
      expect(grammar).toBeTruthy();

      const editor = await lumine.workspace.open();
      editor.setGrammar(grammar);
      editor.setText(
        [
          "%matplotlib inline",
          "#$# Setup",
          "import numpy",
          "#$$# Load",
          "!pip install pandas",
        ].join("\n"),
      );

      const headers = getTextEditorHeaders(editor);
      expect(headers.length).toBe(1);
      expect(headers[0].text).toBe("Setup");
      expect(headers[0].children.map((header) => header.text)).toEqual(["Load"]);
    });

    it("returns no headers when the python scanner is disabled", async () => {
      const { getTextEditorHeaders } = require("../lib/editor-adapter");
      await lumine.packages.activatePackage("language-ipython");
      lumine.config.set("navigation-panel.scanners.python", false);

      const editor = await lumine.workspace.open();
      editor.setGrammar(lumine.grammars.grammarForScopeName("source.python.ipy"));
      editor.setText("#$# Setup");

      expect(getTextEditorHeaders(editor)).toBeNull();
    });
  });

  describe("provided navigation-panel service", () => {
    it("exposes the outline reading API and notifies on updates", async () => {
      const service = mainModule.provideNavigationHeaders();
      expect(typeof service.getEditor).toBe("function");
      expect(typeof service.getFlattenHeaders).toBe("function");
      expect(typeof service.onDidUpdateHeaders).toBe("function");
      expect(typeof service.observeHeaders).toBe("function");

      const updates = [];
      const subscription = service.onDidUpdateHeaders((editor, headers) => {
        updates.push({ editor, headers });
      });

      const { fakeItem, adapter } = createFakeAdapterSetup();
      const adapterDisposable = mainModule.consumeNavigationAdapter(adapter);
      const pane = lumine.workspace.getCenter().getActivePane();
      pane.addItem(fakeItem);
      pane.activateItem(fakeItem);

      await pollUntil(() => updates.length > 0);
      expect(service.getEditor()).toBe(fakeItem);

      const flat = service.getFlattenHeaders();
      expect(flat.map((header) => header.text)).toEqual([
        "Chapter One",
        "Section A",
        "Chapter Two",
      ]);

      subscription.dispose();
      adapterDisposable.dispose();
    });
  });

  describe("list auto-scroll", () => {
    const { NavigationTree } = require("../lib/navi-tree");
    let tree;

    afterEach(() => {
      if (tree) {
        tree.destroy();
        tree = null;
      }
    });

    // Updates arrive faster than the animation runs: an adapter that reports the
    // viewport asynchronously can put a stale header on screen for one update and
    // the right one on the next. The second request finds its target already in
    // view and asks for no movement, so it has to stop the animation the stale
    // one started — otherwise the list keeps travelling to the stale header and
    // settles there, which is exactly what the pdf outline did.
    it("stops an in-flight animation when the next target is already in view", () => {
      tree = new NavigationTree();
      tree.refs.navigationScroller = { clientHeight: 100, scrollTop: 0 };

      tree.scrollToElement({ offsetTop: 500 });
      expect(tree.scrollAnimationID).not.toBeNull();

      tree.scrollToElement({ offsetTop: 40 });
      expect(tree.scrollAnimationID).toBeNull();
      expect(tree.pendingScroll).toBe(0);
    });
  });

  describe("panel reopening", () => {
    async function closeAndReopenPanel() {
      const firstTree = mainModule.navigationTree;
      mainModule.toggleFocus();
      await pollUntil(() => lumine.workspace.paneForItem(firstTree));
      await pollUntil(() => document.activeElement === firstTree.refs.navigationScroller);
      expect(firstTree.refs.searchEditor.element.contains(document.activeElement)).toBe(false);
      await lumine.workspace.paneForItem(firstTree).destroyItem(firstTree);
      expect(mainModule.navigationTree).toBeNull();

      mainModule.toggleFocus();
      expect(mainModule.navigationTree).not.toBe(firstTree);
      await pollUntil(() => lumine.workspace.paneForItem(mainModule.navigationTree));
      await pollUntil(
        () => document.activeElement === mainModule.navigationTree.refs.navigationScroller,
      );
      return mainModule.navigationTree;
    }

    function clickSearch(tree) {
      const searchElement = tree.refs.searchEditor.element;
      searchElement.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
      );
      expect(searchElement.contains(document.activeElement)).toBe(true);
    }

    it("focuses search by mouse for an unsupported grammar", async () => {
      const tree = await closeAndReopenPanel();
      expect(tree.element.textContent).toContain("This grammar is not supported");

      clickSearch(tree);
    });

    it("focuses search by mouse when a query has no results", async () => {
      const tree = await closeAndReopenPanel();
      tree.searchQuery = "missing";
      tree.update(
        [
          {
            text: "Chapter",
            level: 1,
            classList: [],
            startPoint: { row: 0, column: 0 },
            children: [],
          },
        ],
        { instant: true },
      );
      await pollUntil(() => tree.element.textContent.includes("No results"));
      tree.focusHeaderList();

      clickSearch(tree);
    });
  });
});
