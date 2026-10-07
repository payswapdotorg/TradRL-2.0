/**
 * Shared JSON file reading with typed not-found / unreadable / parse errors
 * (W031). One helper, used by the definition, script, dataset and journal
 * loaders — every input file failure is typed and carries the underlying
 * reason verbatim.
 */

import { readFile } from "node:fs/promises";
import { CliError } from "./errors.js";

/** The label codes one caller maps file failures onto. */
export interface JsonFileLabels {
  readonly notFound: "definition-not-found" | "script-not-found" | "dataset-not-found" | "journal-not-found";
  readonly unreadable:
    | "definition-unreadable"
    | "script-unreadable"
    | "dataset-unreadable"
    | "journal-unreadable";
  readonly invalidJson:
    | "definition-invalid-json"
    | "script-invalid-json"
    | "dataset-invalid-json"
    | "journal-invalid";
}

/** Read a JSON file: typed errors for missing, unreadable and unparseable. */
export async function readJsonFile(path: string, labels: JsonFileLabels): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new CliError(labels.notFound, `no such file: ${path}`);
    }
    throw new CliError(labels.unreadable, `cannot read ${path}: ${String(code ?? error)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new CliError(labels.invalidJson, `${path} is not valid JSON: ${(error as Error).message}`);
  }
}
