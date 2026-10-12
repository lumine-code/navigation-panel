const path = require("path");

const packageRoot = path.join(__dirname, "..");

describe("SOFiSTiK program switching in the outline", () => {
  let tree, editor;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    const pkg = await lumine.packages.activatePackage(packageRoot);
    tree = pkg.mainModule.getNavigationTree();
    jasmine.attachToDOM(tree.element);
    editor = lumine.workspace.buildTextEditor();
    editor.setText("  +PrOg aqua urs:1\nEND\n-PROG ase urs:2\nEND");
  });

  afterEach(async () => {
    editor.destroy();
    await lumine.packages.deactivatePackage("navigation-panel");
  });

  async function showPrograms(icons = true) {
    lumine.config.set("navigation-panel.sofistik.icons", icons);
    const { ScannerSofistik } = require("../lib/scanner-sofistik");
    tree.update(new ScannerSofistik(editor).getHeaders(), { instant: true });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    tree.focusHeaderList();
  }

  function pressSpace(target = tree.refs.navigationScroller) {
    const event = new KeyboardEvent("keydown", {
      key: " ",
      code: "Space",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "target", { value: target });
    lumine.keymaps.handleKeyboardEvent(event);
    return event;
  }

  it("toggles the selected program repeatedly without waiting for a rescan", async () => {
    await showPrograms();
    lumine.commands.dispatch(tree.element, "navigation-panel:select-next-header");
    expect(pressSpace().defaultPrevented).toBe(true);
    expect(editor.lineTextForBufferRow(0)).toBe("  -PrOg aqua urs:1");
    expect(editor.lineTextForBufferRow(2)).toBe("-PROG ase urs:2");
    expect(tree.element.querySelector(".sofistik-navi-icon").classList).toContain("status-removed");
    pressSpace();
    expect(editor.lineTextForBufferRow(0)).toBe("  +PrOg aqua urs:1");
    expect(document.activeElement).toBe(tree.refs.navigationScroller);
    lumine.commands.dispatch(tree.element, "navigation-panel:select-next-header");
    pressSpace();
    expect(editor.lineTextForBufferRow(2)).toBe("+PROG ase urs:2");
  });

  it("works when program icons are hidden", async () => {
    await showPrograms(false);
    expect(tree.element.querySelector(".sofistik-navi-icon")).toBeNull();
    pressSpace();
    expect(editor.lineTextForBufferRow(0)).toBe("  -PrOg aqua urs:1");
  });

  it("leaves Space available for text input in the search field", async () => {
    await showPrograms();
    tree.focusSearch();
    expect(pressSpace(tree.refs.searchEditor.element).defaultPrevented).toBe(false);
    expect(editor.lineTextForBufferRow(0)).toBe("  +PrOg aqua urs:1");
  });
});
