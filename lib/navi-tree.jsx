/** @jsx etch.dom */
const etch = require("@lumine-code/etch");
const { CompositeDisposable, TextEditor } = require("lumine");
const { NavigationItem } = require("./navi-item");

// it's required to ommit double scroll request
// 1. from page scroll observer
// 2. from cursor observer
let SCROLL_SKIP = 0;

function skipNextScroll() {
  SCROLL_SKIP += 1;
}

class NavigationTree {
  constructor() {
    this.headers = null;
    this.searches = null;
    this.instant = false;
    this.scrollAnimationID = null;
    this.pendingScroll = 0;
    this.scrollDirection = 0;
    this.selectedNavigationIndex = null;
    this.navigationSelectionActive = false;
    this.resetSelectedHeaderTimer = null;
    this.searchQuery = "";
    this.searchUpdateTimer = null;

    this.searchBar = lumine.config.get("navigation-panel.panel.searchBar");
    this.categoryBar = lumine.config.get("navigation-panel.panel.categoryBar");
    this.visibility = lumine.config.get("navigation-panel.panel.visibility");
    this.collapseWork = null;
    this.textWrap = lumine.config.get("navigation-panel.panel.textWrap");
    this.info = true;
    this.success = true;
    this.warning = true;
    this.error = true;
    this.standard = true;

    this.disposables = new CompositeDisposable(
      lumine.commands.add("lumine-workspace", {
        "navigation-panel:all-categories": {
          description: "Show the headers of every category in the panel.",
          didDispatch: () => {
            this.categoriesChange(["info", "success", "warning", "error", "standard"], true);
          },
        },
        "navigation-panel:none-categories": {
          description: "Hide the headers of every category from the panel.",
          didDispatch: () => {
            this.categoriesChange(["info", "success", "warning", "error", "standard"], false);
          },
        },
        "navigation-panel:categories-toggle": {
          description: "Flip every category at once between shown and hidden.",
          didDispatch: () => {
            this.categoriesChange(["info", "success", "warning", "error", "standard"]);
          },
        },
        "navigation-panel:info-toggle": {
          description: "Show or hide the headers marked as information.",
          didDispatch: () => {
            this.categoriesChange(["info"]);
          },
        },
        "navigation-panel:success-toggle": {
          description: "Show or hide the headers marked as successes.",
          didDispatch: () => {
            this.categoriesChange(["success"]);
          },
        },
        "navigation-panel:warning-toggle": {
          description: "Show or hide the headers marked as warnings.",
          didDispatch: () => {
            this.categoriesChange(["warning"]);
          },
        },
        "navigation-panel:error-toggle": {
          description: "Show or hide the headers marked as errors.",
          didDispatch: () => {
            this.categoriesChange(["error"]);
          },
        },
        "navigation-panel:standard-toggle": {
          description: "Show or hide the headers carrying no category at all.",
          didDispatch: () => {
            this.categoriesChange(["standard"]);
          },
        },
        "navigation-panel:collapse-mode": {
          description: "Keep every section in the panel collapsed.",
          didDispatch: () => {
            this.visibility = this.collapseWork = 0;
            etch.update(this);
          },
        },
        "navigation-panel:expand-mode": {
          description: "Keep every section in the panel expanded.",
          didDispatch: () => {
            this.visibility = this.collapseWork = 1;
            etch.update(this);
          },
        },
        "navigation-panel:auto-collapse": {
          description: "Collapse the sections the cursor is not in.",
          didDispatch: () => {
            this.visibility = 2;
            etch.update(this);
          },
        },
        "navigation-panel:focus-current": {
          description: "Expand only the section the cursor is in.",
          didDispatch: () => {
            this.collapseWork = 2;
            etch.update(this);
          },
        },
        "navigation-panel:text-wrap-toggle": {
          description: "Wrap a long header in the panel rather than clipping it.",
          didDispatch: () => {
            this.textWrap = !this.textWrap;
            etch.update(this);
          },
        },
        "navigation-panel:search-bar-toggle": {
          description: "Show or hide the panel's search field.",
          didDispatch: () => {
            this.searchBar = !this.searchBar;
            etch.update(this);
          },
        },
        "navigation-panel:category-bar-toggle": {
          description: "Show or hide the panel's row of category filters.",
          didDispatch: () => {
            this.categoryBar = !this.categoryBar;
            etch.update(this);
          },
        },
        "navigation-panel:search": {
          description: "Put the cursor in the panel's search field.",
          didDispatch: () => {
            this.focusSearch();
          },
        },
        "navigation-panel:clear": {
          description: "Empty the search field and scroll back to the selection.",
          didDispatch: () => {
            this.clearQuery({ scrollToSelection: true });
          },
        },
        "navigation-panel:copy-header-text": {
          description: "Copy the text of the header under the pointer.",
          didDispatch: (event) => {
            this.copyHeaderText(event.target);
          },
        },
      }),
      lumine.commands.add(".navigation-panel", {
        "navigation-panel:select-previous-header": {
          description: "Move the panel's selection to the header above.",
          didDispatch: () => {
            this.selectAdjacentHeader(-1);
          },
        },
        "navigation-panel:select-next-header": {
          description: "Move the panel's selection to the header below.",
          didDispatch: () => {
            this.selectAdjacentHeader(1);
          },
        },
        "navigation-panel:open-selected-header": {
          description: "Scroll the editor to the selected header, keeping the query.",
          didDispatch: () => {
            this.openSelectedHeader({ clearSearch: false });
          },
        },
        "navigation-panel:open-selected-header-clear-search": {
          description: "Scroll to the selected header and empty the search field.",
          didDispatch: () => {
            this.openSelectedHeader({ clearSearch: true });
          },
        },
        "navigation-panel:open-selected-header-add-cursor": {
          description: "Add a cursor at the selected header, keeping the others.",
          didDispatch: () => {
            this.openSelectedHeader({ addCursor: true });
          },
        },
        "navigation-panel:collapse-selected-header": {
          description: "Collapse the selected section in the panel.",
          didDispatch: () => {
            this.setSelectedHeaderCollapsed(true);
          },
        },
        "navigation-panel:expand-selected-header": {
          description: "Expand the selected section in the panel.",
          didDispatch: () => {
            this.setSelectedHeaderCollapsed(false);
          },
        },
        "navigation-panel:toggle-search-focus": {
          description: "Move focus between the search field and the header tree.",
          didDispatch: () => {
            this.toggleSearchFocus();
          },
        },
      }),
    );
    etch.initialize(this);
    this.disposables.add(lumine.textEditors.add(this.refs.searchEditor));
    this.disposables.add(
      this.refs.searchEditor.onDidChange(() => {
        this.searchQuery = this.refs.searchEditor.getText();
        this.scheduleSearchUpdate();
      }),
    );
  }

