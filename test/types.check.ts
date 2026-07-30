import {
	compile,
	isDiagnostic,
	match,
	search,
	type Treffer,
	type TrefferDiagnostic,
	type TrefferErrorCode,
} from '../src/index.js';

const re: Treffer = compile('[0-9]+');
const whole: boolean = re.match('42');
const part: boolean = re.search('a42b');

const anchored: Treffer = compile('^a.*z$', { anchors: true });
const once: boolean = match('[0-9]+', '42');
const anywhere: boolean = search('[0-9]+', 'a42b');

// The published union, including every bounded-resource code.
const codes: TrefferErrorCode[] = ['TREFFER_SYNTAX', 'TREFFER_MAX_TRANSITIONS'];

// @ts-expect-error compile returns a matcher, not a boolean
const wrongCompile: boolean = compile('a');

// @ts-expect-error match returns a boolean, not a matcher
const wrongMatch: Treffer = match('a', 'a');

// @ts-expect-error the matcher is frozen
re.match = () => true;

try {
	match('[', 'a');
} catch (error: unknown) {
	if (isDiagnostic(error)) {
		const diagnostic: TrefferDiagnostic = error;
		const code: TrefferErrorCode | undefined = diagnostic.code;
		const limit: number | undefined = diagnostic.limit;
		const actual: number | undefined = diagnostic.actual;
		void [code, limit, actual];

		// @ts-expect-error diagnostic metadata is readonly
		diagnostic.limit = 1;
	}
}

void [whole, part, anchored, once, anywhere, codes, wrongCompile, wrongMatch];
