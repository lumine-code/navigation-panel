const SPECIAL_ENTRY_TYPES = new Set(["comment", "preamble", "string"]);
const IDENTIFIER_PUNCTUATION = "!$&*+-./:;<>?@[\\]^_`|~";

// Scan only top-level entry starts and custom marker lines. Walking balanced
// entries here is both cheaper than executing a tags query over the existing
// syntax tree and prevents entry-looking text inside values from leaking into
// the outline.
class BibtexLexer {
  constructor(text, callback) {
    this.text = text;
    this.read = typeof text === "string" ? null : text.reader(4096);
    this.cachedText = "";
    this.cachedStart = 0;
    this.callback = callback;
    this.index = 0;
    this.row = 0;
    this.column = 0;
    this.lineStartIndex = 0;
    this.lineHasOnlyWhitespace = true;
    this.recoveryWork = 0;
    this.recoveryType = null;
  }

  *steps() {
    while (!this.isAtEnd()) {
      yield;
      if (this.column === 0 && (yield* this.scanMarkerLine())) {
        continue;
      }

      if (
        this.lineHasOnlyWhitespace &&
        this.currentCharacter() === "@" &&
        (yield* this.looksLikeDirective(this.index))
      ) {
        yield* this.scanDirective();
        continue;
      }

      if (this.column === 0 || !this.lineHasOnlyWhitespace) {
        this.skipLine();
      } else {
        this.advance();
      }
    }
  }

  *scanMarkerLine() {
    const contentEnd = this.getLineContentEndIndex(this.getLineEndIndex(this.index));
    let first = this.index;
    if (first === 0 && this.characterAt(0) === "\ufeff") first++;
    while (this.characterAt(first) === " " || this.characterAt(first) === "\t") {
      if ((first & 4095) === 0) yield;
      first++;
    }
    if (this.characterAt(first) === "@") {
      this.column += first - this.index;
      this.index = first;
      return false;
    }
    let percent = first;
    while (percent < contentEnd && this.characterAt(percent) !== "%") {
      if ((percent & 4095) === 0) yield;
      percent++;
    }
    let end = percent + 1,
      level = 0;
    while (this.characterAt(end) === "$") {
      if ((end & 4095) === 0) yield;
      end++;
      level++;
    }
    if (!level) return false;
    let flag = this.characterAt(end);
    if (["*", "+", "-", "!", "_"].includes(flag)) end++;
    else flag = null;
    if (this.characterAt(end) !== "%") return false;
    const classes = { "*": "info", "+": "success", "-": "warning", "!": "error", _: "separator" };
    this.emit(
      {
        level,
        text: (
          this.previewRange(this.index, percent).trim() +
          " " +
          this.previewRange(end + 1, contentEnd).trim()
        ).trim(),
        classList: flag ? [classes[flag]] : [],
      },
      this.row,
      contentEnd - this.index,
    );
    this.skipLine();
    return true;
  }

  *scanDirective() {
    const directiveRow = this.row;
    const directiveLineStartIndex = this.lineStartIndex;
    const directiveLineEndIndex = this.getLineContentEndIndex(
      this.getLineEndIndex(this.lineStartIndex),
    );

    this.advance(); // @
    const typeStartIndex = this.index;
    if (!isIdentifierStart(this.currentCharacter())) {
      return;
    }
    this.advance();
    while (isIdentifierContinue(this.currentCharacter())) {
      if ((this.index & 4095) === 0) yield;
      this.advance();
    }

    const type = this.previewRange(typeStartIndex, this.index);
    const normalizedType = type.toLowerCase();
    if (this.recoveryType && normalizedType !== this.recoveryType) {
      // A different directive is a stronger recovery boundary than another
      // repetition of the construct that failed to close.
      this.recoveryWork = 0;
      this.recoveryType = null;
    }
    yield* this.skipWhitespace();

    const openingDelimiter = this.currentCharacter();
    if (openingDelimiter !== "{" && openingDelimiter !== "(") {
      if (normalizedType === "comment" && this.row === directiveRow) {
        this.skipLine();
      }
      return;
    }
    this.advance();

    if (!SPECIAL_ENTRY_TYPES.has(normalizedType)) {
      yield* this.scanCitationKey(type, openingDelimiter, {
        row: directiveRow,
        lineStartIndex: directiveLineStartIndex,
        lineEndIndex: directiveLineEndIndex,
      });
    }

    yield* this.skipBalancedEntry(openingDelimiter, normalizedType);
  }

