/**
 * Minimal headless Chromium driver over the DevTools protocol (no extra
 * dependencies): opens a page, collects console output, evaluates
 * expressions and takes screenshots. Used by the smoke test.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";

const chromeCandidates = [
  process.env.INSITUUMAPS_CHROME,
  process.env.CHROME_PATH,
  "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome",
  "/opt/pw-browsers/chromium-1243/chrome-linux/chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ...(process.platform === "win32"
    ? [
        `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
      ]
    : []),
].filter((c) => c !== undefined);

export function findChrome() {
  const chrome = chromeCandidates.find((c) => existsSync(c));
  if (chrome === undefined) {
    throw new Error(
      "No Chromium found. Set INSITUUMAPS_CHROME to a Chrome/Chromium binary.",
    );
  }
  return chrome;
}

export class Browser {
  constructor(process_, ws) {
    this.process = process_;
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== undefined && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          reject(new Error(message.error.message));
        } else {
          resolve(message.result);
        }
      } else if (message.method !== undefined) {
        for (const listener of this.listeners) {
          listener(message);
        }
      }
    });
  }

  static async launch(options = {}) {
    const { width = 1366, height = 768 } = options;
    const chrome = findChrome();
    const args = [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--disable-dev-shm-usage",
      "--remote-debugging-port=0",
      `--window-size=${width},${height}`,
      "about:blank",
    ];
    const process_ = spawn(chrome, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const wsUrl = await new Promise((resolve, reject) => {
      let stderr = "";
      process_.stderr.on("data", (chunk) => {
        stderr += String(chunk);
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(stderr);
        if (match) {
          resolve(match[1]);
        }
      });
      process_.on("exit", (code) =>
        reject(new Error(`Chromium exited with ${code}: ${stderr}`)),
      );
      setTimeout(
        () => reject(new Error(`Chromium did not start: ${stderr}`)),
        20000,
      );
    });
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    return new Browser(process_, ws);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId !== undefined) {
      message.sessionId = sessionId;
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(message));
    });
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async newPage(options = {}) {
    const { width = 1366, height = 768 } = options;
    const { targetId } = await this.send("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await this.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const page = new Page(this, sessionId, targetId);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Log.enable");
    await page.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    return page;
  }

  async close() {
    try {
      await this.send("Browser.close");
    } catch {
      // ignore
    }
    this.ws.close();
    this.process.kill();
  }
}

export class Page {
  constructor(browser, sessionId, targetId) {
    this.browser = browser;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.console = [];
    this.errors = [];
    browser.on((message) => {
      if (message.sessionId !== sessionId) {
        return;
      }
      if (message.method === "Runtime.consoleAPICalled") {
        const text = message.params.args
          .map(
            (arg) =>
              arg.value ?? arg.description ?? JSON.stringify(arg.preview ?? ""),
          )
          .join(" ");
        this.console.push({ type: message.params.type, text });
        if (message.params.type === "error") {
          this.errors.push(text);
        }
      } else if (message.method === "Runtime.exceptionThrown") {
        const details = message.params.exceptionDetails;
        const text = details.exception?.description ?? details.text;
        this.console.push({ type: "exception", text });
        this.errors.push(text);
      } else if (message.method === "Log.entryAdded") {
        const entry = message.params.entry;
        this.console.push({
          type: `log:${entry.level}`,
          text: `${entry.text} ${entry.url ?? ""}`,
        });
        if (entry.level === "error") {
          this.errors.push(`${entry.text} ${entry.url ?? ""}`);
        }
      }
    });
  }

  send(method, params) {
    return this.browser.send(method, params, this.sessionId);
  }

  async goto(url) {
    const loaded = new Promise((resolve) => {
      const off = this.browser.on((message) => {
        if (
          message.sessionId === this.sessionId &&
          message.method === "Page.loadEventFired"
        ) {
          off();
          resolve();
        }
      });
    });
    await this.send("Page.navigate", { url });
    await Promise.race([loaded, sleep(30000)]);
  }

  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(
        exceptionDetails.exception?.description ?? exceptionDetails.text,
      );
    }
    return result.value;
  }

  /** Polls an expression until it is truthy */
  async waitFor(
    expression,
    { timeout = 60000, interval = 250, label = expression } = {},
  ) {
    const start = Date.now();
    for (;;) {
      let value;
      try {
        value = await this.evaluate(expression);
      } catch {
        value = false;
      }
      if (value) {
        return value;
      }
      if (Date.now() - start > timeout) {
        throw new Error(`Timed out waiting for: ${label}`);
      }
      await sleep(interval);
    }
  }

  async click(selector) {
    const ok = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (!ok) {
      throw new Error(`No element matches ${selector}`);
    }
  }

  async clickText(text, tag = "button") {
    const ok = await this.evaluate(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(tag)})];
      const el = els.find((e) => e.textContent.trim() === ${JSON.stringify(text)}) ?? els.find((e) => e.textContent.includes(${JSON.stringify(text)}));
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (!ok) {
      throw new Error(`No ${tag} with text ${text}`);
    }
  }

  /** Types into an input through React's value setter so React sees the change */
  async type(selector, text) {
    const ok = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    if (!ok) {
      throw new Error(`No element matches ${selector}`);
    }
  }

  async keyboard(key) {
    await this.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code: key,
      windowsVirtualKeyCode: key === "Enter" ? 13 : 0,
    });
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code: key,
      windowsVirtualKeyCode: key === "Enter" ? 13 : 0,
    });
  }

  async mouseClick(x, y) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
  }

  async screenshot(path) {
    const { data } = await this.send("Page.captureScreenshot", {
      format: "png",
    });
    await writeFile(path, Buffer.from(data, "base64"));
  }

  /** Mean colour of a rectangle of the page (from a screenshot), to check that something rendered */
  async regionStats(x, y, w, h) {
    return await this.evaluate(`(async () => {
      const canvases = [...document.querySelectorAll("canvas")];
      if (canvases.length === 0) return null;
      // composite all canvases of the viewer into one
      const out = document.createElement("canvas");
      out.width = ${w}; out.height = ${h};
      const ctx = out.getContext("2d");
      for (const c of canvases) {
        const r = c.getBoundingClientRect();
        if (r.width === 0) continue;
        try {
          ctx.drawImage(c, ${x} - r.left, ${y} - r.top, ${w}, ${h}, 0, 0, ${w}, ${h});
        } catch {}
      }
      const d = ctx.getImageData(0, 0, ${w}, ${h}).data;
      let r = 0, g = 0, b = 0, nonBackground = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]; g += d[i + 1]; b += d[i + 2];
        if (d[i] + d[i + 1] + d[i + 2] > 90) nonBackground++;
      }
      const n = d.length / 4;
      return { r: r / n, g: g / n, b: b / n, nonBackgroundFraction: nonBackground / n };
    })()`);
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
