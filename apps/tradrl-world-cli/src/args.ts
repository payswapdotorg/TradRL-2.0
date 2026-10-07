/**
 * argv parsing and the honest usage text (W031).
 *
 * The CLI contract (work order W031):
 *   tradrl-world run --definition <file.json>
 *                    [--script <commands.json>]
 *                    [--report <out.json>]
 *                    [--journal <out.jsonl>]
 *   tradrl-world replay --journal <file.jsonl>
 *                       [--definition <file.json>]
 *                       [--script <commands.json>]
 *                       [--report <out.json>]
 *   tradrl-world --help | tradrl-world help
 *
 * Parsing is strict: unknown flags, flags without values, unknown
 * subcommands and missing required options are typed usage errors that name
 * the offending token — never a silent default.
 */

import { CliError } from "./errors.js";

/** The parsed command line. */
export type CommandLine =
  | { readonly command: "help" }
  | {
      readonly command: "run";
      readonly definitionPath: string;
      readonly scriptPath?: string;
      readonly reportPath?: string;
      readonly journalPath?: string;
    }
  | {
      readonly command: "replay";
      readonly journalPath: string;
      readonly definitionPath?: string;
      readonly scriptPath?: string;
      readonly reportPath?: string;
    };

export const USAGE = `tradrl-world — headless World CLI/replay runner (W031)

Runs a deterministic World headlessly: a definition file (JSON) builds the
world, an optional script file (JSON) drives an ordered command/clock
stream, and the run report (the W013 headless report + journal digest +
determinism manifest) prints to stdout as JSON. A definition that declares a
regimeSchedule runs the W017 generated market (createGeneratedWorldEngine);
otherwise the plain headless engine runs.

Usage:
  tradrl-world run --definition <file.json> [--script <commands.json>]
                   [--report <out.json>] [--journal <out.jsonl>]
  tradrl-world replay --journal <file.jsonl> [--definition <file.json>]
                      [--script <commands.json>] [--report <out.json>]
  tradrl-world help | --help

Commands:
  run     Create the world from the definition file, drive the script (when
          given) in order, print the run report. --report also writes the
          report JSON to a file; --journal writes the run's journal records
          (JSONL with a definition header — replayable).
  replay  Rebuild the world state from a journal file (records, one per
          line) and continue: with a --script the continuation drives the
          restored engine; the restored-state summary and the continuation
          report print to stdout. The journal file is self-contained when it
          was written by \`run --journal\` (first line embeds the definition);
          a bare records file requires --definition.

Exit codes:
  0  success (the run completed; typed command/clock rejections inside the
     script are honest deterministic outcomes, reported per entry)
  1  usage error (bad argv)
  2  invalid input (files, JSON, schema, dataset imports, mismatches)
  3  engine failure (an engine invariant was violated)`;

const FLAGS_WITH_VALUE: ReadonlySet<string> = new Set([
  "--definition",
  "--script",
  "--report",
  "--journal",
]);

interface ParsedFlags {
  readonly values: Readonly<Record<string, string>>;
  readonly rest: readonly string[];
}

function parseFlags(
  tokens: readonly string[],
): ParsedFlags {
  const values: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (FLAGS_WITH_VALUE.has(token)) {
      const value = tokens[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new CliError(
          "usage-error",
          `option ${token} requires a value (got ${value === undefined ? "nothing" : value})`,
        );
      }
      if (values[token] !== undefined) {
        throw new CliError("usage-error", `option ${token} was given more than once`);
      }
      values[token] = value;
      i += 1;
      continue;
    }
    if (token.startsWith("--")) {
      throw new CliError("usage-error", `unknown option ${token}`);
    }
    rest.push(token);
  }
  return { values, rest };
}

/** Parse the raw argv (excluding node + entry path) into a command line. */
export function parseCommandLine(argv: readonly string[]): CommandLine {
  const [subcommand, ...tokens] = argv;
  if (subcommand === undefined || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    return { command: "help" };
  }
  if (subcommand !== "run" && subcommand !== "replay") {
    throw new CliError(
      "usage-error",
      `unknown command '${subcommand}' (expected 'run' or 'replay'; see tradrl-world --help)`,
    );
  }
  const { values, rest } = parseFlags(tokens);
  if (rest.length > 0) {
    throw new CliError(
      "usage-error",
      `unexpected argument${rest.length > 1 ? "s" : ""} ${rest.map((t) => `'${t}'`).join(", ")} (flags only; see tradrl-world --help)`,
    );
  }
  if (subcommand === "run") {
    if (values["--definition"] === undefined) {
      throw new CliError("usage-error", "run requires --definition <file.json>");
    }
    return {
      command: "run",
      definitionPath: values["--definition"],
      ...(values["--script"] === undefined ? {} : { scriptPath: values["--script"] }),
      ...(values["--report"] === undefined ? {} : { reportPath: values["--report"] }),
      ...(values["--journal"] === undefined ? {} : { journalPath: values["--journal"] }),
    };
  }
  if (values["--journal"] === undefined) {
    throw new CliError("usage-error", "replay requires --journal <file.jsonl>");
  }
  return {
    command: "replay",
    journalPath: values["--journal"],
    ...(values["--definition"] === undefined ? {} : { definitionPath: values["--definition"] }),
    ...(values["--script"] === undefined ? {} : { scriptPath: values["--script"] }),
    ...(values["--report"] === undefined ? {} : { reportPath: values["--report"] }),
  };
}
