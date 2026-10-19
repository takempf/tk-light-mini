import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";

const secret = () => randomBytes(24).toString("hex");

/** @param {string} contents */
function parseEnvFile(contents) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) throw new Error(`Invalid line in server.env.local: ${trimmed}`);
    const key = trimmed.slice(0, index).trim();
    if (!/^TK_LIGHT_[A-Z_]+$/.test(key))
      throw new Error(`Invalid setting in server.env.local: ${key}`);
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    )
      value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

/** @param {NodeJS.ProcessEnv} env */
function senderCredentials(env) {
  if (env.TK_LIGHT_SENDERS) {
    let senders;
    try {
      senders = JSON.parse(env.TK_LIGHT_SENDERS);
    } catch {
      throw new Error("TK_LIGHT_SENDERS must be a JSON object of sender IDs and tokens");
    }
    if (!senders || typeof senders !== "object" || Array.isArray(senders))
      throw new Error("TK_LIGHT_SENDERS must be a JSON object of sender IDs and tokens");
    const entries = Object.entries(senders);
    if (
      !entries.length ||
      entries.some(
        ([id, token]) =>
          !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || typeof token !== "string" || token.length < 16,
      )
    )
      throw new Error("TK_LIGHT_SENDERS needs a sender ID and a token of at least 16 characters");
    return entries.map(([id, token]) => [id, /** @type {string} */ (token)]);
  }
  if (typeof env.TK_LIGHT_SENDER_TOKEN === "string" && env.TK_LIGHT_SENDER_TOKEN.length >= 16)
    return [["any sender ID", env.TK_LIGHT_SENDER_TOKEN]];
  throw new Error("Set TK_LIGHT_SENDERS or TK_LIGHT_SENDER_TOKEN in server.env.local");
}

/**
 * Create local credentials once, then reuse them on every dev run.
 * @param {string} file
 * @param {NodeJS.ProcessEnv} inherited
 */
export async function loadDevConfig(file, inherited = process.env) {
  let contents;
  let created = false;
  try {
    contents = await readFile(file, "utf8");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT") throw error;
    const hasAdminToken = Boolean(inherited.TK_LIGHT_ADMIN_TOKEN);
    const hasSenderToken = Boolean(inherited.TK_LIGHT_SENDERS || inherited.TK_LIGHT_SENDER_TOKEN);
    if (hasAdminToken !== hasSenderToken)
      throw new Error("Set both admin and sender credentials, or let the dev script generate both");
    const hasInheritedTokens = hasAdminToken && hasSenderToken;
    if (!hasInheritedTokens) {
      const initial =
        `TK_LIGHT_ADMIN_TOKEN=${secret()}\n` +
        `TK_LIGHT_SENDERS='${JSON.stringify({ "office-pc": secret() })}'\n` +
        "TK_LIGHT_HOST=0.0.0.0\n";
      try {
        await writeFile(file, initial, { flag: "wx", mode: 0o600 });
        created = true;
        contents = initial;
      } catch (writeError) {
        if (/** @type {NodeJS.ErrnoException} */ (writeError).code !== "EEXIST") throw writeError;
        contents = await readFile(file, "utf8");
      }
    }
  }
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...(contents ? parseEnvFile(contents) : {}), ...inherited };
  if (typeof env.TK_LIGHT_ADMIN_TOKEN !== "string" || env.TK_LIGHT_ADMIN_TOKEN.length < 16)
    throw new Error("TK_LIGHT_ADMIN_TOKEN must be at least 16 characters");
  const senders = senderCredentials(env);
  const port = Number(env.TK_LIGHT_PORT ?? 8787);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error("TK_LIGHT_PORT must be between 1 and 65535");
  return { env, created, fromFile: Boolean(contents), senders, port };
}

/**
 * Whether another program already listens on the port. Loopback is always checked: the admin
 * dev proxy targets 127.0.0.1, and a wildcard bind succeeds beside another loopback listener.
 * @param {number} port
 * @param {string} host
 */
export async function portInUse(port, host) {
  for (const address of new Set([host, "127.0.0.1"])) {
    const free = await new Promise((resolve) => {
      const probe = createServer()
        .once("error", () => resolve(false))
        .listen(port, address, () => probe.close(() => resolve(true)));
    });
    if (!free) return true;
  }
  return false;
}

/**
 * URLs a sender can use to reach the server, given the address it binds.
 * @param {string} host
 * @param {number} port
 * @param {NodeJS.Dict<{ address: string, family: string, internal: boolean }[]>} interfaces
 */
export function senderUrls(host, port, interfaces) {
  if (host !== "0.0.0.0" && host !== "::")
    return [`http://${host.includes(":") ? `[${host}]` : host}:${port}`];
  return Object.entries(interfaces)
    .filter(([name]) => !name.startsWith("utun"))
    .flatMap(([name, addresses]) =>
      (addresses ?? [])
        .filter((address) => address.family === "IPv4" && !address.internal)
        .map((address) => `${name}: http://${address.address}:${port}`),
    );
}
