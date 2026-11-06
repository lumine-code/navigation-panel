const path = require("node:path");
const { Disposable } = require("lumine");

describe("adapter outline initialization", () => {
  let main, tree, scroller, leases, items, animate;

  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage(path.resolve(__dirname, ".."))).mainModule;
    tree = main.getNavigationTree();
    attachTree();
    const media = window.matchMedia.bind(window);
    spyOn(window, "matchMedia").and.callFake((query) =>
      query === "(prefers-reduced-motion: reduce)" ? { matches: false } : media(query),
    );
    leases = [];
    items = [];
  });

  function attachTree() {
    tree.visibility = 1;
    jasmine.attachToDOM(tree.element);
    tree.element.style.cssText = "height: 240px; width: 320px;";
    scroller = tree.refs.navigationScroller;
    scroller.style.cssText =
      "position: relative; display: block; flex: none; height: 180px; overflow: auto;";
    animate = spyOn(tree, "animateScrollTo").and.callThrough();
  }

  afterEach(async () => {
    for (const lease of leases) lease.dispose();
    await lumine.packages.deactivatePackage("navigation-panel");
    for (const item of items)
      await lumine.workspace.paneForItem(item)?.destroyItem(item, { force: true });
  });

  function headers(current = -1, nested = false, prefix = "Section") {
    return Array.from({ length: 90 }, (_, index) => ({
      id: `${prefix}-${index}`,
      text: `${prefix} ${index}`,
      level: 1,
      currentCount: !nested && index === current ? 1 : 0,
      stackCount: index === current ? 1 : 0,
      children: nested
        ? [
            {
              id: `${prefix}-${index}-child`,
              text: `${prefix} ${index} child`,
              level: 2,
              stackCount: index === current ? 1 : 0,
              children: [
                {
                  id: `${prefix}-${index}-leaf`,
                  text: `${prefix} ${index} leaf`,
                  level: 3,
                  currentCount: index === current ? 1 : 0,
                  stackCount: index === current ? 1 : 0,
                  children: [],
                },
              ],
            },
          ]
        : [],
    }));
  }

  function attach(initialHeaders, options = {}) {
    const item = {
      element: document.createElement("div"),
      getTitle: () => "Adapter document",
      canCopy: () => false,
    };
    let publish;
    const stopped = jasmine.createSpy("stop observing headers");
    leases.push(
      main.consumeNavigationAdapter({
        handlesItem: (candidate) => candidate === item,
        observeHeaders: (_item, callback) => {
          publish = callback;
          callback(initialHeaders, options);
          return new Disposable(stopped);
        },
        navigateTo() {},
      }),
    );
    items.push(item);
    const pane = lumine.workspace.getCenter().getActivePane();
    pane.addItem(item);
    pane.activateItem(item);
    return { stopped, publish: (next, props) => publish(next, props) };
  }

  async function settle() {
    await new Promise((resolve) => lumine.views.updateDocument(resolve));
    await flushMicrotasks();
    await new Promise(requestAnimationFrame);
    await new Promise((resolve) => lumine.views.updateDocument(resolve));
    await flushMicrotasks();
  }

  function expectCurrentRevealed(text) {
    const current = scroller.querySelector(".navigation-block.current");
    expect(current?.textContent.trim()).toBe(text);
    expect(scroller.scrollTop).toBeGreaterThan(0);
    const top = current.offsetTop - scroller.scrollTop;
    expect(top).toBeGreaterThanOrEqual(scroller.clientHeight * 0.15 - 1);
    expect(top).toBeLessThanOrEqual(scroller.clientHeight * 0.85 + 1);
  }

  it("positions partial outlines immediately until loading ends, then follows later movement smoothly", async () => {
    const source = attach([], { loading: true });
    await settle();
    source.publish(headers());
    await settle();
    source.publish(null, {
      stateChanges: [{ path: [32], currentCount: 1, stackCount: 1 }],
    });
    await settle();
    expectCurrentRevealed("Section 32");
    source.publish(headers(70));
    await settle();
    expectCurrentRevealed("Section 70");
    source.publish(null, { loading: false, stateChanges: [] });
    await settle();
    expect(animate).not.toHaveBeenCalled();

    source.publish(null, {
      stateChanges: [
        { path: [70], currentCount: 0, stackCount: 0 },
        { path: [4], currentCount: 1, stackCount: 1 },
      ],
    });
    expect(animate).toHaveBeenCalled();
  });

  it("reveals a deep current descendant after automatic expansion without animating the first outline", async () => {
    tree.visibility = 2;
    const source = attach(headers(-1, true), { loading: true });
    await settle();
    source.publish(null, {
      loading: false,
      stateChanges: [
        { path: [70], stackCount: 1 },
        { path: [70, 0], stackCount: 1 },
        { path: [70, 0, 0], currentCount: 1, stackCount: 1 },
      ],
    });
    await waitForFrames(() =>
      scroller.querySelector(".navigation-block.current")?.textContent.includes("Section 70 leaf"),
    );
    await settle();
    expectCurrentRevealed("Section 70 leaf");
    expect(animate).not.toHaveBeenCalled();
  });

  it("cancels the previous source's movement and ignores its late publications", async () => {
    const first = attach(headers(70));
    await settle();
    expectCurrentRevealed("Section 70");
    expect(animate).not.toHaveBeenCalled();
    first.publish(null, {
      stateChanges: [
        { path: [70], currentCount: 0, stackCount: 0 },
        { path: [2], currentCount: 1, stackCount: 1 },
      ],
    });
    expect(animate).toHaveBeenCalled();
    animate.calls.reset();

    const second = attach(headers(62, false, "Replacement"), { loading: true });
    first.publish(headers(1));
    second.publish(null, { loading: false, stateChanges: [] });
    await settle();
    expect(first.stopped).toHaveBeenCalledTimes(1);
    expectCurrentRevealed("Replacement 62");
    expect(animate).not.toHaveBeenCalled();
    const top = scroller.scrollTop;
    first.publish(headers(0), { loading: false });
    await settle();
    expectCurrentRevealed("Replacement 62");
    expect(scroller.scrollTop).toBe(top);
    expect(animate).not.toHaveBeenCalled();
  });

  it("positions a recreated panel immediately after receiving a complete synchronous snapshot", async () => {
    await tree.destroy();
    attach(headers(70));
    tree = main.getNavigationTree();
    attachTree();

    await settle();

    expectCurrentRevealed("Section 70");
    expect(animate).not.toHaveBeenCalled();
  });

  it("does not carry an unused navigation-click scroll skip into the next document", async () => {
    attach(headers(70));
    await settle();
    scroller.querySelector(".navigation-block.current .navigation-text").click();
    attach(headers(5, false, "Replacement"));

    await settle();

    expectCurrentRevealed("Replacement 5");
    expect(animate).not.toHaveBeenCalled();
  });
});
