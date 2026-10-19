import { spawn, spawnSync } from "node:child_process";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDevConfig, portInUse, senderUrls } from "./dev-config.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const serverOnly = process.argv.includes("--server-only");
const envFile = resolve(root, "apps/control-server/server.env.local");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const { env, created, fromFile, senders, port } = await loadDevConfig(envFile);
const childEnv = { ...env, TK_LIGHT_HOST: env.TK_LIGHT_HOST ?? "0.0.0.0" };
// tsx watch outlives a server that cannot bind, which would leave the admin proxy
// talking to whatever else holds the port.
if (await portInUse(port, childEnv.TK_LIGHT_HOST)) {
  console.error(
    `Port ${port} is already in use. Stop that program or set TK_LIGHT_PORT in ${envFile}.`,
  );
  process.exit(1);
}

if (serverOnly) {
  const built = spawnSync(pnpm, ["--filter", "@tk-light/admin-web", "build"], {
    cwd: root,
    env: childEnv,
    stdio: "inherit",
  });
  if (built.error) throw built.error;
  if (built.status !== 0) process.exit(built.status ?? 1);
}

console.log(`\nLight control development stack${created ? " (created server.env.local)" : ""}`);
console.log(`Admin panel: http://127.0.0.1:${serverOnly ? port : 1422}`);
console.log(`Server API:  http://127.0.0.1:${port}`);
for (const url of senderUrls(childEnv.TK_LIGHT_HOST, port, networkInterfaces()))
  console.log(`Sender URL:  ${url}`);
console.log(`Admin token: ${env.TK_LIGHT_ADMIN_TOKEN}`);
for (const [id, token] of senders) console.log(`Sender ${id}: ${token}`);
console.log(fromFile ? `Credentials file: ${envFile}\n` : "Using credentials from environment\n");

/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
let stopping = false;
/** @param {number} code */
const stop = (code) => {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    try {
      if (process.platform === "win32") child.kill("SIGTERM");
      else if (child.pid) process.kill(-child.pid, "SIGTERM");
    } catch {
      // The child may have exited since the last status check.
    }
  }
};
/** @param {string} filter */
const start = (filter) => {
  const child = spawn(pnpm, ["--filter", filter, "dev"], {
    cwd: root,
    env: childEnv,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(`${filter}: ${error.message}`);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code || 1);
  });
};
process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));
// Children run in their own sessions, so closing the terminal only signals this process.
process.on("SIGHUP", () => stop(129));
start("@tk-light/control-server");
if (!serverOnly) start("@tk-light/admin-web");
