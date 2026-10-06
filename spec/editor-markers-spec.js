const path = require("path");

const packageRoot = path.join(__dirname, "..");
const heading = "//$// Heading";

describe("navigation-panel editor markers", () => {
  let editor, markers, scanner;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    await lumine.packages.activatePackage(packageRoot);
    lumine.config.set("navigation-panel.editor.markLines", true);
    lumine.config.set("navigation-panel.editor.markerType", "line");
    lumine.config.set("navigation-panel.editor.markerUserLevel", false);
    lumine.config.set("navigation-panel.editor.maxHeadingDepth", 9);
    // Package unload tears down its module cache. Use this generation's
    // constructors rather than retaining them at the top of the spec.
    const { EditorMarkers } = require("../lib/editor-markers");
    const { ScannerJavascript } = require("../lib/scanner-javascript");
    editor = await lumine.workspace.open();
    markers = new EditorMarkers();
    scanner = new ScannerJavascript(editor);
    setText(`${heading}\nbody`);
  });

  afterEach(async () => {
    markers.clear(editor);
    editor.destroy();
    await lumine.packages.deactivatePackage("navigation-panel");
    lumine.config.unset("navigation-panel.editor.markLines");
    lumine.config.unset("navigation-panel.editor.markerType");
    lumine.config.unset("navigation-panel.editor.markerUserLevel");
    lumine.config.unset("navigation-panel.editor.maxHeadingDepth");
  });

  function refresh() {
    markers.refresh(editor, scanner.getHeaders());
  }

  function setText(text) {
    editor.setText(text);
    refresh();
  }

  function layerMarkers(level) {
    return editor.getBuffer().navigationMarkerLayers[level]?.getMarkers() ?? [];
  }

  function decorations() {
    return Object.entries(
      editor.decorationsStateForScreenRowRange(0, editor.getScreenLineCount()),
    ).filter(([, state]) => state.properties.class?.split(" ").includes("navigation-marker"));
  }

  function expectVisible(marker, row) {
    expect(marker.isDestroyed()).toBe(false);
    expect(marker.isValid()).toBe(true);
    expect(marker.getStartPosition().row).toBe(row);
    const decoration = decorations().find(([id]) => id.endsWith(`-${marker.id}`))?.[1];
    expect(decoration).toBeDefined();
    expect(decoration?.properties.type).toBe("line");
    expect(decoration?.bufferRange).toEqual(marker.getRange());
  }

  function expectHidden(marker) {
    expect(marker.isValid()).toBe(false);
    expect(decorations().some(([id]) => id.endsWith(`-${marker.id}`))).toBe(false);
  }

  it("keeps the background through title insertion, deletion, and replacement before scanning", () => {
    const marker = layerMarkers(1)[0];
    const rescan = spyOn(markers, "refresh").and.callThrough();
    const buffer = editor.getBuffer();

    buffer.insert([0, 9], "new ");
    expectVisible(marker, 0);
    buffer.delete([
      [0, 9],
      [0, 13],
    ]);
    expectVisible(marker, 0);
    buffer.setTextInRange(
      [
        [0, 6],
        [0, heading.length],
      ],
      "Renamed",
    );
    expectVisible(marker, 0);
    buffer.setTextInRange(
      [
        [0, heading.length - 1],
        [0, heading.length],
      ],
      "D",
    );
    expectVisible(marker, 0);

    expect(rescan).not.toHaveBeenCalled();
    expect(layerMarkers(1)).toEqual([marker]);
  });

  it("hides the background when the complete heading range is replaced until the next scan", () => {
    const marker = layerMarkers(1)[0];
    const replacement = "//$// Replacement";

    editor.getBuffer().setTextInRange(marker.getRange(), replacement);
    expectHidden(marker);
    expect(layerMarkers(1)).toEqual([marker]);

    refresh();
    const updated = layerMarkers(1)[0];
    expectVisible(updated, 0);
    expect(updated.getRange().serialize()).toEqual([
      [0, 0],
      [0, replacement.length],
    ]);
    expect(decorations().length).toBe(1);
  });

  it("follows line shifts and keeps Enter at either boundary outside the heading", () => {
    const marker = layerMarkers(1)[0];
    const buffer = editor.getBuffer();

    buffer.insert([0, 0], "\n");
    expectVisible(marker, 1);
    buffer.insert(marker.getEndPosition(), "\n");
    expectVisible(marker, 1);
    expect(marker.getRange().serialize()).toEqual([
      [1, 0],
      [1, heading.length],
    ]);
    buffer.insert(marker.getStartPosition(), "\n");
    expectVisible(marker, 2);
    expect(marker.getRange().serialize()).toEqual([
      [2, 0],
      [2, heading.length],
    ]);
    buffer.delete([
      [0, 0],
      [1, 0],
    ]);
    expectVisible(marker, 1);
    expect(marker.getRange().serialize()).toEqual([
      [1, 0],
      [1, heading.length],
    ]);
  });

  it("removes stale backgrounds on the next scan after a heading loses its annotation or line", () => {
    const buffer = editor.getBuffer();
    const annotationMarker = layerMarkers(1)[0];

    buffer.delete([
      [0, 0],
      [0, 6],
    ]);
    expectVisible(annotationMarker, 0);
    refresh();
    expect(layerMarkers(1)).toEqual([]);
    expect(decorations()).toEqual([]);

    setText(`${heading}\nbody`);
    const deletedMarker = layerMarkers(1)[0];
    buffer.delete([
      [0, 0],
      [1, 0],
    ]);
    expectHidden(deletedMarker);
    refresh();
    expect(layerMarkers(1)).toEqual([]);
    expect(decorations()).toEqual([]);
  });

  it("updates the background level on the next scan", () => {
    setText("//$// Root\n//$$// Child\nbody");
    const childMarker = layerMarkers(2)[0];

    editor.getBuffer().delete([
      [1, 3],
      [1, 4],
    ]);
    expectVisible(childMarker, 1);
    const oldDecoration = decorations().find(([id]) => id.endsWith(`-${childMarker.id}`))?.[1];
    expect(oldDecoration?.properties.class).toContain("navigation-marker-2");

    refresh();
    expect(layerMarkers(2)).toEqual([]);
    expect(layerMarkers(1).map((marker) => marker.getStartPosition().row)).toEqual([0, 1]);
    const updated = layerMarkers(1).find((marker) => marker.getStartPosition().row === 1);
    expectVisible(updated, 1);
    expect(
      decorations().every(([, state]) => state.properties.class.includes("navigation-marker-1")),
    ).toBe(true);
  });
});
