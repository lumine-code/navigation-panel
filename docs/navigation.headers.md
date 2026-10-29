# navigation.headers

Reads the outline the navigation panel currently shows: which editor it belongs to, the flattened header list, and when it changes.

|             |                                                                       |
| ----------- | --------------------------------------------------------------------- |
| Version     | `1.0.0`                                                               |
| Provided by | `provideNavigationHeaders()` returning the query facade               |
| Consumed by | `consumeNavigationHeaders(service)`                                   |
| Owner       | [`navigation-panel`](https://github.com/lumine-code/navigation-panel) |

The read-out side of the panel. To make a _different kind of pane item_ produce headers, provide [`navigation.adapter`](navigation.adapter.md) instead.

## Registration

In your `package.json`:

```json
{
  "consumedServices": {
    "navigation.headers": {
      "versions": { "^1.0.0": "consumeNavigationHeaders" }
    }
  }
}
```

## Contract

```ts
type NavigationHeaders = {
  getEditor(): TextEditor | object | null;
  getFlattenHeaders(): Header[];
  onDidUpdateHeaders(
    callback: (item: TextEditor | object | null, headers: Header[] | null) => void,
  ): Disposable;
  observeHeaders(
    callback: (item: TextEditor | object | null, headers: Header[] | null) => void,
  ): Disposable;
};

type Header = {
  id: string;
  text: string;
  level: number;
  revel: number;
  startPoint?: { row: number; column: number };
  endPoint?: { row: number; column: number };
  classList?: string[];
  children?: Header[];
  currentCount?: number;
  stackCount?: number;
  visibility?: number;
};
```

| Member                         | Description                                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `getEditor()`                  | The pane item the headers describe, or `null`. **Not always a `TextEditor`** — an adapter may supply any item. |
| `getFlattenHeaders()`          | The headers as a flat list, with nesting expressed by `level`.                                                 |
| `onDidUpdateHeaders(callback)` | Fires when the header set changes.                                                                             |
| `observeHeaders(callback)`     | The same, but **also fires immediately** with the current headers.                                             |

## Minimal example

```js
module.exports = {
  consumeNavigationHeaders(service) {
    return service.observeHeaders((item, headers) => {
      this.drawMarkers(
        lumine.workspace.isTextEditor(item) && headers ? service.getFlattenHeaders() : [],
      );
    });
  },
};
```

## Behavior

**Prefer `observeHeaders`.** It replays the current state on subscribe, which is almost always what a consumer wants; `onDidUpdateHeaders` leaves you blank until the next change, which for a stable document may be never.

`getEditor()` can return a non-editor pane item, because an adapter may have supplied the headers. Guard before calling `TextEditor` methods on it.

Built-in scans may return a bounded outline. Header arrays and `getFlattenHeaders()` expose a non-enumerable `outlineStatus` object with `complete`, `omittedRows`, `headingLimit`, and `labelPreviews`. An omitted row count refers to complete regular-expression contexts above the 65,536-unit input budget; reStructuredText contexts span two rows. `headingLimit` means scanning stopped after retaining 5,000 headings, so the number of later headings is unknown. Labels above 1,024 UTF-16 units are visibly elided, and Copy Header Text copies the displayed caption. Source positions for retained headings are not truncated.

`getFlattenHeaders()` returns every header in tree order and retains each header's `children`. `level` is the scanner or adapter's declared level; `revel` is its actual tree depth. Subscription callbacks receive the pane item first and the nested header tree second, or `null` when no supported headers are available.

`id` identifies an entry across tree, search, and modal-list updates. Adapters can supply stable IDs; otherwise the panel generates unique IDs from locations or labels and tree order.

`startPoint` and `endPoint` carry buffer positions for text-editor headers. Adapter headers may omit positions, and any supplied positions belong to the pane item's own document. Check both the pane item and the point before treating it as a text-editor position.

Structural updates replace the list. Current, ancestor and visible state updates may preserve the tree and its entry identities; they still notify subscribers with the updated state. Do not use array identity alone to decide whether the reported outline changed.

## Teardown

Both subscribe methods return a `Disposable`. Return it from your consumer method, and clear what you drew — the panel will not tell you it has gone away.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