  destroy() {
    this.cancelScrollAnimation();
    clearTimeout(this.resetSelectedHeaderTimer);
    clearTimeout(this.searchUpdateTimer);
    this.disposables.dispose();
    etch.destroy(this);
  }

  render() {
    const states = {
      visibility: this.visibility,
      collapseWork: this.collapseWork,
      info: this.info,
      success: this.success,
      warning: this.warning,
      error: this.error,
      standard: this.standard,
    };

    let searchBar, naviList, categoryBar;
    searchBar = (
      <div
        class="navigation-search"
        style={{
          display: this.searchBar ? "block" : "none",
        }}
        on={{ mousedown: this.didMouseDownSearch }}
      >
        {etch.dom(TextEditor, {
          ref: "searchEditor",
          mini: true,
          placeholderText: "Search...",
        })}
        <div
          class="icon-remove-close"
          on={{
            mousedown: this.didMouseDownSearchAction,
            click: this.clearQuery,
          }}
        />
      </div>
    );
    let items = this.searches === null ? this.headers : this.searches;
    if (!items) {
      naviList = (
        <div class="navigation-list">
          <background-tips>
            <ul class="centered background-message">
              <li>This grammar is not supported</li>
            </ul>
          </background-tips>
        </div>
      );
    } else if (items.length) {
      let wspace = this.textWrap || !items ? "unset" : "max-content";
      naviList = (
        <div class="navigation-list" style={{ width: wspace }}>
          {items.map((item) => {
            return (
              <NavigationItem
                {...item}
                key={item.startPoint.row}
                skipNextScroll={skipNextScroll}
                clearSearchAfterNavigate={this.clearSearchAfterNavigate.bind(this)}
                states={states}
              />
            );
          })}
        </div>
      );
    } else {
      naviList = (
        <div class="navigation-list">
          <background-tips>
            <ul class="centered background-message">
              <li>No results</li>
            </ul>
          </background-tips>
        </div>
      );
    }
    if (this.categoryBar) {
      categoryBar = (
        <div class="navigation-desk">
          <input
            type="checkbox"
            class="navigation-switch input-toggle navigation-switch-info"
            checked={this.info}
            onChange={() => this.categoriesChange(["info"])}
          />
          <input
            type="checkbox"
            class="navigation-switch input-toggle navigation-switch-success"
            checked={this.success}
            onChange={() => this.categoriesChange(["success"])}
          />
          <input
            type="checkbox"
            class="navigation-switch input-toggle navigation-switch-warning"
            checked={this.warning}
            onChange={() => this.categoriesChange(["warning"])}
          />
          <input
            type="checkbox"
            class="navigation-switch input-toggle navigation-switch-error"
            checked={this.error}
            onChange={() => this.categoriesChange(["error"])}
          />
          <input
            type="checkbox"
            class="navigation-switch input-toggle navigation-switch-standard"
            checked={this.standard}
            onChange={() => this.categoriesChange(["standard"])}
          />
        </div>
      );
    } else {
      categoryBar = <div class="navigation-desk" />;
    }
    return (
      <lumine-panel
        class="navigation-panel"
        ref="navigationPanel"
        tabIndex={-1}
        on={{ focusout: this.resetSelectedHeaderOnFocusOut }}
      >
        {searchBar}
        <div class="navigation-scroller" ref="navigationScroller" tabIndex={-1}>
          {naviList}
        </div>
        {categoryBar}
      </lumine-panel>
    );
  }

