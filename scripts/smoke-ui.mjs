import { chromium } from "playwright";
import { preview } from "vite";

const host = "127.0.0.1";
const port = 4174;
const baseUrl = `http://${host}:${port}`;
const smokePath = process.env.SMOKE_PATH ?? "/";

function closePreview(server) {
  return new Promise((resolve, reject) => {
    server.httpServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (error) {
    const fallbackChannels =
      process.platform === "win32" ? ["msedge", "chrome"] : ["chrome"];

    for (const channel of fallbackChannels) {
      try {
        return await chromium.launch({ channel });
      } catch {
        // Try the next locally installed browser channel.
      }
    }

    throw error;
  }
}

async function runSmoke() {
  const server = await preview({
    preview: {
      host,
      port,
      strictPort: true
    }
  });
  let browser;

  try {
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });

    await page.goto(new URL(smokePath, baseUrl).toString(), { waitUntil: "networkidle" });
    await page.locator(".workspace").waitFor();
    await page.locator(".chart-panel svg").first().waitFor();

    const chartCount = await page.locator(".chart-panel svg").count();
    if (chartCount < 2) {
      throw new Error(`Expected at least 2 rendered charts, found ${chartCount}`);
    }

    const selector = page.getByTestId("active-strategy");
    const originalStrategy = await selector.inputValue();
    const originalCount = await selector.locator("option").count();
    await selector.selectOption({ index: 1 });
    await page.locator('.workspace[aria-busy="false"]').waitFor();
    if (await page.locator('.tab-button[aria-current="page"]').innerText() !== "策略总览") {
      throw new Error("Selecting a strategy should preserve the current view");
    }
    await selector.selectOption(originalStrategy);
    await page.getByRole("button", { name: "删除当前策略", exact: true }).click();
    const deleteDialog = page.getByRole("dialog");
    await deleteDialog.waitFor();
    if (!await deleteDialog.getByText("暂时无法删除", { exact: true }).isVisible()) {
      throw new Error("Deleting a referenced base strategy must be blocked");
    }
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "新基础策略", exact: true }).click();
    if (await selector.locator("option").count() !== originalCount + 1) {
      throw new Error("Expected a newly created strategy in the global selector");
    }
    await page.getByRole("button", { name: "删除当前策略", exact: true }).click();
    await deleteDialog.getByRole("button", { name: "取消", exact: true }).click();
    if (await selector.locator("option").count() !== originalCount + 1) {
      throw new Error("Canceling deletion should preserve the strategy");
    }
    await page.getByRole("button", { name: "删除当前策略", exact: true }).click();
    await deleteDialog.getByRole("button", { name: "确认删除", exact: true }).click();
    if (await selector.locator("option").count() !== originalCount) {
      throw new Error("Confirmed deletion should remove the strategy");
    }

    await page.locator(".tab-button").nth(1).click();
    await page.locator(".lab-grid").waitFor();

    const controls = await page.locator("select, input, button").count();
    if (controls < 10) {
      throw new Error(`Expected strategy lab controls, found ${controls}`);
    }

    await page.locator('[data-testid="minimum-commission-input"]').waitFor();
    await page.locator('[data-testid="participation-rate-input"]').waitFor();

    await page.getByTestId("rotation-mode").selectOption("return");
    if (await page.getByTestId("rotation-window").inputValue() !== "20") {
      throw new Error("Expected default 20-trading-day return window");
    }
    await page.getByTestId("buy-count").fill("2");
    await page.getByTestId("sell-match").selectOption("all");
    await page.getByTestId("rebalance-frequency").selectOption("interval");
    await page.getByTestId("rebalance-interval").fill("5");
    await page.getByTestId("invested-weight").fill("60");
    await page.getByTestId("execution-price-select").selectOption("next_open");
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".tab-button").nth(1).click();
    if (await page.getByTestId("buy-count").inputValue() !== "2" ||
        await page.getByTestId("sell-match").inputValue() !== "all" ||
        await page.getByTestId("invested-weight").inputValue() !== "60" ||
        await page.getByTestId("rebalance-interval").inputValue() !== "5") {
      throw new Error("Rotation rules were not persisted across reload");
    }

    await page.locator('[data-testid="dynamic-universe-mode"]').click();
    await page.locator('[data-testid="universe-min-history"]').waitFor();
    const dynamicUniverseMembers = await page.locator(".dynamic-universe-table tbody tr").count();
    if (dynamicUniverseMembers < 1) {
      throw new Error("Expected at least one dynamically selected ETF");
    }

    await page.getByRole("button", { name: "策略总览" }).click();
    await page.getByText("每 5 个交易日轮动", { exact: false }).first().waitFor();
    await page.getByText("成交：下一交易日开盘切仓", { exact: true }).waitFor();
    await page.getByRole("button", { name: "保存快照" }).click();
    const snapshotCount = await page.locator(".archive-table tbody tr").count();
    if (snapshotCount < 1) {
      throw new Error("Expected a saved backtest snapshot");
    }

    for (const view of ["信号跟踪", "因子库", "策略实验室", "策略总览"]) {
      await page.getByRole("button", { name: view, exact: true }).click();
      await selector.selectOption({ index: 1 });
      await page.locator('.workspace[aria-busy="false"]').waitFor();
      if (await page.locator('.tab-button[aria-current="page"]').innerText() !== view) {
        throw new Error(`Strategy switch unexpectedly left ${view}`);
      }
      if (await page.getByTestId("active-strategy").count() !== 1) {
        throw new Error(`Expected exactly one global strategy selector in ${view}`);
      }
      await selector.selectOption(originalStrategy);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await selector.scrollIntoViewIfNeeded();
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflows) throw new Error("Workspace overflows the mobile viewport");
    const metricPositions = await page.locator(".metric-tile").evaluateAll(elements =>
      elements.slice(0, 2).map(element => element.getBoundingClientRect().y));
    if (metricPositions[0] !== metricPositions[1]) {
      throw new Error("Mobile overview metrics should use two columns");
    }
    await page.setViewportSize({ width: 320, height: 700 });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);

    console.log(
      `Smoke test passed: ${chartCount} charts, ${controls} lab controls, ${dynamicUniverseMembers} dynamic-universe members, and ${snapshotCount} saved snapshot rendered.`
    );
  } finally {
    await browser?.close();
    await closePreview(server);
  }
}

runSmoke().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