  *scanCitationKey(type, openingDelimiter, directive) {
    yield* this.skipWhitespace();

    if (
      this.lineHasOnlyWhitespace &&
      this.currentCharacter() === "@" &&
      (yield* this.looksLikeDirective(this.index))
    ) {
      return;
    }

    const keyStartIndex = this.index;
    while (!this.isAtEnd()) {
      if ((this.index & 4095) === 0) yield;
      const character = this.currentCharacter();
      // The grammar deliberately permits `)` inside a parenthesized key; only
      // a closing brace terminates its corresponding key before the comma.
      if (
        character === "," ||
        (openingDelimiter === "{" && character === "}") ||
        isWhitespace(character)
      ) {
        break;
      }
      this.advance();
    }
    const keyEndIndex = this.index;
    yield* this.skipWhitespace();

    if (keyEndIndex === keyStartIndex || this.currentCharacter() !== ",") {
      return;
    }

    const key = this.previewRange(keyStartIndex, keyEndIndex);
    this.emit(
      { level: 4, text: `${type}: ${key}`, classList: [] },
      directive.row,
      directive.lineEndIndex - directive.lineStartIndex,
    );
  }

  *skipBalancedEntry(openingDelimiter, entryType) {
    const scanStartIndex = this.index;
    // Do not trade a main-thread freeze for speculative recovery from deeply
    // malformed input. Two complete suffix attempts are enough to recover the
    // ordinary single-error case; beyond that, stop rather than publish
    // entry-looking text from an ambiguous nested context.
    if (this.recoveryWork >= this.text.length * 2) {
      this.index = this.text.length;
      return false;
    }
    const commentEntry = entryType === "comment";
    const closingDelimiter = openingDelimiter === "{" ? "}" : ")";
    let delimiterDepth = 1;
    let braceDepth = 0;
    let insideQuote = false;
    let quotedBraceDepth = 0;
    let recoveryPoint = null;

    while (!this.isAtEnd()) {
      if ((this.index & 4095) === 0) yield;
      const character = this.currentCharacter();

      if (
        character === "@" &&
        this.lineHasOnlyWhitespace &&
        (yield* this.looksLikeDirective(this.index))
      ) {
        if (!commentEntry && !insideQuote && braceDepth === 0 && delimiterDepth === 1) {
          this.recordRecoveryWork(scanStartIndex);
          this.recoveryType = entryType;
          return false;
        }
        recoveryPoint ??= this.snapshot();
      }

      if (character === "\\") {
        this.advance();
        if (!this.isAtEnd()) {
          this.advance();
        }
        continue;
      }

      const percentStartsComment =
        !commentEntry &&
        !insideQuote &&
        character === "%" &&
        (openingDelimiter === "{" ? delimiterDepth === 1 : braceDepth === 0);
      if (percentStartsComment) {
        this.skipLine();
        continue;
      }

      const quoteIsStructural = insideQuote
        ? quotedBraceDepth === 0
        : delimiterDepth === 1 && (openingDelimiter === "{" || braceDepth === 0);
      // Delimited comments contain opaque text, and quotes inside braced
      // values are ordinary characters rather than quoted-value delimiters.
      if (!commentEntry && character === '"' && quoteIsStructural) {
        insideQuote = !insideQuote;
        this.advance();
        continue;
      }

      if (insideQuote) {
        if (character === "{") {
          quotedBraceDepth += 1;
        } else if (character === "}" && quotedBraceDepth > 0) {
          quotedBraceDepth -= 1;
        }
        this.advance();
        continue;
      }

      if (openingDelimiter === "{") {
        if (character === "{") {
          delimiterDepth += 1;
        } else if (character === "}") {
          delimiterDepth -= 1;
          if (delimiterDepth === 0) {
            this.advance();
            this.recoveryWork = 0;
            this.recoveryType = null;
            return true;
          }
        }
      } else if (character === "{") {
        braceDepth += 1;
      } else if (character === "}" && braceDepth > 0) {
        braceDepth -= 1;
      } else if (braceDepth === 0 && character === openingDelimiter) {
        delimiterDepth += 1;
      } else if (braceDepth === 0 && character === closingDelimiter) {
        delimiterDepth -= 1;
        if (delimiterDepth === 0) {
          this.advance();
          this.recoveryWork = 0;
          this.recoveryType = null;
          return true;
        }
      }

      this.advance();
    }

    this.recordRecoveryWork(scanStartIndex);
    if (recoveryPoint) {
      this.restore(recoveryPoint);
      this.recoveryType = entryType;
    }
    return false;
  }

