const { CompositeDisposable } = require("lumine");

class NavigationList {
  constructor({ getItems, hasHeaders, didConfirmSelection, didScrollSelection }) {
    this.getItems = getItems;
    this.hasHeaders = hasHeaders;
    this.didConfirmSelection = didConfirmSelection;
    this.didScrollSelection = didScrollSelection;
    this.dirty = true;

    this.selectList = lumine.workspace.buildSelectList({
      className: "navigation-panel-list",
      crumb: "Headers",
      emptyMessage: "No headers found",
      placeholderText: "Search headers...",
      removeDiacritics: true,
      algorithm: "fuzzaldrin",
      filterKeyForItem: (item) => this.primaryTextForItem(item),
      elementForItem: (item, options) => this.elementForItem(item, options),
      didConfirmSelection: (item) => this.confirmSelection(item),
      didCancelSelection: () => this.selectList.hide(),
      willShow: () => this.update(),
    });

    // Registered in the package's own namespace: the item-actions list (F12)
    // derives its rows — label, description, keybinding — from this
    // registration and the keymap.
    this.disposables = new CompositeDisposable(
      lumine.commands.add(this.selectList.element, {
        "navigation-panel:scroll": {
          description: "Scroll the editor to the selected header, keeping the list open",
          didDispatch: () => this.scrollSelection(this.selectList.getSelectedItem()),
        },
      }),
    );
  }

  toggle() {
    this.selectList.toggle();
  }

  markDirty() {
    this.dirty = true;
    if (this.selectList.isVisible()) {
      this.update();
    }
  }

  update() {
    if (this.dirty) {
      // An unsupported grammar is why the list is empty, so it belongs in the
      // empty message rather than the resting info line — which is what a
      // reader sees where the rows would have been.
      this.selectList.update({
        items: this.getItems(),
        emptyMessage: this.hasHeaders() ? "No headers found" : "This grammar is not supported",
      });
      this.dirty = false;
    }
  }

  elementForItem(item, { highlight }) {
    const primary = document.createDocumentFragment();
    primary.appendChild(highlight(this.primaryTextForItem(item)));

    return {
      primary,
      secondary: this.secondaryTextForItem(item),
      className: item.classList,
    };
  }

  secondaryTextForItem(item) {
    if (item.badge != null) {
      return `Page ${item.badge}`;
    } else if (item.filePath) {
      return item.filePath;
    } else if (item.startPoint) {
      return `Line ${item.startPoint.row + 1}`;
    }
  }

  primaryTextForItem(item) {
    return item.text.trim();
  }

  confirmSelection(item) {
    if (!item) {
      return;
    }
    this.selectList.hide();
    this.didConfirmSelection(item);
  }

  scrollSelection(item) {
    if (!item) {
      return;
    }
    this.didScrollSelection(item);
  }

  destroy() {
    this.disposables.dispose();
    this.selectList.destroy();
  }
}

module.exports = { NavigationList };
