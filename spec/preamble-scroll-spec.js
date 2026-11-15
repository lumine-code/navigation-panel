const path = require("node:path");

describe("editor outline tracking before the first header", () => {
  let editor, observer, publish, viewport, scrollTop, tracing;

  beforeEach(async () => {
    await lumine.packages.activatePackage(path.resolve(__dirname, ".."));
    const grammar = await lumine.packages.activatePackage("language-javascript");
    await grammar.resourceLoadPromise;
    editor = lumine.workspace.buildTextEditor();
    editor.setGrammar(lumine.grammars.grammarForScopeName("source.js"));
    editor.setText([...Array(200).fill(""), "//$// First", "//$// Second"].join("\n"));
    editor.setCursorBufferPosition([0, 0], { autoscroll: false });
    await editor.getBuffer().getLanguageMode().ready;
    viewport = spyOn(editor, "getVisibleRowRange").and.returnValue([0, 10]);
    scrollTop = spyOn(lumine.views.getView(editor), "getScrollTop").and.returnValue(0);
    tracing = true;
    publish = jasmine.createSpy("headers");
    const { EditorHeaderObserver } = require("../lib/editor-adapter");
    observer = new EditorHeaderObserver(editor, publish, { traceVisible: () => tracing });
    await conditionPromise(() => observer.headers?.length === 2);
    publish.calls.reset();
  });

  afterEach(async () => {
    observer?.destroy();
    editor?.destroy();
    await lumine.packages.deactivatePackage("navigation-panel");
  });

  it("keeps publishing the start boundary while scrolling with no visible-state changes", () => {
    expect(observer.scrollBoundary).toBe("start");
    observer.handleVisibleChange();
    viewport.and.returnValue([30, 40]);
    scrollTop.and.returnValue(600);
    observer.handleVisibleChange();

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.calls.mostRecent().args[1]).toEqual({
      scrollBoundary: "start",
      scrollDirection: 600,
      visibilityChanges: [],
    });
    expect(observer.headers.every((header) => header.visibility === 0)).toBeTrue();
  });

  it("retains the viewport boundary when the cursor belongs to a later header", async () => {
    editor.setCursorBufferPosition([201, 0], { autoscroll: false });
    await flushMicrotasks();

    expect(publish.calls.mostRecent().args[1].scrollBoundary).toBe("start");
    expect(observer.headers[1].currentCount).toBe(1);
    expect(observer.headers[1].visibility).toBe(0);
  });

  it("clears the boundary as soon as the first header enters the viewport", () => {
    viewport.and.returnValue([190, 200]);
    observer.handleVisibleChange();

    expect(publish.calls.mostRecent().args[1].scrollBoundary).toBeNull();
    expect(observer.headers[0].visibility).toBe(1);

    viewport.and.returnValue([80, 90]);
    observer.handleVisibleChange();
    expect(publish.calls.mostRecent().args[1].scrollBoundary).toBe("start");
  });

  it("does not infer a start boundary from an empty outline", async () => {
    editor.setText("Plain text\nwithout headings");
    await observer.update({ instant: true });

    expect(observer.headers).toEqual([]);
    expect(publish.calls.mostRecent().args[1].scrollBoundary).toBeNull();
  });

  it("does no viewport tracking when tracing is disabled", () => {
    tracing = false;
    viewport.calls.reset();
    expect(observer.handleVisibleChange()).toBeFalse();
    expect(viewport).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    observer.emit();
    expect(publish.calls.mostRecent().args[1].scrollBoundary).toBeNull();
  });

  it("clears the panel's viewport boundary when tracing is disabled", async () => {
    observer.destroy();
    const main = lumine.packages.getActivePackage("navigation-panel").mainModule;
    const tree = main.getNavigationTree();
    main.adapterSubscribe(main.builtinEditorAdapter, editor);
    await conditionPromise(() => main.headers?.length === 2);
    main.updateAdapterHeaders(null, { scrollBoundary: "start", stateChanges: [] });
    expect(tree.scrollBoundary).toBe("start");

    lumine.config.set("navigation-panel.panel.traceVisible", false);

    expect(main.scrollBoundary).toBeNull();
    expect(tree.scrollBoundary).toBeNull();
  });
});
