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

    await page.locator(".tab-button").nth(1).click();
    await page.locator(".lab-grid").waitFor();

    const controls = await page.locator("select, input, button").count();
    if (controls < 10) {
      throw new Error(`Expected strategy lab controls, found ${controls}`);
    }

    console.log(`Smoke test passed: ${chartCount} charts and ${controls} lab controls rendered.`);
  } finally {
    await browser?.close();
    await closePreview(server);
  }
}

runSmoke().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
