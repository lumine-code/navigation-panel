const { ScannerAbstract } = require("./scanner-abstract");

class ScannerRest extends ScannerAbstract {
  getRegex() {
    this.windowRows = 2;
    return /^(.+)\n([!-/:-@[-`{-~])\2+$/gim;
  }

  beforeScan() {
    this.sectionLevels = {};
  }

  *omittedRow(source, start, end, row) {
    if (row + 1 >= source.lineCount) return;
    const next = source.lineStart(row + 1);
    if (next === start + 1 || source.charCodeAt(next - 2) === 13) return;
    for (const chunk of source.subtext(start, next - 1).chunks()) {
      yield;
      if (/[\r\n\u2028\u2029]/.test(chunk)) return;
    }
    const punctuation = source.slice(next, Math.min(next + 1, end));
    if (!/^[!-/:-@[-`{-~]$/.test(punctuation) || end - next < 2) return;
    for (const chunk of source.subtext(next, end).chunks()) {
      yield;
      for (let index = 0; index < chunk.length; index++) if (chunk[index] !== punctuation) return;
    }
    if (!(punctuation in this.sectionLevels))
      this.sectionLevels[punctuation] = Object.keys(this.sectionLevels).length + 1;
    return end;
  }

  parse(object) {
    let match = object.match;
    let level;
    let c = match[2].substr(0, 1);
    if (c in this.sectionLevels) {
      level = this.sectionLevels[c];
    } else {
      level = Object.keys(this.sectionLevels).length + 1;
      this.sectionLevels[c] = level;
    }
    return { level, text: match[1], classList: [] };
  }
}

module.exports = { ScannerRest };
