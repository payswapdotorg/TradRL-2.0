# Fresh TL Quickstart

Read in this exact order:

1. AGENTS.md
2. spec/ARCHITECTURE-LOCK.md
3. spec/ARCHITECTURE.md
4. spec/WORLD-PROTOCOL.md
5. spec/UX-DESIGN.md
6. spec/SIMULATION.md
7. spec/DOMAIN-MODEL.md
8. spec/REQUIREMENTS.md
9. spec/ACCEPTANCE-WORLD-ALPHA.md
10. spec/WORK-ITEMS.md
11. spec/DEPENDENCY-GRAPH.md
12. spec/WORKER-RUNBOOK.md
13. program/graph.json

Then inspect only the ZCode modules touched by the active Work Orders.

The immediate job is World Alpha, not Agent/RL.

At every merge, update graph/state and dispatch the next safe 3-way frontier.

Do not ask the user to restate architecture already present in the repository.
