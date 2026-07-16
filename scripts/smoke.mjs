import {
  assertIncludes,
  createHarnessConfig,
  ensureServersReady,
  fetchJson,
  fetchText,
  postJson
} from "./ripple-smoke-harness.mjs";

const config = createHarnessConfig();
const serverScope = await ensureServersReady(config);

try {
  const html = await fetchText(config.appUrl);
  assertIncludes(html, "scene-menu", "app shell should include the pause menu");
  assertIncludes(html, "/src/main.ts", "app shell should load the TypeScript entrypoint");

  const nonce = `smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await postJson(config.logPostUrl, {
    source: "ripple-field-lab-smoke",
    href: config.appUrl,
    entries: [
      {
        index: 0,
        level: "info",
        channel: "smoke.probe",
        message: "Smoke probe event",
        pageMs: 0,
        timestamp: new Date().toISOString(),
        payload: { nonce, script: "scripts/smoke.mjs" }
      }
    ]
  });

  const eventPayload = await fetchJson(config.logEventsUrl);
  const retainedEntries = Array.isArray(eventPayload.entries) ? eventPayload.entries : [];
  const hasSmokeProbe = retainedEntries.some((record) => record?.entry?.payload?.nonce === nonce);
  if (!hasSmokeProbe) {
    throw new Error("Diagnostics smoke failed: nonce-tagged probe event was not retained.");
  }

  console.log(`[ripple-field-lab:smoke] app OK at ${config.appUrl}`);
  console.log(`[ripple-field-lab:smoke] logs OK at ${config.logHealthUrl}`);
} finally {
  serverScope.shutdown();
}
