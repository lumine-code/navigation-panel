const { scanBibtex } = require("./bibtex-lexer");
const { ScannerAbstract } = require("./scanner-abstract");

class ScannerBibtex extends ScannerAbstract {
  scan(callback) {
    scanBibtex(this.editor.getText(), callback);
  }

  parse(object) {
    return object.item;
  }
}

module.exports = { ScannerBibtex };
