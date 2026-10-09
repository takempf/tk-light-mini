import { createSocket, type Socket } from "node:dgram";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import type { Rgb } from "./types.js";

export interface FoundDevice {
  id: string;
  ip: string;
  sku: string;
}
export const CONTROL_PORT = 4003;
const SCAN_PORT = 4001;
const REPLY_PORT = 4002;
const MULTICAST = "239.255.255.250";
const SCAN = Buffer.from(
  JSON.stringify({ msg: { cmd: "scan", data: { account_topic: "reserve" } } }),
);

export function parseScan(data: Buffer): FoundDevice | null {
  try {
    const msg = JSON.parse(data.toString("utf8"))?.msg;
    if (msg?.cmd !== "scan" || typeof msg.data?.device !== "string" || isIP(msg.data?.ip) !== 4)
      return null;
    return {
      id: msg.data.device,
      ip: msg.data.ip,
      sku: typeof msg.data.sku === "string" ? msg.data.sku : "",
    };
  } catch {
    return null;
  }
}

export const turnPacket = (on: boolean) =>
  Buffer.from(JSON.stringify({ msg: { cmd: "turn", data: { value: on ? 1 : 0 } } }));
export const colorPacket = ([r, g, b]: Rgb) =>
  Buffer.from(
    JSON.stringify({ msg: { cmd: "colorwc", data: { color: { r, g, b }, colorTemInKelvin: 0 } } }),
  );
export const brightnessPacket = (value: number) =>
  Buffer.from(
    JSON.stringify({
      msg: { cmd: "brightness", data: { value: Math.max(1, Math.min(100, Math.round(value))) } },
    }),
  );

export function razerPacket(colors: Rgb[] | boolean): Buffer {
  const bytes =
    typeof colors === "boolean"
      ? [0xbb, 0, 1, 0xb1, Number(colors)]
      : [0xbb, 0, 0xfa, 0xb0, 0, Math.min(colors.length, 100), ...colors.slice(0, 100).flat()];
  bytes.push(bytes.reduce((sum, b) => sum ^ b, 0));
  return Buffer.from(
    JSON.stringify({ msg: { cmd: "razer", data: { pt: Buffer.from(bytes).toString("base64") } } }),
  );
}

export class Govee {
  private readonly socket: Socket;
  constructor(socket = createSocket("udp4")) {
    this.socket = socket;
    this.socket.on("error", (error) => console.error("Govee UDP:", error));
  }
  send(ip: string, packet: Buffer): void {
    if (isIP(ip) !== 4) throw new Error("Invalid device IP");
    this.socket.send(packet, CONTROL_PORT, ip);
  }
  turn(ip: string, on: boolean): void {
    this.send(ip, turnPacket(on));
  }
  color(ip: string, value: Rgb): void {
    this.send(ip, colorPacket(value));
  }
  razer(ip: string, value: Rgb[] | boolean): void {
    this.send(ip, razerPacket(value));
  }
  close(): void {
    this.socket.close();
  }

  async probe(ip: string, timeoutMs = 2000): Promise<FoundDevice | null> {
    if (isIP(ip) !== 4) throw new Error("Invalid device IP");
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("error", reject);
        socket.bind(REPLY_PORT, "0.0.0.0", () => {
          socket.off("error", reject);
          resolve();
        });
      });
      socket.on("error", (error) => console.error("Govee probe:", error));
      return await new Promise<FoundDevice | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), timeoutMs);
        socket.on("message", (packet) => {
          const found = parseScan(packet);
          if (found?.ip === ip) {
            clearTimeout(timer);
            resolve(found);
          }
        });
        socket.send(SCAN, SCAN_PORT, ip);
      });
    } finally {
      socket.close();
    }
  }

  async discover(timeoutMs = 2500): Promise<FoundDevice[]> {
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    const found = new Map<string, FoundDevice>();
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("error", reject);
        socket.bind(REPLY_PORT, "0.0.0.0", () => {
          socket.off("error", reject);
          resolve();
        });
      });
      socket.on("error", (error) => console.error("Govee discovery:", error));
      socket.on("message", (packet) => {
        const device = parseScan(packet);
        if (device) found.set(device.id, device);
      });
      const addresses = Object.values(networkInterfaces())
        .flat()
        .filter((i): i is NonNullable<typeof i> => Boolean(i && i.family === "IPv4" && !i.internal))
        .map((i) => i.address);
      for (const address of addresses) {
        try {
          socket.addMembership(MULTICAST, address);
        } catch {
          /* Interface may reject multicast. */
        }
        try {
          socket.setMulticastInterface(address);
          socket.send(SCAN, SCAN_PORT, MULTICAST);
        } catch {
          /* Try the next interface. */
        }
      }
      // A second round catches devices which missed the first packet.
      await new Promise((resolve) => setTimeout(resolve, timeoutMs / 2));
      for (const address of addresses) {
        try {
          socket.setMulticastInterface(address);
          socket.send(SCAN, SCAN_PORT, MULTICAST);
        } catch {
          /* Try the next interface. */
        }
        // Some access points drop multicast; match the original app's /24 sweep.
        const prefix = address.split(".").slice(0, 3).join(".");
        for (let host = 1; host <= 254; host++) socket.send(SCAN, SCAN_PORT, `${prefix}.${host}`);
      }
      await new Promise((resolve) => setTimeout(resolve, timeoutMs / 2));
      return [...found.values()].sort(
        (a, b) => a.sku.localeCompare(b.sku) || a.ip.localeCompare(b.ip),
      );
    } finally {
      socket.close();
    }
  }
}
