import { CandlestickChartIcon, XIcon } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import type { TradingWorldSidePaneTab } from "@/lib/workspaceSidePane.js";

/**
 * TradRL Trading World side-pane placeholder surface (W005 seam).
 *
 * 外壳只认识这个组件的**生命周期形状**（挂载/聚焦/关闭 + 容器自适应布局），
 * 不认识任何交易域语义：`tab.worldId` / `tab.layoutProfileId` 在外壳侧是不透明
 * 字符串，由 Trading World 自己解释（contracts/ui/ 契约 + AGENTS.md 产品边界）。
 *
 * 完整的市场工作台（charts / watchlist / DOM / orders / portfolio / clock）是
 * W006+ 的 surface；W005 只交付注册 + 生命周期 parity + 常驻模拟披露徽标。
 */

/** 面板固定展示名（产品名，不本地化；W006+ 接管真实 i18n 时再评估）。 */
export const TRADING_WORLD_PANE_TITLE = "Trading World";

/**
 * 常驻模拟披露文案（ACCEPTANCE-WORLD-ALPHA K "persistent SIMULATED disclosure"；
 * UX-DESIGN "Simulation disclosure" 的持久可见态：`SIMULATED · HISTORICAL` 或对应
 * world mode）。徽标必须是文字 + 边框，绝不能只靠颜色区分；World Alpha 无任何
 * live execution authority（ARCHITECTURE-LOCK A14）。
 */
export const TRADING_WORLD_SIMULATION_DISCLOSURE = "SIMULATED · HISTORICAL";

export function TradingWorldSidePane({
  tab,
  visible,
  focused,
  onClose,
  className,
}: {
  /** 外壳持久化的 tab 身份（外壳拥有的 outer state）。 */
  tab: TradingWorldSidePaneTab;
  /** 侧栏整体是否呈现（与 tab 活跃态独立）。 */
  visible: boolean;
  /** 本 tab 是否为呈现中的活动 tab（visible && active）。 */
  focused: boolean;
  /** 请求外壳走通用关闭路径关掉这个 tab。 */
  onClose: () => void;
  className?: string;
}) {
  return (
    <section
      aria-label={TRADING_WORLD_PANE_TITLE}
      data-trading-world-pane=""
      data-trading-world-visible={visible ? "true" : "false"}
      data-trading-world-focused={focused ? "true" : "false"}
      className={cn("flex h-full min-h-0 flex-col bg-background", className)}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/50 px-3">
        <CandlestickChartIcon className="size-4 shrink-0 text-foreground-subtle" />
        <h2 className="shrink-0 text-ui-base font-medium text-foreground">
          {TRADING_WORLD_PANE_TITLE}
        </h2>
        {/* 常驻模拟披露：文字徽标，任何时候挂载即渲染，不依赖颜色单独传达。 */}
        <span
          data-trading-world-simulation-disclosure=""
          title="Simulation disclosure — this world has no live execution authority (World Alpha)"
          className="shrink-0 rounded-full border border-border bg-surface px-1.5 text-ui-xs font-medium leading-5 text-foreground-subtle"
        >
          {TRADING_WORLD_SIMULATION_DISCLOSURE}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Close ${TRADING_WORLD_PANE_TITLE}`}
          className="ml-auto shrink-0"
          onClick={onClose}
        >
          <XIcon className="size-3.5" />
        </Button>
      </header>
      <div
        data-trading-world-placeholder=""
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-y-auto px-5 py-10 text-center"
      >
        <p className="text-ui-base font-medium text-foreground">Trading World</p>
        <p className="max-w-[20rem] text-ui-base text-foreground-subtle">
          Placeholder surface. The market workspace (watchlist, chart, order book, orders,
          portfolio, simulation clock) docks here in a later milestone.
        </p>
        <p
          data-trading-world-id=""
          title="Opaque world identity persisted by the workspace shell"
          className="font-mono text-ui-xs text-foreground-subtlest"
        >
          {tab.worldId}
        </p>
      </div>
    </section>
  );
}
