# Market World Protocol

## Ports

### QueryPort

`getWorldMeta`, `getSnapshot`, `getInstrument`, `getQuote`, `getOrderBook`, `getTrades`, `getOrders`, `getPositions`, `getPortfolio`, `getRisk`, `getNews`, `getTimeline`

### CommandPort

`submitOrder`, `cancelOrder`, `replaceOrder`, `closePosition`, `addAnnotation`, `createSnapshot`, `branchWorld`, `setScenario`

### ClockPort

`play`, `pause`, `step`, `seek`, `jumpToEvent`, `setSpeed`, `followRealtime`, `getClock`

### EvidencePort

`getEvent`, `getEvents`, `getProvenance`, `getSnapshot`, `getBranchLineage`, `getInformationBoundary`, `getDeterminismManifest`

## Command lifecycle

```
command
 ↓
validate
 ↓
authorize
 ↓
apply domain rules
 ↓
mutate authoritative state
 ↓
emit ordered events
 ↓
append journal
 ↓
publish projections
 ↓
ack
```

## Event envelope

- worldId
- sequence
- eventId
- eventType
- occurredAt
- availableAt when applicable
- causationId
- correlationId
- producer
- schemaVersion
- payload

Sequence is monotonic within a world.

## Time

```
wallTime       host time
simulationTime world time
eventTime      domain timestamp
availableAt    earliest legal observation time
```

## Snapshots

A snapshot is immutable and self-describing. It includes world definition, clock, engine/version, seed, market/account/participant/information state and journal cursor.

## Branches

A branch never modifies its parent. It references a source snapshot and records its branch definition.

## Determinism

The determinism manifest includes:

- world definition version
- engine/version
- seed
- input hashes
- dependency/runtime versions
- command stream hash

## UI projection law

Projections may batch, conflate, virtualize and drop stale display frames. They may never fabricate financial facts.

## Human/agent symmetry

Human and agent actions terminate at the same CommandPort.
