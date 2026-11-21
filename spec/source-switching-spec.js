const path = require("node:path");
const { Disposable } = require("lumine");

describe("navigation source subscriptions", () => {
  let main, tree, items, leases;

  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.deactivatePackage("navigation-panel");
    main = (await lumine.packages.activatePackage(path.resolve(__dirname, ".."))).mainModule;
    tree = main.getNavigationTree();
    items = [];
    leases = [];
  });

  afterEach(async () => {
    for (const lease of leases) lease.dispose();
    await lumine.packages.deactivatePackage("navigation-panel");
    for (const item of items) await lumine.workspace.paneForItem(item)?.destroyItem(item);
  });

  function item(title = "Document") {
    const value = {
      element: document.createElement("div"),
      getTitle: () => title,
      canCopy: () => false,
    };
    items.push(value);
    return value;
  }

  function provider(target, text) {
    const stopped = jasmine.createSpy(`stop ${text}`);
    const adapter = {
      handlesItem: (candidate) => candidate === target,
      observeHeaders: jasmine.createSpy(`observe ${text}`).and.callFake((_item, callback) => {
        callback([{ text, level: 1, children: [] }], { instant: true });
        return new Disposable(stopped);
      }),
      navigateTo: jasmine.createSpy(`navigate ${text}`),
    };
    leases.push(main.consumeNavigationAdapter(adapter));
    return { adapter, stopped };
  }

  async function activate(target) {
    const pane = lumine.workspace.getCenter().getActivePane();
    if (!pane.getItems().includes(target)) pane.addItem(target);
    pane.activateItem(target);
    await lumine.views.getNextUpdatePromise();
    await flushMicrotasks();
  }

  it("keeps an existing subscription and presentation when the same source is requested again", async () => {
    const target = item();
    const { adapter, stopped } = provider(target, "Heading");
    await activate(target);
    const headers = main.headers;
    const rows = [...tree.element.querySelectorAll(".navigation-block")];
    const observation = main.adapterManager.observation;
    const build = spyOn(main.adapterManager, "buildHeaders").and.callThrough();
    const update = spyOn(tree, "update").and.callThrough();
    const filter = spyOn(tree, "filter").and.callThrough();
    const list = spyOn(main.navigationList, "markDirty").and.callThrough();
    const published = jasmine.createSpy("source publication");
    const subscription = main.onDidUpdateHeaders(published);
    try {
      main.subscribeToItem(target);
      main.adapterSubscribe(adapter, target);
      await flushMicrotasks();

      expect(adapter.observeHeaders).toHaveBeenCalledTimes(1);
      expect(stopped).not.toHaveBeenCalled();
      expect(main.adapterManager.observation).toBe(observation);
      expect(main.headers).toBe(headers);
      expect([...tree.element.querySelectorAll(".navigation-block")]).toEqual(rows);
      for (const spy of [build, update, filter, list, published])
        expect(spy).not.toHaveBeenCalled();
    } finally {
      subscription.dispose();
    }
  });

  it("keeps the first matching provider until it is withdrawn", async () => {
    const target = item();
    const first = provider(target, "First provider");
    await activate(target);
    const headers = main.headers;
    const build = spyOn(main.adapterManager, "buildHeaders").and.callThrough();
    const update = spyOn(tree, "update").and.callThrough();
    const second = provider(target, "Second provider");
    await flushMicrotasks();

    expect(main.adapterManager.active).toBe(first.adapter);
    expect(first.adapter.observeHeaders).toHaveBeenCalledTimes(1);
    expect(first.stopped).not.toHaveBeenCalled();
    expect(second.adapter.observeHeaders).not.toHaveBeenCalled();
    expect(main.headers).toBe(headers);
    expect(build).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();

    leases[0].dispose();
    await lumine.views.getNextUpdatePromise();
    expect(main.adapterManager.active).toBe(second.adapter);
    expect(first.stopped).toHaveBeenCalledTimes(1);
    expect(second.adapter.observeHeaders).toHaveBeenCalledTimes(1);
    expect(main.headers[0].text).toBe("Second provider");
  });

  it("observes a generic adapter again after returning from another pane item", async () => {
    const first = item("First");
    const second = item("Second");
    let text = "Original heading";
    const stopped = jasmine.createSpy("stop generic observation");
    const adapter = {
      handlesItem: (candidate) => candidate === first,
      observeHeaders: jasmine
        .createSpy("observe generic source")
        .and.callFake((_item, callback) => {
          callback([{ text, level: 1, children: [] }]);
          return new Disposable(stopped);
        }),
      navigateTo() {},
    };
    leases.push(main.consumeNavigationAdapter(adapter));
    await activate(first);
    await activate(second);
    text = "Changed while unobserved";
    await activate(first);

    expect(adapter.observeHeaders).toHaveBeenCalledTimes(2);
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(main.headers[0].text).toBe(text);
  });

  it("retargets saved navigation functions and editor metadata when a tree changes owner", () => {
    const { AdapterManager } = require("../lib/adapter-manager");
    const manager = new AdapterManager();
    const first = item("First split");
    const second = item("Second split");
    const adapter = { navigateTo: jasmine.createSpy("navigate to current split") };
    manager.active = adapter;
    const raw = [
      {
        text: "Parent",
        level: 1,
        editor: first,
        children: [{ text: "Child", level: 2, editor: first, children: [] }],
      },
    ];
    const headers = manager.buildHeaders(raw, first);
    const navigate = headers[0].children[0].navigate;

    manager.retargetHeaders(headers, second);
    navigate({ focus: false });

    expect(headers[0].children[0].navigate).toBe(navigate);
    expect(adapter.navigateTo).toHaveBeenCalledOnceWith(second, headers[0].children[0], {
      focus: false,
    });
    expect(headers[0].editor).toBe(second);
    expect(headers[0].children[0].editor).toBe(second);
    expect(raw[0].editor).toBe(first);
    expect(raw[0].children[0].editor).toBe(first);
  });
});
