const path = require("path");
const { Disposable } = require("lumine");

const packageRoot = path.join(__dirname, "..");

function pollUntil(condition, timeoutMs = 15000) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (condition()) resolve();
      else if (performance.now() - start > timeoutMs)
        reject(new Error("Timed out waiting for render"));
      else requestAnimationFrame(check);
    };
    check();
  });
}

describe("navigation-panel adapter navigation", () => {
  let main, tree, leases;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    main = (await lumine.packages.activatePackage(packageRoot)).mainModule;
    tree = main.getNavigationTree();
    leases = [];
  });

  afterEach(async () => {
    for (const lease of leases) lease.dispose();
    await lumine.packages.deactivatePackage("navigation-panel");
  });

  function attach(headers) {
    const item = {
      element: document.createElement("div"),
      getTitle: () => "Patch",
      isSingleton: () => true,
    };
    let publish;
    const stopped = jasmine.createSpy("stopped");
    const navigateTo = jasmine.createSpy("navigateTo");
    const adapter = {
      handlesItem: (candidate) => candidate === item,
      observeHeaders: (_item, callback) => {
        publish = callback;
        callback(headers, { instant: true });
        return new Disposable(stopped);
      },
      navigateTo,
    };
    const lease = main.consumeNavigationAdapter(adapter);
    leases.push(lease);
    const pane = lumine.workspace.getCenter().getActivePane();
    pane.addItem(item);
    pane.activateItem(item);
    return {
      item,
      navigateTo,
      stopped,
      lease,
      publish: (next) => publish(next, { instant: true }),
    };
  }

  function file(id, text) {
    return {
      id,
      text,
      level: 1,
      startPoint: { row: 0, column: 0 },
      children: [
        {
          id: `${id}:chunk`,
          text: "Change",
          level: 2,
          startPoint: { row: 0, column: 0 },
          children: [],
        },
      ],
    };
  }

  it("keeps same-row files distinct and preserves their collapsed state when reordered", async () => {
    const first = file("file:a", "First Change");
    const second = file("file:b", "Second Change");
    const setup = attach([first, second]);
    main.open();
    await pollUntil(() => tree.element.querySelectorAll(".navigation-block").length === 4);
    tree.element.querySelector(".navigation-state-icon").click();
    await pollUntil(() => tree.element.querySelectorAll(".navigation-block").length === 3);

    setup.publish([second, first]);
    await pollUntil(
      () => tree.element.querySelector(".navigation-text")?.textContent === "Second Change",
    );
    const roots = tree.element.querySelector(".navigation-list").children;
    expect(roots[0].querySelectorAll(".navigation-block").length).toBe(2);
    expect(roots[1].querySelectorAll(".navigation-block").length).toBe(1);
  });

  it("retains same-row file and chunk identities in flattened search and the modal list", async () => {
    const setup = attach([file("file:a", "First Change"), file("file:b", "Second Change")]);
    main.open();
    tree.searchQuery = "Change";
    tree.update(main.headers, { instant: true });
    await pollUntil(() => tree.element.querySelectorAll(".navigation-block").length === 4);
    expect(new Set(tree.searches.map((header) => header.id)).size).toBe(4);
    const texts = tree.element.querySelectorAll(".navigation-text");
    for (const text of texts) text.click();
    expect(new Set(setup.navigateTo.calls.allArgs().map((args) => args[1].id)).size).toBe(4);

    const items = main.getVisibleHeaderListItems();
    expect(
      new Set(items.map((header) => main.navigationList.selectList.getItemId(header))).size,
    ).toBe(4);
    expect(items[1].text).toBe("First Change > Change");
  });

  it("generates unique identities for duplicate entries without inventing document rows", async () => {
    const headers = [
      { text: "Metadata Change", level: 1, children: [] },
      { text: "Metadata Change", level: 1, children: [] },
    ];
    const setup = attach(headers);
    const ids = main.headers.map((header) => header.id);
    expect(new Set(ids).size).toBe(2);
    expect(main.headers.every((header) => header.startPoint === undefined)).toBe(true);
    setup.publish(headers);
    expect(main.headers.map((header) => header.id)).toEqual(ids);

    main.open();
    tree.searchQuery = "Change";
    tree.update(main.headers, { instant: true });
    await pollUntil(() => tree.element.querySelectorAll(".navigation-block").length === 2);
    expect(tree.element.querySelectorAll(".badge").length).toBe(0);
    expect(main.navigationList.secondaryTextForItem(main.headers[0])).toBeUndefined();
  });

  it("generates stable default identities for duplicate rows and preserves explicit IDs", () => {
    const headers = [
      { text: "First", level: 1, startPoint: { row: 0, column: 0 }, children: [] },
      { text: "Second", level: 1, startPoint: { row: 0, column: 0 }, children: [] },
      { id: "explicit", text: "Third", level: 1, children: [] },
    ];
    const setup = attach(headers);
    const ids = main.headers.map((header) => header.id);
    expect(new Set(ids).size).toBe(3);
    setup.publish(headers.map((header) => ({ ...header, text: `${header.text} renamed` })));
    expect(main.headers.map((header) => header.id)).toEqual(ids);
  });

  it("moves next and previous from the current non-text entry and wraps", () => {
    const headers = [file("file:a", "First"), file("file:b", "Second")];
    headers[0].stackCount = 1;
    headers[0].children[0].currentCount = 1;
    const setup = attach(headers);

    main.navigateHeader(1);
    expect(setup.navigateTo.calls.mostRecent().args[1].id).toBe("file:b");
    main.navigateHeader(1);
    expect(setup.navigateTo.calls.mostRecent().args[1].id).toBe("file:b:chunk");
    main.navigateHeader(1);
    expect(setup.navigateTo.calls.mostRecent().args[1].id).toBe("file:a");
    main.navigateHeader(-1);
    expect(setup.navigateTo.calls.mostRecent().args[1].id).toBe("file:b:chunk");

    setup.publish(headers);
    main.navigateHeader(-1);
    expect(setup.navigateTo.calls.mostRecent().args[1].id).toBe("file:a");
  });

  it("uses the deepest active ancestor when a non-text item has no current entry", () => {
    const headers = [file("file:a", "First"), file("file:b", "Second")];
    headers[0].stackCount = 1;
    headers[0].children[0].stackCount = 1;
    const setup = attach(headers);
    main.navigateHeader(1);
    expect(setup.navigateTo.calls.mostRecent().args[1].id).toBe("file:b");
  });

  it("stops observers and resets navigation when the active item or provider changes", () => {
    const first = attach([file("file:a", "First"), file("file:b", "Second")]);
    main.navigateHeader(1);
    main.navigateHeader(1);
    expect(main.currentHeaderIndex).toBe(1);
    const second = attach([file("file:c", "Third")]);
    expect(first.stopped).toHaveBeenCalledTimes(1);
    expect(main.currentHeaderIndex).toBe(-1);
    main.navigateHeader(-1);
    expect(second.navigateTo.calls.mostRecent().args[1].id).toBe("file:c:chunk");

    second.lease.dispose();
    expect(second.stopped).toHaveBeenCalledTimes(1);
    expect(main.headers).toBeNull();
    expect(main.currentHeaderIndex).toBe(-1);
    expect(() => main.navigateHeader(1)).not.toThrow();
  });
});
