describe("header command availability", () => {
  it("keeps source discovery meaningful but disables empty cached headers", async () => {
    const main = (await lumine.packages.activatePackage("navigation-panel")).mainModule;
    jasmine.attachToDOM(lumine.workspace.getElement());
    const available = () =>
      lumine.commands.canDispatch(lumine.workspace.getElement(), "navigation-panel:next-header");
    expect(available()).toBe(false);
    const editor = await lumine.workspace.open();
    try {
      if (main._runtimeReady) {
        main.editor = editor;
        main.headers = [];
      } else expect(available()).toBe(true);
      main._runtimeReady = true;
      main.editor = editor;
      main.headers = [];
      expect(available()).toBe(false);
      main.headers = [{ row: 0 }];
      expect(available()).toBe(true);
      main.headers = [];
      expect(available()).toBe(false);
    } finally {
      editor.destroy();
      await lumine.packages.deactivatePackage("navigation-panel");
    }
  });
});