  categoriesChange(classNames, value = null) {
    for (let className of classNames) {
      if (value === null) {
        this[className] = !this[className];
      } else {
        this[className] = value;
      }
    }
    etch.update(this);
  }

  update(headers, props) {
    this.headers = headers;
    this.filter(); // .searches
    if (props) {
      if (Object.hasOwn(props, "instant")) {
        this.instant = props.instant;
      }
      if (Object.hasOwn(props, "scrollDirection")) {
        this.scrollDirection = props.scrollDirection;
      }
    }
    etch.update(this);
  }

  readAfterUpdate() {
    this.collapseWork = null;
    this.restoreSelectedHeader();
    this.scrollToCurrent();
  }

  scrollToCurrent() {
    if (SCROLL_SKIP) {
      SCROLL_SKIP -= 1;
      return;
    }
    let scroller = this.refs.navigationScroller;
    if (!scroller) {
      return;
    }
    let element;
    let elements = scroller.getElementsByClassName("navigation-block visible");
    if (elements.length > 0) {
      if (this.scrollDirection > 0) {
        element = elements[elements.length - 1];
      } else {
        element = elements[0];
      }
      return this.scrollToElement(element);
    }
    element = scroller.getElementsByClassName("navigation-block current")[0];
    if (element) {
      return this.scrollToElement(element);
    }
  }

