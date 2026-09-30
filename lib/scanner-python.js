const { ScannerAbstract } = require("./scanner-abstract");
const { Point } = require("lumine");

const SLICE_MS = 8;
const CHUNK_NODES = 512;
const pendingHeaders = new WeakMap();

function isFragment(editor) {
  return lumine.textEditors.roleFor(editor) === "fragment";
}

class ScannerPython extends ScannerAbstract {
  getRegex() {
    return /^(?:([^#\n]*)#(%%)?(\$+[spv1]?|\?)([*+\-!]?)([_<;]*)#(.*)|[\t ]*#[\t ]*(%%+)(?:[\t ]+(.*?))?[\t ]*$)/gi;
  }

  getHeaders() {
    if (this.editor.getGrammar().scopeName !== "source.python.ipy") return super.getHeaders();
    const mode = this.editor.getBuffer().getLanguageMode();
    const fragment = isFragment(this.editor);
    const existing = pendingHeaders.get(this.editor);
    if (
      existing?.mode === mode &&
      existing.fragment === fragment &&
      existing.maxDepth === this.maxDepth
    )
      return existing.promise;
    const pending = { mode, fragment, maxDepth: this.maxDepth };
    pending.promise = this.getIPythonHeaders().finally(() => {
      if (pendingHeaders.get(this.editor) === pending) pendingHeaders.delete(this.editor);
    });
    pendingHeaders.set(this.editor, pending);
    return pending.promise;
  }

  async getIPythonHeaders() {
    const buffer = this.editor.getBuffer();
    let changed = false;
    const subscription = buffer.onDidChange(() => {
      changed = true;
    });
    try {
      while (!this.editor.isDestroyed()) {
        changed = false;
        const mode = buffer.getLanguageMode();
        await mode.atTransactionEnd?.();
        if (this.editor.isDestroyed()) return [];
        if (changed || mode !== buffer.getLanguageMode()) continue;
        const tree = mode.rootLanguageLayer?.tree;
        if (!tree || this.editor.getGrammar().scopeName !== "source.python.ipy") return [];
        const fragment = isFragment(this.editor);
        const current = () =>
          !changed &&
          !this.editor.isDestroyed() &&
          mode === buffer.getLanguageMode() &&
          tree === mode.rootLanguageLayer?.tree &&
          fragment === isFragment(this.editor);
        const items = [];
        const cursor = tree.rootNode.walk();
        let depth = 1;
        let visiting = cursor.gotoFirstChild();
        let count = 0;
        let sliceStart = performance.now();
        try {
          while (visiting && current()) {
            const type = cursor.nodeType;
            let descend = true;
            if (type === "markdown_cell" || type === "raw_cell") {
              if (depth === 1 && !fragment) {
                this.addCellItem(items, cursor.currentNode.childForFieldName("marker"));
              }
              descend = false;
            } else if (type === "cell_marker") {
              if (depth === 1 && !fragment) this.addCellItem(items, cursor.currentNode);
              descend = false;
            } else if (type === "cell_body") {
              descend = false;
            } else if (type === "comment") {
              this.addCommentItem(items, cursor.startPosition);
              descend = false;
            }
            count++;
            if (
              count % CHUNK_NODES === 0 ||
              (count % 64 === 0 && performance.now() - sliceStart >= SLICE_MS)
            ) {
              await new Promise((resolve) => setImmediate(resolve));
              if (!current()) break;
              sliceStart = performance.now();
            }
            if (descend && cursor.gotoFirstChild()) {
              depth++;
            } else {
              while (depth > 0 && !cursor.gotoNextSibling()) {
                cursor.gotoParent();
                depth--;
              }
              visiting = depth > 0;
            }
          }
        } finally {
          cursor.delete();
        }
        if (!current()) continue;
        const headers = await this.headersFromItems(items, current);
        if (headers && current()) return headers;
      }
      return [];
    } finally {
      subscription.dispose();
    }
  }

  addCellItem(items, marker) {
    if (!marker) return;
    const row = marker.startPosition.row;
    const name = marker.childForFieldName("name")?.text;
    if (!name) return;
    const prefix = marker.childForFieldName("marker")?.text ?? "";
    const legacy = prefix === "#%%" && /^[$?]/.test(name) ? this.legacyItemForRow(row) : null;
    const item = legacy ?? {
      text: name,
      level: (prefix.match(/%+/)?.[0].length ?? 2) - 1,
      classList: ["cell"],
    };
    items.push({
      ...item,
      startPoint: new Point(row, 0),
      endPoint: new Point(row, this.editor.getBuffer().lineLengthForRow(row)),
    });
  }

  legacyItemForRow(row) {
    this.regex.lastIndex = 0;
    const match = this.regex.exec(this.editor.lineTextForBufferRow(row));
    return match?.[3] ? this.parse({ match }) : null;
  }

  addCommentItem(items, start) {
    const end = new Point(
      start.row,
      Math.min(start.column + 4, this.editor.getBuffer().lineLengthForRow(start.row)),
    );
    if (!/^#(?:%%)?[$?]/.test(this.editor.getTextInBufferRange([start, end]))) return;
    const item = this.legacyItemForRow(start.row);
    if (item)
      items.push({
        ...item,
        startPoint: new Point(start.row, 0),
        endPoint: new Point(start.row, this.editor.getBuffer().lineLengthForRow(start.row)),
      });
  }

  async headersFromItems(items, current) {
    const headers = [];
    let previous = null;
    let count = 0;
    let sliceStart = performance.now();
    const closeRow = this.editor.getLineCount();
    for (const item of items) {
      item.text = item.text.trim();
      item.children = [];
      item.editor = this.editor;
      item.lastRow = closeRow;
      item.currentCount = 0;
      item.stackCount = 0;
      this.stacker(headers, item, 1);
      if (previous) previous.lastRow = item.startPoint.row - 1;
      previous = item;
      count++;
      if (
        count % CHUNK_NODES === 0 ||
        (count % 64 === 0 && performance.now() - sliceStart >= SLICE_MS)
      ) {
        await new Promise((resolve) => setImmediate(resolve));
        if (!current()) return null;
        sliceStart = performance.now();
      }
    }
    return headers;
  }

  parse(object) {
    let match = object.match;
    if (isFragment(this.editor) && (match[7] || match[2])) return;

    if (match[7]) {
      let text = (match[8] || "").trim();
      text = text.replace(/^(?:md|markdown|\[md\]|\[markdown\])(?:\s+|$)/i, "").trim();
      if (!text) {
        return;
      }
      return {
        level: match[7].length - 1,
        text,
        classList: ["cell"],
      };
    }

    let level, text, subre;
    let classList = [];

    if (match[3] === "?") {
      subre = /\( *(\d+) *, *[rf]*['"](.*?)['"]/.exec(match[0]);
      if (!subre) {
        return;
      }
      level = parseInt(subre[1]);
      if (!level || level > this.maxDepth || level < 1 || level > 9) {
        return;
      } else {
        text = `${subre[2].trim()} ${match[6].trim()}`;
      }
    } else if (match[3].slice(-1) === "s") {
      subre = /['"](.*?)['"]/.exec(match[0]);
      level = match[3].length - 1;
      if (subre) {
        text = subre[1] + " " + match[6].trim();
      } else {
        text = `${match[1].trim()} ${match[6].trim()}`;
      }
    } else if (match[3].slice(-1) === "p") {
      subre = /((?:def|class)[^:(\n]*)/.exec(match[0]);
      level = match[3].length - 1;
      if (subre) {
        text = subre[1] + " " + match[6].trim();
      } else {
        text = `${match[1].trim()} ${match[6].trim()}`;
      }
    } else if (match[3].slice(-1) === "v") {
      subre = / *(.+) *=/.exec(match[0]);
      level = match[3].length - 1;
      if (subre) {
        text = subre[1] + " " + match[6].trim();
      } else {
        text = `${match[1].trim()} ${match[6].trim()}`;
      }
    } else if (match[3].slice(-1) === "1") {
      level = match[3].length - 1;

      let sr0 = match[1].split(" ")[0];
      if (sr0.slice(-1) === ":") {
        sr0 = sr0.substring(0, sr0.length - 1);
      }
      text = (sr0 + " " + match[6]).trim();
    } else {
      level = match[3].length;
      text = `${match[1].trim()} ${match[6].trim()}`;
    }

    text = text.replace(/~+/g, " ").replace(/--/g, "–");

    if (match[2]) {
      classList.push("cell");
    }
    if (match[4] === "*") {
      classList.push("info");
    } else if (match[4] === "+") {
      classList.push("success");
    } else if (match[4] === "-") {
      classList.push("warning");
    } else if (match[4] === "!") {
      classList.push("error");
    }
    if (match[5]) {
      if (new Set(match[5]).size !== match[5].length) {
        return; // don't allow duplicates
      }
      if (match[5].includes("_")) {
        classList.push("separator");
      }
      if (match[5].includes("<")) {
        classList.push("larger");
      }
      if (match[5].includes(";")) {
        classList.push("bolder");
      }
    }

    return { level, text, classList };
  }
}

module.exports = { ScannerPython };
