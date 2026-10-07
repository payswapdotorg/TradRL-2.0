# TradRL Project State

Repository: payswapdotorg/TradRL-2.0
Upstream base: zai-org/zcode
Program: TRADRL-2.0

Status at architecture bootstrap:
- program implementation: not started
- World Alpha: not started
- Agent/RL implementation: gated behind World Alpha
- Arena: optional, non-blocking
- max workers: 3

## Primary objective

Build Trader World Alpha as the first useful TradRL product surface inside the existing ZCode workbench.

## State ownership

`program/graph.json` is authoritative for Work Order status.

This document records the current milestone and architectural context.

## Carried-forward architecture

- Agent = Body + Cognitive Substrate via Possession.
- Organization is discoverable/optimizable.
- Capability discovery is empirical.
- Specialized models can be selected when measured capability warrants them.
- World modes: exact replay, reactive replay, counterfactual.
- Time Machine enforces point-in-time knowledge.
- Reward/evaluation are constraint-aware.
- Firm Brain is tenant isolated.
- Arena is optional human expertise, never the learning engine.

## Update rule

After every merge that changes readiness, the TL updates graph state and this document from repository facts.
