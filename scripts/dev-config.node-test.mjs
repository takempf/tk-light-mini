import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadDevConfig, portInUse, senderUrls } from "./dev-config.mjs";

/** @param {(file: string) => Promise<void>} callback */
async function withConfig(callback) {
  const dir = await mkdtemp(join(tmpdir(), "tk-light-dev-"));
  try {
    await callback(join(dir, "server.env.local"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("first run creates persistent, private credentials", () =>
  withConfig(async (file) => {
    const first = await loadDevConfig(file, {});
    const second = await loadDevConfig(file, {});

    assert.equal(first.created, true);
    assert.equal(first.fromFile, true);
    assert.equal(second.created, false);
    assert.equal(first.env.TK_LIGHT_ADMIN_TOKEN, second.env.TK_LIGHT_ADMIN_TOKEN);
    assert.deepEqual(first.senders, second.senders);
    assert.notEqual(first.env.TK_LIGHT_ADMIN_TOKEN, first.senders[0]?.[1]);
    assert.equal(first.env.TK_LIGHT_HOST, "0.0.0.0");
    assert.equal(first.port, 8787);
    assert.match(await readFile(file, "utf8"), /TK_LIGHT_SENDERS=/);
    if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
  }));

test("complete environment credentials work without creating a file", () =>
  withConfig(async (file) => {
    const config = await loadDevConfig(file, {
      TK_LIGHT_ADMIN_TOKEN: "admin-secret-123456789",
      TK_LIGHT_SENDERS: '{"office-pc":"sender-secret-123456789"}',
      TK_LIGHT_PORT: "8877",
    });

    assert.equal(config.created, false);
    assert.equal(config.fromFile, false);
    assert.equal(config.port, 8877);
    assert.deepEqual(config.senders, [["office-pc", "sender-secret-123456789"]]);
    await assert.rejects(stat(file), { code: "ENOENT" });
  }));

test("incomplete or invalid credentials fail before startup", () =>
  withConfig(async (file) => {
    await assert.rejects(
      loadDevConfig(file, { TK_LIGHT_ADMIN_TOKEN: "admin-secret-123456789" }),
      /Set both admin and sender credentials/,
    );
    await assert.rejects(stat(file), { code: "ENOENT" });
    await assert.rejects(
      loadDevConfig(file, {
        TK_LIGHT_ADMIN_TOKEN: "admin-secret-123456789",
        TK_LIGHT_SENDERS: "[]",
      }),
      /JSON object/,
    );
  }));

test("sender URLs match the address the server binds", () => {
  const interfaces = {
    lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    en0: [
      { address: "192.168.1.36", family: "IPv4", internal: false },
      { address: "fe80::1", family: "IPv6", internal: false },
    ],
    utun3: [{ address: "10.8.0.2", family: "IPv4", internal: false }],
  };

  assert.deepEqual(senderUrls("0.0.0.0", 8787, interfaces), ["en0: http://192.168.1.36:8787"]);
  assert.deepEqual(senderUrls("127.0.0.1", 8787, interfaces), ["http://127.0.0.1:8787"]);
  assert.deepEqual(senderUrls("fd00::5", 8877, interfaces), ["http://[fd00::5]:8877"]);
});

test("a port held on loopback counts as in use for a wildcard bind", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  try {
    assert.equal(await portInUse(port, "0.0.0.0"), true);
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
  assert.equal(await portInUse(port, "0.0.0.0"), false);
});
