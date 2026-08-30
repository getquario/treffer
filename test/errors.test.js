import assert from "node:assert/strict";
import test from "node:test";
import { compile, isDiagnostic, match, relocate, search } from "../lib/index.js";

let check = (run, Type, code, limit, actual) =>
  assert.throws(run, (e) => {
    assert.ok(e instanceof Type);
    assert.ok(isDiagnostic(e));
    assert.ok(Object.hasOwn(e, "code"));
    assert.strictEqual(e.code, code);
    if (limit == null) {
      assert.ok(!Object.hasOwn(e, "limit"));
      assert.ok(!Object.hasOwn(e, "actual"));
    } else {
      assert.ok(Object.hasOwn(e, "limit"));
      assert.strictEqual(e.limit, limit);
      if (actual == null) assert.ok(!Object.hasOwn(e, "actual"));
      else {
        assert.ok(Object.hasOwn(e, "actual"));
        assert.strictEqual(e.actual, actual);
      }
    }
    return true;
  });

test("invalid I-Regexp syntax throws SyntaxError", () => {
  for (const pattern of [
    "(",
    ")",
    "[",
    "[]",
    "[^]",
    "[[]",
    "[a[b]",
    "[z-a]",
    "\\d+",
    "(?=a)",
    "(a)\\1",
    "a+?",
    "a{,2}",
    "a{2,1}",
    "a{2",
    "\ud800",
    "\\p{Foo}",
    "\\p{L",
    "\\p{}",
    "\\",
    "\\q",
  ]) {
    check(() => compile(pattern), SyntaxError, "TREFFER_SYNTAX");
  }
});

test("API type errors are explicit", () => {
  for (const run of [
    () => compile(),
    () => compile(1),
    () => compile("a", true),
    () => compile("a", { anchors: 1 }),
    () => compile("a").match(),
    () => match("a", 1),
  ])
    assert.throws(
      run,
      (e) => e instanceof TypeError && isDiagnostic(e) && !Object.hasOwn(e, "code"),
    );
});

test("compile-time resource limits expose distinct diagnostics", () => {
  assert.doesNotThrow(() => compile("(".repeat(64) + "a" + ")".repeat(64)), "deepest group");
  check(
    () => compile("(".repeat(65) + "a" + ")".repeat(65)),
    RangeError,
    "TREFFER_MAX_GROUP_DEPTH",
    64,
    65,
  );

  assert.doesNotThrow(() => compile("a{1024}"), "largest repetition");
  check(() => compile("a{1025}"), RangeError, "TREFFER_MAX_REPETITIONS", 1024, 1025);
  check(() => compile("a{0001024}"), RangeError, "TREFFER_MAX_QUANTIFIER_DIGITS", 6, 7);

  assert.doesNotThrow(() => compile("a".repeat(4095)), "largest NFA");
  check(() => compile("a".repeat(4096)), RangeError, "TREFFER_MAX_NFA_STATES", 4096, 4097);
  assert.doesNotThrow(() => compile("[" + "a".repeat(4094) + "]"), "largest pattern");
  check(
    () => compile("[" + "a".repeat(4095) + "]"),
    RangeError,
    "TREFFER_MAX_PATTERN_SCALARS",
    4096,
    4097,
  );
  check(() => compile("a".repeat(8193)), RangeError, "TREFFER_MAX_PATTERN_SCALARS", 4096);
});

test("subject validation and work limits throw", () => {
  const re = compile("a");
  assert.throws(
    () => re.match("\ud800"),
    (e) => e instanceof TypeError && isDiagnostic(e) && !Object.hasOwn(e, "code"),
  );
  assert.throws(
    () => re.match("\udc00"),
    (e) => e instanceof TypeError && isDiagnostic(e) && !Object.hasOwn(e, "code"),
    "lone low surrogate",
  );
  check(
    () => search("", "a".repeat(1_000_001)),
    RangeError,
    "TREFFER_MAX_SUBJECT_SCALARS",
    1_000_000,
    1_000_001,
  );

  const expensive = compile("[" + "b".repeat(4093) + "]");
  check(
    () => expensive.search("a".repeat(1000)),
    RangeError,
    "TREFFER_MAX_TRANSITIONS",
    1_000_000,
    1_000_001,
  );
});

