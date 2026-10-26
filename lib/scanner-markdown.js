const { ScannerAbstract } = require("./scanner-abstract");

class ScannerMarkdown extends ScannerAbstract {
  getRegex() {
    return /^(`{3,})|^(~{3,})|^ *(#+) (.+)$/gm;
  }

  beforeScan() {
    this.insideCode1 = false;
    this.insideCode2 = false;
  }

  *omittedRow(source, start, end) {
    yield;
    const prefix = source.slice(start, Math.min(start + 3, end));
    if (prefix === "```") this.insideCode1 = !this.insideCode1;
    else if (prefix === "~~~") this.insideCode2 = !this.insideCode2;
  }

  parse(object) {
    let match = object.match;
    if (match[1]) {
      this.insideCode1 = !this.insideCode1;
      return;
    }
    if (match[2]) {
      this.insideCode2 = !this.insideCode2;
      return;
    }
    if (this.insideCode1 || this.insideCode2) {
      return;
    }
    return { level: match[3].length, text: match[4], classList: [] };
  }
}

module.exports = { ScannerMarkdown };
