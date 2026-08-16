import assert from "node:assert/strict";
import { compile, isDiagnostic } from "../lib/index.js";

export function fuzz(data) {
  const pattern = data.toString();
  try {
    const re = compile(pattern, { anchors: !!data[0] });
    assert.ok(Object.isFrozen(re));
  } catch (err) {
    assert.ok(err instanceof SyntaxError || err instanceof RangeError);
    assert.ok(isDiagnostic(err));
    assert.match(err.code, /^TREFFER_(?:SYNTAX|MAX_[A-Z_]+)$/);
  }
}
