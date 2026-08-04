const path = require("path");

// Activate by path: resolving by name would need this checkout linked into
// ~/.lumine/packages-dev first.
const packageRoot = path.join(__dirname, "..");

describe("navigation-panel item actions", () => {
  let list;

  beforeEach(async () => {
    jasmine.attachToDOM(atom.views.getView(atom.workspace));
    const pkg = await atom.packages.activatePackage(packageRoot);
    list = pkg.mainModule.navigationList;
  });

  afterEach(async () => {
    await atom.packages.deactivatePackage("navigation-panel");
  });

  it("derives its action from the command registration and the keymap", () => {
    const actions = list.selectList.itemActions();

    expect(actions.map((action) => action.command)).toEqual(["navigation-panel:scroll"]);
    const scroll = actions[0];
    expect(scroll.name).toBe("Scroll");
    expect(scroll.description).toBe(
      "Scroll the editor to the selected header, keeping the list open",
    );
    expect(scroll.keystrokes).toEqual(["alt-enter"]);
  });

  it("shows the actions as a flow step and runs one against the master list", async () => {
    list.selectList.show();

    await list.selectList.showItemActions();

    expect(list.selectList.itemActionsList.isVisible()).toBeTruthy();
    expect(atom.workspace.getModalTrail()).toEqual(["Headers", "Actions"]);
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
});
