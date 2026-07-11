import { spawn, spawnSync } from "node:child_process";

const DEFAULT_APP_URL = "http://127.0.0.1:5183/";
const DEFAULT_LOG_HEALTH_URL = "http://127.0.0.1:5184/health";
const DEFAULT_LOG_EVENTS_URL = "http://127.0.0.1:5184/events";
const DEFAULT_LOG_POST_URL = "http://127.0.0.1:5184/__ripple_debug_log";

export function createHarnessConfig() {
  const appUrl = process.env.RIPPLE_APP_URL || DEFAULT_APP_URL;
  const logHealthUrl = process.env.RIPPLE_LOG_HEALTH_URL || DEFAULT_LOG_HEALTH_URL;
  const logEventsUrl = process.env.RIPPLE_LOG_EVENTS_URL || DEFAULT_LOG_EVENTS_URL;
  const logPostUrl = process.env.RIPPLE_LOG_POST_URL || DEFAULT_LOG_POST_URL;

  return {
    appUrl,
    logHealthUrl,
    logEventsUrl,
    logPostUrl,
    logServerQueryValue: resolveLogServerQueryValue(logPostUrl, logHealthUrl)
  };
}

export async function ensureServersReady(config = createHarnessConfig()) {
  const children = [];
  const appAlreadyRunning = await isOk(config.appUrl);
  const logsAlreadyRunning = await isOk(config.logHealthUrl);

  if (appAlreadyRunning || logsAlreadyRunning) {
    if (!appAlreadyRunning || !logsAlreadyRunning) {
      throw new Error("Partial server state: app and log server must both be running or both be free.");
    }
  } else {
    startServers(children);
  }

  try {
    await waitForOk(config.appUrl, "app");
    await waitForOk(config.logHealthUrl, "log server");
  } catch (error) {
    shutdown(children);
    throw error;
  }

  return {
    startedServers: children.length > 0,
    shutdown: () => shutdown(children)
  };
}

export function buildAppUrl(config, parameters = {}) {
  const url = new URL(config.appUrl);

  url.searchParams.set("debug", "1");
  url.searchParams.set("logServer", config.logServerQueryValue);

  for (const [key, value] of Object.entries(parameters)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

export async function waitForOk(url, label) {
  const deadline = Date.now() + 15000;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for ${label} at ${url}: ${lastError}`);
}

export async function isOk(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

export async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

export async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`POST failed for ${url}: ${response.status} ${response.statusText}`);
  }
}

export function assertIncludes(text, expected, reason) {
  if (!text.includes(expected)) {
    throw new Error(`${reason}. Missing: ${expected}`);
  }
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startServers(children) {
  const npmRunner = resolveNpmRunner();
  start(children, "logs", process.execPath, ["scripts/debug-log-server.mjs"]);
  start(children, "vite", npmRunner.command, [...npmRunner.args, "run", "dev:vite"]);
}

function start(children, label, command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });

  children.push(child);
  child.stdout.on("data", (chunk) => write(label, chunk));
  child.stderr.on("data", (chunk) => write(label, chunk));
}

function write(label, chunk) {
  const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    console.log(`[ripple-field-lab:${label}] ${line}`);
  }
}

function shutdown(children) {
  for (const child of children) {
    if (child.pid) killProcessTree(child.pid);
  }
}

function killProcessTree(pid) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // The process may already be gone during shutdown.
  }
}

function resolveNpmRunner() {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath?.endsWith(".js")) {
    return { command: process.execPath, args: [npmExecPath] };
  }

  if (process.platform === "win32") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", "npm.cmd"] };
  }

  return { command: "npm", args: [] };
}

function resolveLogServerQueryValue(...urls) {
  for (const value of urls) {
    try {
      const url = new URL(value);
      if (isLocalLogHost(url) && url.port) return url.port;
    } catch {
      // Ignore malformed environment values; the fetch step will report them.
    }
  }

  return "1";
}

function isLocalLogHost(url) {
  return url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1");
}
