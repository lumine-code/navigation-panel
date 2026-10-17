const path = require("path");

// Activate by path: resolving by name would need this checkout linked into
// ~/.lumine/packages-dev first.
const packageRoot = path.join(__dirname, "..");

describe("navigation-panel item actions", () => {
  let list;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    const pkg = await lumine.packages.activatePackage(packageRoot);
    list = pkg.mainModule.navigationList;
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("navigation-panel");
  });

  it("derives its actions from the command registrations and the keymap", async () => {
    await list.selectListHost.show();
    const header = { id: "section", text: "Section", startPoint: { row: 4, column: 0 } };
    await list.selectList.setItems([header]);
    await list.selectList.selectIndex(0);
    const actions = list.selectList.getAvailableActions();

    expect(actions.map((action) => action.command)).toEqual([
      "navigation-panel:open-selected-header",
      "navigation-panel:scroll",
      "select-list:toggle-keep-open",
    ]);
    const open = actions[0];
    expect(open.name).toBe("Open Selected Header");
    expect(open.description).toBe("Scroll the editor to the selected header.");
    expect(open.primary).toBe(true);

    const scroll = actions[1];
    expect(scroll.name).toBe("Scroll");
    expect(scroll.description).toBe(
      "Scroll the editor to the selected header, keeping the list open.",
    );
    expect(scroll.keystrokes).toEqual(["alt-enter"]);
    expect(list.selectList.getItemId(header)).toBe("section");
  });

  it("shows the actions as a flow step and runs one against the master list", async () => {
    await list.selectListHost.show();
    const header = { id: "section", text: "Section", startPoint: { row: 4, column: 0 } };
    await list.selectList.setItems([header]);
    await list.selectList.selectIndex(0);

    await list.selectListHost.showActions();

    expect(lumine.workspace.getModalTrail()).toEqual(["Headers", "Actions"]);

    const spy = spyOn(list, "scrollSelection");
    lumine.workspace.popModal();
    await list.selectList.runAction("navigation-panel:scroll");

    expect(spy).toHaveBeenCalled();
    expect(list.selectListHost.isVisible()).toBeTruthy();
  });

  it("opens the highlighted modal-list header through the reused command", async () => {
    await list.selectListHost.show();
    const header = { id: "section", text: "Section", startPoint: { row: 4, column: 0 } };
    await list.selectList.setItems([header]);
    await list.selectList.selectIndex(0);
    const confirm = spyOn(list, "confirmSelection");

    await lumine.commands.dispatch(
      list.selectList.getElement(),
      "navigation-panel:open-selected-header",
    );

    expect(confirm).toHaveBeenCalledOnceWith(header);
  });

  for (const [command, callback] of [
    ["navigation-panel:open-selected-header", "didConfirmSelection"],
    ["navigation-panel:scroll", "didScrollSelection"],
  ]) {
    it(`waits for asynchronous ${command} navigation before finishing a kept-open action`, async () => {
      const header = { id: "section", text: "Section", startPoint: { row: 4, column: 0 } };
      let finish;
      const navigate = spyOn(list, callback).and.returnValue(
        new Promise((resolve) => (finish = resolve)),
      );
      await list.selectListHost.show();
      await list.selectList.setItems([header]);
      await list.selectList.setKeepOpen(true);

      const completion = list.selectList.runAction(command);
      await conditionPromise(() => navigate.calls.count() === 1);
      await new Promise((resolve) => setImmediate(resolve));
      expect(list.selectList.isActionPending()).toBe(true);
      finish("navigated");
      const result = await completion;

      expect(result.status).toBe("success");
      expect(result.value).toEqual(["navigated"]);
      expect(list.selectListHost.isVisible()).toBe(true);
    });
  }
});
