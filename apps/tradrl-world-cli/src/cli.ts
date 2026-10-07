/**
 * The CLI entry (W031): parse argv, execute `run`/`replay`, print the
 * report JSON to stdout. Honest failure: typed errors print to stderr (one
 * human line + the JSON error value) and the process exits with the error
 * class's code (0 success, 1 usage, 2 invalid input, 3 engine failure).
 *
 * `main` returns the exit code without exiting (testable); `runMain` is the
 * bin-facing wrapper that prints and exits.
 */

import { parseCommandLine, USAGE } from "./args.js";
import { CliError } from "./errors.js";
import { loadDefinitionFile } from "./definitionFile.js";
import { loadScriptFile } from "./scriptFile.js";
import { executeRun } from "./runner.js";
import { stableDigest } from "tradrl-world-sim/world";
import { executeReplay } from "./replay.js";

/** Execute one command line, printing the report JSON to stdout. */
export async function main(argv: readonly string[]): Promise<number> {
  let commandLine;
  try {
    commandLine = parseCommandLine(argv);
  } catch (error) {
    if (error instanceof CliError) {
      return reportError(error);
    }
    throw error;
  }
  if (commandLine.command === "help") {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  try {
    if (commandLine.command === "run") {
      const loaded = await loadDefinitionFile(commandLine.definitionPath);
      const entries =
        commandLine.scriptPath === undefined
          ? []
          : (await loadScriptFile(commandLine.scriptPath, loaded.definition.scope.worldId)).entries;
      const report = await executeRun({
        definition: loaded.definition,
        definitionDigest: stableDigest(loaded.definition),
        datasets: loaded.datasets?.evidence ?? [],
        entries,
        invocation: {
          definitionPath: commandLine.definitionPath,
          ...(commandLine.scriptPath === undefined ? {} : { scriptPath: commandLine.scriptPath }),
          ...(commandLine.reportPath === undefined ? {} : { reportPath: commandLine.reportPath }),
          ...(commandLine.journalPath === undefined ? {} : { journalPath: commandLine.journalPath }),
        },
      });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return 0;
    }
    const report = await executeReplay({
      journalPath: commandLine.journalPath,
      ...(commandLine.definitionPath === undefined ? {} : { definitionPath: commandLine.definitionPath }),
      ...(commandLine.scriptPath === undefined ? {} : { scriptPath: commandLine.scriptPath }),
      ...(commandLine.reportPath === undefined ? {} : { reportPath: commandLine.reportPath }),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof CliError) {
      return reportError(error);
    }
    return reportError(
      new CliError("engine-error", `unexpected failure: ${String((error as Error)?.stack ?? error)}`),
    );
  }
}

/** Print one typed error to stderr (human line + JSON value); return the exit code. */
function reportError(error: CliError): number {
  process.stderr.write(`tradrl-world: ${error.code}: ${error.message}\n`);
  process.stderr.write(`${JSON.stringify(error.toJson())}\n`);
  return error.exitCode;
}

/** The bin entry: run main and exit with its code. */
export async function runMain(): Promise<void> {
  process.exit(await main(process.argv.slice(2)));
}
