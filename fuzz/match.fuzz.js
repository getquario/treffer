import assert from 'node:assert/strict';
import { compile, isDiagnostic } from '../lib/index.js';

let outcome = fn => {
	try { return ['value', fn()] }
	catch (err) {
		assert.ok(isDiagnostic(err));
		return ['error', err.constructor.name, err.code, err.limit, err.actual];
	}
};

export function fuzz(data) {
	const cut = data.length ? data[0] % data.length : 0;
	const pattern = data.subarray(1, cut).toString();
	const subject = data.subarray(cut).toString();

	try {
		const re = compile(pattern, { anchors: !!(data[1] & 1) });
		for (const name of ['match', 'search']) {
			const first = outcome(() => re[name](subject));
			const second = outcome(() => re[name](subject));
			assert.deepStrictEqual(first, second);
		}
	} catch (err) {
		assert.ok(err instanceof SyntaxError || err instanceof RangeError);
		assert.ok(isDiagnostic(err));
	}
}