  recordRecoveryWork(scanStartIndex) {
    this.recoveryWork += Math.max(0, this.index - scanStartIndex);
  }

  *looksLikeDirective(index) {
    if (this.characterAt(index) !== "@" || !isIdentifierStart(this.characterAt(index + 1))) {
      return false;
    }

    index += 2;
    while (isIdentifierContinue(this.characterAt(index))) {
      if ((index & 4095) === 0) yield;
      index += 1;
    }
    while (isWhitespace(this.characterAt(index))) {
      if ((index & 4095) === 0) yield;
      index += 1;
    }
    return this.characterAt(index) === "{" || this.characterAt(index) === "(";
  }

  emit(item, row, endColumn) {
    this.callback({
      item,
      range: {
        start: { row, column: 0 },
        end: { row, column: endColumn },
      },
    });
  }

  *skipWhitespace() {
    while (isWhitespace(this.currentCharacter())) {
      if ((this.index & 4095) === 0) yield;
      this.advance();
    }
  }

  skipLine() {
    const lineEndIndex = this.getLineEndIndex(this.index);
    if (lineEndIndex >= this.text.length) {
      this.index = this.text.length;
      return;
    }

    this.index = lineEndIndex + 1;
    this.row += 1;
    this.column = 0;
    this.lineStartIndex = this.index;
    this.lineHasOnlyWhitespace = true;
  }

  advance() {
    const character = this.currentCharacter();
    if (character === undefined) {
      return;
    }

    this.index += 1;
    if (character === "\n") {
      this.row += 1;
      this.column = 0;
      this.lineStartIndex = this.index;
      this.lineHasOnlyWhitespace = true;
    } else {
      this.column += 1;
      if (character !== " " && character !== "\t" && character !== "\r") {
        this.lineHasOnlyWhitespace = false;
      }
    }
  }

  getLineEndIndex(index) {
    if (this.read) {
      const row = this.text.positionAt(index).row;
      return row + 1 < this.text.lineCount ? this.text.lineStart(row + 1) - 1 : this.text.length;
    }
    const newlineIndex = this.text.indexOf("\n", index);
    return newlineIndex === -1 ? this.text.length : newlineIndex;
  }

  getLineContentEndIndex(lineEndIndex) {
    return lineEndIndex > 0 && this.characterAt(lineEndIndex - 1) === "\r"
      ? lineEndIndex - 1
      : lineEndIndex;
  }

  characterAt(index) {
    if (index < 0 || index >= this.text.length) return undefined;
    if (!this.read) return this.text[index];
    if (index < this.cachedStart || index >= this.cachedStart + this.cachedText.length) {
      this.cachedStart = index;
      this.cachedText = this.read(index);
    }
    return this.cachedText[index - this.cachedStart];
  }

  previewRange(start, end) {
    const text = this.text.slice(start, Math.min(end, start + 1024));
    if (end - start <= 1024) return text;
    return text.replace(/[\uD800-\uDBFF]$/, "") + "…";
  }

  currentCharacter() {
    return this.characterAt(this.index);
  }

  isAtEnd() {
    return this.index >= this.text.length;
  }

  snapshot() {
    return {
      index: this.index,
      row: this.row,
      column: this.column,
      lineStartIndex: this.lineStartIndex,
      lineHasOnlyWhitespace: this.lineHasOnlyWhitespace,
    };
  }

  restore(snapshot) {
    Object.assign(this, snapshot);
  }
}

function isIdentifierStart(character) {
  return isAsciiLetter(character) || IDENTIFIER_PUNCTUATION.includes(character);
}

function isIdentifierContinue(character) {
  return isIdentifierStart(character) || isAsciiDigit(character);
}

function isAsciiLetter(character) {
  if (!character) return false;
  const code = character.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiDigit(character) {
  if (!character) return false;
  const code = character.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isWhitespace(character) {
  return (
    character === " " ||
    character === "\t" ||
    character === "\r" ||
    character === "\n" ||
    character === "\f" ||
    character === "\v"
  );
}

function scanBibtex(text, callback) {
  for (const _step of new BibtexLexer(text, callback).steps()) {
    /* synchronous compatibility */
  }
}

module.exports = {
  scanBibtex,
  scanBibtexSource: (source, callback) => new BibtexLexer(source, callback).steps(),
};
