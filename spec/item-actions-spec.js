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
    const header = { text: "Section", startPoint: { row: 4, column: 0 } };
    await list.selectList.update({ items: [header] });
    await list.selectList.selectIndex(0);
    const actions = list.selectList.itemActions();

    expect(actions.map((action) => action.command)).toEqual([
      "navigation-panel:open-selected-header",
      "navigation-panel:scroll",
    ]);
    const open = actions[0];
    expect(open.name).toBe("Open Selected Header");
    expect(open.description).toBe("Scroll the editor to the selected header.");
    expect(open.keystrokes).toEqual(["enter"]);

    const scroll = actions[1];
    expect(scroll.name).toBe("Scroll");
    expect(scroll.description).toBe(
      "Scroll the editor to the selected header, keeping the list open.",
    );
    expect(scroll.keystrokes).toEqual(["alt-enter"]);
    expect(list.selectList.getIdForItem(header)).toBe(":4:0:Section");
  });

  it("shows the actions as a flow step and runs one against the master list", async () => {
    list.selectList.show();
    const header = { text: "Section", startPoint: { row: 4, column: 0 } };
    await list.selectList.update({ items: [header] });
    await list.selectList.selectIndex(0);

    await list.selectList.showItemActions();

    expect(list.selectList.itemActionsList.isVisible()).toBeTruthy();
    expect(lumine.workspace.getModalTrail()).toEqual(["Headers", "Actions"]);
    // The actions list wears the package class, so the package keymap
    // resolves action keystrokes inside it too.
    expect(
      list.selectList.itemActionsList.element.classList.contains("navigation-panel-list"),
    ).toBe(true);

    const spy = spyOn(list, "scrollSelection");
    const index = list.selectList.itemActionsList.items.findIndex(
      (item) => item.command === "navigation-panel:scroll",
    );
    list.selectList.itemActionsList.selectIndex(index);
    list.selectList.itemActionsList.confirmSelection();

    expect(spy).toHaveBeenCalled();
    expect(list.selectList.isVisible()).toBeTruthy();
    expect(list.selectList.itemActionsList.isVisible()).toBeFalsy();
  });

  it("opens the highlighted modal-list header through the reused command", async () => {
    list.selectList.show();
    const header = { text: "Section", startPoint: { row: 4, column: 0 } };
    await list.selectList.update({ items: [header] });
    await list.selectList.selectIndex(0);
    const confirm = spyOn(list, "confirmSelection");

    lumine.commands.dispatch(list.selectList.element, "navigation-panel:open-selected-header");

    expect(confirm).toHaveBeenCalledOnceWith(header);
  });
});
