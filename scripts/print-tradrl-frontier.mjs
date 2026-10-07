import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const graph = JSON.parse(readFileSync(resolve(import.meta.dirname, "../program/graph.json"), "utf8"));
const byId = new Map(graph.items.map((item) => [item.id, item]));
const ready = graph.items.filter((item) =>
  item.status === "ready" &&
  (item.deps ?? []).every((dep) => byId.get(dep)?.status === "merged"),
);
const active = graph.items.filter((item) => ["in_progress", "in_review"].includes(item.status));

console.log(JSON.stringify({
  program: graph.program,
  updated_at: graph.updated_at,
  active_count: active.length,
  max_active: graph.policies.max_concurrent_work_orders,
  active: active.map(({id,title,status,branch}) => ({id,title,status,branch})),
  ready: ready.map(({id,title,deps,write_surface}) => ({id,title,deps,write_surface})),
}, null, 2));
