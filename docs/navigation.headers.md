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
  onDidUpdateHeaders(callback: (headers: Header[]) => void): Disposable;
  observeHeaders(callback: (headers: Header[]) => void): Disposable;
};

type Header = {
  text: string;
  level: number;
  row?: number;
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
    return service.observeHeaders((headers) => {
      this.drawMarkers(headers.filter((header) => header.row != null));
    });
  },
};
```

## Behavior

**Prefer `observeHeaders`.** It replays the current state on subscribe, which is almost always what a consumer wants; `onDidUpdateHeaders` leaves you blank until the next change, which for a stable document may be never.

`getEditor()` can return a non-editor pane item, because an adapter may have supplied the headers. Guard before calling `TextEditor` methods on it.

Headers arrive flattened. `level` carries the nesting depth, so a consumer rendering a tree rebuilds it from that rather than walking `children`.

`row` is absent for headers that do not correspond to a buffer row — an adapter listing files, for instance — so filter before treating them as positions.

The list is replaced wholesale on each update; do not diff against a previous array by identity.

## Teardown

Both subscribe methods return a `Disposable`. Return it from your consumer method, and clear what you drew — the panel will not tell you it has gone away.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
