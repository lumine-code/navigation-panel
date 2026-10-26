const { scanBibtexSource } = require("./bibtex-lexer");
const { ScannerAbstract } = require("./scanner-abstract");

class ScannerBibtex extends ScannerAbstract {
  scan(callback, options = {}) {
    const source = this.editor.getBuffer().getTextSnapshot();
    return this.runSteps(scanBibtexSource(source, callback), source, options);
  }

  parse(object) {
    return object.item;
  }
}

module.exports = { ScannerBibtex };
