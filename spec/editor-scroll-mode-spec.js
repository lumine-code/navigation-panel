const { EditorAdapter } = require("../lib/editor-adapter");

describe("editor section navigation scrolling", () => {
  let editor, adapter, subscription, scrollRequests;

  beforeEach(() => {
    editor = lumine.workspace.buildTextEditor();
    editor.setText("first\nsecond\nthird");
    adapter = new EditorAdapter();
    scrollRequests = [];
    subscription = editor.onDidRequestAutoscroll((request) => scrollRequests.push(request));
  });

  afterEach(() => {
    subscription.dispose();
    editor.destroy();
  });

  it("uses the current shared zone for each visited section", async () => {
    lumine.config.set("editor.scrollZone", [10, 60]);
    await adapter.navigateTo(editor, { startPoint: { row: 1 } }, { focus: false });
    expect(editor.getCursorBufferPosition().toArray()).toEqual([1, 0]);
    expect(scrollRequests.map((request) => request.options.mode)).toEqual([[10, 60]]);

    lumine.config.set("editor.scrollZone", [40]);
    await adapter.navigateTo(editor, { startPoint: { row: 2 } }, { focus: false });
    expect(scrollRequests.at(-1).options.mode).toEqual([40, 40]);
  });

  it("keeps adding a cursor as a nearest reveal", async () => {
    lumine.config.set("editor.scrollZone", [25]);
    await adapter.navigateTo(editor, { startPoint: { row: 2 } }, { addCursor: true });
    expect(editor.getCursorBufferPositions().map((point) => point.toArray())).toContain([2, 0]);
    expect(scrollRequests.at(-1).options.mode).toEqual([0, 100]);
  });
});
