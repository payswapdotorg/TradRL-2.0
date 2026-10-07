/**
 * Trading World side-pane lifecycle contract tests (UI side).
 *
 * These are primarily compile-time law assertions (checked by
 * `tsc -p contracts/ui`, which includes this file); the node:test blocks
 * make the same laws executable so `tsx --test` reports them too.
 *
 * Spec: spec/ZCODE-INTEGRATION-MAP.md (Required first integration,
 * Forbidden coupling), spec/ARCHITECTURE-LOCK.md (A1 shell genericity, A2
 * Trading World is a first-class dockable surface, A14 visible simulation
 * disclosure), AGENTS.md product boundary, spec/ACCEPTANCE-WORLD-ALPHA.md K.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type {
  OpenTradingWorldSidePaneRequestContract,
  TradingWorldPanelIconContract,
  TradingWorldPanelTypeKind,
  TradingWorldPanelTypeRegistrationContract,
  TradingWorldPaneLayoutProfileContract,
  TradingWorldSidePaneTabContract,
  TradingWorldSurfaceComponentContract,
  TradingWorldSurfaceHostingPhase,
  TradingWorldSurfacePropsContract,
} from "../src/trading-world-side-pane.js";
import type { Equal, Expect, OptionalKeys, RequiredKeys } from "./helpers.js";

test("the registered panel kind discriminates exactly to trading-world", () => {
  type Kind = TradingWorldPanelTypeKind;
  type _kindIsLiteral = Expect<Equal<Kind, "trading-world">>;
  assert.equal("trading-world" satisfies Kind, "trading-world");
});

test("tab identity carries the minimum identity from the integration map", () => {
  type Tab = TradingWorldSidePaneTabContract;
  type _required = Expect<
    Equal<RequiredKeys<Tab>, "id" | "type" | "workspaceKey" | "worldId" | "layoutProfileId">
  >;
  type _optional = Expect<Equal<OptionalKeys<Tab>, "ownerTaskId" | "openedAt">>;
  type _kind = Expect<Equal<Tab["type"], "trading-world">>;
  // Scope/identity fields stay opaque strings: the shell persists and
  // compares them but never interprets their content.
  type _opaqueWorld = Expect<Equal<Tab["worldId"], string>>;
  type _opaqueLayout = Expect<Equal<Tab["layoutProfileId"], string>>;
  type _workspaceScope = Expect<Equal<Tab["workspaceKey"], string>>;
  const sample: Tab = {
    id: "trading-world:ws:world",
    type: "trading-world",
    workspaceKey: "ws",
    worldId: "world",
    layoutProfileId: "default",
  };
  assert.equal(sample.type, "trading-world");
});

test("open requests name the world and layout profile explicitly", () => {
  type Request = OpenTradingWorldSidePaneRequestContract;
  type _required = Expect<
    Equal<RequiredKeys<Request>, "workspaceKey" | "worldId" | "layoutProfileId">
  >;
  type _optional = Expect<Equal<OptionalKeys<Request>, "ownerTaskId">>;
});

test("the shell never learns trading domain concepts through this contract", () => {
  /**
   * The product-boundary law as a type: none of these domain keys may ever
   * appear as a field of the persisted tab identity. Adding e.g. an
   * `orders` or `symbol` field to the shell-side contract is a compile
   * failure here (AGENTS.md "Do not import trading-domain implementations
   * into generic ZCode infrastructure"; ZCODE-INTEGRATION-MAP "Forbidden
   * coupling").
   */
  type ForbiddenDomainKeys =
    | "market"
    | "markets"
    | "order"
    | "orders"
    | "instrument"
    | "symbol"
    | "venue"
    | "quote"
    | "book"
    | "depth"
    | "trade"
    | "trades"
    | "fill"
    | "fills"
    | "position"
    | "positions"
    | "portfolio"
    | "account"
    | "balance"
    | "cash"
    | "risk"
    | "pnl"
    | "candle"
    | "candles"
    | "tick"
    | "news"
    | "clock";
  type TabKeys = keyof TradingWorldSidePaneTabContract;
  type Violations = Extract<TabKeys, ForbiddenDomainKeys>;
  type _noDomainLeak = Expect<Equal<Violations, never>>;
  assert.ok(true, "compile-time law: no trading domain keys on the shell tab contract");
});

test("hosting phases distinguish collapse (hidden) from close (unmounted)", () => {
  type Phase = TradingWorldSurfaceHostingPhase;
  type _phases = Expect<
    Equal<Phase, "unmounted" | "mounted-hidden" | "mounted-focused">
  >;
  const phases: readonly Phase[] = ["unmounted", "mounted-hidden", "mounted-focused"];
  assert.equal(phases.length, 3);
});

test("surface props mirror what the shell passes to existing panes", () => {
  type Props = TradingWorldSurfacePropsContract;
  type _required = Expect<
    Equal<RequiredKeys<Props>, "tab" | "visible" | "focused" | "onClose">
  >;
  type _noOptional = Expect<Equal<OptionalKeys<Props>, never>>;
  type _tabIsContract = Expect<Equal<Props["tab"], TradingWorldSidePaneTabContract>>;
  type _onClose = Expect<Equal<Props["onClose"], () => void>>;
  assert.ok(true);
});

test("registration contract is the existing pane-type pattern, generalized", () => {
  type Registration = TradingWorldPanelTypeRegistrationContract;
  type _required = Expect<
    Equal<RequiredKeys<Registration>, "kind" | "title" | "icon" | "defaultLayout">
  >;
  type _kind = Expect<Equal<Registration["kind"], TradingWorldPanelTypeKind>>;
  type _title = Expect<Equal<Registration["title"], string>>;
  type _icon = Expect<Equal<Registration["icon"], TradingWorldPanelIconContract>>;
  type _layout = Expect<
    Equal<Registration["defaultLayout"], TradingWorldPaneLayoutProfileContract>
  >;
  // The layout profile must stay numeric outer geometry — no domain tools.
  type Layout = TradingWorldPaneLayoutProfileContract;
  type _layoutKeys = Expect<
    Equal<keyof Layout, "minWidthPx" | "maxWidthRatio" | "defaultWidthRatio" | "collapsedWidthPx">
  >;
  assert.ok(true);
});

test("the hosted surface stays a plain component type", () => {
  type Surface = TradingWorldSurfaceComponentContract;
  type _isPropsFn = Expect<Equal<Surface, (props: TradingWorldSurfacePropsContract) => unknown>>;
  assert.ok(true);
});
