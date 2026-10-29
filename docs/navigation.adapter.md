# navigation.adapter

Supplies the navigation panel's outline for a pane item that is not a text document — a PDF's bookmarks, a notebook's cells, the images in a folder.

|             |                                                                       |
| ----------- | --------------------------------------------------------------------- |
| Version     | `1.0.0`                                                               |
| Provided by | `provideNavigationAdapter()` returning one adapter                    |
| Consumed by | `consumeNavigationAdapter(adapter)` returning a `Disposable`          |
| Owner       | [`navigation-panel`](https://github.com/lumine-code/navigation-panel) |

The panel normally builds headers by scanning a buffer. An adapter takes that job over for items it claims, so the same panel, the same list, and the same click-to-jump behavior work for something that has no text.

## Registration

In your `package.json`:

```json
{
  "providedServices": {
    "navigation.adapter": {
      "versions": { "1.0.0": "provideNavigationAdapter" }
    }
  }
}
```

## Contract

```ts
type NavigationAdapter = {
  handlesItem(item: object): boolean;
  observeHeaders(
    item: object,
    callback: (
      headers: Header[],
      options?: {
        instant?: boolean;
        scrollDirection?: number;
        stateChanges?: Array<{
          path: number[];
          currentCount?: number;
          stackCount?: number;
          visibility?: number;
        }>;
      },
    ) => void,
  ): Disposable;
  navigateTo(
    item: object,
    header: Header,
    options?: { focus?: boolean; addCursor?: boolean },
  ): unknown;
};

type Header = {
  id?: string;
  text: string;
  level: number;
  children: Header[];
  classList?: string[];
  currentCount?: number;
  stackCount?: number;
  filePath?: string;
  startPoint?: { row: number; column: number };
  endPoint?: { row: number; column: number };
  visibility?: number;
};
```

| Member                              | Description                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handlesItem(item)`                 | Whether this adapter owns the pane item. Asked on every active-item change.                                                                       |
| `observeHeaders(item, callback)`    | Start reporting headers for that item. Call the callback with the current list, and again whenever it changes.                                    |
| `navigateTo(item, header, options)` | Reveal the selected header in the pane item; `focus: false` keeps the panel focused and `addCursor: true` requests another cursor when supported. |

A header needs `text`, `level`, and `children` (use `[]` for a leaf). Nesting comes from `children`, rather than `level`. An optional `id` identifies the same logical entry across updates and must be unique across the entire tree, including descendants. The panel uses it for tree rendering, flattened search results, and modal-list selection. When omitted, the panel generates a unique ID from the entry's location or label and its occurrence in tree order; provide an explicit ID when entries can move or share a location.

`currentCount` marks the current entry; `stackCount` marks its active ancestors as well, so the panel can expand the current branch. The adapter supplies both. Global next/previous navigation moves relative to the current entry, falling back to the deepest active ancestor when none is current, and wraps at either end.

`startPoint` and `endPoint` are optional real positions in the pane item's own document. Omit them when an entry has no document position; the panel does not invent one. Multiple entries can share a position. `filePath` is display metadata; navigation is delegated to `navigateTo`, which receives the augmented header and its original metadata.

## Minimal example

```js
const { Disposable } = require("lumine");

module.exports = {
  provideNavigationAdapter() {
    return {
      handlesItem: (item) => item instanceof MyViewer,
      observeHeaders: (item, callback) => {
        const refresh = () => {
          const entries = item.getEntries();
          callback(
            entries.map((entry, index) => ({
              id: entry.path,
              text: entry.title,
              level: 1,
              children: [],
              classList: [],
              filePath: entry.path,
              currentCount: item.currentIndex === index ? 1 : 0,
              stackCount: item.currentIndex === index ? 1 : 0,
            })),
            { instant: true },
          );
        };
        refresh();
        return item.onDidChange(refresh);
      },
      navigateTo: (item, header, options) => item.revealEntry(header.filePath, options),
    };
  },
};
```

## Behavior

`observeHeaders` is a **push**: call the callback once immediately with the current list, then again on every change. The panel does not poll.

Pass `{ instant: true }` when the list is already known and no scan is needed. It suppresses the panel's debounce so the outline appears without the usual settling delay — right for a list you can produce synchronously, wrong for one you compute.

When only current, ancestor or visible state changes, reuse the current header tree and pass `stateChanges`. Each change names an entry by its zero-based `path` through the nested arrays and supplies the changed state fields. The panel updates those rows and their ancestors without rebuilding the outline or its search results. Publish a full tree when its hierarchy or other metadata changes. A numeric `scrollDirection` can carry the source viewport's scroll delta so tracking follows its leading or trailing visible heading. Tracking updates animate by default; reserve `instant: true` for an intentional immediate reveal. The panel honors reduced-motion preferences and cancels its animation when the user scrolls or presses the pointer in the panel.

An adapter that is registered while its item is already active is **subscribed immediately**, so a package activating late still populates the panel without the user switching tabs.

The panel keeps the existing tree when a pane split produces a new item sharing the same buffer, so a split does not flash an empty outline. An adapter for a non-buffer item does not benefit from that and should return its headers promptly.

Adapters are consulted in registration order; the first whose `handlesItem` returns `true` wins.

## Teardown

Return a `Disposable` from `observeHeaders` that stops your own watching — it is disposed when the item is deactivated or the panel moves on. `consumeNavigationAdapter` separately returns a `Disposable` that unregisters the adapter entirely.

Withdrawing the active adapter also stops its current header observer and refreshes the outline from another matching adapter or the built-in editor scanner. If the current item has no remaining adapter, its previous outline is cleared.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
