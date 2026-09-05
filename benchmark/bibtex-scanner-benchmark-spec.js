// Run manually from this repository with:
//   lumine --test benchmark/bibtex-scanner-benchmark-spec.js

const path = require("path");
const { ScannerAbstract } = require("../lib/scanner-abstract");
const { ScannerBibtex } = require("../lib/scanner-bibtex");

const ENTRY_COUNTS = [10, 1000, 10000];
const SAMPLE_COUNT = 30;
const WARMUP_COUNT = 5;
const BATCH_SIZES = new Map([
  [10, 100],
  [1000, 5],
  [10000, 1],
]);

class RegexBaselineScanner extends ScannerAbstract {
  getRegex() {
    return /([^%\n]*)%(\$+)([*+\-!_]?)%(.*)|^[ ]*@(\w*)[ ]*{[ ]*([^,]*)/gim;
  }

  parse({ match }) {
    let level, text;
    const classList = [];
    if (match[2]) {
      level = match[2].length;
      text = `${match[1].trim()} ${match[4].trim()}`.trim();
    } else {
      level = 4;
      text = `${match[5].trim()}: ${match[6].trim()}`;
    }
    if (match[3] === "*") {
      classList.push("info");
    } else if (match[3] === "+") {
      classList.push("success");
    } else if (match[3] === "-") {
      classList.push("warning");
    } else if (match[3] === "!") {
      classList.push("error");
    } else if (match[3] === "_") {
      classList.push("separator");
    }
    return { level, text, classList };
  }
}

function sourceWithEntries(count) {
  const types = ["article", "book", "inproceedings", "misc"];
  const entries = new Array(count);
  for (let index = 0; index < count; index++) {
    const type = types[index % types.length];
    entries[index] =
      `@${type}{entry-${index},\n  title = {A {nested} title ${index}},\n  note = "quoted value ${index}"\n}`;
  }
  return entries.join("\n\n");
}

function sourceWithBrokenComments(count) {
  const comments = Array.from({ length: count }, (_, index) => `@comment{broken-${index}`);
  comments.push('@book{recovered, title = "Recovered"}');
  return comments.join("\n");
}

function percentile(samples, fraction) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function summarize(samples) {
  return {
    medianMs: Number(percentile(samples, 0.5).toFixed(3)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
  };
}

function measureSyncInterleaved(runs, batchSize) {
  const measurements = Object.fromEntries(
    Object.keys(runs).map((name) => [name, { samples: [], checksum: 0 }]),
  );
  const names = Object.keys(runs);

  for (let sample = -WARMUP_COUNT; sample < SAMPLE_COUNT; sample++) {
    for (let offset = 0; offset < names.length; offset++) {
      const name = names[(sample + WARMUP_COUNT + offset) % names.length];
      const measurement = measurements[name];
      const started = performance.now();
      for (let batch = 0; batch < batchSize; batch++) {
        measurement.checksum += runs[name]();
      }
      if (sample >= 0) {
        measurement.samples.push((performance.now() - started) / batchSize);
      }
    }
  }

  return Object.fromEntries(
    Object.entries(measurements).map(([name, measurement]) => [
      name,
      { ...summarize(measurement.samples), checksum: measurement.checksum },
    ]),
  );
}

async function measureAsync(run, batchSize) {
  let checksum = 0;
  for (let index = 0; index < WARMUP_COUNT * batchSize; index++) checksum += await run();
  const samples = [];
  for (let index = 0; index < SAMPLE_COUNT; index++) {
    const started = performance.now();
    for (let batch = 0; batch < batchSize; batch++) checksum += await run();
    samples.push((performance.now() - started) / batchSize);
  }
  return { ...summarize(samples), checksum };
}

function countCitationDefinitions(groups) {
  let count = 0;
  for (const { captures } of groups) {
    for (const capture of captures) {
      if (capture.name === "definition.constant") count++;
    }
  }
  return count;
}

function ratio(dividend, divisor) {
  return Number((dividend / divisor).toFixed(2));
}

describe("BibTeX scanner benchmark", () => {
  it("compares the lexer with a regex baseline and a warm tags query", async () => {
    const grammarPackageRoot =
      lumine.packages.resolvePackagePath("language-bibtex") ??
      path.join(__dirname, "..", "..", "language-bibtex");
    await lumine.packages.activatePackage(grammarPackageRoot);
    const editor = await lumine.workspace.open();
    const grammar = lumine.grammars.grammarForScopeName("text.bibtex");
    editor.setGrammar(grammar);

    const rows = [];
    try {
      for (const entryCount of ENTRY_COUNTS) {
        editor.setText(sourceWithEntries(entryCount));
        await editor.whenGrammarSettled();

        const batchSize = BATCH_SIZES.get(entryCount);
        const regexScanner = new RegexBaselineScanner(editor);
        const lexerScanner = new ScannerBibtex(editor);
        const malformedSource = sourceWithBrokenComments(entryCount);
        const malformedScanner = new ScannerBibtex({
          getText: () => malformedSource,
          getLineCount: () => entryCount + 1,
        });
        const countRegexMatches = (throughHook) => {
          let count = 0;
          const callback = () => {
            count += 1;
          };
          if (throughHook) {
            regexScanner.scan(callback);
          } else {
            editor.scan(regexScanner.regex, {}, callback);
          }
          return count;
        };
        const sync = measureSyncInterleaved(
          {
            regex: () => regexScanner.getHeaders().length,
            lexer: () => lexerScanner.getHeaders().length,
            directScan: () => countRegexMatches(false),
            hookedScan: () => countRegexMatches(true),
            malformed: () => malformedScanner.getHeaders().length,
          },
          batchSize,
        );
        const { regex, lexer, directScan, hookedScan, malformed } = sync;
        // This is the fastest plausible tags path: parsing and query compilation are already warm,
        // and no symbol-to-header conversion cost is included.
        const queryTags = async () =>
          countCitationDefinitions(await editor.getGrammarQueryCaptureGroups("tagsQuery"));
        const tags = await measureAsync(queryTags, batchSize);

        const expectedChecksum = entryCount * (SAMPLE_COUNT + WARMUP_COUNT) * batchSize;
        expect(regex.checksum).toBe(expectedChecksum);
        expect(lexer.checksum).toBe(expectedChecksum);
        expect(directScan.checksum).toBe(expectedChecksum);
        expect(hookedScan.checksum).toBe(expectedChecksum);
        expect(malformed.checksum).toBe(0);
        expect(tags.checksum).toBe(expectedChecksum);

        rows.push({
          entries: entryCount,
          kib: Number((editor.getText().length / 1024).toFixed(1)),
          regexMedianMs: regex.medianMs,
          regexP95Ms: regex.p95Ms,
          lexerMedianMs: lexer.medianMs,
          lexerP95Ms: lexer.p95Ms,
          warmTagsMedianMs: tags.medianMs,
          warmTagsP95Ms: tags.p95Ms,
          malformedMedianMs: malformed.medianMs,
          malformedP95Ms: malformed.p95Ms,
          lexerVsRegex: ratio(lexer.medianMs, regex.medianMs),
          tagsVsLexer: ratio(tags.medianMs, lexer.medianMs),
          hookVsDirect: ratio(hookedScan.medianMs, directScan.medianMs),
        });
      }
    } finally {
      editor.destroy();
    }

    const largest = rows[rows.length - 1];
    const gates = {
      lexerNoSlowerThanRegex:
        largest.lexerMedianMs <= largest.regexMedianMs && largest.lexerP95Ms <= largest.regexP95Ms,
      hookOverheadAtMost5Percent: largest.hookVsDirect <= 1.05,
      lexerP95Below16Ms: largest.lexerP95Ms < 16,
      malformedRecoveryP95Below16Ms: largest.malformedP95Ms < 16,
      lexerAtLeast4xFasterThanWarmTags: largest.tagsVsLexer >= 4,
    };
    console.log("[navigation-panel BibTeX benchmark]", JSON.stringify(rows, null, 2));
    console.log("[navigation-panel BibTeX gates]", JSON.stringify(gates));
    expect(gates).toEqual({
      lexerNoSlowerThanRegex: true,
      hookOverheadAtMost5Percent: true,
      lexerP95Below16Ms: true,
      malformedRecoveryP95Below16Ms: true,
      lexerAtLeast4xFasterThanWarmTags: true,
    });
  });
});
