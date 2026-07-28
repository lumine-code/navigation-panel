const VIEW_ID = "navigation-panel.headers";

// The fuzzy header list. There is no view object any more: the kernel owns the
// modal, so the package only describes the rows and the two verbs.
function headerListSpec({ getItems, hasHeaders, navigate }) {
  return {
    id: VIEW_ID,
    className: "navigation-panel-list",
    placeholder: "Search headers...",
    emptyMessage: "No headers found",
    help:
      "Available commands:\n" +
      "- **Enter**: Navigate to header\n" +
      "- **Alt+Enter**: Scroll to header",
    // Read on every open and on every refresh, which is what retires the old
    // dirty flag and its "only if visible" update dance.
    source: (req) => {
      req.progress({ message: hasHeaders() ? null : "This grammar is not supported" });
      return getItems();
    },
    // Not the kernel default (command-t): the list has always ranked with
    // fuzzaldrin and changing the algorithm would reorder every result.
    matcher: atom.modals.matchers.fuzzy({ algorithm: "fuzzaldrin" }),
    renderer: {
      // The source rebuilds its items from scratch on every run, so identity
      // has to be the buffer row rather than the item object — otherwise a
      // refresh would lose the focused row.
      entry: (item, index) => ({
        id: item.startPoint ? item.startPoint.row : index,
        text: primaryTextForItem(item),
      }),
      row: (item) => ({
        label: primaryTextForItem(item),
        detail: secondaryTextForItem(item),
        className: item.classList,
      }),
    },
    actions: [
      {
        name: "scroll",
        label: "Scroll to header",
        keystroke: "alt-enter",
        run: ({ item }) => {
          navigate(item, { focus: false });
          // Previewing without leaving is the whole point of this verb: the
          // next candidate stays one keystroke away.
          return { keepOpen: true };
        },
      },
    ],
    confirm: ({ item }) => navigate(item),
  };
}

// The active session when it is ours. "Is the list up?" is now a question about
// the kernel rather than about an object the package keeps alive.
function headerListSession() {
  const session = atom.modals.getActiveSession();
  return session && session.rootSpec.id === VIEW_ID ? session : null;
}

function primaryTextForItem(item) {
  return item.text.trim();
}

function secondaryTextForItem(item) {
  if (item.badge != null) {
    return `Page ${item.badge}`;
  } else if (item.filePath) {
    return item.filePath;
  } else if (item.startPoint) {
    return `Line ${item.startPoint.row + 1}`;
  }
}

module.exports = { headerListSpec, headerListSession };
