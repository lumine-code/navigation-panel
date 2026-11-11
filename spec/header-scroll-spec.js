const path = require("path");

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function until(condition) {
  const start = performance.now();
  while (performance.now() - start < 15000) {
    if (condition()) return;
    await nextFrame();
  }
  throw new Error("Timed out waiting for the header list");
}

describe("header click at the bottom of an overflowing list", () => {
  let main, editor, tree, controller;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    main = (await lumine.packages.activatePackage(path.join(__dirname, ".."))).mainModule;
    lumine.config.set("navigation-panel.panel.textWrap", false);
    const grammar = await lumine.packages.activatePackage("language-javascript");
    await grammar.resourceLoadPromise;
    editor = await lumine.workspace.open();
    editor.setGrammar(lumine.grammars.grammarForScopeName("source.js"));
    editor.setText(
      Array.from(
        { length: 80 },
        (_, index) => `//$// Section ${index}: ${"long header ".repeat(12)}`,
      ).join("\n"),
    );
    await editor.getBuffer().getLanguageMode().ready;
    main.open();
    tree = main.navigationTree;
    if (tree.textWrap) {
      lumine.commands.dispatch(tree.element, "navigation-panel:text-wrap-toggle");
    }
    tree.element.style.cssText = "width:280px;height:240px;max-height:240px";
    await until(() => tree.element.querySelectorAll(".navigation-text").length === 80);
    await until(() => document.activeElement === tree.refs.navigationScroller);
    await until(() => !tree.initializing);
    controller = lumine.scrollbars.attach(tree.refs.navigationScroller, {
      kind: "panel",
      layout: "overlay",
      policy: "always",
    });
  });

  afterEach(async () => {
    controller?.dispose();
    await lumine.packages.deactivatePackage("navigation-panel");
  });

  it("keeps the end space and scroll position through every frame after navigation", async () => {
    const scroller = tree.refs.navigationScroller;
    await until(
      () =>
        controller.publicGeometry?.scrollEndInset > 0 &&
        controller.publicGeometry.scrollHeight === scroller.scrollHeight &&
        !controller.manager.pending &&
        !controller.manager.writeRequest &&
        controller.manager.dirty.size === 0,
    );
    expect(controller.publicGeometry?.canScrollHorizontally).toBeTrue();
    expect(controller.publicGeometry?.canScrollVertically).toBeTrue();
    expect(controller.publicGeometry?.scrollEndInset).toBeGreaterThan(0);
    scroller.scrollTop = scroller.scrollHeight;
    scroller.scrollLeft = 60;
    for (let frame = 0; frame < 4; frame++) await nextFrame();
    const endOffset = scroller.scrollTop;
    const horizontalOffset = scroller.scrollLeft;
    const lastHeader = tree.element.querySelectorAll(".navigation-text")[79];
    lastHeader.click();

    for (let frame = 0; frame < 16; frame++) {
      await nextFrame();
      expect(scroller.scrollTop).withContext(`vertical position in frame ${frame}`).toBe(endOffset);
      expect(scroller.scrollLeft)
        .withContext(`horizontal position in frame ${frame}`)
        .toBe(horizontalOffset);
      expect(lastHeader.getBoundingClientRect().bottom)
        .withContext(`last header above horizontal rail in frame ${frame}`)
        .toBeLessThanOrEqual(controller.horizontal.element.getBoundingClientRect().top + 0.5);
    }
    expect(editor.getCursorBufferPosition().row).toBe(79);
    expect(lumine.views.getView(editor).contains(document.activeElement)).toBeTrue();
  });
});
