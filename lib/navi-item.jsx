/** @jsx etch.dom */
const etch = require("@lumine-code/etch");

const itemViews = new WeakMap();

class NavigationItem {
  constructor(props) {
    this.updateProps(props);
    if (this.states.visibility === 2 || this.states.collapseWork === 2) {
      this.showChildren = this.computeAutoCollapseShow();
    } else {
      this.showChildren = Boolean(this.states.visibility);
    }
    etch.initialize(this);
    this.writeAfterUpdate();
  }

  update(props) {
    this.updateProps(props);
    if (this.states.visibility === 2 || this.states.collapseWork === 2) {
      this.showChildren = this.computeAutoCollapseShow();
    } else if (this.states.collapseWork !== null) {
      this.showChildren = Boolean(this.states.visibility);
    }
    return etch.update(this);
  }

  computeAutoCollapseShow() {
    if (this.item.stackCount > 0) {
      return true;
    }
    if (this.item.traceByVisibility) {
      return this.item.visibility > 0 || this.checkChildrenVisibility(this.item);
    }
    return false;
  }

  updateProps(props) {
    if (this.item && this.item !== props.item && itemViews.get(this.item) === this) {
      itemViews.delete(this.item);
    }
    this.item = props.item;
    itemViews.set(this.item, this);
    this.states = props.states;
    this.skipNextScroll = props.skipNextScroll;
    this.clearSearchAfterNavigate = props.clearSearchAfterNavigate;
  }

  destroy() {
    if (itemViews.get(this.item) === this) itemViews.delete(this.item);
    etch.destroy(this);
  }

  updateVisibility() {
    // collapseWork is a one-render command. Its copied value can outlive the
    // tree's readAfterUpdate reset, so only the persistent mode responds to
    // later viewport-only updates.
    if (this.states.visibility === 2) {
      const showChildren = this.computeAutoCollapseShow();
      if (showChildren !== this.showChildren) {
        this.showChildren = showChildren;
        return etch.update(this);
      }
    }
    this.refs.block?.classList.toggle("visible", this.hasVisibleTrace());
    return null;
  }

  hasVisibleTrace() {
    return Boolean(
      this.item.visibility ||
      (!this.showChildren && this.item.children.length && this.checkChildrenVisibility(this.item)),
    );
  }

  render() {
    if (this.item.classList.includes("info")) {
      if (!this.states.info) {
        return <div />;
      }
    } else if (this.item.classList.includes("success")) {
      if (!this.states.success) {
        return <div />;
      }
    } else if (this.item.classList.includes("warning")) {
      if (!this.states.warning) {
        return <div />;
      }
    } else if (this.item.classList.includes("error")) {
      if (!this.states.error) {
        return <div />;
      }
    } else if (!this.states.standard) {
      return <div />;
    }

    let iconClass;
    if (this.item.children.length) {
      if (this.showChildren) {
        iconClass = " icon-chevron-down";
      } else {
        iconClass = " icon-chevron-right";
      }
    } else {
      iconClass = " icon-one-dot";
    }

    let naviList;
    if (this.item.children.length && this.showChildren) {
      naviList = this.item.children.map((item) => {
        return (
          <NavigationItem
            item={item}
            key={item.startPoint.row}
            skipNextScroll={this.skipNextScroll}
            states={this.states}
          />
        );
      });
    } else {
      naviList = "";
    }

    let stackClass = this.item.stackCount > 0 ? " stack" : "";
    let currentClass = this.item.currentCount > 0 ? " current" : "";

    let naviClass = this.item.classList.length ? " " + this.item.classList.join(" ") : "";

    return (
      <div class={"navigation-tree" + stackClass} ref="tree">
        <div class={"navigation-block" + naviClass + currentClass} ref="block">
          <div
            class={"navigation-icon navigation-state-icon" + iconClass}
            on={{ click: this.toggleNested }}
          />
          {this.item.display ? this.item.display : ""}
          {this.item.filterResult && this.item.badge != null ? (
            <span class="badge badge-flexible">{this.item.badge}</span>
          ) : this.item.filterRow !== null && this.item.filterRow !== undefined ? (
            <span class="badge badge-flexible">{this.item.filterRow + 1}</span>
          ) : (
            ""
          )}
          <div class="navigation-text" on={{ click: this.scrollToLine }}>
            {this.item.filterResult ? this.item.filterResult : this.item.text}
          </div>
        </div>
        {naviList}
      </div>
    );
  }

  checkChildrenVisibility(item) {
    return (
      item.visibility ||
      !!item.children.filter((child) => this.checkChildrenVisibility(child)).length
    );
  }

  scrollToLine(e) {
    if (!this.item.navigate) return;
    if (e.ctrlKey) {
      this.item.navigate({ addCursor: true });
      return;
    }
    if (e.altKey) {
      this.clearSearchAfterNavigate?.();
      this.item.navigate();
      return;
    }
    this.skipNextScroll?.();
    this.item.navigate();
  }

  toggleNested() {
    this.setCollapsed(this.showChildren);
  }

  setCollapsed(collapsed, options = {}) {
    if (!this.item.children.length) {
      return false;
    }
    if (this.showChildren === !collapsed) {
      return Boolean(options.allowAlreadyCollapsed);
    }
    this.showChildren = !collapsed;
    etch.update(this);
    return true;
  }

  writeAfterUpdate() {
    if (this.refs.tree) {
      this.refs.tree.navigationTreeView = this;
    }
    // Viewport updates own this class outside Etch. Reapply it after a render
    // so switching editors cannot leave the trace from the previous viewport
    // when Etch finds the rest of the cached class attribute unchanged.
    this.refs.block?.classList.toggle("visible", this.hasVisibleTrace());
  }
}

function getNavigationItemView(item) {
  return itemViews.get(item) ?? null;
}

module.exports = { NavigationItem, getNavigationItemView };
