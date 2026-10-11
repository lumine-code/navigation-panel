const { Disposable } = require("lumine");

beforeEach(() => {
  for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
    if (!jasmine.isSpy(lumine.shell[method])) spyOn(lumine.shell, method).and.resolveTo();
  if (!jasmine.isSpy(lumine.application.openWindow))
    spyOn(lumine.application, "openWindow").and.resolveTo();
});

describe("Navigation headers after adapter withdrawal", () => {
  let main, item, leases, disposed;
  beforeEach(async () => {
    jasmine.useRealClock();
    if (lumine.packages.isPackageLoaded("navigation-panel"))
      await lumine.packages.unloadPackage("navigation-panel");
    jasmine.attachToDOM(lumine.workspace.getElement());
    leases = [];
    disposed = jasmine.createSpy("stop observing headers");
    main = (await lumine.packages.activatePackage("navigation-panel")).mainModule;
    main.getNavigationTree();
  });
  afterEach(async () => {
    for (const lease of leases) lease.dispose();
    if (lumine.packages.isPackageLoaded("navigation-panel"))
      await lumine.packages.unloadPackage("navigation-panel");
    if (lumine.workspace.isTextEditor(item)) item.destroy();
    else if (item) await lumine.workspace.paneForItem(item)?.destroyItem(item, { force: true });
    await lumine.fileWatchClient.settlePendingTeardown();
  });
  async function start(textEditor = false) {
    if (textEditor) {
      const grammarPackage = await lumine.packages.activatePackage("language-javascript");
      await grammarPackage.resourceLoadPromise;
      item = await lumine.workspace.open();
      item.setGrammar(lumine.grammars.grammarForScopeName("source.js"));
      item.setText("//$// Built-in heading\nbody\n");
      await item.getBuffer().getLanguageMode().ready;
    } else {
      item = { element: document.createElement("div"), getTitle: () => "Owned document" };
      const pane = lumine.workspace.getCenter().getActivePane();
      pane.addItem(item);
      pane.activateItem(item);
    }
    const lease = lumine.packages.serviceHub.provide("navigation.adapter", "1.0.0", {
      handlesItem: (candidate) => candidate === item,
      observeHeaders: (_item, callback) => {
        callback([{ text: "Adapter heading", level: 1, children: [] }], { instant: true });
        return new Disposable(disposed);
      },
      navigateTo: () => {},
    });
    leases.push(lease);
    await conditionPromise(() => main.headers?.[0]?.text === "Adapter heading");
    await waitForFrames(() => main.navigationTree.element.textContent.includes("Adapter heading"));
    return lease;
  }
  it("clears the current non-editor outline and stops its observer", async () => {
    const lease = await start();
    lease.dispose();
    await waitForFrames(() => true);
    expect(main.headers).toBeNull();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(main.navigationTree.element.textContent).not.toContain("Adapter heading");
  });
  it("restores the built-in scanner for an editor after its adapter disappears", async () => {
    const lease = await start(true);
    lease.dispose();
    await waitForFrames(() => true);
    expect(main.adapterManager.active).toBe(main.builtinEditorAdapter);
    expect(main.headers?.[0]?.text).toBe("Built-in heading");
    expect(disposed).toHaveBeenCalledTimes(1);
  });
  it("keeps a connected ordinary adapter outline until it is withdrawn", async () => {
    await start();
    expect(main.editor).toBe(item);
    expect(main.headers[0].text).toBe("Adapter heading");
    expect(disposed).not.toHaveBeenCalled();
  });
});
