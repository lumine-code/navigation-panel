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
    callback: (headers: Header[], options?: { instant?: boolean }) => void,
  ): Disposable;
};

type Header = {
  text: string;
  level: number;
  children: Header[];
  classList?: string[];
  currentCount?: number;
  stackCount?: number;
  filePath?: string;
  row?: number;
};
```

| Member                           | Description                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `handlesItem(item)`              | Whether this adapter owns the pane item. Asked on every active-item change.                                    |
| `observeHeaders(item, callback)` | Start reporting headers for that item. Call the callback with the current list, and again whenever it changes. |

A header needs `text`, `level`, and `children` (use `[]` for a leaf). `currentCount` and `stackCount` mark the entry as the current one so the panel highlights it. `filePath` makes the row open a file; `row` makes it jump to a buffer position.

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
    };
  },
};
```

## Behavior

`observeHeaders` is a **push**: call the callback once immediately with the current list, then again on every change. The panel does not poll.

Pass `{ instant: true }` when the list is already known and no scan is needed. It suppresses the panel's debounce so the outline appears without the usual settling delay — right for a list you can produce synchronously, wrong for one you compute.

An adapter that is registered while its item is already active is **subscribed immediately**, so a package activating late still populates the panel without the user switching tabs.

The panel keeps the existing tree when a pane split produces a new item sharing the same buffer, so a split does not flash an empty outline. An adapter for a non-buffer item does not benefit from that and should return its headers promptly.

Adapters are consulted in registration order; the first whose `handlesItem` returns `true` wins.

## Teardown

Return a `Disposable` from `observeHeaders` that stops your own watching — it is disposed when the item is deactivated or the panel moves on. `consumeNavigationAdapter` separately returns a `Disposable` that unregisters the adapter entirely.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
