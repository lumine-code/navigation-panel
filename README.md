# navigation-panel

Document outline and navigation panel.

Navigate through custom section markers in text editors with tree view, filtering, and folding support.

## Features

- **Tree navigation**: browse document structure with collapsible sections.
- **Multi-level headers**: automatic level calculation for nested sections.
- **Category markers**: tag headers as info, success, warning, or error.
- **Section folding**: fold/unfold sections and view as table of contents.
- **Multiple scopes**: LaTeX, Python, Markdown, JavaScript, and more. Individual built-in scanners can be disabled in settings to let a community adapter take over.
- **Adapter support**: external packages can provide navigation headers for any pane item type via the `navigation-adapter` service. Used by [pdf-view](https://github.com/lumine-code/pdf-view), [image-editor](https://github.com/lumine-code/image-editor), and [jove-view](https://github.com/lumine-code/jove-view).

## Installation

To install `navigation-panel` search for _navigation-panel_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/navigation-panel`.

## Commands

Commands available in `atom-workspace`:

- `navigation-panel:open`: open navigation panel,
- `navigation-panel:open-and-split-down`: open navigation panel in split down,
- `navigation-panel:hide`: hide navigation panel,
- `navigation-panel:toggle`: toggle navigation panel,
- `navigation-panel:toggle-focus`: open and focus navigation panel, or return focus to editor if already focused,
- `navigation-panel:list`: open fuzzy modal list of current headers,
- `navigation-panel:next-header`: navigate to next visible header,
- `navigation-panel:previous-header`: navigate to previous visible header,
- `navigation-panel:fold-toggle`: toggle fold of current section,
- `navigation-panel:fold-section`: fold current section,
- `navigation-panel:fold-section-at-N`: fold last section at level N,
- `navigation-panel:fold-as-table`: fold all sections as table of contents,
- `navigation-panel:fold-all-infos`: fold all info sections,
- `navigation-panel:fold-all-successes`: fold all success sections,
- `navigation-panel:fold-all-warnings`: fold all warning sections,
- `navigation-panel:fold-all-errors`: fold all error sections,
- `navigation-panel:unfold`: unfold current section,
- `navigation-panel:unfold-all`: unfold all sections,
- `navigation-panel:markers-toggle`: toggle navigation markers.

Commands available in `.navigation-panel`:

- `navigation-panel:search`: focus search editor,
- `navigation-panel:clear`: clear search editor,
- `navigation-panel:toggle-search-focus`: toggle focus between search and header list,
- `navigation-panel:select-previous-header`: select previous header,
- `navigation-panel:select-next-header`: select next header,
- `navigation-panel:collapse-selected-header`: collapse selected header,
- `navigation-panel:expand-selected-header`: expand selected header,
- `navigation-panel:open-selected-header`: open selected header,
- `navigation-panel:copy-header-text`: copy header text to clipboard,
- `navigation-panel:all-categories`: activate all categories,
- `navigation-panel:none-categories`: deactivate all categories,
- `navigation-panel:categories-toggle`: toggle all categories,
- `navigation-panel:info-toggle`: toggle info category headers,
- `navigation-panel:success-toggle`: toggle success category headers,
- `navigation-panel:warning-toggle`: toggle warning category headers,
- `navigation-panel:error-toggle`: toggle error category headers,
- `navigation-panel:standard-toggle`: toggle category-less headers,
- `navigation-panel:collapse-mode`: collapse all headers now and if rebuilding,
- `navigation-panel:expand-mode`: uncollapse all headers now and if rebuilding,
- `navigation-panel:auto-collapse`: expand only active headers,
- `navigation-panel:focus-current`: scroll panel to current header,
- `navigation-panel:text-wrap-toggle`: toggle text wrapping in the panel,
- `navigation-panel:search-bar-toggle`: toggle the search bar,
- `navigation-panel:category-bar-toggle`: toggle the category bar.

Commands available in `.navigation-panel-list`:

- `select-list:scroll`: scroll to selected header.

## Sections panel

This package provides a panel for navigating through custom symbols in text editors. The tree items are manually created by inserting special markers into the text editor. Multiple scopes are supported (see below) with their own marker system. The package supports multiple cursors.

## Real section level

The package introduces the concept of multi-level headers. The user enters a tag with a level, which indicates **the maximum level** of the text associated with that tag. The actual level of the header will be determined when building the header tree using the rule that a header can have a level at most one greater than its predecessor. For example, if you enter a level 1 heading, then a level 2 heading, and then a level 5 heading, the actual level of the last heading will be 3. The marker designations are for real headers. The real section level is used everywhere instead of the user level.

## Highlight section

For each header, the package can create a marker to highlight the corresponding line of text in the editor. The marker style can be customized.

## Panel interactions

A panel has few handy commands. There are mouse interactions:

- use LeftMouseButton to navigate to item,
- use Ctrl+LeftMouseButton to create a new cursor on the header line and scroll to (text editors only),
- use Alt+LeftMouseButton to copy item text to clipboard.

At context menu there are shortcuts to modify settings locally.

## Search bar

Headers can be filtered. Fuzzy-finder is used and items are sorted by score.

## Categories

Headers can be marked with categories. The categories can be filtered in the bottom bar of the panel, the context menu of the panel, or using commands. The categories are predefined: info, success, warning, error. The meaning of the categories depends on the creativity of the user, so you can use them as you like.

## Collapse modes

The elements of the header tree can be collapsed, which can improve workflow or document clarity. The global settings can be changed in the package settings, and local settings can be adjusted using the context menu of the panel or through commands.

## Regex testing

In order to search for markers in a text editor, all lines of the editor are tested using global regular expressions. If the global expression returns a positive search result, the matched lines are further processed. Global expressions can be found below, with different expressions for each scope.

You can test and analyze the regex patterns below on [regex101](https://regex101.com/). Just select the flavor as `ECMAScript (JavaScript)` and paste the statement.

## Supported scopes

### ASCII

Global regular expression is `^(=={0,5}|#\#{0,5})[ \t]+(.+?)(?:[ \t]+\1)?$`.

### LaTeX

Global regular expression is `([^%\n]*)%(\$+)([\*\+\-\!\_]?)%(.*)|^[^\%\n]*\\(part*?|chapter*?|section*?|subsection*?|subsubsection*?|paragraph*?|subparagraph*?)\*?(?:\[(.*)\])?{(.*)}`. The `\part{...}` is equal level 4, `\chapter{...}` is level 5 etc. The section commands can be changed in package settings.

- e.g. `%$!% Countries` -> `1. Countries` with error category
- e.g. `%$$% United Kingdom` -> `1.1. United Kingdom`
- e.g. `\part{Resources}` -> `1.1.1.1. Resources`
- e.g. `\part[Resources]{Resources but to long to TOC}` -> `1.1.1.1. Resources`

In case of `([^%\n]*)%(\$+)%(.*)`, the additional letter can be used to provide additional visual effect:

- `*`: info category
- `+`: success category
- `-`: warning category
- `!`: error category
- `_`: separator category

### BibTeX

Global regular expression is `([^%\n]*)%(\$+)([\*!-]?)%(.*)|^[ ]*\@(\w*)[ ]*{[ ]*([^\,]*)`. The `@<type>{<text>,` is level 6.

- e.g. `%$% Bibliography about countries` -> `1. Bibliography about countries`
- e.g. `%$$% United Kingdom` -> `1.1. United Kingdom`
- e.g. `@book{jk2021, ...` -> `1.1.1.1.1.1. jk2021`

Additional letter can be used to provide additional visual effect:

- `*`: info category
- `+`: success category
- `-`: warning category
- `!`: error category
- `_`: separator category

### Markdown

Global regular expression is `^ *(\#+) (.*)`. The level is defined as count of `#`. The number of levels is endless.

- e.g. `# Countries` -> `1. Countries`
- e.g. `### United Kingdom` -> `1.1. United Kingdom`

### Tasklist

Global regular expression is `(?:^(#+) +(.+?) *$|^ *(.+?) *: *$)`. The level is defined as count of `#`. The number of levels is endless. A header level is equal 5.

- e.g. `# Countries` -> `1. Countries`
- e.g. `### United Kingdom` -> `1.1. United Kingdom`
- e.g. `United Kingdom:` -> `1.1.1.1.1. United Kingdom`

### Python

Global regular expression is `^([^#\n]*)#(?:%%)?(\$+[spv1]?|\?)([\*\+\-\!\_]?)#(.*)` where count of `$` mean the level on list. Headers are compatible with [jove-repl](https://github.com/lumine-code/jove-repl) cells.

Additional letter can be used to provide additional parse effect:

- `s`: get only text from first string which occur at line
- `p`: python def or class; show only type and name of object
- `v`: variable; show only name of variable
- `1`: use only first word (split by whitespace), without optional after-colon

One additional letter can be used to assign a category:

- `*`: info category
- `+`: success category
- `-`: warning category
- `!`: error category

Any additional letters can be used to provide additional visual effect:

- `_`: separator line above the item
- `<`: increase font size
- `;`: font weight is bold

As special case you can use `#?#` or `#?<category>#` which mean auto level base on pattern `<any>(<lvl as int>, "<text>"<any>)`. It is useful e.g. in PyLaTex or similar.

- e.g. `#$# Countries` -> `1. Countries`
- e.g. `#$$$# Countries` -> `1. Countries` and cell marker
- e.g. `#$$# United Kingdom` -> `1.1. United Kingdom`
- e.g. `a = 5 #$$v#` -> `1.1. a`
- e.g. `class MyCounty(Country): #$$p#` -> `1.1. MyCounty`
- e.g. `document.section(1, 'Countries') #?!#` -> `1. Countries`
- e.g. `document.section(2, 'United Kingdom') #?+#` -> `1.1. United Kingdom` with success category
- e.g. `document.section(2, 'United Kingdom') #?!#` -> `1.1. United Kingdom` with error category

### C-like

Global regular expression is `^([^\/\/\n]*)\/\/(\$+[sv1]?|\?)([\*\+\-\!\_]?)\/\/(.*)` where count of `$` mean the level on list.

Additional letter can be used to provide additional parse effect:

- `s`: get only text from first string which occur at line
- `v`: variable; show only name of variable
- `1`: use only first word (split by whitespace)

Additional letter can be used to provide additional visual effect:

- `*`: info category
- `+`: success category
- `-`: warning category
- `!`: error category
- `_`: separator category

As special case you can use `//?//` or `//?<category>//` which mean auto level base on pattern `<any>(<lvl as int>, "<text>"<any>)`.

- e.g. `//$// Countries` -> `1. Countries`
- e.g. `//$$// United Kingdom` -> `1.1. United Kingdom`
- e.g. `a = 5 //$$v//` -> `1.1. a`
- e.g. `document.section(1, 'Countries') //?!//` -> `1. Countries`
- e.g. `document.section(2, 'United Kingdom') //?+//` -> `1.1. United Kingdom` with success category
- e.g. `document.section(2, 'United Kingdom') //?!//` -> `1.1. United Kingdom` with error category

### JavaScript

Global regular expression is `^([^\/\/\n]*)\/\/(?:%%)?(\$+[scfv1]?|\?)([\*\+\-\!\_]?)\/\/(.*)` where count of `$` mean the level on list.

Additional letter can be used to provide additional parse effect:

- `s`: get only text from first string which occur at line
- `c`: class, interface or enum; show only type and name of object
- `f`: function; show function, const, let, var, or async declarations
- `v`: variable; show only name of variable (const/let/var)
- `1`: use only first word (split by whitespace), without optional after-brace

One additional letter can be used to assign a category:

- `*`: info category
- `+`: success category
- `-`: warning category
- `!`: error category

Any additional letters can be used to provide additional visual effect:

- `_`: separator line above the item
- `<`: increase font size
- `;`: font weight is bold

As special case you can use `//?//` or `//?<category>//` which mean auto level base on pattern `<any>(<lvl as int>, "<text>"<any>)`.

- e.g. `//$// Main Section` -> `1. Main Section`
- e.g. `//$$// Sub Section` -> `1.1. Sub Section`
- e.g. `class MyClass { //$c// Class definition` -> `1. MyClass`
- e.g. `function myFunc() { //$f// Function` -> `1. myFunc`
- e.g. `const value = 10; //$$v//` -> `1.1. value`
- e.g. `document.section(1, 'Main') //?!//` -> `1. Main` with error category
- e.g. `document.section(2, 'Sub') //?+//` -> `1.1. Sub` with success category

### ReStructuredText

Global regular expression is `^(.+)\n([!-/:-@[-[-~])\2+$`.

### SOFiSTiK

Global regular expression is `^ *(#define [^\n=]+$|#enddef)|^!([+-\\#\\$])!(?:chapter|kapitel) (.*)|(^(?! *\$)[^!\n]*)!(\$+)!(.*)|^ *([+-])?prog +([^\n]*)(?:\n *head +(.+))?|^ *!.! +(.*)|^\$ graphics +(\d+) +\| +picture +(\d+) +\| +layer +(\d+) +: *(.*)`. The `chapter` is equal level 4, `prog` is equal level 5 and `label` is equal level 6.

- e.g. `!$! Design slab` -> `1. Design slab`
- e.g. `!$$! Req. reinforcement` -> `1.1. Req. reinforcement`
- e.g. `!+!Chapter Design` -> `1.1.1.1. Design`
- e.g. `+prog aqua` -> `1.1.1.1.1. aqua`
- e.g. `+prog aqua \n head sections` -> `1.1.1.1.1.1. aqua: head sections`

### Typst

Global regular expression is:

```
^(`{3,})|^ *(=+) (.+)$
```

The level is defined as count of `=`. The number of levels is endless. Headings inside raw blocks (fenced with triple backticks) are skipped.

- e.g. `= Countries` -> `1. Countries`
- e.g. `=== United Kingdom` -> `1.1. United Kingdom`

### Sinumerik

Global regular expression is `^;{2}[*+\-!]? (.+)$`.

- e.g. `;;* TODO`

Additional letter can be used to provide additional visual effect:

- `*`: info category
- `+`: success category
- `-`: warning category
- `!`: error category

### pdf-view

[pdf-view](https://github.com/lumine-code/pdf-view) provides its document outline via the `navigation-adapter` service. You can search the entire outline tree instead of the built-in PDFjs outline. A section number filter and scroll-position tracking are supported. Configure the filter in pdf-view settings (`snoFilter`).

### image-editor

[image-editor](https://github.com/lumine-code/image-editor) provides its folder file list via the `navigation-adapter` service.

### jove-view

[jove-view](https://github.com/lumine-code/jove-view) provides markdown cell headings via the `navigation-adapter` service. Clicking a heading activates the corresponding cell and scrolls to it.

## Adapter API

External packages provide navigation headers for any pane item type through the `navigation-adapter` service. When an adapter is registered and its `handlesItem` returns true for the active pane item, the panel displays headers provided by the adapter instead of running a built-in scanner.

In your `package.json`:

```json
{
  "providedServices": {
    "navigation-adapter": {
      "versions": {
        "1.0.0": "provideNavigationAdapter"
      }
    }
  }
}
```

In your main module:

```javascript
module.exports = {
  provideNavigationAdapter() {
    return {
      // Return true if this adapter handles the given pane item
      handlesItem: (item) => item instanceof MyCustomEditor,

      // Push a nested tree array initially and whenever headers or state change.
      // Must return a Disposable.
      observeHeaders: (item, callback) => {
        callback(item.getNavigationHeaders(), { instant: true });
        return item.onDidChangeNavigation(() => {
          callback(item.getNavigationHeaders());
        });
      },

      // Navigate to the given header.
      // options.focus    – false when scrolling without switching focus
      // options.addCursor – true on Ctrl+click (add cursor, do not move)
      navigateTo: (item, header, options) => item.revealHeader(header, options),
    };
  },
};
```

Header objects should have `{ text, level, classList, children }`, where `children` is an array of child header objects. The adapter should build the nested structure and decide when to push a replacement tree. If the adapter tracks current or visible state, it should include that state directly on the pushed headers using `currentCount` / `stackCount` and `visibility`, or the public aliases `current` / `active` and `visible`.

The panel augments the tree with navigation callbacks and default display state, but it does not derive hierarchy from a flat list or compute adapter current/visible state.

## Customization

The style can be adjusted according to user preferences in the `styles.less` file:

- e.g. all markers have highlighted background, but only level 1, 2 and 3 have their own color:

  ```less
  .navigation-marker {
    background: rgba(233, 228, 141, 0.3);
  }
  .navigation-marker-3 {
    background: rgba(200, 197, 243, 0.3);
  }
  .navigation-marker-2 {
    background: rgba(250, 192, 209, 0.3);
  }
  .navigation-marker-1 {
    background: rgba(197, 218, 131, 0.3);
  }
  ```

- e.g. add top border to markers with level 1:

  ```less
  .navigation-marker-1 {
    border-top: 0.016px solid var(--text-color-info);
  }
  ```

- e.g. change font to monospace:

  ```less
  .navigation-panel {
    font-family: monospace;
  }
  ```

- e.g. change style of visible headers:
  ```less
  .navigation-panel .visible {
    background: color-mix(in srgb, green 5%, transparent);
  }
  ```

## Services

- **navigation-panel** (`1.0.0`): provided to let other packages read the current outline — exposes `getEditor()`, `getFlattenHeaders()`, `onDidUpdateHeaders(callback)`, and `observeHeaders(callback)`.
- **navigation-adapter** (`^1.0.0`): consumed to let external packages provide navigation headers for any pane item type — see the Adapter API chapter.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
