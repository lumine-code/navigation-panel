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
  text: string;
  level: number;
  revel: number;
  startPoint: { row: number; column: number };
  endPoint: { row: number; column: number };
  classList?: string[];
  children?: Header[];
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

`getFlattenHeaders()` returns every header in tree order and retains each header's `children`. `level` is the scanner or adapter's declared level; `revel` is its actual tree depth. Subscription callbacks receive the pane item first and the nested header tree second, or `null` when no supported headers are available.

`startPoint` and `endPoint` carry buffer positions for text-editor headers. Adapter headers may use synthetic positions, so check the pane item before treating those points as text positions.

The list is replaced wholesale on each update; do not diff against a previous array by identity.

## Teardown

Both subscribe methods return a `Disposable`. Return it from your consumer method, and clear what you drew — the panel will not tell you it has gone away.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
