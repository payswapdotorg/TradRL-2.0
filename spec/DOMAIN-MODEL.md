# TradRL Domain Model

## World entities

Project
World
WorldSnapshot
WorldBranch
Instrument
Venue
MarketEvent
Order
Execution
Fill
Account
Position
Portfolio
RiskState
Participant
InformationArtifact
SimulationClock
JournalEntry
EvidenceCapsule

## Future intelligence entities

AgentBody
CognitiveSubstrate
Possession
Capability
Organization
Trajectory
Experiment
Evaluation
FirmBrain

## Identity laws

- IDs are opaque.
- Tenant/project/world scope is explicit.
- Composite ids use canonical encoders.
- Business code never parses opaque ids by delimiter.
- Branch lineage is immutable.

## Financial precision

Money, price and quantity use explicit decimal/precision policies. Display formatting is never financial truth.

## Ownership

```
World Engine → authoritative live state
Journal      → authoritative history
Snapshot     → branch origin
UI stores    → presentation
Adapters     → translation
```