  scrollToElement(element) {
    if (this.instant === null) {
      this.instant = false;
      return; // do not scroll
    }

    let container = this.refs.navigationScroller;
    if (!container) {
      return;
    }

    let elementTop = element.offsetTop;
    let containerHeight = container.clientHeight;

    let relativeTop = elementTop - container.scrollTop;
    let limitTop = containerHeight * 0.15;
    let limitBottom = containerHeight * 0.85;

    if (relativeTop > limitTop && relativeTop < limitBottom) {
      // The target already sits in the comfortable band, so this update asks for
      // no movement at all. Stop an animation still running towards an earlier
      // target: it would carry the list away from the header we just accepted.
      this.cancelScrollAnimation();
      this.instant = false;
      return;
    }

    let targetScrollTop;
    if (relativeTop < limitTop) {
      targetScrollTop = elementTop - limitTop;
    } else {
      targetScrollTop = elementTop - limitBottom;
    }

    // If instant mode, use direct scroll without animation
    if (this.instant) {
      this.instant = false;
      this.cancelScrollAnimation();
      container.scrollTop = targetScrollTop;
      return;
    }

    // Custom smooth scroll animation
    this.cancelScrollAnimation();
    this.pendingScroll = targetScrollTop - container.scrollTop;

    const animate = () => {
      if (Math.abs(this.pendingScroll) < 1) {
        container.scrollTop = targetScrollTop;
        this.pendingScroll = 0;
        this.scrollAnimationID = null;
        return;
      }
      let step = Math.trunc(this.pendingScroll / 12);
      if (step === 0) step = Math.sign(this.pendingScroll);
      let currentTop = container.scrollTop;
      container.scrollTop += step;
      this.pendingScroll -= step;
      if (container.scrollTop === currentTop) {
        this.pendingScroll = 0;
        this.scrollAnimationID = null;
        return; // stop if not scrolling more
      }
      this.scrollAnimationID = requestAnimationFrame(animate);
    };

    this.scrollAnimationID = requestAnimationFrame(animate);
    this.instant = false;
  }

  cancelScrollAnimation() {
    if (this.scrollAnimationID) {
      cancelAnimationFrame(this.scrollAnimationID);
      this.scrollAnimationID = null;
    }
    this.pendingScroll = 0;
  }

  getSelectableHeaderBlocks() {
    if (!this.refs.navigationScroller) {
      return [];
    }
    return Array.from(this.refs.navigationScroller.querySelectorAll(".navigation-block"));
  }

  getSelectedHeaderBlock() {
    const blocks = this.getSelectableHeaderBlocks();
    if (!blocks.length) {
      return null;
    }

    const selectedBlock = this.getVisibleSelectedHeaderBlock(blocks);
    if (selectedBlock) {
      return selectedBlock;
    }

    if (
      !this.navigationSelectionActive &&
      this.selectedNavigationIndex !== null &&
      this.selectedNavigationIndex >= 0 &&
      this.selectedNavigationIndex < blocks.length
    ) {
      return blocks[this.selectedNavigationIndex];
    }

    return blocks.find((block) => block.classList.contains("current")) || blocks[0];
  }

  getVisibleSelectedHeaderBlock(blocks = this.getSelectableHeaderBlocks()) {
    return blocks.find((block) => block.classList.contains("selected")) || null;
  }

  getVisibleCurrentHeaderBlock(blocks = this.getSelectableHeaderBlocks()) {
    return blocks.find((block) => block.classList.contains("current")) || null;
  }

  setSelectedHeaderBlock(block) {
    if (!block) {
      this.selectedNavigationIndex = null;
      return;
    }

    const previous = this.refs.navigationScroller.querySelector(".navigation-block.selected");
    if (previous) {
      previous.classList.remove("selected");
    }

    this.selectedNavigationIndex = this.getSelectableHeaderBlocks().indexOf(block);
    this.scrollToElement(block);
    this.focus();
    if (this.navigationSelectionActive && this.hasFocus()) {
      block.classList.add("selected");
    }
  }

  showSelectedHeader() {
    if (!this.navigationSelectionActive || !this.hasFocus()) {
      return;
    }
    const block = this.getVisibleSelectedHeaderBlock();
    if (block) {
      block.classList.add("selected");
    }
  }

  restoreSelectedHeaderAtIndex() {
    if (!this.navigationSelectionActive || !this.hasFocus()) {
      return;
    }
    const blocks = this.getSelectableHeaderBlocks();
    if (
      this.selectedNavigationIndex !== null &&
      this.selectedNavigationIndex >= 0 &&
      this.selectedNavigationIndex < blocks.length
    ) {
      blocks[this.selectedNavigationIndex].classList.add("selected");
    }
  }

  resetSelectedHeader() {
    if (this.refs.navigationScroller) {
      const selected = this.refs.navigationScroller.querySelector(".navigation-block.selected");
      if (selected) {
        selected.classList.remove("selected");
      }
    }
    this.navigationSelectionActive = false;
    this.selectedNavigationIndex = null;
  }

