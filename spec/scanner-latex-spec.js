const { normalizeLatexText } = require("../lib/scanner-latex");

describe("LaTeX heading text", () => {
  it("renders common commands as compact Unicode", () => {
    expect(
      normalizeLatexText(
        String.raw`Stan graniczny naprężeń normalnych z -0.05 \cdot {{\tau}}_{max}`,
      ),
    ).toBe("Stan graniczny naprężeń normalnych z -0.05 ⋅ τ_max");
  });

  it("converts every occurrence and respects command boundaries", () => {
    expect(
      normalizeLatexText(String.raw`$\alpha + \alpha \leq \beta \Rightarrow \infty$ \alphabet`),
    ).toBe(String.raw`α + α ≤ β ⇒ ∞ \alphabet`);
  });

  it("supports Greek variants and common mathematical symbols", () => {
    expect(
      normalizeLatexText(
        String.raw`\epsilon \varepsilon \vartheta \varkappa \varpi \varrho \varsigma \phi \varphi \nabla \prod \approx \pm \parallel \perp \iint \sqrt \partial \oplus`,
      ),
    ).toBe("ϵ ε ϑ ϰ ϖ ϱ ς ϕ φ ∇ ∏ ≈ ± ∥ ⟂ ∬ √ ∂ ⊕");
  });

  it("keeps braces required by an unknown formatting command", () => {
    expect(normalizeLatexText(String.raw`\mathbf{{\tau}} + {{\sigma}}_{max value}`)).toBe(
      String.raw`\mathbf{τ} + σ_{max value}`,
    );
  });
});
