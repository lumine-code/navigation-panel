const path = require("node:path");
const { Disposable } = require("lumine");

describe("incremental adapter tracking", () => {
  let main, tree, lease, publish;

  const initialHeaders = () => [
    {
      id: "section-one",
      text: "Section One",
      level: 1,
      stackCount: 1,
      children: [
        {
          id: "detail",
          text: "Detail",
          level: 2,
          currentCount: 1,
          stackCount: 1,
          children: [],
        },
      ],
    },
    { id: "section-two", text: "Section Two", level: 1, children: [] },
  ];

  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage(path.resolve(__dirname, ".."))).mainModule;
    tree = main.getNavigationTree();
    tree.visibility = 1;
    jasmine.attachToDOM(tree.element);
    const item = {
      element: document.createElement("div"),
      getTitle: () => "Document",
      canCopy: () => false,
    };
    const adapter = {
      handlesItem: (candidate) => candidate === item,
      observeHeaders: (_item, callback) => {
        publish = callback;
        callback(initialHeaders(), { instant: true });
        return new Disposable();
      },
      navigateTo() {},
    };
    lease = main.consumeNavigationAdapter(adapter);
    const pane = lumine.workspace.getCenter().getActivePane();
    pane.addItem(item);
    pane.activateItem(item);
    await lumine.views.getNextUpdatePromise();
    await flushMicrotasks();
  });

  afterEach(async () => {
    lease?.dispose();
    await lumine.packages.deactivatePackage("navigation-panel");
  });

  const changes = () => ({
    scrollDirection: 25,
    stateChanges: [
      { path: [0], stackCount: 0 },
      { path: [0, 0], currentCount: 0, stackCount: 0, visibility: 0 },
      { path: [1], currentCount: 1, stackCount: 1, visibility: 1 },
    ],
  });

  function setScrollGeometry(scrollTop = 600) {
    const scroller = tree.refs.navigationScroller;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 2000 },
      scrollTop: { configurable: true, writable: true, value: scrollTop },
    });
    for (const block of scroller.querySelectorAll(".navigation-block")) {
      Object.defineProperty(block, "offsetTop", { configurable: true, value: 500 });
    }
    return scroller;
  }

  function setReducedMotion(matches) {
    const media = window.matchMedia.bind(window);
    spyOn(window, "matchMedia").and.callFake((query) =>
      query === "(prefers-reduced-motion: reduce)" ? { matches } : media(query),
    );
  }

  it("tracks an empty service patch to the exact start ahead of visible and current rows", () => {
    const scroller = setScrollGeometry();
    publish(null, { ...changes(), instant: true });
    expect(scroller.scrollTop).toBeGreaterThan(0);
    scroller.scrollTop = 600;
    const headers = main.headers;
    const blocks = [...scroller.querySelectorAll(".navigation-block")];
    const build = spyOn(main.adapterManager, "buildHeaders");
    const update = spyOn(tree, "update");
    const filter = spyOn(tree, "filter");

    publish(null, {
      instant: true,
      scrollDirection: -25,
      scrollBoundary: "start",
      stateChanges: [],
    });

    expect(scroller.scrollTop).toBe(0);
    expect(tree.scrollDirection).toBe(-25);
    expect(main.headers).toBe(headers);
    expect([...scroller.querySelectorAll(".navigation-block")]).toEqual(blocks);
    expect(build).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(filter).not.toHaveBeenCalled();
  });

  it("preserves the start boundary across state patches until an explicit null clears it", () => {
    const scroller = setScrollGeometry();
    publish(null, { instant: true, scrollBoundary: "start", stateChanges: [] });
    expect(scroller.scrollTop).toBe(0);

    scroller.scrollTop = 600;
    publish(null, { instant: true, stateChanges: [] });
    expect(scroller.scrollTop).toBe(0);

    publish(null, { instant: true, scrollBoundary: null, stateChanges: [] });
    expect(scroller.scrollTop).toBe(415);
  });

  it("defaults an omitted boundary to normal tracking on a full service snapshot", async () => {
    const scroller = setScrollGeometry();
    publish(initialHeaders(), { instant: true, scrollBoundary: "start" });
    await lumine.views.getNextUpdatePromise();
    expect(scroller.scrollTop).toBe(0);

    publish(initialHeaders(), { instant: true });
    await lumine.views.getNextUpdatePromise();
    expect(scroller.scrollTop).toBe(415);
  });

  it("animates later start tracking and cancels it on wheel and pointer input", () => {
    const scroller = setScrollGeometry();
    setReducedMotion(false);
    const animate = spyOn(tree, "animateScrollTo").and.callThrough();

    for (const type of ["wheel", "pointerdown"]) {
      publish(null, { scrollBoundary: "start", stateChanges: [] });
      expect(animate).toHaveBeenCalledWith(0);
      expect(scroller.scrollTop).toBe(600);
      expect(tree.scrollTargetTop).toBe(0);
      expect(tree.scrollAnimationID).not.toBeNull();
      scroller.dispatchEvent(new Event(type));
      expect(tree.scrollAnimationID).toBeNull();
      expect(tree.scrollTargetTop).toBeNull();
    }
  });

  it("positions the start boundary immediately throughout initialization", () => {
    const scroller = setScrollGeometry();
    setReducedMotion(false);
    const animate = spyOn(tree, "animateScrollTo");

    publish(null, { loading: true, scrollBoundary: "start", stateChanges: [] });

    expect(tree.initializing).toBe(true);
    expect(scroller.scrollTop).toBe(0);
    expect(animate).not.toHaveBeenCalled();
  });

  it("positions the start boundary immediately when reduced motion is requested", () => {
    const scroller = setScrollGeometry();
    setReducedMotion(true);
    const animate = spyOn(tree, "animateScrollTo");

    publish(null, { scrollBoundary: "start", stateChanges: [] });

    expect(scroller.scrollTop).toBe(0);
    expect(animate).not.toHaveBeenCalled();
    expect(tree.scrollAnimationID).toBeNull();
  });

  it("clears a retired provider's start boundary before the next source arrives", () => {
    const scroller = setScrollGeometry();
    publish(null, { instant: true, scrollBoundary: "start", stateChanges: [] });
    expect(scroller.scrollTop).toBe(0);

    lease.dispose();

    expect(main.scrollBoundary).toBeNull();
    expect(tree.scrollBoundary).toBeNull();
    expect(tree.scrollAnimationID).toBeNull();
  });

  it("restores the start boundary when recreating the panel without another publication", async () => {
    publish(null, { instant: true, scrollBoundary: "start", stateChanges: [] });
    await tree.destroy();
    tree = main.getNavigationTree();
    tree.visibility = 1;
    jasmine.attachToDOM(tree.element);
    await lumine.views.getNextUpdatePromise();
    await flushMicrotasks();
    const scroller = setScrollGeometry();
    tree.instant = true;

    tree.scrollToCurrent();

    expect(scroller.scrollTop).toBe(0);
  });

  it("updates only state classes while keeping the outline and its DOM identities", () => {
    const headers = main.headers;
    const blocks = [...tree.element.querySelectorAll(".navigation-block")];
    const build = spyOn(main.adapterManager, "buildHeaders");
    const update = spyOn(tree, "update");
    const filter = spyOn(tree, "filter");
    const published = jasmine.createSpy("state notification");
    const observation = main.onDidUpdateHeaders(published);
    main.updateAdapterHeaders(null, changes());
    expect(main.headers).toBe(headers);
    expect(build).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(filter).not.toHaveBeenCalled();
    expect(published).toHaveBeenCalledOnceWith(main.editor, headers);
    observation.dispose();
    expect([...tree.element.querySelectorAll(".navigation-block")]).toEqual(blocks);
    expect(blocks[1].classList.contains("current")).toBe(false);
    expect(blocks[2].classList.contains("current")).toBe(true);
    expect(blocks[2].classList.contains("visible")).toBe(true);
    expect(blocks[0].closest(".navigation-tree").classList.contains("stack")).toBe(false);
  });

  it("updates current state in filtered results without rerunning their search", async () => {
    tree.searchQuery = "Section";
    tree.update(main.headers, { instant: true });
    await lumine.views.getNextUpdatePromise();
    const filter = spyOn(tree, "filter");
    main.updateAdapterHeaders(null, changes());
    const second = tree.searches.find((item) => item.text === "Section Two");
    expect(second.currentCount).toBe(1);
    expect(second.stackCount).toBe(1);
    expect(second.visibility).toBe(1);
    expect(filter).not.toHaveBeenCalled();
    expect(tree.element.querySelector(".navigation-block.current").textContent.trim()).toBe(
      "Section Two",
    );
  });

  for (const filtered of [false, true]) {
    it(`restores state after a full refresh reuses ${filtered ? "filtered" : "outline"} rows`, async () => {
      if (filtered) {
        tree.searchQuery = "Section";
        tree.update(main.headers, { instant: true });
        await lumine.views.getNextUpdatePromise();
      }
      const blocks = [...tree.element.querySelectorAll(".navigation-block")];
      const state = () =>
        blocks.map((block) => [
          block.classList.contains("current"),
          block.closest(".navigation-tree").classList.contains("stack"),
        ]);
      const originalState = state();
      main.updateAdapterHeaders(null, changes());
      expect(tree.element.querySelector(".navigation-block.current").textContent.trim()).toBe(
        "Section Two",
      );
      expect(state()).not.toEqual(originalState);

      main.updateAdapterHeaders(initialHeaders(), { instant: true });
      await lumine.views.getNextUpdatePromise();

      expect([...tree.element.querySelectorAll(".navigation-block")]).toEqual(blocks);
      expect(state()).toEqual(originalState);
    });
  }

  it("uses animation for tracking after an initial instant reveal and cancels it on user input", () => {
    const scroller = tree.refs.navigationScroller;
    tree.refs.navigationScroller = { clientHeight: 100, scrollHeight: 2000, scrollTop: 0 };
    const media = window.matchMedia.bind(window);
    spyOn(window, "matchMedia").and.callFake((query) =>
      query === "(prefers-reduced-motion: reduce)" ? { matches: false } : media(query),
    );
    spyOn(tree, "scrollToCurrent").and.callFake(() => tree.scrollToElement({ offsetTop: 500 }));
    try {
      tree.instant = true;
      tree.updateState([], {});
      expect(tree.refs.navigationScroller.scrollTop).toBe(0);
      expect(tree.scrollAnimationID).not.toBeNull();
      scroller.dispatchEvent(new WheelEvent("wheel"));
      expect(tree.scrollAnimationID).toBeNull();
      expect(tree.scrollTargetTop).toBeNull();
    } finally {
      tree.refs.navigationScroller = scroller;
    }
  });

  it("reveals immediately when reduced motion is requested", () => {
    const scroller = tree.refs.navigationScroller;
    tree.refs.navigationScroller = { clientHeight: 100, scrollHeight: 2000, scrollTop: 0 };
    const media = window.matchMedia.bind(window);
    spyOn(window, "matchMedia").and.callFake((query) =>
      query === "(prefers-reduced-motion: reduce)" ? { matches: true } : media(query),
    );
    const animate = spyOn(tree, "animateScrollTo");
    try {
      tree.instant = false;
      tree.scrollToElement({ offsetTop: 500 });
      expect(tree.refs.navigationScroller.scrollTop).toBe(415);
      expect(animate).not.toHaveBeenCalled();
      expect(tree.scrollAnimationID).toBeNull();
    } finally {
      tree.refs.navigationScroller = scroller;
    }
  });
});
