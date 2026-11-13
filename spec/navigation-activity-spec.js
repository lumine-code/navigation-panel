const path = require("node:path");

describe("Navigation Panel command activity", () => {
  let tree, controller, headers, reveal;

  beforeEach(async () => {
    const main = (await lumine.packages.activatePackage(path.join(__dirname, ".."))).mainModule;
    tree = main.getNavigationTree();
    tree.element.style.cssText = "position:absolute;left:20px;top:20px;width:280px;height:240px";
    tree.refs.navigationScroller.style.cssText = "height:180px;flex:none;overflow:auto";
    jasmine.attachToDOM(tree.element);
    headers = Array.from({ length: 30 }, (_, index) => ({
      id: `activity-${index}`,
      text: `Section ${index}`,
      level: 1,
      classList: [],
      startPoint: { row: index, column: 0 },
      children: [],
    }));
    await tree.update(headers, { instant: true });
    controller = lumine.scrollbars.attach(tree.refs.navigationScroller, {
      kind: "panel",
      layout: "overlay",
      policy: "hover",
    });
    await globalThis.waitForFrames(
      () =>
        controller.publicGeometry?.layout === "overlay" &&
        controller.publicGeometry.canScrollVertically &&
        controller.activity &&
        !controller.manager.pending &&
        !controller.manager.writeRequest &&
        !controller.manager.dirty.size,
      { description: "Navigation Panel transient overlay" },
    );
    controller.activity.clear();
    reveal = spyOn(lumine.scrollbars, "reveal").and.callThrough();
  });

  afterEach(async () => {
    const element = tree?.element;
    controller?.dispose();
    await lumine.packages.deactivatePackage("navigation-panel");
    element?.remove();
  });

  function selectVisibleLeaf() {
    const blocks = tree.getSelectableHeaderBlocks();
    tree.navigationSelectionActive = true;
    tree.setSelectedHeaderBlock(blocks[1]);
    return blocks;
  }

  it("reveals its overlay when the next selected row is already visible", () => {
    const blocks = selectVisibleLeaf();
    const scroller = tree.refs.navigationScroller;
    const before = scroller.scrollTop;
    const bounds = scroller.getBoundingClientRect();
    const target = blocks[2].getBoundingClientRect();
    expect(target.top).toBeGreaterThanOrEqual(bounds.top);
    expect(target.bottom).toBeLessThanOrEqual(bounds.bottom);
    expect(controller.activity.active).toBeFalse();
    lumine.commands.dispatch(scroller, "navigation-panel:select-next-header");
    expect(tree.getVisibleSelectedHeaderBlock()).toBe(blocks[2]);
    expect(scroller.scrollTop).toBe(before);
    expect(reveal).toHaveBeenCalledOnceWith(scroller);
    expect(controller.activity.active).toBeTrue();
  });

  for (const direction of ["collapse", "expand"]) {
    it(`reveals a handled ${direction} command on a leaf with no scroll or tree change`, () => {
      const blocks = selectVisibleLeaf();
      const scroller = tree.refs.navigationScroller;
      const before = scroller.scrollTop;
      lumine.commands.dispatch(scroller, `navigation-panel:${direction}-selected-header`);
      expect(tree.getSelectableHeaderBlocks()).toEqual(blocks);
      expect(scroller.scrollTop).toBe(before);
      expect(reveal).toHaveBeenCalledOnceWith(scroller);
      expect(controller.activity.active).toBeTrue();
    });
  }

  for (const [command, method] of [
    ["open-selected-header", "openSelectedHeader"],
    ["open-selected-header-clear-search", "openSelectedHeader"],
    ["open-selected-header-add-cursor", "openSelectedHeader"],
    ["toggle-selected-prog", "toggleSelectedProg"],
    ["toggle-search-focus", "toggleSearchFocus"],
    ["clear", "clearQuery"],
  ]) {
    it(`reports handled ${command} through its command boundary`, () => {
      const handler = spyOn(tree, method);
      lumine.commands.dispatch(tree.refs.navigationScroller, `navigation-panel:${command}`);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(reveal).toHaveBeenCalledOnceWith(tree.refs.navigationScroller);
      expect(controller.activity.active).toBeTrue();
    });
  }

  it("does not turn ordinary search typing or a non-navigation command into activity", async () => {
    tree.focusSearch();
    tree.refs.searchEditor.setText("Section");
    tree.refs.searchEditor.element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", bubbles: true }),
    );
    lumine.commands.dispatch(tree.element, "navigation-panel:search-bar-toggle");
    await tree.update(headers);
    expect(reveal).not.toHaveBeenCalled();
    expect(controller.activity.active).toBeFalse();
  });

  it("keeps automatic header tracking and selection restoration quiet", () => {
    const blocks = tree.getSelectableHeaderBlocks();
    blocks[2].classList.add("current");
    const before = tree.refs.navigationScroller.scrollTop;
    tree.scrollToCurrent();
    tree.restoreSelectedHeaderAtIndex();
    expect(tree.refs.navigationScroller.scrollTop).toBe(before);
    expect(reveal).not.toHaveBeenCalled();
    expect(controller.activity.active).toBeFalse();
  });

  it("ignores an unmatched navigation command outside the panel", () => {
    lumine.commands.dispatch(document.body, "navigation-panel:select-next-header");
    expect(reveal).not.toHaveBeenCalled();
    expect(controller.activity.active).toBeFalse();
  });
});
