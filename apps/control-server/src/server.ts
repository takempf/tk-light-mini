import { timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { extname, resolve, sep } from "node:path";
import { type WebSocket, WebSocketServer } from "ws";
import { LightEngine, type LightOutput } from "./engine.js";
import { FrameRegistry, parseFrame } from "./frames.js";
import { type SetupStore, validateSetup } from "./setup.js";
import type { Setup } from "./types.js";

interface ServerOptions {
  store: SetupStore;
  lights: LightOutput & {
    discover?: () => Promise<{ id: string; ip: string; sku: string }[]>;
    probe?: (ip: string) => Promise<{ id: string; ip: string; sku: string } | null>;
  };
  adminToken: string;
  senderToken?: string;
  senderTokens?: Record<string, string>;
  adminDist?: string;
}

const equal = (a: string, b: string) => {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};
const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
};
const readJson = async (req: IncomingMessage): Promise<unknown> => {
  let text = "";
  for await (const part of req) {
    text += part;
    if (text.length > 1_000_000) throw new Error("Request too large");
  }
  return JSON.parse(text);
};

export function createControlServer({
  store,
  lights,
  adminToken,
  senderToken,
  senderTokens,
  adminDist,
}: ServerOptions) {
  const frames = new FrameRegistry();
  const engine = new LightEngine(frames, lights);
  const sockets = new Map<string, WebSocket>();
  const ws = new WebSocketServer({ noServer: true, maxPayload: 300_000 });
  let discovered: { id: string; ip: string; sku: string }[] = [];
  let sequence = 0;
  let lastError: string | null = null;

  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    try {
      if (!url.pathname.startsWith("/api/")) {
        if (!adminDist) return json(res, 404, { error: "Admin build unavailable" });
        const path = resolve(adminDist, `.${url.pathname === "/" ? "/index.html" : url.pathname}`);
        const root = resolve(adminDist);
        if (path !== root && !path.startsWith(root + sep))
          return json(res, 404, { error: "Not found" });
        const file = await stat(path).catch(() => null);
        if (!file?.isFile()) return json(res, 404, { error: "Not found" });
        const type =
          (
            {
              ".html": "text/html",
              ".js": "text/javascript",
              ".css": "text/css",
              ".svg": "image/svg+xml",
              ".png": "image/png",
              ".woff2": "font/woff2",
            } as Record<string, string>
          )[extname(path)] ?? "application/octet-stream";
        res.writeHead(200, { "content-type": type, "x-content-type-options": "nosniff" });
        createReadStream(path).pipe(res);
        return;
      }
      if (!equal((req.headers.authorization ?? "").replace(/^Bearer /, ""), adminToken))
        return json(res, 401, { error: "Unauthorized" });
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host && req.method !== "GET")
        return json(res, 403, { error: "Origin denied" });
      if (url.pathname === "/api/setup" && req.method === "GET") return json(res, 200, store.get());
      if (url.pathname === "/api/setup" && req.method === "PUT") {
        const body = (await readJson(req)) as { expectedRevision: number; setup: Setup };
        const previous = store.get();
        const next = await store.update(validateSetup(body.setup), body.expectedRevision);
        for (const device of next.devices)
          if (!device.on && previous.devices.some((old) => old.id === device.id && old.on))
            lights.turn(device.ip, false);
        sequence++;
        return json(res, 200, next);
      }
      if (url.pathname === "/api/status" && req.method === "GET")
        return json(res, 200, {
          senders: frames.statuses(),
          discovered,
          error: lastError,
          running: store.get().enabled,
        });
      if (url.pathname === "/api/scan" && req.method === "POST") {
        discovered = (await lights.discover?.()) ?? [];
        return json(res, 200, discovered);
      }
      if (url.pathname === "/api/probe" && req.method === "POST") {
        const body = (await readJson(req)) as { ip?: string };
        if (!body.ip || !lights.probe) throw new Error("Invalid device IP");
        const device = await lights.probe(body.ip);
        return device
          ? json(res, 200, device)
          : json(res, 404, { error: "No light replied at that IP" });
      }
      if (url.pathname === "/api/preview" && req.method === "GET") {
        const device = url.searchParams.get("device") ?? undefined;
        const sectionText = url.searchParams.get("section");
        const section = sectionText === null ? undefined : Number(sectionText);
        if (section !== undefined && (!Number.isSafeInteger(section) || section < 0))
          throw new Error("Invalid section");
        const frame = device
          ? engine.previewFor(store.get(), Date.now(), device, section)
          : engine.preview;
        return json(res, 200, {
          seq: sequence,
          status: { running: store.get().enabled, error: lastError },
          paths: Object.fromEntries(engine.live),
          image: frame
            ? { width: frame.width, height: frame.height, bgra: frame.bgra.toString("base64") }
            : null,
        });
      }
      const power = /^\/api\/devices\/([^/]+)\/power$/.exec(url.pathname);
      if (power && req.method === "POST") {
        const body = (await readJson(req)) as { on: boolean };
        if (typeof body.on !== "boolean") throw new Error("Invalid power state");
        const setup = store.get();
        const device = setup.devices.find((d) => d.id === decodeURIComponent(power[1] ?? ""));
        if (!device) return json(res, 404, { error: "Unknown light" });
        device.on = body.on;
        const next = await store.update(setup, setup.revision);
        lights.turn(device.ip, body.on);
        sequence++;
        return json(res, 200, next);
      }
      if (url.pathname === "/api/power-now" && req.method === "POST") {
        const body = (await readJson(req)) as { ip?: string; on?: boolean };
        const device = store.get().devices.find((d) => d.ip === body.ip);
        if (!device || typeof body.on !== "boolean") throw new Error("Invalid power request");
        if (body.on) engine.release(device.id);
        else engine.hold(device.id, Date.now() + 1000);
        lights.turn(device.ip, body.on);
        return json(res, 200, { ok: true });
      }
      const identify = /^\/api\/devices\/([^/]+)\/identify$/.exec(url.pathname);
      if (identify && req.method === "POST") {
        const device = store
          .get()
          .devices.find((d) => d.id === decodeURIComponent(identify[1] ?? ""));
        if (!device) return json(res, 404, { error: "Unknown light" });
        engine.hold(device.id, Date.now() + 2500);
        lights.turn(device.ip, true);
        let i = 0;
        const pulse = setInterval(() => {
          const k = Math.sin((Math.PI * (i % 20)) / 20) ** 2;
          lights.color(device.ip, [Math.round(255 * k), 0, Math.round(150 * k)]);
          if (++i >= 60) {
            clearInterval(pulse);
            lights.color(device.ip, [0, 0, 0]);
          }
        }, 40);
        return json(res, 200, { ok: true });
      }
      if (url.pathname === "/api/lights-off" && req.method === "POST") {
        const setup = store.get();
        setup.enabled = false;
        for (const device of setup.devices) lights.turn(device.ip, false);
        const next = await store.update(setup, setup.revision);
        return json(res, 200, next);
      }
      if (url.pathname === "/api/lights-off-now" && req.method === "POST") {
        for (const device of store.get().devices) {
          engine.hold(device.id, Date.now() + 1000);
          lights.turn(device.ip, false);
        }
        return json(res, 200, { ok: true });
      }
      if (url.pathname === "/api/calibration" && req.method === "POST") {
        const body = (await readJson(req)) as { id?: string; color?: string; raw?: boolean };
        if (body.id === undefined) engine.clearCalibration();
        else {
          if (
            !store.get().devices.some((d) => d.id === body.id) ||
            typeof body.color !== "string" ||
            !/^#[0-9a-fA-F]{6}$/.test(body.color)
          )
            throw new Error("Invalid calibration request");
          const hex = body.color;
          const color = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [
            number,
            number,
            number,
          ];
          engine.setCalibration(body.id, color, Boolean(body.raw), Date.now() + 5000);
        }
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(res, message === "Revision conflict" ? 409 : 400, { error: message });
    }
  });

  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/api/publish")
      return socket.destroy();
    ws.handleUpgrade(req, socket, head, (client) => ws.emit("connection", client));
  });
  ws.on("connection", (client) => {
    let id: string | null = null;
    let lastFrameAt = 0;
    const timeout = setTimeout(() => client.close(1008, "Authentication required"), 5000);
    client.on("message", (data, binary) => {
      try {
        if (!id) {
          if (binary) throw new Error("Authentication required");
          const auth = JSON.parse(data.toString()) as { token: string; id: string; name: string };
          const expected = senderTokens ? senderTokens[auth.id] : senderToken;
          if (!expected || !equal(auth.token, expected)) throw new Error("Unauthorized");
          frames.connect(auth.id, auth.name);
          id = auth.id;
          sockets.get(id)?.close(1000, "Reconnected");
          sockets.set(id, client);
          clearTimeout(timeout);
          client.send(JSON.stringify({ ok: true }));
          return;
        }
        if (!binary) throw new Error("Expected binary frame");
        const now = Date.now();
        if (now - lastFrameAt < 15) return;
        lastFrameAt = now;
        frames.publish(id, parseFrame(Buffer.from(data as Buffer)), now);
        sequence++;
      } catch {
        client.close(1008, "Invalid publisher message");
      }
    });
    client.on("close", () => {
      clearTimeout(timeout);
      if (id && sockets.get(id) === client) {
        sockets.delete(id);
        frames.disconnect(id);
        sequence++;
      }
    });
  });

  let lastRun = 0;
  const timer = setInterval(() => {
    try {
      const setup = store.get();
      const now = Date.now();
      if (now - lastRun < 1000 / setup.fps) return;
      lastRun = now;
      engine.tick(setup, now);
      lastError = null;
      sequence++;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }, 10);
  timer.unref();

  return {
    server,
    frames,
    engine,
    close: async () => {
      clearInterval(timer);
      for (const client of ws.clients) client.terminate();
      ws.close();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    },
  };
}
