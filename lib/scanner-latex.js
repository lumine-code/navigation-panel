const { ScannerAbstract } = require("./scanner-abstract");

const GREEK_COMMANDS = Object.freeze({
  alpha: "α",
  Alpha: "Α",
  beta: "β",
  Beta: "Β",
  gamma: "γ",
  Gamma: "Γ",
  delta: "δ",
  Delta: "Δ",
  epsilon: "ϵ",
  varepsilon: "ε",
  Epsilon: "Ε",
  zeta: "ζ",
  Zeta: "Ζ",
  eta: "η",
  Eta: "Η",
  theta: "θ",
  vartheta: "ϑ",
  Theta: "Θ",
  iota: "ι",
  Iota: "Ι",
  kappa: "κ",
  Kappa: "Κ",
  varkappa: "ϰ",
  lambda: "λ",
  Lambda: "Λ",
  mu: "μ",
  Mu: "Μ",
  nu: "ν",
  Nu: "Ν",
  xi: "ξ",
  Xi: "Ξ",
  omicron: "ο",
  Omicron: "Ο",
  // Preserve the misspelling accepted by the old scanner.
  omnikron: "ο",
  Omikron: "Ο",
  pi: "π",
  varpi: "ϖ",
  Pi: "Π",
  rho: "ρ",
  varrho: "ϱ",
  Rho: "Ρ",
  sigma: "σ",
  varsigma: "ς",
  Sigma: "Σ",
  tau: "τ",
  Tau: "Τ",
  upsilon: "υ",
  Upsilon: "Υ",
  phi: "ϕ",
  varphi: "φ",
  Phi: "Φ",
  chi: "χ",
  Chi: "Χ",
  psi: "ψ",
  Psi: "Ψ",
  omega: "ω",
  Omega: "Ω",
});

const SYMBOL_COMMANDS = Object.freeze({
  cdot: "⋅",
  times: "×",
  div: "÷",
  pm: "±",
  mp: "∓",
  equiv: "≡",
  approx: "≈",
  aprox: "≈",
  sim: "∼",
  simeq: "≃",
  neq: "≠",
  ne: "≠",
  le: "≤",
  leq: "≤",
  leqslant: "≤",
  ge: "≥",
  geq: "≥",
  geqslant: "≥",
  ll: "≪",
  gg: "≫",
  propto: "∝",
  parallel: "∥",
  perp: "⟂",
  nabla: "∇",
  partial: "∂",
  infty: "∞",
  sum: "∑",
  prod: "∏",
  int: "∫",
  iint: "∬",
  iiint: "∭",
  sqrt: "√",
  in: "∈",
  notin: "∉",
  ni: "∋",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  emptyset: "∅",
  varnothing: "∅",
  forall: "∀",
  exists: "∃",
  neg: "¬",
  land: "∧",
  lor: "∨",
  oplus: "⊕",
  leftarrow: "←",
  rightarrow: "→",
  leftrightarrow: "↔",
  Leftarrow: "⇐",
  Rightarrow: "⇒",
  Leftrightarrow: "⇔",
  uparrow: "↑",
  downarrow: "↓",
  dagger: "†",
  permil: "‰",
  circ: "∘",
  textdegree: "°",
  limits: "",
});

const SPECIAL_GREEK_COMMANDS = Object.freeze({
  straightepsilon: "ϵ",
  textepsilon: "ε",
  straighttheta: "θ",
  texttheta: "ϑ",
  straightphi: "ϕ",
  textphi: "φ",
});

const CONVERTED_SYMBOLS = new Set([
  ...Object.values(GREEK_COMMANDS),
  ...Object.values(SYMBOL_COMMANDS),
  ...Object.values(SPECIAL_GREEK_COMMANDS),
]);

