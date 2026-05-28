import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { App } from "./App";

describe("App", () => {
  test("renders the ETF strategy platform workspace", () => {
    const html = renderToString(<App />);

    expect(html).toContain("策略总览");
    expect(html).toContain("策略实验室");
    expect(html).toContain("因子库");
    expect(html).toContain("信号跟踪");
  });
});
