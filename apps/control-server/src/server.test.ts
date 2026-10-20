import { mkdtemp, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { createControlServer } from "./server.js";
import { SetupStore } from "./setup.js";
import type { Rgb } from "./types.js";

const open: Array<ReturnType<typeof createControlServer>> = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((app) => app.close()));
});

it("authenticates, saves configuration, accepts a screen frame, and drives one light", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tk-light-api-"));
  await writeFile(join(dir, "index.html"), "<h1>Light control</h1>");
  const store = new SetupStore(join(dir, "setup.json"));
  await store.load();
  const colors: Rgb[] = [];
  const turns: { ip: string; on: boolean }[] = [];
  const app = createControlServer({
    store,
    adminToken: "admin-secret-long",
    senderTokens: { office: "sender-secret-long" },
    adminDist: dir,
    lights: {
      turn(ip, on) {
        turns.push({ ip, on });
      },
      color(_ip, value) {
        colors.push(value);
      },
      razer() {},
      discover: async () => [{ id: "one", ip: "192.168.1.2", sku: "H6056" }],
      probe: async (ip) => (ip === "192.168.1.2" ? { id: "one", ip, sku: "H6056" } : null),
    },
  });
  open.push(app);
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = (app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const authorized = { authorization: "Bearer admin-secret-long" };
  expect(await (await fetch(base)).text()).toBe("<h1>Light control</h1>");
  expect((await fetch(`${base}/api/setup`)).status).toBe(401);
  expect(
    (
      await fetch(`${base}/api/scan`, {
        method: "POST",
        headers: { ...authorized, origin: "http://another-host:8787" },
      })
    ).status,
  ).toBe(403);
  expect(
    await (await fetch(`${base}/api/scan`, { method: "POST", headers: authorized })).json(),
  ).toEqual([{ id: "one", ip: "192.168.1.2", sku: "H6056" }]);
  expect(
    await (
      await fetch(`${base}/api/probe`, {
        method: "POST",
        headers: authorized,
        body: JSON.stringify({ ip: "192.168.1.2" }),
      })
    ).json(),
  ).toEqual({ id: "one", ip: "192.168.1.2", sku: "H6056" });
  const setup = store.get();
  setup.enabled = true;
  setup.source = { kind: "remote", senderId: "office" };
  setup.tuning = { saturation: 1, brightness: 1, smoothing: 0 };
  setup.devices = [
    {
      id: "one",
      ip: "192.168.1.2",
      sku: "H6056",
      name: "Bar",
      on: true,
      razer: false,
      brightness: 1,
      sections: [
        {
          count: 1,
          color: "path",
          path: {
            points: [
              [0, 0.5],
              [1, 0.5],
            ],
            width: 0.5,
            closed: false,
          },
        },
      ],
    },
  ];
  const saved = await fetch(`${base}/api/setup`, {
    method: "PUT",
    headers: authorized,
    body: JSON.stringify({ setup, expectedRevision: 0 }),
  });
  expect(saved.status).toBe(200);
  expect(((await saved.json()) as { revision: number }).revision).toBe(1);
  expect(
    (
      await fetch(`${base}/api/setup`, {
        method: "PUT",
        headers: authorized,
        body: JSON.stringify({ setup, expectedRevision: 0 }),
      })
    ).status,
  ).toBe(409);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/publish`);
  await new Promise<void>((resolve) => ws.once("open", resolve));
  ws.send(JSON.stringify({ token: "sender-secret-long", id: "office", name: "Office PC" }));
  await new Promise<void>((resolve) => ws.once("message", resolve));
  const frame = Buffer.alloc(20 + 4 * 2 * 4);
  frame.write("TKL1");
  frame.writeUInt16LE(4, 4);
  frame.writeUInt16LE(2, 6);
  frame.writeUInt32LE(1, 8);
  frame.writeDoubleLE(Date.now(), 12);
  for (let i = 20; i < frame.length; i += 4) frame.set([0, 0, 255, 255], i);
  ws.send(frame);
  await new Promise((resolve) => setTimeout(resolve, 60));
  app.engine.tick(store.get());
  expect(colors.at(-1)).toEqual([255, 0, 0]);
  expect(
    (
      (await (await fetch(`${base}/api/status`, { headers: authorized })).json()) as {
        senders: { online: boolean }[];
      }
    ).senders[0]?.online,
  ).toBe(true);
  const preview = Buffer.from(
    await (
      await fetch(`${base}/api/preview?device=one&section=0`, { headers: authorized })
    ).arrayBuffer(),
  );
  // Status, colors and the section's frame, in RGBA: 4 x 2 red pixels.
  expect(preview[8]).toBe(1 | 2 | 4);
  expect([...preview.subarray(-36)]).toEqual([
    4,
    0,
    2,
    0,
    ...Array.from({ length: 8 }, () => [255, 0, 0, 255]).flat(),
  ]);
  expect(
    (await fetch(`${base}/api/preview?device=one&section=bad`, { headers: authorized })).status,
  ).toBe(400);
  expect(
    (
      await fetch(`${base}/api/power-now`, {
        method: "POST",
        headers: authorized,
        body: JSON.stringify({ ip: "192.168.1.2", on: false }),
      })
    ).status,
  ).toBe(200);
  expect(turns.at(-1)).toEqual({ ip: "192.168.1.2", on: false });
  expect(store.get().revision).toBe(1);
  await fetch(`${base}/api/lights-off-now`, { method: "POST", headers: authorized });
  expect(turns.at(-1)).toEqual({ ip: "192.168.1.2", on: false });
  ws.close();
  await new Promise<void>((resolve) => ws.once("close", resolve));
  await vi.waitFor(() => expect(app.frames.statuses()[0]?.online).toBe(false));
});

it("rests while sync is off and no admin looks, and sends the admin only what changed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tk-light-api-"));
  const store = new SetupStore(join(dir, "setup.json"));
  await store.load();
  const setup = store.get();
  setup.devices = [
    {
      id: "one",
      ip: "192.168.1.2",
      sku: "H6056",
      name: "Bar",
      on: true,
      razer: false,
      brightness: 1,
      sections: [{ count: 1, color: "#ff0000" }],
    },
  ];
  await store.update(setup, 0);
  const app = createControlServer({
    store,
    adminToken: "admin-secret-long",
    lights: { turn() {}, color() {}, razer() {} },
  });
  open.push(app);
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const poll = async (after: number) =>
    Buffer.from(
      await (
        await fetch(`${base}/api/preview?after=${after}`, {
          headers: { authorization: "Bearer admin-secret-long" },
        })
      ).arrayBuffer(),
    );
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(app.engine.live.size).toBe(0);
  const first = await poll(0);
  expect(first[8]).toBe(1 | 2 | 4);
  expect(app.engine.live.has("192.168.1.2")).toBe(true);
  // The scene moves on; the status and the light's fixed color don't.
  const next = await poll(Number(first.readBigUInt64LE(0)));
  expect(next[8]).toBe(4);
});
