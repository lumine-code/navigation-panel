const path = require("path");

const packageRoot = path.join(__dirname, "..");

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

describe("header navigation", () => {
  let main, editor, tree;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    main = (await lumine.packages.activatePackage(packageRoot)).mainModule;
    const grammarPackage = await lumine.packages.activatePackage("language-javascript");
    await grammarPackage.resourceLoadPromise;
    editor = await lumine.workspace.open();
    editor.setGrammar(lumine.grammars.grammarForScopeName("source.js"));
    editor.setText(
      [
        "//$// First",
        "//$$// First child",
        ...Array(38).fill(""),
        "//$// Second",
        "//$$// Second child",
      ].join("\n"),
    );
    editor.setCursorBufferPosition([0, 0]);
    await editor.getBuffer().getLanguageMode().ready;
    await pollUntil(() => main.editor === editor && main.headers?.length === 2);
    main.open();
    tree = main.navigationTree;
    await pollUntil(
      () =>
        lumine.workspace.paneForItem(tree) &&
        tree.element.querySelectorAll(".navigation-block").length === 4,
    );
    await pollUntil(() => document.activeElement === tree.refs.navigationScroller);
    await pollUntil(
      () => tree.element.querySelector(".navigation-block.current")?.textContent.trim() === "First",
    );
  });

  for (const route of ["Enter", "left click"]) {
    for (const tracing of ["changed viewport", "unchanged viewport", "disabled"]) {
      it(`updates the active header after ${route} with tracing ${tracing}`, async () => {
        const observer = main.builtinEditorAdapter.activeObserver;
        const viewport = spyOn(editor, "getVisibleRowRange").and.returnValue(
          tracing === "changed viewport" ? [0, 10] : [0, 50],
        );
        const scrollTop = spyOn(observer.editorView, "getScrollTop").and.returnValue(0);
        if (tracing === "disabled") {
          lumine.config.set("navigation-panel.panel.traceVisible", false);
        } else {
          observer.handleVisibleChange();
        }
        const navigate = spyOn(main.builtinEditorAdapter, "navigateTo").and.callThrough();
        const publish = spyOn(main, "updateAdapterHeaders").and.callThrough();
        tree.focusHeaderList();
        if (tracing === "changed viewport") {
          viewport.and.returnValue([40, 50]);
          scrollTop.and.returnValue(1000);
        }

        if (route === "Enter") {
          const target = tree.refs.navigationScroller;
          for (let index = 0; index < 3; index++) {
            lumine.commands.dispatch(target, "navigation-panel:select-next-header");
          }
          lumine.commands.dispatch(target, "navigation-panel:select-previous-header");
          lumine.commands.dispatch(target, "navigation-panel:select-next-header");
          lumine.commands.dispatch(target, "navigation-panel:open-selected-header");
        } else {
          tree.element.querySelectorAll(".navigation-text")[3].click();
        }
        expect(navigate.calls.count()).toBe(1);
        await navigate.calls.mostRecent().returnValue;

        expect(editor.getCursorBufferPosition()).toEqual([41, 0]);
        expect(lumine.views.getView(editor).contains(document.activeElement)).toBe(true);
        expect(publish.calls.count()).toBe(1);
        expect(publish.calls.mostRecent()?.args[1]?.visibilityChanges).toBeUndefined();
        expect(main.headers[0].currentCount).toBe(0);
        expect(main.headers[0].stackCount).toBe(0);
        expect(main.headers[1].currentCount).toBe(0);
        expect(main.headers[1].stackCount).toBe(1);
        expect(main.headers[1].children[0].currentCount).toBe(1);
        expect(main.headers[1].children[0].stackCount).toBe(1);
        if (tracing === "changed viewport") {
          expect(main.headers[0].children[0].visibility).toBe(0);
          expect(main.headers[1].children[0].visibility).toBe(1);
          expect(observer.lastScrollTop).toBe(1000);
          expect(publish.calls.mostRecent().args[1].scrollDirection).toBe(1000);
        }
        await pollUntil(
          () =>
            tree.element
              .querySelector(".navigation-block.current")
              ?.textContent.includes("Second child"),
          1000,
        );
        expect(tree.element.querySelectorAll(".navigation-block.current").length).toBe(1);
        expect(tree.element.querySelectorAll(".navigation-tree.stack").length).toBe(2);
        if (tracing === "changed viewport") {
          viewport.and.returnValue([0, 10]);
          scrollTop.and.returnValue(950);
          observer.handleVisibleChange();
          expect(publish.calls.mostRecent().args[1].scrollDirection).toBe(-50);
        }
      });
    }
  }
});
