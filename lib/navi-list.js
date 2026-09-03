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
      getItemId: (item) => this.getItemId(item),
      search: {
        getFilterText: (item) => this.primaryTextForItem(item),
        algorithm: "fuzzaldrin",
        ignoreDiacritics: true,
      },
      renderItem: (item, options) => this.renderItem(item, options),
      source: {
        mode: "snapshot",
        load: () => this.loadItems(),
      },
      commands: {
        "navigation-panel:open-selected-header": {
          description: "Scroll the editor to the selected header.",
          didDispatch: (event) => this.confirmSelection(event.detail.item),
        },
        "navigation-panel:scroll": {
          description: "Scroll the editor to the selected header, keeping the list open.",
          didDispatch: (event) => this.scrollSelection(event.detail.item),
        },
      },
      actions: [
        {
          command: "navigation-panel:open-selected-header",
          context: "item",
          primary: true,
          group: "Open",
          disposition: "close",
          dispatch: "local",
        },
        {
          command: "navigation-panel:scroll",
          context: "item",
          group: "Open",
          disposition: "stay",
          dispatch: "local",
        },
      ],
    });
  }

  getItemId(item) {
    const row = item.startPoint?.row ?? "";
    const column = item.startPoint?.column ?? "";
    return [item.filePath ?? "", row, column, this.primaryTextForItem(item)].join(":");
  }

  toggle() {
    return this.selectList.toggle();
  }

  markDirty() {
    this.dirty = true;
    if (this.selectList.isVisible()) {
      this.selectList.reload();
    }
  }

  loadItems() {
    if (!this.dirty) return undefined;
    this.dirty = false;
    // An unsupported grammar is why the list is empty, so it belongs in the
    // empty message rather than the resting info line — which is what a
    // reader sees where the rows would have been.
    return {
      items: this.getItems(),
      emptyMessage: this.hasHeaders() ? "No headers found" : "This grammar is not supported",
    };
  }

  renderItem(item, { highlight }) {
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
    this.didConfirmSelection(item);
  }

  scrollSelection(item) {
    if (!item) {
      return;
    }
    this.didScrollSelection(item);
  }

  destroy() {
    return this.selectList.destroy();
  }
}

module.exports = { NavigationList };
