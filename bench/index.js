// Manual micro- and scaling benchmarks for treffer. Run with `npm run bench`.
import assert from "node:assert/strict";
import { compile, match, search } from "../lib/index.js";

let sink = 0;

function consume(value) {
  sink += typeof value === "boolean" ? Number(value) : value ? 1 : 0;
}

function micro(name, fn) {
  for (let t = performance.now(); performance.now() - t < 50;) consume(fn());
  let best = 0;
  for (let sample = 0; sample < 5; sample++) {
    let ops = 0;
    const start = performance.now();
    let elapsed;
    do {
      for (let i = 0; i < 100; i++) consume(fn());
      ops += 100;
      elapsed = performance.now() - start;
    } while (elapsed < 100);
    best = Math.max(best, ops / (elapsed / 1e3));
  }
  console.log(name.padEnd(30), Math.round(best).toLocaleString().padStart(14), "ops/sec");
}

function elapsed(name, fn) {
  consume(fn());
  let best = Infinity;
  for (let sample = 0; sample < 3; sample++) {
    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;
    consume(result);
    best = Math.min(best, duration);
  }
  console.log(name.padEnd(30), best.toFixed(3).padStart(14), "ms");
}

const SIMPLE = "[a-z]+";
const COMPLEX = "([A-Z][a-z]+ ){1,3}[0-9]{4}";
const SEARCH = "item-[0-9]+";
const simple = compile(SIMPLE);
const complex = compile(COMPLEX);
const finder = compile(SEARCH);

assert.equal(simple.match("hello"), true);
assert.equal(complex.match("Main Street 1234"), true);
assert.equal(finder.search("prefix item-12345 suffix"), true);
assert.equal(match(SIMPLE, "HELLO"), false);
assert.equal(search(SEARCH, "missing"), false);

console.log(`Node ${process.version} · ${process.platform} ${process.arch}`);
console.log("\nMicrobenchmarks (best of 5)");
micro("compile: simple", () => compile(SIMPLE));
micro("compile: complex", () => compile(COMPLEX));
micro("run: full match", () => complex.match("Main Street 1234"));
micro("run: substring search", () => finder.search("prefix item-12345 suffix"));
micro("match: one-shot", () => match(SIMPLE, "hello"));
micro("search: one-shot", () => search(SEARCH, "prefix item-12345 suffix"));

console.log("\nSearch scaling, precompiled (best of 3)");
for (const size of [100, 10_000, 100_000]) {
  const subject = `${"x".repeat(size)}item-12345`;
  assert.equal(finder.search(subject), true);
  elapsed(`${size.toLocaleString()} leading chars`, () => finder.search(subject));
}

if (sink < 0) console.log(sink);
