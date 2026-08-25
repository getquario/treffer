import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "../lib/index.js";

let takeEscape = (pattern, i, c) => {
  if (c !== "\\") return;
  return c + pattern[i + 1];
};

let inClass = (c, cls) => {
  if (c === "[") return true;
  if (c === "]") return false;
  return cls;
};

let mapChar = (c, cls) => (c === "." && !cls ? "[^\\n\\r]" : c);

let native = (pattern, full) => {
  let out = "",
    cls = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    const escaped = takeEscape(pattern, i, c);
    if (escaped) {
      out += escaped;
      i++;
      continue;
    }
    cls = inClass(c, cls);
    out += mapChar(c, cls);
  }
  return new RegExp(full ? "^(?:" + out + ")$" : out, "u");
};

test("safe RFC subset agrees with ECMAScript mapping", () => {
  const patterns = [
    "",
    "a",
    ".",
    "a*",
    "(a|b)+",
    "[a-z]{0,3}",
    "[^a]+",
    "\\p{L}+",
    "\\P{N}+",
    "[-a]+",
    "(ab|){1,3}",
  ];
  const subjects = ["", "a", "ab", "bbb", "42", "Ä", "😀", "a\nb"];

  for (const pattern of patterns) {
    const re = compile(pattern);
    for (const subject of subjects) {
      assert.strictEqual(
        re.match(subject),
        native(pattern, true).test(subject),
        "match " + pattern + " / " + JSON.stringify(subject),
      );
      assert.strictEqual(
        re.search(subject),
        native(pattern, false).test(subject),
        "search " + pattern + " / " + JSON.stringify(subject),
      );
    }
  }
});
