const { Disposable } = require("atom");

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
    workspaceElement = atom.views.getView(atom.workspace);
    jasmine.attachToDOM(workspaceElement);
    const pkg = await atom.packages.activatePackage("navigation-panel");
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

  describe("navigation-adapter consumption", () => {
    it("renders outline entries provided by an adapter", async () => {
      const { fakeItem, adapter } = createFakeAdapterSetup();
      mainModule.consumeNavigationAdapter(adapter);

      const pane = atom.workspace.getCenter().getActivePane();
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

      const pane = atom.workspace.getCenter().getActivePane();
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

      const pane = atom.workspace.getCenter().getActivePane();
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
  });

  describe("built-in markdown scanner", () => {
    it("builds a nested header tree from markdown text", async () => {
      const { ScannerMarkdown } = require("../lib/scanner-markdown");
      const editor = await atom.workspace.open();
      editor.setText("# One\n\ntext\n\n## Sub\n\n```\n# not a header\n```\n\n# Two\n");

      const scanner = new ScannerMarkdown(editor);
      const headers = scanner.getHeaders();

      expect(headers.length).toBe(2);
      expect(headers[0].text).toBe("One");
      expect(headers[0].children.length).toBe(1);
      expect(headers[0].children[0].text).toBe("Sub");
      expect(headers[1].text).toBe("Two");
    });
  });

  describe("built-in python scanner", () => {
    // The IPython grammar is a dialect of python with its own scope, so it has
    // to be mapped to the python scanner explicitly — scanner lookup is an
    // exact scope match, not a selector.
    it("scans editors using the IPython grammar", async () => {
      const { getTextEditorHeaders } = require("../lib/editor-adapter");
      await atom.packages.activatePackage("language-python");
      const grammar = atom.grammars.grammarForScopeName("source.python.ipy");
      expect(grammar).toBeTruthy();

      const editor = await atom.workspace.open();
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
      await atom.packages.activatePackage("language-python");
      atom.config.set("navigation-panel.scanners.python", false);

      const editor = await atom.workspace.open();
      editor.setGrammar(atom.grammars.grammarForScopeName("source.python.ipy"));
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
      const pane = atom.workspace.getCenter().getActivePane();
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
});
