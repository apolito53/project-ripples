import { createServer } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const PORT = Number(process.env.RIPPLE_LOG_PORT ?? 5184);
const DEBUG_ENDPOINT = "/__ripple_debug_log";
const BODY_LIMIT_BYTES = 512 * 1024;
const RECENT_ENTRY_LIMIT = 800;
const ROOT_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOGS_DIRECTORY = resolve(ROOT_DIRECTORY, "logs");

const recentEntries = [];

const server = createServer(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
  if (request.method === "GET" && url.pathname === "/health") {
    writeJson(response, 200, {
      ok: true,
      endpoint: DEBUG_ENDPOINT,
      recentEntries: recentEntries.length,
      logsDirectory: LOGS_DIRECTORY
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/events") {
    writeJson(response, 200, {
      ok: true,
      count: recentEntries.length,
      entries: recentEntries
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/tail") {
    writeText(response, 200, formatTail(Number(url.searchParams.get("limit") ?? 80)));
    return;
  }

  if (request.method === "POST" && url.pathname === "/clear") {
    recentEntries.length = 0;
    writeJson(response, 200, { ok: true, count: 0 });
    return;
  }

  if (request.method === "POST" && url.pathname === DEBUG_ENDPOINT) {
    try {
      const payload = await readJsonBody(request, BODY_LIMIT_BYTES);
      const result = await appendDebugEntries(payload);
      writeJson(response, 200, result);
    } catch (error) {
      writeJson(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to write Ripple debug logs."
      });
    }
    return;
  }

  writeJson(response, 404, {
    ok: false,
    error: `Use POST ${DEBUG_ENDPOINT}, GET /tail, GET /events, or GET /health.`
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Ripple debug log server listening on http://${HOST}:${PORT}`);
  console.log(`POST ${DEBUG_ENDPOINT} -> ${LOGS_DIRECTORY}`);
  console.log(`GET /tail?limit=80 for a quick recent-log view`);
});

server.on("error", (error) => {
  console.error("Ripple debug log server failed:", error);
  process.exitCode = 1;
});

async function readJsonBody(request, bodyLimitBytes) {
  const chunks = [];
  let byteLength = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    byteLength += buffer.byteLength;
    if (byteLength > bodyLimitBytes) {
      throw new Error(`Payload is too large. Limit is ${bodyLimitBytes} bytes.`);
    }
    chunks.push(buffer);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (rawBody.trim().length === 0) {
    throw new Error("Debug log payload is empty.");
  }
  return JSON.parse(rawBody);
}

async function appendDebugEntries(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Debug log payload must be a JSON object.");
  }

  const entries = Array.isArray(payload.entries)
    ? payload.entries
    : [payload.entry ?? payload];
  if (entries.length === 0) {
    throw new Error("Debug log payload has no entries.");
  }

  const receivedAt = new Date().toISOString();
  const dateStamp = receivedAt.slice(0, 10);
  const logPath = resolve(LOGS_DIRECTORY, `ripple-debug-${dateStamp}.jsonl`);
  const context = {
    source: typeof payload.source === "string" ? payload.source : "ripple-field-lab",
    href: typeof payload.href === "string" ? payload.href : "",
    userAgent: typeof payload.userAgent === "string" ? payload.userAgent : "",
    sentAtIso: typeof payload.sentAtIso === "string" ? payload.sentAtIso : null
  };

  const records = entries.map((entry, batchIndex) => ({
    type: "ripple.debug.entry",
    receivedAt,
    batchIndex,
    context,
    entry
  }));

  await mkdir(LOGS_DIRECTORY, { recursive: true });
  await appendFile(logPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");

  recentEntries.push(...records);
  if (recentEntries.length > RECENT_ENTRY_LIMIT) {
    recentEntries.splice(0, recentEntries.length - RECENT_ENTRY_LIMIT);
  }

  const slowFrames = records.filter((record) => {
    const payload = record.entry && typeof record.entry === "object" ? record.entry.payload : null;
    return payload && typeof payload === "object" && Number(payload.frameMs) >= 24;
  }).length;
  console.log(`[ripple-log] +${records.length} entries (${slowFrames} slow frames) -> ${logPath}`);

  return {
    ok: true,
    count: records.length,
    slowFrames,
    logPath
  };
}

function formatTail(limit) {
  const safeLimit = Math.max(1, Math.min(RECENT_ENTRY_LIMIT, Math.floor(limit || 80)));
  return recentEntries
    .slice(-safeLimit)
    .map((record) => JSON.stringify(record))
    .join("\n");
}

function setCorsHeaders(response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function writeText(response, statusCode, text) {
  response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  response.end(text);
}