test("diagnostic provenance cannot be copied", () => {
  for (const value of [null, undefined, 1, "TREFFER_SYNTAX", {}, SyntaxError("host")])
    assert.strictEqual(isDiagnostic(value), false);

  const spoof = Object.assign(SyntaxError("spoof"), { code: "TREFFER_SYNTAX" });
  assert.strictEqual(isDiagnostic(spoof), false);
});

test("diagnostic provenance is local to a module instance", async () => {
  const other = await import("../lib/index.js?instance=provenance");
  let first, second;
  try {
    compile("(");
  } catch (e) {
    first = e;
  }
  try {
    other.compile("(");
  } catch (e) {
    second = e;
  }

  assert.ok(isDiagnostic(first));
  assert.ok(other.isDiagnostic(second));
  assert.strictEqual(isDiagnostic(second), false);
  assert.strictEqual(other.isDiagnostic(first), false);
});

test("captured provenance operations resist prototype replacement", () => {
  // Captured to restore in `finally`, never called — `unbound-method` reads the
  // saving of a prototype method as the scoping hazard of calling one.
  // oxlint-disable-next-line typescript/unbound-method
  const add = WeakSet.prototype.add;
  // oxlint-disable-next-line typescript/unbound-method
  const has = WeakSet.prototype.has;
  try {
    WeakSet.prototype.add = function () {
      return this;
    };
    WeakSet.prototype.has = () => true;
    assert.strictEqual(
      isDiagnostic(Object.assign(SyntaxError("spoof"), { code: "TREFFER_SYNTAX" })),
      false,
    );
    check(() => compile("("), SyntaxError, "TREFFER_SYNTAX");
  } finally {
    WeakSet.prototype.add = add;
    WeakSet.prototype.has = has;
  }
});

let caught = (fn) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  assert.fail("expected an error");
};

test("syntax faults point at the offending code point", () => {
  let span = (pattern) => {
    const e = caught(() => compile(pattern));
    assert.strictEqual(e.code, "TREFFER_SYNTAX");
    return [e.start, e.end];
  };

  assert.deepStrictEqual(span("a)"), [1, 2], "trailing garbage is not consumed yet");
  assert.deepStrictEqual(span("(a"), [2, 2], "end of pattern is an empty span at the end");
  assert.deepStrictEqual(span("a{2,1}"), [1, 6], "an impossible brace spans the whole quantifier");
  assert.deepStrictEqual(
    span("a{,2}"),
    [2, 3],
    "a missing bound points at what stands where the digit belongs",
  );
  assert.deepStrictEqual(span("[z-a]"), [3, 4], "a reversed range points at its high endpoint");
  assert.deepStrictEqual(span("a\\q"), [2, 3], "an unknown escape points at the escaped char");
  assert.deepStrictEqual(span("\\p{Foo}"), [3, 6], "an unknown property points at its name");
  assert.deepStrictEqual(span("ab\ud800"), [2, 3], "a lone surrogate points at itself");
  assert.deepStrictEqual(span("😀)"), [2, 3], "spans are UTF-16 offsets, not code points");
});

test("resource limits carry no span", () => {
  const e = caught(() => compile("a{1025}"));
  assert.strictEqual(e.code, "TREFFER_MAX_REPETITIONS");
  assert.ok(!Object.hasOwn(e, "start"));
  assert.ok(!Object.hasOwn(e, "end"));
});

test("relocate returns an authenticated copy in the embedder's coordinates", () => {
  const original = caught(() => compile("a)"));
  const moved = relocate(original, { prefix: "$.a[?match(@.b, 'a)')]: ", offset: 14 });

  assert.ok(moved instanceof SyntaxError);
  assert.strictEqual(moved.message, "$.a[?match(@.b, 'a)')]: " + original.message);
  assert.strictEqual(moved.code, original.code);
  assert.deepStrictEqual([moved.start, moved.end], [15, 16]);
  assert.ok(isDiagnostic(moved));
  assert.deepStrictEqual([original.start, original.end], [1, 2], "the original is left untouched");
});

