import type { Diagnostic, Relocation } from "waarmerk";

export interface TrefferOptions {
  /**
   * Treat `^` and `$` as subject anchors.
   *
   * This is a compatibility extension and is not part of RFC 9485.
   */
  anchors?: boolean;
}

export type TrefferErrorCode =
  | "TREFFER_SYNTAX"
  | "TREFFER_MAX_PATTERN_SCALARS"
  | "TREFFER_MAX_GROUP_DEPTH"
  | "TREFFER_MAX_QUANTIFIER_DIGITS"
  | "TREFFER_MAX_REPETITIONS"
  | "TREFFER_MAX_NFA_STATES"
  | "TREFFER_MAX_SUBJECT_SCALARS"
  | "TREFFER_MAX_TRANSITIONS";

/**
 * The fields and their meanings are waarmerk's; this names the code union they
 * are checked against. `start`/`end` are zero-based and exclusive offsets into
 * the pattern, on syntax diagnostics only; `limit`/`actual` are the resource
 * ones, which have no span.
 */
export interface TrefferDiagnostic extends Diagnostic<TrefferErrorCode> {}

/** Test whether an error was created by this Treffer module instance. */
export function isDiagnostic(error: unknown): error is TrefferDiagnostic;

/**
 * Copy a diagnostic into an embedder's coordinates: `prefix` is prepended to
 * the message verbatim, the span is moved when there is one, every other field
 * is carried over, and the copy is authenticated exactly as the original was.
 *
 * `offset` shifts the span, for an embedder that handed over a verbatim slice
 * of its own text. `span` replaces it, for one whose text reached the pattern
 * through a decode — a pattern read out of a JSON string literal, where an
 * escape makes every later offset slide — and so has no offset to shift.
 * `span` wins when both are given.
 *
 * @throws {TypeError} When `diag` is not a diagnostic from this instance.
 */
export function relocate(diag: unknown, opts?: Relocation): TrefferDiagnostic;

export interface Treffer {
  /** Test whether the pattern matches the whole subject. */
  readonly match: (subject: string) => boolean;
  /** Test whether the pattern matches any substring of the subject. */
  readonly search: (subject: string) => boolean;
}

/** Compile and validate an RFC 9485 I-Regexp. */
export function compile(pattern: string, options?: TrefferOptions): Treffer;

/** Compile a pattern and test it against the whole subject. */
export function match(pattern: string, subject: string, options?: TrefferOptions): boolean;

/** Compile a pattern and test it against any substring of the subject. */
export function search(pattern: string, subject: string, options?: TrefferOptions): boolean;
