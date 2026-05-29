# Multi-Strategy and Parameterized Factors Design

## Goal

Upgrade the ETF platform from one fixed strategy to a strategy workspace. Users can create multiple base strategies, give each strategy its own factor set and weights, and create composite strategies that combine existing strategies by allocation weight.

## Open-Source Patterns Borrowed

- Zipline Pipeline: separate reusable `Factor` definitions from per-strategy parameter choices such as `window`.
- Backtrader: strategy behavior is controlled through explicit strategy params rather than duplicated classes.
- vectorbt-style research: the same indicator can be evaluated across different parameter sets without creating separate source-code factors.

## Model

`BaseStrategyConfig` represents a normal ETF rotation strategy:

- ETF universe
- factor selections
- filter rules
- rebalance policy
- portfolio sizing
- transaction cost and cash assumptions

`CompositeStrategyConfig` represents a portfolio of strategies:

- components reference existing strategy ids
- each component has a target weight
- the composite backtest combines child strategy daily returns and latest holdings
- composite strategies cannot directly define ETF factors; they inherit behavior from child strategies

`StrategyConfig` becomes a union of base and composite strategy configs.

## Factor Parameters

Factor definitions become generic:

- `return`: configurable `window`
- `close_ma_ratio`: configurable `window`
- `volatility`: configurable `window`
- `max_drawdown`: configurable `window`
- `amount_ma`: configurable `window`
- `trend_slope`: configurable `window`

Each factor has a `paramSchema` so the UI can render numeric controls. Factor selections keep a stable `key`, because the same factor id can appear twice with different parameters inside one strategy.

## UI

The Strategy Lab adds a strategy selector and actions:

- switch active strategy
- duplicate current strategy
- create base strategy
- create composite strategy
- delete non-last strategy

For base strategies, the editor shows ETF pool, factor weights, factor parameter controls, filters, rebalance, and portfolio rules.

For composite strategies, the editor shows component strategy weights and the synthesized result.

## Backtest Behavior

Base strategy backtests keep the existing engine.

Composite strategy backtests:

1. run each child strategy independently
2. align equity curves by date
3. combine child daily returns by normalized component weights
4. aggregate latest holdings by component weight
5. surface child warnings with the child strategy name

If all component weights are zero or a component id is missing, the engine returns warnings and ignores invalid components.
