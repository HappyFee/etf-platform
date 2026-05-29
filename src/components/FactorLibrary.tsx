import { ArrowDownAZ, ArrowUpZA } from "lucide-react";
import { factorCatalog } from "../core/factors";
import type { StrategyConfig } from "../core/types";
import { Section } from "./ui";

const categoryName: Record<string, string> = {
  momentum: "动量",
  trend: "趋势",
  risk: "风险",
  liquidity: "流动性",
  quality: "质量"
};

export function FactorLibrary({ config }: { config: StrategyConfig }) {
  const activeIds = new Set(
    config.kind === "base"
      ? config.factors.filter((factor) => factor.enabled).map((factor) => factor.id)
      : []
  );
  const groups = factorCatalog.reduce<Record<string, typeof factorCatalog>>(
    (current, factor) => {
      current[factor.category] = [...(current[factor.category] ?? []), factor];
      return current;
    },
    {}
  );

  return (
    <Section
      title="因子库"
      action={<span className="section-note">{factorCatalog.length} 个参数化因子</span>}
    >
      <div className="factor-groups">
        {Object.entries(groups).map(([category, factors]) => (
          <div className="factor-group" key={category}>
            <h3>{categoryName[category] ?? category}</h3>
            <div className="factor-list">
              {factors?.map((factor) => {
                const DirectionIcon =
                  factor.defaultDirection === "desc" ? ArrowUpZA : ArrowDownAZ;
                return (
                  <article
                    className={activeIds.has(factor.id) ? "factor-row active" : "factor-row"}
                    key={factor.id}
                  >
                    <div>
                      <strong>{factor.name}</strong>
                      <p>{factor.description}</p>
                      {factor.paramSchema && (
                        <small>
                          参数：
                          {factor.paramSchema
                            .map((param) => `${param.label} ${param.min}-${param.max}`)
                            .join("，")}
                        </small>
                      )}
                    </div>
                    <span title={factor.defaultDirection === "desc" ? "越高越好" : "越低越好"}>
                      <DirectionIcon size={16} />
                      {factor.defaultDirection === "desc" ? "高优先" : "低优先"}
                    </span>
                  </article>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
