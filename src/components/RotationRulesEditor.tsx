import { defaultRotationRules } from "../core/rotation";
import type { BaseStrategyConfig, RotationRules } from "../core/types";
import { Section } from "./ui";

function RuleNumber({ label, value, onChange, percent = false, optional = false, max = 500, min = 0, testId }: {
  label: string; value?: number; onChange: (value: number | undefined) => void;
  percent?: boolean; optional?: boolean; min?: number; max?: number; testId: string;
}) {
  return <label>{label}
    <input type="number" data-testid={testId} min={min} max={max} step={percent ? 0.1 : 1}
      placeholder={optional ? "不限" : undefined}
      value={value === undefined ? "" : percent ? Number((value * 100).toFixed(6)) : value}
      onChange={event => {
        if (optional && event.target.value === "") { onChange(undefined); return; }
        const parsed = Number(event.target.value);
        if (!Number.isFinite(parsed)) return;
        const bounded = Math.min(max, Math.max(min, parsed));
        onChange(percent ? bounded / 100 : Math.round(bounded));
      }} />
  </label>;
}

export function RotationRulesEditor({ config, onChange }: {
  config: BaseStrategyConfig; onChange: (config: BaseStrategyConfig) => void;
}) {
  const rules = config.rotationRules ?? defaultRotationRules;
  function update(patch: Partial<RotationRules>) {
    onChange({ ...config, rotationRules: { ...rules, ...patch } });
  }
  function buy(patch: Partial<RotationRules["buy"]>) { update({ buy: { ...rules.buy, ...patch } }); }
  function sell(patch: Partial<RotationRules["sell"]>) { update({ sell: { ...rules.sell, ...patch } }); }
  return <Section title="买卖规则">
    <div className="control-grid">
      <label>排序方式
        <select data-testid="rotation-mode" value={config.rotationRules?.enabled ? "return" : "factor"}
          onChange={event => update({ enabled: event.target.value === "return" })}>
          <option value="factor">多因子综合得分</option>
          <option value="return">区间涨幅排名</option>
        </select>
      </label>
      {config.rotationRules?.enabled && <RuleNumber label="涨幅窗口（交易日）" value={rules.window}
        min={1} max={250} testId="rotation-window" onChange={value => update({ window: value! })} />}
    </div>
    {config.rotationRules?.enabled && <div className="rotation-rules">
      <div>
        <h3>买入条件</h3>
        <div className="control-grid">
          <RuleNumber label="买入排名起点" value={rules.buy.rankFrom} min={1} testId="buy-rank-from"
            onChange={value => buy({ rankFrom: value!, rankTo: Math.max(value!, rules.buy.rankTo) })} />
          <RuleNumber label="买入排名终点" value={rules.buy.rankTo} min={rules.buy.rankFrom} testId="buy-rank-to"
            onChange={value => buy({ rankTo: value! })} />
          <RuleNumber label="最低涨幅（%）" value={rules.buy.minReturn} min={-100} max={10000} optional percent
            testId="buy-min-return" onChange={value => buy({ minReturn: value,
              maxReturn: value !== undefined && rules.buy.maxReturn !== undefined ? Math.max(value, rules.buy.maxReturn) : rules.buy.maxReturn })} />
          <RuleNumber label="最高涨幅（%）" value={rules.buy.maxReturn} min={rules.buy.minReturn === undefined ? -100 : rules.buy.minReturn * 100}
            max={10000} optional percent testId="buy-max-return" onChange={value => buy({ maxReturn: value })} />
          <RuleNumber label="每次最多新买（只）" value={rules.buy.maxNewPositions} min={0} max={100}
            testId="buy-count" onChange={value => buy({ maxNewPositions: value! })} />
        </div>
      </div>
      <div>
        <h3>卖出条件</h3>
        <div className="control-grid">
          <RuleNumber label="排名跌出前几名" value={rules.sell.rankBelow} min={1} optional testId="sell-rank-below"
            onChange={value => sell({ rankBelow: value })} />
          <RuleNumber label="涨幅低于（%）" value={rules.sell.returnBelow} min={-100} max={10000} optional percent
            testId="sell-return-below" onChange={value => sell({ returnBelow: value })} />
          <RuleNumber label="涨幅高于（%）" value={rules.sell.returnAbove} min={-100} max={10000} optional percent
            testId="sell-return-above" onChange={value => sell({ returnAbove: value })} />
          <label>卖出触发方式
            <select data-testid="sell-match" value={rules.sell.match}
              onChange={event => sell({ match: event.target.value as "any" | "all" })}>
              <option value="any">任一条件满足</option><option value="all">全部条件满足</option>
            </select>
          </label>
        </div>
      </div>
    </div>}
  </Section>;
}
