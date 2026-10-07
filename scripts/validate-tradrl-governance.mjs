import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "AGENTS.md",
  "spec/ARCHITECTURE-LOCK.md",
  "spec/ARCHITECTURE.md",
  "spec/WORLD-PROTOCOL.md",
  "spec/UX-DESIGN.md",
  "spec/SIMULATION.md",
  "spec/DOMAIN-MODEL.md",
  "spec/REQUIREMENTS.md",
  "spec/ACCEPTANCE-WORLD-ALPHA.md",
  "spec/WORK-ITEMS.md",
  "spec/DEPENDENCY-GRAPH.md",
  "spec/WORKER-RUNBOOK.md",
  "spec/WORK-ORDER-TEMPLATE.md",
  "spec/PROJECT-STATE.md",
  "spec/THIRD-PARTY-TECHNOLOGY-REGISTER.md",
  "docs/LLM-ARCHITECT-HANDOFF.md",
  "docs/ARCHITECT-QUICKSTART.md",
  "program/graph.json",
];
for (const path of required) {
  if (!existsSync(resolve(root, path))) throw new Error(`missing source-of-truth file: ${path}`);
}
const graph = JSON.parse(readFileSync(resolve(root, "program/graph.json"), "utf8"));
if (graph.program !== "TradRL-2.0") throw new Error("wrong program id");
if (graph.policies?.max_concurrent_work_orders !== 3) throw new Error("max concurrency must be 3");
const items = graph.items ?? [];
if (items.length !== 66) throw new Error(`expected 66 work items, got ${items.length}`);
const ids = new Set(items.map((x) => x.id));
for (const item of items) {
  for (const dep of item.deps ?? []) if (!ids.has(dep)) throw new Error(`${item.id} depends on unknown ${dep}`);
}
const byId = new Map(items.map((x) => [x.id, x]));
const visiting = new Set();
const visited = new Set();
function visit(id) {
  if (visiting.has(id)) throw new Error(`dependency cycle at ${id}`);
  if (visited.has(id)) return;
  visiting.add(id);
  for (const dep of byId.get(id)?.deps ?? []) visit(dep);
  visiting.delete(id);
  visited.add(id);
}
for (const item of items) visit(item.id);
const active = items.filter((x) => ["in_progress", "in_review"].includes(x.status));
if (active.length > 3) throw new Error(`too many active work items: ${active.length}`);
const surfaceOwners = new Map();
for (const item of active) for (const surface of item.write_surface ?? []) {
  if (surfaceOwners.has(surface)) throw new Error(`active write-surface collision: ${surface}`);
  surfaceOwners.set(surface, item.id);
}
console.log(`TradRL governance OK: ${items.length} work items, ${active.length} active/review, no dependency cycles.`);
