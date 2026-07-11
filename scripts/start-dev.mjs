import { spawn, spawnSync } from "node:child_process";

const children = [];
const npmRunner = resolveNpmRunner();
const viteArgs = process.argv.slice(2);

start("logs", process.execPath, ["scripts/debug-log-server.mjs"]);
start("vite", npmRunner.command, [...npmRunner.args, "run", "dev:vite", "--", ...viteArgs]);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", shutdown);

function start(label, command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });

  children.push(child);
  child.stdout.on("data", (chunk) => write(label, chunk));
  child.stderr.on("data", (chunk) => write(label, chunk));
  child.on("exit", (code, signal) => {
    if (code === 0 || signal) return;
    console.error(`[ripple-field-lab:${label}] exited with code ${code}`);
    shutdown();
  });
}

function write(label, chunk) {
  const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    console.log(`[ripple-field-lab:${label}] ${line}`);
  }
}

function shutdown() {
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
    // The child may already be gone during process teardown.
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