function symbolForCommand(command) {
  if (Object.hasOwn(SYMBOL_COMMANDS, command)) return SYMBOL_COMMANDS[command];
  if (Object.hasOwn(SPECIAL_GREEK_COMMANDS, command)) return SPECIAL_GREEK_COMMANDS[command];
  if (Object.hasOwn(GREEK_COMMANDS, command)) return GREEK_COMMANDS[command];

  const prefixedGreek = command.match(/^(?:text|up)(.+)$/);
  if (prefixedGreek && Object.hasOwn(GREEK_COMMANDS, prefixedGreek[1])) {
    return GREEK_COMMANDS[prefixedGreek[1]];
  }
  return null;
}

function removeRedundantSymbolBraces(text) {
  let previous;
  do {
    previous = text;
    text = text
      .replace(/(?<!\\)([_^])\s*\{([^{}\s]+)\}/g, "$1$2")
      .replace(/(?<!\\)\{([^{}]+)(?<!\\)\}/g, (group, content, offset, source) => {
        const followsCommand = /\\[A-Za-z]+\s*$/.test(source.slice(0, offset));
        const isCompactSymbol =
          !/[\s,{}]/u.test(content) &&
          Array.from(content).some((char) => CONVERTED_SYMBOLS.has(char));
        return !followsCommand && isCompactSymbol ? content : group;
      });
  } while (text !== previous);
  return text;
}

function normalizeLatexText(text) {
  const normalized = text
    .trim()
    .replace(/~+/g, " ")
    .replace(/--/g, "–")
    .replace(/(?<!\\)\$/g, "")
    .replace(/\\\$/g, "$")
    .replace(/\\%/g, "%")
    .replace(/\^\s*\{\s*\\circ\s*\}/g, "°")
    .replace(/\^\s*\\circ\b/g, "°")
    .replace(/\\([A-Za-z]+)(?![A-Za-z])/g, (match, command) => symbolForCommand(command) ?? match);

  return removeRedundantSymbolBraces(normalized);
}

class ScannerLatex extends ScannerAbstract {
  getRegex() {
    this.secCommands = [
      lumine.config.get("navigation-panel.latex.commands.4"),
      lumine.config.get("navigation-panel.latex.commands.5"),
      lumine.config.get("navigation-panel.latex.commands.6"),
      lumine.config.get("navigation-panel.latex.commands.7"),
      lumine.config.get("navigation-panel.latex.commands.8"),
      lumine.config.get("navigation-panel.latex.commands.9"),
      lumine.config.get("navigation-panel.latex.commands.10"),
    ];
    return new RegExp(
      "([^%\\n]*)%(\\$+)([\\*\\+\\-\\!\\_]?)%(.*)|^[^\\%\\n]*\\\\(" +
        this.secCommands.join("|") +
        ")\\*?(?:\\[(.*)\\])?{(.*)}",
      "g",
    );
  }

  parse(object) {
    let match = object.match;
    let level, text;
    let classList = [];
    if (match[2]) {
      level = match[2].length;
      text = `${match[1].trim()} ${match[4].trim()}`.trim().replace(/~+/g, " ");
      if (match[3] === "*") {
        classList = ["info"];
      } else if (match[3] === "+") {
        classList = ["success"];
      } else if (match[3] === "-") {
        classList = ["warning"];
      } else if (match[3] === "!") {
        classList = ["error"];
      } else if (match[3] === "_") {
        classList = ["separator"];
      }
    } else if (match[5]) {
      level = match[5].toLowerCase();
      for (let i = 0; i < this.secCommands.length; i++) {
        if (this.secCommands[i] && level.match(`^(${this.secCommands[i]})$`)) {
          level = 4 + i;
          break;
        }
      }
      text = match[6] ? match[6] : match[7];
      let count = 0;
      for (var i = 0; i < text.length; i++) {
        let char = text.charAt(i);
        if (char === "{") {
          count++;
        } else if (char === "}") {
          if (count === 0) {
            break;
          } else {
            count--;
          }
        }
      }
      text = normalizeLatexText(text.substring(0, i));
    }
    return { level, text, classList };
  }
}

module.exports = { normalizeLatexText, ScannerLatex };
