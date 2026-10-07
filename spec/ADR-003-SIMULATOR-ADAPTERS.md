# ADR-003 — Simulator Engines Behind the World Protocol

Status: Accepted.

The canonical World Protocol belongs to TradRL.

NautilusTrader, ABIDES, JAX-LOB and other engines are adapters, not sources of canonical business types.

Reason: engine replacement, licensing isolation, multiple fidelity modes and headless/browser execution require a stable provider-neutral abstraction.

Consequence: no engine-specific object may leak through the public World Protocol.
