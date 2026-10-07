const path = require("path");

const packageRoot = path.join(__dirname, "..");

describe("navigation-panel with split editors sharing a buffer", () => {
  let main, tree, leftPane, rightPane, leftEditor, rightEditor;

  function headerTexts(selector) {
    return Array.from(tree.element.querySelectorAll(selector)).map((element) =>
      element.querySelector(".navigation-text").textContent.trim(),
    );
  }

  async function expectPanelFor(editor, section) {
    const child = `${section} child`;
    await waitForFrames(
      () =>
        main.editor === editor &&
        main.headers?.length === 2 &&
        headerTexts(".navigation-block.current").join() === child &&
        headerTexts(".navigation-block.visible").join() === `${section},${child}`,
      { description: `outline tracing ${section} in the active split` },
    );
    expect(main.builtinEditorAdapter.activeObserver.editor).toBe(editor);
    expect(headerTexts(".navigation-block.current")).toEqual([child]);
    expect(headerTexts(".navigation-block.visible")).toEqual([section, child]);
  }

  beforeEach(async () => {
    const workspaceElement = lumine.views.getView(lumine.workspace);
    workspaceElement.style.width = "800px";
    workspaceElement.style.height = "400px";
    jasmine.attachToDOM(workspaceElement);
    lumine.config.set("navigation-panel.panel.traceVisible", true);
    lumine.config.set("navigation-panel.panel.visibility", 1);
    main = (await lumine.packages.activatePackage(packageRoot)).mainModule;
    const grammarPackage = await lumine.packages.activatePackage("language-javascript");
    await grammarPackage.resourceLoadPromise;
    leftEditor = await lumine.workspace.open();
    leftEditor.setGrammar(lumine.grammars.grammarForScopeName("source.js"));
    leftEditor.setText(
      [
        "//$// First",
        "//$$// First child",
        ...Array(38).fill(""),
        "//$// Second",
        "//$$// Second child",
        ...Array(38).fill(""),
      ].join("\n"),
    );
    leftEditor.setCursorBufferPosition([1, 0]);
    spyOn(leftEditor, "getVisibleRowRange").and.returnValue([0, 10]);
    await leftEditor.getBuffer().getLanguageMode().ready;
    await waitForFrames(() => main.editor === leftEditor && main.headers?.length === 2);

    leftPane = lumine.workspace.paneForItem(leftEditor);
    rightPane = leftPane.splitRight({ copyActiveItem: true });
    rightEditor = rightPane.getActiveItem();
    expect(rightEditor).not.toBe(leftEditor);
    expect(rightEditor.getBuffer()).toBe(leftEditor.getBuffer());
    rightEditor.setCursorBufferPosition([41, 0]);
    spyOn(rightEditor, "getVisibleRowRange").and.returnValue([40, 50]);
    main.open();
    tree = main.navigationTree;
    await expectPanelFor(rightEditor, "Second");
  });

  afterEach(() => {
    lumine.config.unset("navigation-panel.panel.traceVisible");
    lumine.config.unset("navigation-panel.panel.visibility");
  });

  it("follows each split's cursor and viewport when focus moves left, right and left", async () => {
    for (const [pane, editor, section] of [
      [leftPane, leftEditor, "First"],
      [rightPane, rightEditor, "Second"],
      [leftPane, leftEditor, "First"],
    ]) {
      pane.activate();
      await expectPanelFor(editor, section);
      expect(lumine.views.getView(editor).contains(document.activeElement)).toBe(true);
    }
  });

  it("replaces visibility from a scrolled split when the next viewport matches the previous render", async () => {
    leftEditor.setCursorBufferPosition([41, 0]);
    leftEditor.getVisibleRowRange.and.returnValue([40, 50]);
    rightEditor.getVisibleRowRange.and.returnValue([0, 10]);
    main.builtinEditorAdapter.activeObserver.handleVisibleChange();
    await waitForFrames(
      () => headerTexts(".navigation-block.visible").join() === "First,First child",
      { description: "viewport-only tracing in the outgoing split" },
    );
    expect(headerTexts(".navigation-block.current")).toEqual(["Second child"]);

    const scrollToElement = spyOn(tree, "scrollToElement").and.callThrough();
    leftPane.activate();
    await waitForFrames(
      () =>
        main.editor === leftEditor &&
        main.headers?.[0].children[0].visibility === 0 &&
        main.headers?.[1].children[0].visibility === 1,
      { description: "the incoming split's headers and viewport" },
    );
    await waitForFrames(() => true);
    expect(main.builtinEditorAdapter.activeObserver.editor).toBe(leftEditor);
    expect(headerTexts(".navigation-block.current")).toEqual(["Second child"]);
    expect(headerTexts(".navigation-block.visible")).toEqual(["Second", "Second child"]);
    expect(scrollToElement).toHaveBeenCalled();
    expect(
      scrollToElement.calls
        .mostRecent()
        .args[0].querySelector(".navigation-text")
        .textContent.trim(),
    ).toBe("Second");
  });

  it("preserves viewport tracing when a cursor change redraws the same split", async () => {
    rightEditor.getVisibleRowRange.and.returnValue([0, 10]);
    main.builtinEditorAdapter.activeObserver.handleVisibleChange();
    await waitForFrames(
      () => headerTexts(".navigation-block.visible").join() === "First,First child",
      { description: "viewport tracing before the cursor change" },
    );
    const publish = spyOn(main, "updateAdapterHeaders").and.callThrough();

    rightEditor.setCursorBufferPosition([0, 0]);
    await waitForFrames(() => headerTexts(".navigation-block.current").join() === "First", {
      description: "the current header after the cursor change",
    });

    expect(publish).toHaveBeenCalled();
    expect(publish.calls.mostRecent().args[1]?.visibilityChanges).toBeUndefined();
    expect(headerTexts(".navigation-block.visible")).toEqual(["First", "First child"]);
  });

  it("retargets navigation actions to the active editor in the shared buffer", async () => {
    const navigate = spyOn(main.builtinEditorAdapter, "navigateTo").and.callThrough();
    for (const [pane, editor, section, inactiveEditor] of [
      [leftPane, leftEditor, "First", rightEditor],
      [rightPane, rightEditor, "Second", leftEditor],
      [leftPane, leftEditor, "First", rightEditor],
    ]) {
      pane.activate();
      await expectPanelFor(editor, section);
      const inactivePosition = inactiveEditor.getCursorBufferPosition();
      await main.headers[0].navigate({ focus: false });
      expect(navigate.calls.mostRecent().args[0]).toBe(editor);
      expect(editor.getCursorBufferPosition()).toEqual([0, 0]);
      expect(inactiveEditor.getCursorBufferPosition()).toEqual(inactivePosition);
      editor.setCursorBufferPosition([section === "First" ? 1 : 41, 0]);
      await expectPanelFor(editor, section);
    }
  });

  it("keeps the final split active after rapid switches and ignores inactive editor events", async () => {
    for (const pane of [leftPane, rightPane, leftPane, rightPane, leftPane, rightPane]) {
      pane.activate();
    }
    await expectPanelFor(rightEditor, "Second");
    const publish = spyOn(main, "updateAdapterHeaders").and.callThrough();
    leftEditor.setCursorBufferPosition([0, 0]);
    leftEditor.getVisibleRowRange.and.returnValue([60, 70]);
    lumine.views.getView(leftEditor).setScrollTop(300);
    advanceClock(100);
    await flushMicrotasks();
    await expectPanelFor(rightEditor, "Second");
    expect(publish).not.toHaveBeenCalled();
    expect(main.editor).toBe(rightEditor);
    expect(main.headers[1].children[0].currentCount).toBe(1);
    expect(main.headers[0].children[0].currentCount).toBe(0);
  });
});
