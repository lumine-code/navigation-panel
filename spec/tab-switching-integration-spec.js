const path = require("node:path");

describe("cached text editor navigation across tabs", () => {
  let main, tree, first, second, grammar;

  async function setSource(editor, text, row) {
    const stopped = new Promise((resolve) => {
      const observation = editor.onDidStopChanging(() => {
        observation.dispose();
        resolve();
      });
    });
    editor.setText(text);
    editor.setCursorBufferPosition([row, 0], { autoscroll: false });
    await editor.getBuffer().getLanguageMode().ready;
    await stopped;
  }

  function source(prefix) {
    return [
      `//$// ${prefix} first`,
      `//$$// ${prefix} first child`,
      ...Array(38).fill("// body"),
      `//$// ${prefix} second`,
      `//$$// ${prefix} second child`,
      ...Array(10).fill("// body"),
    ].join("\n");
  }

  async function waitForItem(editor) {
    await conditionPromise(
      () =>
        main.editor === editor &&
        main.headers?.length === 2 &&
        !main.builtinEditorAdapter.activeObserver?.isUpdating &&
        !tree.initializing &&
        tree.element.querySelectorAll(".navigation-block").length === 4,
      "settled tab outline",
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await flushMicrotasks();
  }

  async function activate(editor) {
    const pane = lumine.workspace.paneForItem(editor);
    pane.activateItem(editor);
    pane.activate();
    await waitForItem(editor);
  }

  function work() {
    const { ScannerAbstract } = require("../lib/scanner-abstract");
    return {
      scan: spyOn(ScannerAbstract.prototype, "getHeaders").and.callThrough(),
      build: spyOn(main.adapterManager, "buildHeaders").and.callThrough(),
      render: spyOn(tree, "update").and.callThrough(),
      filter: spyOn(tree, "filter").and.callThrough(),
    };
  }

  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    lumine.config.set("navigation-panel.panel.visibility", 1);
    main = (await lumine.packages.activatePackage(path.resolve(__dirname, ".."))).mainModule;
    const grammarPackage = await lumine.packages.activatePackage("language-javascript");
    await grammarPackage.resourceLoadPromise;
    grammar = lumine.grammars.grammarForScopeName("source.js");
    first = await lumine.workspace.open();
    first.setGrammar(grammar);
    spyOn(first, "getVisibleRowRange").and.returnValue([0, 10]);
    await setSource(first, source("A"), 1);
    main.open();
    tree = main.navigationTree;
    await waitForItem(first);
    second = await lumine.workspace.open();
    second.setGrammar(grammar);
    spyOn(second, "getVisibleRowRange").and.returnValue([40, 50]);
    await setSource(second, source("B"), 41);
    await waitForItem(second);
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("navigation-panel");
    first?.destroy();
    second?.destroy();
  });

  it("returns to unchanged tabs without rescanning and reconciles live cursor and viewport state", async () => {
    const calls = work();
    first.setCursorBufferPosition([41, 0], { autoscroll: false });
    first.getVisibleRowRange.and.returnValue([40, 50]);
    for (const editor of [first, second, first]) await activate(editor);

    expect(calls.scan).not.toHaveBeenCalled();
    expect(calls.build).toHaveBeenCalledTimes(3);
    expect(calls.render).toHaveBeenCalledTimes(3);
    expect(main.headers[0].text).toBe("A first");
    expect(main.headers[0].children[0].currentCount).toBe(0);
    expect(main.headers[1].children[0].currentCount).toBe(1);
    expect(main.headers[1].children[0].visibility).toBe(1);
    expect(tree.element.querySelector(".navigation-block.current").textContent).toContain(
      "A second child",
    );
  });

  it("keeps an already active observation when asked to subscribe to that item again", async () => {
    const calls = work();
    const observer = main.builtinEditorAdapter.activeObserver;
    const headers = main.headers;
    const rows = [...tree.element.querySelectorAll(".navigation-block")];
    for (let index = 0; index < 3; index++) main.subscribeToItem(second);
    await flushMicrotasks();

    expect(main.builtinEditorAdapter.activeObserver).toBe(observer);
    expect(main.headers).toBe(headers);
    expect([...tree.element.querySelectorAll(".navigation-block")]).toEqual(rows);
    for (const spy of Object.values(calls)) expect(spy).not.toHaveBeenCalled();
  });

  it("reuses shared-buffer rows and retargets retained navigation callbacks to the focused split", async () => {
    await activate(first);
    const pane = lumine.workspace.paneForItem(first);
    const copied = await lumine.workspace.copyPaneItem(first, {
      sourcePane: pane,
      splitDirection: "right",
    });
    const split = copied.pane.getActiveItem();
    spyOn(split, "getVisibleRowRange").and.returnValue([40, 50]);
    split.setCursorBufferPosition([41, 0], { autoscroll: false });
    await waitForItem(split);
    const calls = work();
    const headers = main.headers;
    const retainedNavigate = headers[0].navigate;
    const rows = [...tree.element.querySelectorAll(".navigation-block")];
    const publications = [];
    const observation = main.onDidUpdateHeaders((editor) => publications.push(editor));
    try {
      for (const editor of [first, split, first]) {
        await activate(editor);
        expect(main.headers).toBe(headers);
        expect(main.headers[0].editor).toBe(editor);
        expect([...tree.element.querySelectorAll(".navigation-block")]).toEqual(rows);
      }
      for (const spy of Object.values(calls)) expect(spy).not.toHaveBeenCalled();
      expect(publications).toEqual([first, split, first]);
      const inactivePosition = split.getCursorBufferPosition();
      await retainedNavigate({ focus: false });
      expect(first.getCursorBufferPosition()).toEqual([0, 0]);
      expect(split.getCursorBufferPosition()).toEqual(inactivePosition);
    } finally {
      observation.dispose();
      split.destroy();
    }
  });

  it("rescans an inactive document after its source changes", async () => {
    await setSource(first, source("Edited A"), 1);
    const calls = work();
    await activate(first);
    expect(calls.scan).toHaveBeenCalledTimes(1);
    expect(calls.build).toHaveBeenCalledTimes(1);
    expect(main.headers[0].text).toBe("Edited A first");
    await activate(second);
    await activate(first);
    expect(calls.scan).toHaveBeenCalledTimes(1);
  });

  it("announces a changed split even when its cursor and visible state are identical", async () => {
    await activate(first);
    const pane = lumine.workspace.paneForItem(first);
    const copied = await lumine.workspace.copyPaneItem(first, {
      sourcePane: pane,
      splitDirection: "right",
    });
    const split = copied.pane.getActiveItem();
    spyOn(split, "getVisibleRowRange").and.returnValue([0, 10]);
    await waitForItem(split);
    const calls = work();
    const headers = main.headers;
    const published = jasmine.createSpy("new active split");
    const subscription = main.onDidUpdateHeaders(published);
    try {
      await activate(first);
      expect(published).toHaveBeenCalledOnceWith(first, headers);
      expect(main.headers).toBe(headers);
      expect(main.headers[0].editor).toBe(first);
      for (const spy of Object.values(calls)) expect(spy).not.toHaveBeenCalled();
    } finally {
      subscription.dispose();
      split.destroy();
    }
  });

  it("invalidates inactive cache entries when scanner options change", async () => {
    lumine.config.set("navigation-panel.editor.maxHeadingDepth", 1);
    await conditionPromise(
      () => main.headers?.[0]?.children.length === 0,
      "active outline after changing heading depth",
    );
    const calls = work();
    const pane = lumine.workspace.paneForItem(first);
    pane.activateItem(first);
    pane.activate();
    await conditionPromise(
      () => main.editor === first && main.headers?.[0]?.children.length === 0,
      "inactive outline after changing heading depth",
    );
    expect(calls.scan).toHaveBeenCalledTimes(1);
    expect(main.headers[0].text).toBe("A first");
  });

  it("ignores cancelled observations during rapid tab changes", async () => {
    const calls = work();
    const pane = lumine.workspace.paneForItem(first);
    for (const editor of [first, second, first, second, first]) pane.activateItem(editor);
    await waitForItem(first);
    expect(calls.scan).not.toHaveBeenCalled();
    expect(main.editor).toBe(first);
    expect(main.headers[0].text).toBe("A first");
    expect(main.headers[0].children[0].currentCount).toBe(1);
    expect(main.headers[1].children[0].currentCount).toBe(0);
  });

  it("keeps the final observer when a cached publication switches tabs reentrantly", async () => {
    const calls = work();
    const pane = lumine.workspace.paneForItem(first);
    let stage = 0;
    const subscription = main.onDidUpdateHeaders((editor) => {
      if (stage === 0 && editor === first) {
        stage = 1;
        pane.activateItem(second);
      } else if (stage === 1 && editor === second) {
        stage = 2;
        pane.activateItem(first);
      }
    });
    try {
      await activate(first);
      expect(stage).toBe(2);
      expect(calls.scan).not.toHaveBeenCalled();
      const observer = main.builtinEditorAdapter.activeObserver;
      expect(observer.editor).toBe(first);
      first.setCursorBufferPosition([41, 0], { autoscroll: false });
      await conditionPromise(
        () => main.headers?.[1]?.children[0].currentCount === 1,
        "cursor tracking after a reentrant cached activation",
      );
      expect(main.builtinEditorAdapter.activeObserver).toBe(observer);
      expect(main.headers[0].children[0].currentCount).toBe(0);
      expect(main.headers[1].children[0].currentCount).toBe(1);
    } finally {
      subscription.dispose();
    }
  });
});
