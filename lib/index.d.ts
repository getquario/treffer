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

export interface TrefferDiagnostic extends Error {
  readonly code?: TrefferErrorCode;
  readonly limit?: number;
  readonly actual?: number;
  /** Zero-based offset into the pattern. Syntax diagnostics only. */
  readonly start?: number;
  /** Exclusive offset into the pattern. Syntax diagnostics only. */
  readonly end?: number;
}

/** Test whether an error was created by this Treffer module instance. */
export function isDiagnostic(error: unknown): error is TrefferDiagnostic;

/**
 * Copy a diagnostic into an embedder's coordinates: `prefix` is prepended to
 * the message verbatim, `offset` shifts the span when there is one, every
 * other field is carried over, and the copy is authenticated exactly as the
 * original was.
 *
 * @throws {TypeError} When `diag` is not a diagnostic from this instance.
 */
export function relocate(
  diag: unknown,
  opts?: { prefix?: string; offset?: number },
): TrefferDiagnostic;

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
