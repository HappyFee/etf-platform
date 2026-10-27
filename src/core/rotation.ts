import type { EvaluationRow, Holding, RotationRules } from "./types";

export const defaultRotationRules: RotationRules = {
  enabled: true,
  window: 20,
  buy: { rankFrom: 1, rankTo: 3, minReturn: 0, maxNewPositions: 3 },
  sell: { rankBelow: 5, returnBelow: 0, match: "any" }
};

const returnTolerance = 1e-10;

export function rotationRulesError(rules: RotationRules): string | undefined {
  if (!Number.isSafeInteger(rules.window) || rules.window < 1) return "涨幅窗口必须是正整数。";
  if (!Number.isSafeInteger(rules.buy?.rankFrom) || rules.buy.rankFrom < 1 ||
    !Number.isSafeInteger(rules.buy?.rankTo) || rules.buy.rankTo < rules.buy.rankFrom) {
    return "买入排名必须是正整数，且起点不能大于终点。";
  }
  if (!Number.isSafeInteger(rules.buy.maxNewPositions) || rules.buy.maxNewPositions < 0) {
    return "每次新买数量必须是非负整数。";
  }
  if (!rules.sell || !["any", "all"].includes(rules.sell.match)) return "卖出触发方式无效。";
  if (rules.sell.rankBelow !== undefined &&
    (!Number.isSafeInteger(rules.sell.rankBelow) || rules.sell.rankBelow < 1)) return "卖出排名必须是正整数。";
  const thresholds = [rules.buy.minReturn, rules.buy.maxReturn, rules.sell.returnBelow, rules.sell.returnAbove];
  if (thresholds.some(value => value !== undefined && !Number.isFinite(value))) return "涨幅阈值必须是有效数值。";
  if (rules.buy.minReturn !== undefined && rules.buy.maxReturn !== undefined &&
    rules.buy.minReturn > rules.buy.maxReturn) return "最低买入涨幅不能高于最高买入涨幅。";
  return undefined;
}

function matchesSell(row: EvaluationRow, rank: number, rules: RotationRules): boolean {
  const checks: boolean[] = [];
  if (Number.isFinite(rules.sell.rankBelow)) checks.push(rank > rules.sell.rankBelow!);
  if (Number.isFinite(rules.sell.returnBelow)) {
    checks.push(row.periodReturn! < rules.sell.returnBelow! - returnTolerance);
  }
  if (Number.isFinite(rules.sell.returnAbove)) {
    checks.push(row.periodReturn! > rules.sell.returnAbove! + returnTolerance);
  }
  return checks.length > 0 && (rules.sell.match === "all" ? checks.every(Boolean) : checks.some(Boolean));
}

// Keep eligible incumbents until a sell rule fires, then fill free slots with new buys.
export function selectRotationRows(
  rows: EvaluationRow[], previous: Holding[], rules: RotationRules,
  maximumPositions: number, replacementSymbol?: string
): EvaluationRow[] {
  const limit = Number.isFinite(maximumPositions) ? Math.max(0, Math.floor(maximumPositions)) : 0;
  const newLimit = Number.isFinite(rules.buy.maxNewPositions)
    ? Math.max(0, Math.floor(rules.buy.maxNewPositions)) : 0;
  rows = rows.filter((row, index, all) => row.symbol !== replacementSymbol &&
    Number.isFinite(row.periodReturn) && all.findIndex(item => item.symbol === row.symbol) === index);
  const ranked = new Map(rows.map((row, index) => [row.symbol, { row, rank: index + 1 }]));
  const sold = new Set<string>();
  const retained: EvaluationRow[] = [];
  for (const holding of previous) {
    if (!Number.isFinite(holding.weight) || holding.weight <= 0 || holding.symbol === replacementSymbol) continue;
    const item = ranked.get(holding.symbol);
    if (!item || item.row.periodReturn == null) {
      sold.add(holding.symbol);
      continue;
    }
    if (matchesSell(item.row, item.rank, rules)) sold.add(holding.symbol);
    else if (!retained.some(row => row.symbol === holding.symbol)) retained.push(item.row);
  }
  retained.sort((a, b) => ranked.get(a.symbol)!.rank - ranked.get(b.symbol)!.rank);
  const selected = retained.slice(0, limit);
  const selectedSymbols = new Set(selected.map(row => row.symbol));
  const validBuyBounds = Number.isSafeInteger(rules.buy.rankFrom) && rules.buy.rankFrom >= 1 &&
    Number.isSafeInteger(rules.buy.rankTo) && rules.buy.rankTo >= rules.buy.rankFrom &&
    (rules.buy.minReturn === undefined || Number.isFinite(rules.buy.minReturn)) &&
    (rules.buy.maxReturn === undefined || Number.isFinite(rules.buy.maxReturn)) &&
    (rules.buy.minReturn === undefined || rules.buy.maxReturn === undefined || rules.buy.minReturn <= rules.buy.maxReturn);
  let newPositions = 0;
  for (let index = 0; index < rows.length; index += 1) {
    if (!validBuyBounds || selected.length >= limit || newPositions >= newLimit) break;
    const row = rows[index];
    const rank = index + 1;
    if (row.symbol === replacementSymbol || selectedSymbols.has(row.symbol) || sold.has(row.symbol)) continue;
    if (matchesSell(row, rank, rules)) continue;
    if (rank < rules.buy.rankFrom || rank > rules.buy.rankTo || row.periodReturn == null) continue;
    if (rules.buy.minReturn !== undefined && row.periodReturn < rules.buy.minReturn - returnTolerance) continue;
    if (rules.buy.maxReturn !== undefined && row.periodReturn > rules.buy.maxReturn + returnTolerance) continue;
    selected.push(row);
    selectedSymbols.add(row.symbol);
    newPositions += 1;
  }
  return selected.sort((a, b) => ranked.get(a.symbol)!.rank - ranked.get(b.symbol)!.rank);
}
