const path = require("node:path");

describe("built-in editor tracking work", () => {
  let main, editor, tree, observer;

  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage(path.resolve(__dirname, ".."))).mainModule;
    const grammar = await lumine.packages.activatePackage("language-javascript");
    await grammar.resourceLoadPromise;
    editor = await lumine.workspace.open();
    editor.setGrammar(lumine.grammars.grammarForScopeName("source.js"));
    const stoppedChanging = new Promise((resolve) => {
      const subscription = editor.onDidStopChanging(() => {
        subscription.dispose();
        resolve();
      });
    });
    editor.setText(
      [
        "//$// First",
        ...Array(9).fill("// First body"),
        "//$$// First child",
        ...Array(29).fill("// Child body"),
        "//$// Second",
        "//$$// Second child",
        ...Array(20).fill("// Second body"),
      ].join("\n"),
    );
    editor.setCursorBufferPosition([0, 0], { autoscroll: false });
    await editor.getBuffer().getLanguageMode().ready;
    await stoppedChanging;
    main.open();
    tree = main.navigationTree;
    tree.visibility = 1;
    await conditionPromise(
      () =>
        main.editor === editor &&
        main.headers?.length === 2 &&
        tree.element.querySelectorAll(".navigation-block").length === 4 &&
        !tree.initializing &&
        !main.builtinEditorAdapter.activeObserver?.isUpdating,
      "initial editor outline",
    );
    observer = main.builtinEditorAdapter.activeObserver;
    await flushMicrotasks();
    observer.updateVisibleItems.cancel();
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("navigation-panel");
    editor?.destroy();
  });

  function watchWork() {
    return {
      headers: main.headers,
      rows: [...tree.element.querySelectorAll(".navigation-block")],
      scan: spyOn(observer.scanner, "getHeaders").and.callThrough(),
      build: spyOn(main.adapterManager, "buildHeaders").and.callThrough(),
      update: spyOn(tree, "update").and.callThrough(),
      filter: spyOn(tree, "filter").and.callThrough(),
      list: spyOn(main.navigationList, "markDirty").and.callThrough(),
      publish: spyOn(main, "updateAdapterHeaders").and.callThrough(),
    };
  }

  function expectStateOnly(work) {
    expect(work.scan).not.toHaveBeenCalled();
    expect(work.build).not.toHaveBeenCalled();
    expect(work.update).not.toHaveBeenCalled();
    expect(work.filter).not.toHaveBeenCalled();
    expect(work.list).not.toHaveBeenCalled();
    expect(main.headers).toBe(work.headers);
    expect([...tree.element.querySelectorAll(".navigation-block")]).toEqual(work.rows);
  }

  it("changes the current section without rescanning, filtering or replacing rows", async () => {
    const work = watchWork();
    editor.setCursorBufferPosition([41, 0], { autoscroll: false });
    await flushMicrotasks();

    expect(work.publish).toHaveBeenCalledTimes(1);
    expect(work.publish.calls.mostRecent().args[1].stateChanges.length).toBeGreaterThan(0);
    expect(main.headers[0].stackCount).toBe(0);
    expect(main.headers[1].stackCount).toBe(1);
    expect(main.headers[1].children[0].currentCount).toBe(1);
    expect(tree.element.querySelector(".navigation-block.current")?.textContent).toContain(
      "Second child",
    );
    expectStateOnly(work);
  });

  it("ignores cursor motion inside a section and a burst returning to the same section", async () => {
    const work = watchWork();
    editor.setCursorBufferPosition([2, 2], { autoscroll: false });
    editor.setCursorBufferPosition([8, 3], { autoscroll: false });
    await flushMicrotasks();
    editor.setCursorBufferPosition([41, 0], { autoscroll: false });
    editor.setCursorBufferPosition([5, 0], { autoscroll: false });
    await flushMicrotasks();

    expect(work.publish).not.toHaveBeenCalled();
    expect(main.headers[0].currentCount).toBe(1);
    expectStateOnly(work);
  });

  it("updates a resized viewport at the same scroll position without rebuilding", async () => {
    const viewport = spyOn(editor, "getVisibleRowRange").and.returnValue([0, 5]);
    const scroll = spyOn(observer.editorView, "getScrollTop").and.returnValue(0);
    observer.handleVisibleChange();
    const work = watchWork();
    viewport.and.returnValue([0, 50]);
    observer.editorView.emitter.emit("did-change-scroll-geometry");
    await conditionPromise(
      () => main.headers[1].children[0].visibility === 1,
      "resized editor visibility",
    );

    expect(scroll()).toBe(0);
    expect(work.publish).toHaveBeenCalledTimes(1);
    expectStateOnly(work);
  });

  it("scrolls with visibility updates and skips repeated unchanged viewport state", async () => {
    const viewport = spyOn(editor, "getVisibleRowRange").and.returnValue([0, 5]);
    const scroll = spyOn(observer.editorView, "getScrollTop").and.returnValue(0);
    observer.handleVisibleChange();
    const work = watchWork();
    const refresh = spyOn(observer, "handleVisibleChange").and.callThrough();
    viewport.and.returnValue([40, 50]);
    scroll.and.returnValue(1000);
    observer.editorView.emitter.emit("did-change-scroll-top");
    await conditionPromise(
      () => main.headers[1].children[0].visibility === 1,
      "scrolled editor visibility",
    );
    expect(work.publish).toHaveBeenCalledTimes(1);
    expect(work.publish.calls.mostRecent().args[1].scrollDirection).toBe(1000);
    expect(work.publish.calls.mostRecent().args[1].visibilityChanges).toBeDefined();

    const refreshCount = refresh.calls.count();
    scroll.and.returnValue(1100);
    observer.editorView.emitter.emit("did-change-scroll-top");
    await conditionPromise(() => refresh.calls.count() > refreshCount, "unchanged viewport check");
    expect(work.publish).toHaveBeenCalledTimes(1);
    expectStateOnly(work);
  });

  it("keeps pending cursor state when scrolling publishes before its microtask", async () => {
    const viewport = spyOn(editor, "getVisibleRowRange").and.returnValue([0, 5]);
    spyOn(observer.editorView, "getScrollTop").and.returnValue(0);
    observer.handleVisibleChange();
    const work = watchWork();
    editor.setCursorBufferPosition([41, 0], { autoscroll: false });
    viewport.and.returnValue([40, 50]);
    observer.handleVisibleChange();
    await flushMicrotasks();

    expect(main.headers[1].children[0].currentCount).toBe(1);
    expect(main.headers[1].children[0].visibility).toBe(1);
    expect(main.headers[0].currentCount).toBe(0);
    expect(main.headers[0].visibility).toBe(0);
    expect(work.publish).toHaveBeenCalledTimes(1);
    expectStateOnly(work);
  });

  it("navigates to a header using one state update with tracing disabled", async () => {
    lumine.config.set("navigation-panel.panel.traceVisible", false);
    const work = watchWork();
    await main.builtinEditorAdapter.navigateTo(editor, main.headers[1].children[0], {
      focus: false,
    });
    await flushMicrotasks();

    expect(editor.getCursorBufferPosition().row).toBe(41);
    expect(main.headers[1].children[0].currentCount).toBe(1);
    expect(work.publish).toHaveBeenCalledTimes(1);
    expectStateOnly(work);
  });

  it("rescans a real source edit and publishes its complete replacement outline", async () => {
    const work = watchWork();
    editor.setText("//$// Replacement\n//$$// Replacement child\n");
    await conditionPromise(
      () => main.headers?.length === 1 && main.headers[0].text === "Replacement",
      "replacement editor outline",
    );

    expect(work.scan).toHaveBeenCalledTimes(1);
    expect(work.build).toHaveBeenCalledTimes(1);
    expect(main.headers).not.toBe(work.headers);
    expect(main.headers[0].children[0].text).toBe("Replacement child");
    expect(work.publish.calls.mostRecent().args[1].stateChanges).toBeUndefined();
  });
});
