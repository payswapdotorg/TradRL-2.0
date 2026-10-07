/**
 * The executable entry (W031): the bin bootstrap (`bin/tradrl-world.mjs`)
 * loads this module through the tsx loader and node runs it as the main
 * module. Kept separate from `cli.ts` so importing the CLI's `main` from
 * tests never executes a run or exits the process.
 */

import { runMain } from "./cli.js";

await runMain();
