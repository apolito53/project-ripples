import assert from "node:assert/strict";
import { createServer } from "node:http";
import { resolve } from "node:path";
import {
  createHarnessConfig,
  ensureServersReady
} from "./ripple-smoke-harness.mjs";

const appServer = createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url?.startsWith("/@fs/") && request.url.endsWith("/package.json")) {
    response.end(JSON.stringify({ name: "ripple-field-lab" }));
    return;
  }
  response.end(JSON.stringify({ ok: true }));
});

let reportedLogsDirectory = resolve(process.cwd(), "logs");
const logServer = createServer((_request, response) => {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ ok: true, logsDirectory: reportedLogsDirectory }));
});

await Promise.all([listen(appServer), listen(logServer)]);

const previousAllowExisting = process.env.RIPPLE_ALLOW_EXISTING_SERVERS;
delete process.env.RIPPLE_ALLOW_EXISTING_SERVERS;

try {
  const appPort = appServer.address().port;
  const logPort = logServer.address().port;
  const config = {
    appUrl: `http://127.0.0.1:${appPort}/`,
    logHealthUrl: `http://127.0.0.1:${logPort}/health`,
    logEventsUrl: `http://127.0.0.1:${logPort}/events`,
    logPostUrl: `http://127.0.0.1:${logPort}/__ripple_debug_log`,
    logServerQueryValue: String(logPort),
    targetsExplicit: false
  };

  const sameCheckout = await ensureServersReady(config);
  assert.equal(sameCheckout.startedServers, false);
  sameCheckout.shutdown();

  reportedLogsDirectory = resolve(process.cwd(), "..", "different-checkout", "logs");
  await assert.rejects(
    ensureServersReady(config),
    /another or unverifiable checkout/
  );

  const explicitPair = await ensureServersReady({ ...config, targetsExplicit: true });
  assert.equal(explicitPair.startedServers, false);
  explicitPair.shutdown();

  const targetNames = [
    "RIPPLE_APP_URL",
    "RIPPLE_LOG_HEALTH_URL",
    "RIPPLE_LOG_EVENTS_URL",
    "RIPPLE_LOG_POST_URL"
  ];
  const previousTargets = Object.fromEntries(targetNames.map((name) => [name, process.env[name]]));
  try {
    for (const name of targetNames) delete process.env[name];
    process.env.RIPPLE_APP_URL = "http://127.0.0.1:1/";
    assert.throws(createHarnessConfig, /Set all four RIPPLE_APP_URL\/RIPPLE_LOG_\*/);
  } finally {
    for (const name of targetNames) restoreEnv(name, previousTargets[name]);
  }

  console.log("[ripple-field-lab:smoke-harness] checkout provenance and explicit-pair rules passed");
} finally {
  restoreEnv("RIPPLE_ALLOW_EXISTING_SERVERS", previousAllowExisting);
  await close(appServer);
  await close(logServer);
}

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
}

function close(server) {
  return new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