  resetSelectedHeaderOnFocusOut() {
    clearTimeout(this.resetSelectedHeaderTimer);
    this.resetSelectedHeaderTimer = setTimeout(() => {
      if (!this.element || this.element.contains(document.activeElement)) {
        return;
      }
      this.resetSelectedHeader();
    }, 75);
  }

  restoreSelectedHeader() {
    this.showSelectedHeader();
  }

  selectAdjacentHeader(direction) {
    const blocks = this.getSelectableHeaderBlocks();
    if (!blocks.length) {
      return;
    }

    const selectedBlock = this.getVisibleSelectedHeaderBlock(blocks);
    const currentBlock = this.getVisibleCurrentHeaderBlock(blocks);
    const originBlock = selectedBlock || (!this.navigationSelectionActive ? currentBlock : null);

    if (!this.navigationSelectionActive) {
      this.navigationSelectionActive = true;
    }

    let index = blocks.indexOf(originBlock);
    if (index === -1) {
      index = direction > 0 ? -1 : 0;
    }

    index += direction;
    if (index >= blocks.length) {
      index = 0;
    } else if (index < 0) {
      index = blocks.length - 1;
    }

    this.setSelectedHeaderBlock(blocks[index]);
  }

  openSelectedHeader(options = {}) {
    const block = this.getSelectedHeaderBlock();
    if (!block) {
      return;
    }

    this.setSelectedHeaderBlock(block);
    const text = block.querySelector(".navigation-text");
    if (!text) {
      return;
    }
    if (options.addCursor) {
      text.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }),
      );
    } else if (options.clearSearch) {
      text.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }),
      );
    } else {
      text.click();
    }
  }

  setSelectedHeaderCollapsed(collapsed) {
    const block = this.getSelectedHeaderBlock();
    if (!block) {
      return;
    }
    this.navigationSelectionActive = true;

    this.setSelectedHeaderBlock(block);
    const tree = block.closest(".navigation-tree");
    if (this.setHeaderTreeCollapsed(tree, block, collapsed, { allowAlreadyCollapsed: false })) {
      setTimeout(() => this.restoreSelectedHeaderAtIndex());
      return;
    }

    if (collapsed) {
      this.collapseSelectedHeaderParent(tree);
    }
  }

  setSelectedHeaderCollapsedFromIcon(block, collapsed, options = {}) {
    const icon = block.querySelector(".navigation-state-icon");
    if (!icon) {
      return;
    }
    if (collapsed && icon.classList.contains("icon-chevron-down")) {
      icon.click();
      return true;
    } else if (!collapsed && icon.classList.contains("icon-chevron-right")) {
      icon.click();
      return true;
    } else if (collapsed && icon.classList.contains("icon-chevron-right")) {
      return Boolean(options.allowAlreadyCollapsed);
    }
    return false;
  }

  setHeaderTreeCollapsed(tree, block, collapsed, options = {}) {
    if (
      tree &&
      tree.navigationTreeView &&
      tree.navigationTreeView.setCollapsed(collapsed, options)
    ) {
      return true;
    }
    return this.setSelectedHeaderCollapsedFromIcon(block, collapsed, options);
  }

  collapseSelectedHeaderParent(tree) {
    let parentTree = tree && tree.parentElement && tree.parentElement.closest(".navigation-tree");
    while (parentTree) {
      const parentBlock = Array.from(parentTree.children).find((child) =>
        child.classList.contains("navigation-block"),
      );
      if (
        parentBlock &&
        this.setHeaderTreeCollapsed(parentTree, parentBlock, true, {
          allowAlreadyCollapsed: true,
        })
      ) {
        this.setSelectedHeaderBlock(parentBlock);
        setTimeout(() => this.restoreSelectedHeaderAtIndex());
        return;
      }
      parentTree = parentTree.parentElement && parentTree.parentElement.closest(".navigation-tree");
    }
  }

  getTitle() {
    return "Navigation";
  }

  getIconName() {
    return "list-unordered";
  }

  getDefaultLocation() {
    return lumine.config.get("navigation-panel.panel.defaultSide");
  }

  getAllowedLocations() {
    return ["left", "right"];
  }

  filter() {
    if (!this.headers) {
      this.searches = null;
      return;
    }
    let query = this.searchQuery;
    if (query.length === 0) {
      this.searches = null;
      return;
    }
    query = lumine.tools.removeDiacritics(query);
    let scoredItems = [];
    this._filter(query, scoredItems, this.headers);
    this.searches = scoredItems.sort((a, b) => b.score - a.score);
  }

  _filter(query, items, headers) {
    for (let item of headers) {
      let score = lumine.tools.fuzzyMatcher.score(lumine.tools.removeDiacritics(item.text), query);
      if (score > 0) {
        let matches =
          query.length > 0
            ? lumine.tools.fuzzyMatcher.match(lumine.tools.removeDiacritics(item.text), query, {
                recordMatchIndexes: true,
              }).matchIndexes
            : [];
        let display = this.highlightMatchesInElement(item.text, matches);
        items.push({
          ...item,
          score: score,
          children: [],
          filterResult: display,
          filterRow: item.startPoint.row,
        });
      }
      if (item.children && item.children.length > 0) {
        this._filter(query, items, item.children);
      }
    }
  }

  focusSearch() {
    this.refs.searchEditor.element.focus();
  }

  didMouseDownSearch(event) {
    if (event.target && event.target.closest && event.target.closest(".icon-remove-close")) {
      return;
    }
    const element = this.refs.searchEditor && this.refs.searchEditor.element;
    if (element && (!element.hasFocus || !element.hasFocus())) {
      event.preventDefault();
      element.focus();
    }
  }

  didMouseDownSearchAction(event) {
    event.preventDefault();
  }

  scheduleSearchUpdate() {
    clearTimeout(this.searchUpdateTimer);
    this.searchUpdateTimer = setTimeout(() => {
      this.update(this.headers, { instant: true });
    }, 50);
  }

  toggleSearchFocus() {
    const searchElement = this.refs.searchEditor && this.refs.searchEditor.element;
    if (searchElement && searchElement.contains(document.activeElement)) {
      this.focus();
    } else {
      this.focusSearch();
    }
  }

  focusHeaderList() {
    this.focus();
  }

  focus() {
    if (this.refs.navigationScroller) {
      return this.refs.navigationScroller.focus();
    }
    if (this.element) {
      return this.element.focus();
    }
  }

  hasFocus() {
    return Boolean(this.element && this.element.contains(document.activeElement));
  }

  copyHeaderText(target) {
    const block = target && target.closest && target.closest(".navigation-block");
    if (!block) {
      return;
    }
    const tree = block.closest(".navigation-tree");
    const view = tree && tree.navigationTreeView;
    if (!view || !view.item) {
      return;
    }
    lumine.clipboard.write(view.item.text);
    lumine.notifications.addSuccess("Copied to clipboard!");
  }

  clearSearchAfterNavigate() {
    if (this.searchQuery.length === 0) {
      return;
    }
    this.searchQuery = "";
    this.refs.searchEditor.setText("");
    clearTimeout(this.searchUpdateTimer);
    this.instant = true;
  }

  clearQuery(options = {}) {
    this.searchQuery = "";
    this.refs.searchEditor.setText("");
    if (options.scrollToSelection) {
      requestAnimationFrame(() => this.scrollToSelectedHeader());
    }
  }

  scrollToSelectedHeader() {
    const block = this.getVisibleSelectedHeaderBlock();
    if (block) {
      this.scrollToElement(block);
    }
  }

  highlightMatchesInElement(text, matches) {
    let el = [];
    let matchedChars = [];
    let lastIndex = 0;
    for (const matchIndex of matches) {
      const unmatched = text.substring(lastIndex, matchIndex);
      if (unmatched) {
        if (matchedChars.length > 0) {
          el.push(<span class="character-match">{matchedChars.join("")}</span>);
          matchedChars = [];
        }
        el.push(<span>{unmatched}</span>);
      }
      matchedChars.push(text[matchIndex]);
      lastIndex = matchIndex + 1;
    }
    if (matchedChars.length > 0) {
      el.push(<span class="character-match">{matchedChars.join("")}</span>);
    }
    const unmatched = text.substring(lastIndex);
    if (unmatched) {
      el.push(<span>{unmatched}</span>);
    }
    return el;
  }
}

module.exports = { NavigationTree };
