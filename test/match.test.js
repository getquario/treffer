import assert from "node:assert/strict";
import test from "node:test";
import { compile, match, search } from "../lib/index.js";

const notOk = (value, message) => assert.ok(!value, message);

test("compile once, run many", () => {
  const re = compile("(ab|cd)+");
  assert.ok(Object.isFrozen(re), "compiled matcher is immutable");
  assert.ok(re.match("ab"));
  assert.ok(re.match("abcd"));
  assert.ok(re.match("cdab"));
  notOk(re.match("zab"));
  assert.ok(re.search("zabcd!"));
});

test("quantifiers and empty branches", () => {
  for (const [pattern, yes, no] of [
    ["a*", ["", "a", "aaa"], ["b"]],
    ["a+", ["a", "aaa"], ["", "b"]],
    ["a?", ["", "a"], ["aa"]],
    ["a{2,4}", ["aa", "aaaa"], ["a", "aaaaa"]],
    ["a{2,}", ["aa", "aaaaa"], ["a"]],
    ["a|", ["", "a"], ["aa"]],
    ["", [""], ["a"]],
  ]) {
    const re = compile(pattern);
    for (const value of yes)
      assert.ok(re.match(value), pattern + " matches " + JSON.stringify(value));
    for (const value of no) notOk(re.match(value), pattern + " rejects " + JSON.stringify(value));
  }
});

test("character classes", () => {
  assert.ok(match("[-a]+", "a-a"), "leading hyphen");
  assert.ok(match("[a-]+", "a-a"), "trailing hyphen");
  assert.ok(match("[^a]+", "bbb"), "negated class");
  notOk(match("[^a]+", "aba"), "negated class rejects member");
  assert.ok(match("[\\[]+", "[[["), "escaped opening bracket");
  assert.ok(match("[\\]]+", "]]]"), "escaped closing bracket");
  assert.ok(match("[\\\\]+", "\\\\"), "escaped backslash");
  assert.ok(match("[\\n-\\r]+", "\n\f\r"), "escaped range endpoints");
});

test("Unicode scalar and property semantics", () => {
  assert.ok(match("\\p{Lu}+", "ÄBC"));
  notOk(match("\\p{Lu}+", "Äbc"));
  assert.ok(match("\\P{Lu}+", "abc"));
  assert.ok(match(".", "😀"), "dot consumes one astral scalar");
  assert.ok(match(".", "\u2028"), "dot includes Unicode line separator");
  notOk(match(".", "\n"), "dot excludes newline");
  notOk(match(".", "\r"), "dot excludes carriage return");
  assert.ok(match("😀+", "😀😀"));
});

test("match and search differ only in anchoring", () => {
  assert.ok(match("[0-9]+", "123"));
  notOk(match("[0-9]+", "x123"));
  assert.ok(search("[0-9]+", "x123"));
  notOk(search("[0-9]+", "abc"));
  assert.ok(search("", "abc"), "empty pattern is found");
});

test("subject anchors are an explicit extension", () => {
  assert.ok(match("^a$", "^a$"), "strict RFC mode treats anchors as literals");
  notOk(match("^a$", "a"), "strict mode does not anchor");

  const re = compile("^a+$", { anchors: true });
  assert.ok(re.match("aaa"));
  assert.ok(re.search("aaa"));
  notOk(re.search("xaaa"));
  notOk(re.search("aaax"));
});

test("one-shot helpers match compiled behavior", () => {
  const pattern = "(a|bc)+",
    subject = "abca";
  const re = compile(pattern);
  assert.strictEqual(match(pattern, subject), re.match(subject));
  assert.strictEqual(search(pattern, "x" + subject), re.search("x" + subject));
});
