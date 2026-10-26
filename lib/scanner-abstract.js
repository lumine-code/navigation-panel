const INPUT_LIMIT = 65536;
const HEADING_LIMIT = 5000;
const LABEL_LIMIT = 1024;
class HeadingLimit extends Error {}

function rowPattern(source) {
  let result = "",
    inClass = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === "\\") {
      result += char + (source[++index] ?? "");
      continue;
    }
    if (char === "[") inClass = true;
    if (char === "]") inClass = false;
    result +=
      !inClass && char === "^" ? "(?<![^\\n])" : !inClass && char === "$" ? "(?=\\r?\\n|$)" : char;
  }
  return result;
}

function preview(text) {
  if (text.length <= LABEL_LIMIT) return text;
  let end = LABEL_LIMIT;
  if (text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--;
  return text.slice(0, end) + "…";
}

class ScannerAbstract {
  constructor(editor) {
    this.editor = editor;
    this.maxDepth = Math.min(64, lumine.config.get("navigation-panel.editor.maxHeadingDepth"));
    this.regex = this.getRegex();
  }

  getRegex() {
    return;
  }

  beforeScan() {
    return;
  }

  scan(callback, options = {}) {
    const buffer = this.editor.getBuffer();
    const source = buffer.getTextSnapshot();
    return this.runSteps(this.scanRows(source, callback), source, options);
  }

  runSteps(steps, source, { signal } = {}) {
    const buffer = this.editor.getBuffer();
    const revision = buffer.getTextRevision();
    const generation = (this.scanGeneration = (this.scanGeneration ?? 0) + 1);
    const check = () => {
      signal?.throwIfAborted();
      if (
        this.editor.isDestroyed() ||
        buffer.getTextRevision() !== revision ||
        this.scanGeneration !== generation
      )
        throw new DOMException("The navigation scan was superseded.", "AbortError");
    };
    const step = () => {
      check();
      return steps.next();
    };
    if (source.length <= INPUT_LIMIT) {
      while (!step().done) {
        /* bounded synchronous inputs retain the existing API */
      }
      return;
    }
    return (async () => {
      let deadline = performance.now() + 4;
      while (!step().done)
        if (performance.now() >= deadline) {
          await new Promise((resolve) => setImmediate(resolve));
          deadline = performance.now() + 4;
        }
    })();
  }

  *scanRows(source, callback) {
    const windowRows = this.windowRows ?? 1;
    const regex = new RegExp(
      rowPattern(this.regex.source),
      [...new Set(this.regex.flags.replace(/m/g, "") + "g")].join(""),
    );
    let resume = 0;
    for (let row = 0; row < source.lineCount; row++) {
      yield;
      const start = source.lineStart(row);
      if (windowRows > 1 && resume > start) continue;
      const lastRow = Math.min(source.lineCount - 1, row + windowRows - 1);
      let end = lastRow + 1 < source.lineCount ? source.lineStart(lastRow + 1) - 1 : source.length;
      if (end > start && source.charCodeAt(end - 1) === 13) end--;
      if (end - start > INPUT_LIMIT) {
        this.status.omittedRows++;
        const omitted = this.omittedRow?.(source, start, end, row);
        if (omitted) {
          const consumedEnd = yield* omitted;
          if (Number.isSafeInteger(consumedEnd)) resume = Math.max(resume, consumedEnd);
        }
        continue;
      }
      const text = source.slice(start, end);
      regex.lastIndex = Math.max(0, resume - start);
      let match;
      while ((match = regex.exec(text))) {
        if (windowRows > 1 && source.positionAt(start + match.index).row !== row) break;
        const matchStart = start + match.index,
          matchEnd = matchStart + match[0].length;
        const range = { start: source.positionAt(matchStart), end: source.positionAt(matchEnd) };
        const expected = match[0];
        callback({
          range,
          match,
          matchText: expected,
          replace: (replacement) => {
            if (this.editor.isDestroyed()) return;
            if (this.editor.getTextInBufferRange(range) === expected)
              this.editor.setTextInBufferRange(range, replacement);
          },
        });
        resume = matchEnd;
        if (!match[0].length) regex.lastIndex++;
      }
    }
  }

  getHeaders(options) {
    let headers = [];
    let closeRow = this.editor.getLineCount();
    let lastItem = null;
    if (!this.editor) {
      return headers;
    }
    this.beforeScan();
    this.status = { complete: true, omittedRows: 0, headingLimit: false, labelPreviews: 0 };
    const status = this.status;
    let count = 0;
    const consume = (object) => {
      let item = this.parse(object);
      if (!item) {
        return;
      }
      if (count === HEADING_LIMIT) {
        if (lastItem) lastItem.lastRow = object.range.start.row - 1;
        status.headingLimit = true;
        throw new HeadingLimit();
      }
      count++;
      item.text = item.text.trim();
      if (item.text.length > LABEL_LIMIT) {
        status.labelPreviews++;
        item.text = preview(item.text);
      }
      item.children = [];
      item.editor = this.editor;
      ((item.startPoint = object.range.start), (item.endPoint = object.range.end));
      item.lastRow = closeRow;
      item.currentCount = 0;
      item.stackCount = 0;
      this.stacker(headers, item, 1);
      if (lastItem) {
        lastItem.lastRow = item.startPoint.row - 1;
      }
      lastItem = item;
    };
    const finish = () => {
      status.complete = !status.omittedRows && !status.headingLimit;
      Object.defineProperty(headers, "outlineStatus", { value: status, enumerable: false });
      return headers;
    };
    const failed = (error) => {
      if (error instanceof HeadingLimit) return finish();
      throw error;
    };
    try {
      const scanned = this.scan(consume, options);
      return scanned?.then ? scanned.then(finish, failed) : finish();
    } catch (error) {
      return failed(error);
    }
  }

  stacker(stack, item, revel) {
    while (revel <= this.maxDepth) {
      item.revel = revel;
      if (!stack.length || stack.at(-1).level >= item.level) {
        stack.push(item);
        return;
      }
      stack = stack.at(-1).children;
      revel++;
    }
  }

  parse(object) {
    return {
      level: object.level,
      text: object.text,
      classList: object.classList,
    };
  }
}

module.exports = { ScannerAbstract, preview };
