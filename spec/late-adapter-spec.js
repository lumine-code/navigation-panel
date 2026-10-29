const path = require("node:path");
const { Disposable } = require("lumine");

describe("navigation adapters arriving after the tree bootstrap", () => {
  let main, lease, item;

  beforeEach(async () => {
    await lumine.packages.deactivatePackage("navigation-panel");
    // Reproduce a cold panel even when an earlier spec has announced a text
    // editor. The adapter below is what wakes the full runtime in this test.
    const onHook = lumine.hooks.on.bind(lumine.hooks);
    spyOn(lumine.hooks, "on").and.callFake((name, callback) =>
      name === "core:text-editor-used" ? new Disposable() : onHook(name, callback),
    );
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage(path.resolve(__dirname, ".."))).mainModule;
  });

  afterEach(async () => {
    lease?.dispose();
    if (item) await lumine.workspace.paneForItem(item)?.destroyItem(item, true);
    await lumine.packages.deactivatePackage("navigation-panel");
  });

  it("keeps a late adapter discoverable when its pane item is opened afterwards", async () => {
    expect(main._objectsReady).toBe(true);
    expect(main._runtimeReady).toBe(false);
    item = {
      element: document.createElement("div"),
      getTitle: () => "Document from an adapter",
      canCopy: () => false,
    };
    const adapter = {
      handlesItem: (candidate) => candidate === item,
      observeHeaders: (_item, callback) => {
        callback([{ text: "A real section", level: 1, children: [] }], { instant: true });
        return new Disposable();
      },
      navigateTo: jasmine.createSpy("navigateTo"),
    };
    lease = main.consumeNavigationAdapter(adapter);
    expect(main.adapterManager.getForItem(item)).toBe(adapter);
    await flushMicrotasks(20);
    expect(main._runtimeReady).toBe(true);
    const pane = lumine.workspace.getCenter().getActivePane();
    pane.addItem(item);
    pane.activateItem(item);
    expect(main.editor).toBe(item);
    expect(main.headers[0].text).toBe("A real section");
  });

  it("withdraws a late adapter even when its lease retires before the runtime wakes", async () => {
    expect(main._objectsReady).toBe(true);
    expect(main._runtimeReady).toBe(false);
    const candidate = {};
    const adapter = { handlesItem: (item) => item === candidate };
    lease = main.consumeNavigationAdapter(adapter);
    expect(main.adapterManager.getForItem(candidate)).toBe(adapter);
    lease.dispose();
    expect(main.adapterManager.getForItem(candidate)).toBeNull();
    await flushMicrotasks(20);
    expect(main._runtimeReady).toBe(false);
    expect(main.navigationAdapters.has(adapter)).toBe(false);
  });
});