test("relocate leaves a span-less diagnostic span-less", () => {
  const original = caught(() => compile("a{1025}"));
  const moved = relocate(original, { prefix: "pattern: ", offset: 9 });

  assert.ok(moved instanceof RangeError);
  assert.strictEqual(moved.code, "TREFFER_MAX_REPETITIONS");
  assert.strictEqual(moved.limit, 1024);
  assert.strictEqual(moved.actual, 1025);
  assert.ok(!Object.hasOwn(moved, "start"));
  assert.ok(isDiagnostic(moved));
});

test("relocate defaults to no prefix and no shift", () => {
  const original = caught(() => compile("a)"));
  const moved = relocate(original);

  assert.strictEqual(moved.message, original.message);
  assert.deepStrictEqual([moved.start, moved.end], [original.start, original.end]);
  assert.ok(isDiagnostic(moved));
});

test("relocate refuses anything that is not a Treffer diagnostic", () => {
  const spoof = Object.assign(SyntaxError("spoof"), { code: "TREFFER_SYNTAX", start: 0, end: 1 });
  for (const value of [null, undefined, 1, "TREFFER_SYNTAX", {}, SyntaxError("host"), spoof])
    assert.throws(() => relocate(value), TypeError);
});

test("relocate does not mint a diagnostic through a replaced constructor", () => {
  const d = caught(() => compile("a)"));
  const real = SyntaxError.prototype.constructor;
  try {
    SyntaxError.prototype.constructor = function () {
      return { pwned: true };
    };
    const moved = relocate(d, { prefix: "x: " });
    assert.ok(moved instanceof SyntaxError, "the class comes from a captured table");
    assert.ok(!Object.hasOwn(moved, "pwned"));
    assert.ok(isDiagnostic(moved));
  } finally {
    SyntaxError.prototype.constructor = real;
  }
});

test("relocate degrades to a plain Error when the original's prototype was replaced", () => {
  const d = caught(() => compile("a)"));
  Object.setPrototypeOf(d, Object.create(null));

  const moved = relocate(d, { prefix: "x: " });
  assert.ok(moved instanceof Error, "an unrecognized class falls back to Error");
  assert.ok(isDiagnostic(moved), "and is still authenticated");
});

test("relocate keeps an API type error a TypeError", () => {
  const d = caught(() => compile(1));
  const moved = relocate(d, { prefix: "pattern: " });

  assert.ok(moved instanceof TypeError);
  assert.ok(isDiagnostic(moved));
  assert.ok(!Object.hasOwn(moved, "code"), "API type errors carry no code");
});

test("a resource limit names the budget and the number it passed", () => {
  // The code is the contract; the message is for a human reading a stack, and
  // saying which budget and how big it was beats a single fixed sentence.
  for (const [pattern, message] of [
    ["a{1025}", "repetitions limit of 1024 exceeded"],
    ["a{0001024}", "quantifier digits limit of 6 exceeded"],
    ["(".repeat(65) + "a" + ")".repeat(65), "group depth limit of 64 exceeded"],
    ["a".repeat(4096), "NFA states limit of 4096 exceeded"],
    ["[" + "a".repeat(4095) + "]", "pattern scalars limit of 4096 exceeded"],
  ])
    assert.strictEqual(caught(() => compile(pattern)).message, message);
});

test("relocate names this package when it refuses, not its dependency", () => {
  // The message is documented here, and the guard has to stay here to keep it:
  // waarmerk refuses in its own name, which is a package the caller never chose.
  assert.throws(
    () => relocate(SyntaxError("from somewhere else")),
    (e) => e instanceof TypeError && e.message === "Not a diagnostic from Treffer",
  );
});
