/**
 * The typed CLI error taxonomy (W031).
 *
 * Spec: spec/WORLD-PROTOCOL.md (typed surfaces — errors are values with
 * closed codes, never silent) and the W031 work order: "honest errors to
 * stderr with typed codes; exit 0 on success, non-zero on failure".
 *
 * Every failure the CLI can produce maps to ONE code from the closed set
 * below and one exit class. Engine-side failures (the sim package's own
 * typed errors) are wrapped with their name + message preserved verbatim —
 * the CLI never invents a cause.
 */

/** The closed set of CLI failure codes. */
export type CliErrorCode =
  // argv shape (unknown flag, missing value, unknown subcommand, missing
  // required option)
  | "usage-error"
  // input files: missing / unreadable / not valid JSON
  | "definition-not-found"
  | "definition-unreadable"
  | "definition-invalid-json"
  | "definition-invalid"
  | "script-not-found"
  | "script-unreadable"
  | "script-invalid-json"
  | "script-invalid"
  | "dataset-not-found"
  | "dataset-unreadable"
  | "dataset-invalid-json"
  | "dataset-import-violations"
  | "journal-not-found"
  | "journal-unreadable"
  | "journal-invalid"
  // semantic cross-file mismatches
  | "definition-mismatch"
  | "replay-requires-definition"
  // output files
  | "report-unwritable"
  | "journal-unwritable"
  // the engine threw (invariant violation, journal law violation, ...)
  | "engine-error";

/** Exit classes: 0 success; 1 usage; 2 invalid input; 3 engine failure. */
export type CliExitCode = 0 | 1 | 2 | 3;

const EXIT_OF_CODE: Readonly<Record<CliErrorCode, 1 | 2 | 3>> = {
  "usage-error": 1,
  "definition-not-found": 2,
  "definition-unreadable": 2,
  "definition-invalid-json": 2,
  "definition-invalid": 2,
  "script-not-found": 2,
  "script-unreadable": 2,
  "script-invalid-json": 2,
  "script-invalid": 2,
  "dataset-not-found": 2,
  "dataset-unreadable": 2,
  "dataset-invalid-json": 2,
  "dataset-import-violations": 2,
  "journal-not-found": 2,
  "journal-unreadable": 2,
  "journal-invalid": 2,
  "definition-mismatch": 2,
  "replay-requires-definition": 2,
  "report-unwritable": 2,
  "journal-unwritable": 2,
  "engine-error": 3,
};

/** The one error type the CLI reports (to stderr, with its code). */
export class CliError extends Error {
  constructor(
    readonly code: CliErrorCode,
    message: string,
    /** Machine-readable detail (violation lists, cause chains, ...). */
    readonly details?: readonly string[],
  ) {
    super(message);
    this.name = "CliError";
  }

  /** The process exit class for this code. */
  get exitCode(): 1 | 2 | 3 {
    return EXIT_OF_CODE[this.code];
  }

  /** The JSON error value printed to stderr after the human line. */
  toJson(): { error: { code: CliErrorCode; message: string; details?: readonly string[] } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

/** Whether an unknown thrown value is one of the sim package's typed errors. */
export function isSimTypedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    [
      "InvalidWorldDefinitionError",
      "EngineInvariantError",
      "JournalLawViolationError",
      "ClockRejectionError",
      "DatasetImportError",
      "InformationImportError",
      "InvalidClockSetupError",
    ].includes(error.name)
  );
}

/** Wrap an engine-side failure as an `engine-error` (name preserved). */
export function engineError(error: unknown, context: string): CliError {
  if (error instanceof Error) {
    return new CliError(
      "engine-error",
      `${context}: ${error.name}: ${error.message}`,
    );
  }
  return new CliError("engine-error", `${context}: ${String(error)}`);
}
