#!/usr/bin/env node
/**
 * Opens a URL headless, waits, saves a screenshot and prints the console.
 *   node scripts/shot.mjs <url> <out.png> [waitMs] [waitForSelector]
 */
import { Browser, sleep } from "./browser.mjs";

const [url, out, waitMs = "8000", selector] = process.argv.slice(2);
const browser = await Browser.launch();
try {
  const page = await browser.newPage();
  await page.goto(url);
  if (selector) {
    await page.waitFor(
      `!!document.querySelector(${JSON.stringify(selector)})`,
      { timeout: Number(waitMs) },
    );
  }
  await sleep(Number(waitMs));
  await page.screenshot(out);
  for (const entry of page.console) {
    console.log(`[${entry.type}] ${entry.text.slice(0, 400)}`);
  }
  console.log(`Saved ${out}`);
} finally {
  await browser.close();
}
