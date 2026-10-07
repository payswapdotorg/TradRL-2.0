# Dependency Graph and Concurrency

Maximum workers: 3.

A Work Order is ready only when every dependency is merged.

## Foundation

```
W001
 ├── W002
 └── W003
      ├── W004
      └── W005
```

W002 and W003 can run concurrently after W001.

W004 and W005 can run concurrently after W003, subject to disjoint write surfaces.

## World UI

```
W005 → W006
          ├→ W007 chart
          ├→ W008 watchlist
          ├→ W009 DOM/T&S
          ├→ W010 orders
          ├→ W011 portfolio/risk
          └→ W012 clock
```

These are deliberately split to allow three concurrent workers at a time.

## World runtime

```
W013
 ├→ W014 matching
 ├→ W015 account/risk
 └→ W016 journal/snapshot/branch
W014 → W017 generator
W006 + W013 → W018 worker adapter
W007+W008+W009+W010+W011+W012+W014+W015+W016+W017+W018 → W019
```

## Later parallel zones

After World Alpha:

```
W020  W023  W027  W029
 │     │     │     │
 W021  W024  W028  W030
```

After agent foundation:

```
W032 → W033 → W034
             ├→ W035 → W036 → W037 → W038
             └→ W039 → W040 → W041 → W042 → W043
```

RL:

```
W047 → W048 → W049
W050 → W051 → W052 → W053 → W054 → W055
```

## Collision hotspots

Serialize:

- root manifests
- lockfiles
- architecture policy
- protocol indexes
- WorkspaceShellLayout
- workspaceSidePane registry

## Dispatch algorithm

At every merge:

1. read graph;
2. recompute dependency satisfaction;
3. collect ready items;
4. group by disjoint write surface;
5. dispatch up to 3;
6. reserve shared-file work for TL;
7. repeat immediately after merge.

Never keep a worker idle while a safe ready task exists.

## No-drift rule

A worker that discovers another surface is required records a dependency finding rather than editing the other Work Order's files.
