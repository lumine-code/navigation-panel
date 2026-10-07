const fs = require("fs");
const path = require("path");

describe("Navigation separator CSS role", () => {
  it("uses the theme border instead of a fixed black line", () => {
    const stylesheet = lumine.styles.addStyleSheet(
      fs.readFileSync(path.join(__dirname, "../styles/navigation-panel.css"), "utf8"),
      { priority: 1000 },
    );
    try {
      const panel = document.createElement("div");
      panel.className = "navigation-panel";
      panel.style.setProperty("--base-border-color", "rgb(190, 200, 210)");
      panel.innerHTML =
        '<div class="navigation-list"><div class="navigation-tree"><div class="navigation-block separator">Section</div></div></div>';
      jasmine.attachToDOM(panel);
      expect(getComputedStyle(panel.querySelector(".separator")).borderTopColor).toBe(
        "rgb(190, 200, 210)",
      );
    } finally {
      stylesheet.dispose();
    }
  });
});
