import { expect, it } from "vitest";
import { colorPacket, parseScan, razerPacket, turnPacket } from "./govee.js";

it("builds Govee LAN packets and parses scan replies", () => {
  expect(JSON.parse(turnPacket(false).toString()).msg.data.value).toBe(0);
  expect(JSON.parse(colorPacket([1, 2, 3]).toString()).msg.data.color).toEqual({
    r: 1,
    g: 2,
    b: 3,
  });
  const scan = Buffer.from(
    JSON.stringify({
      msg: { cmd: "scan", data: { device: "abc", ip: "192.168.1.5", sku: "H6056" } },
    }),
  );
  expect(parseScan(scan)).toEqual({ id: "abc", ip: "192.168.1.5", sku: "H6056" });
  expect(parseScan(Buffer.from("garbage"))).toBeNull();
  const bytes = Buffer.from(
    JSON.parse(razerPacket([[255, 0, 0]]).toString()).msg.data.pt,
    "base64",
  );
  expect(bytes.subarray(0, 6)).toEqual(Buffer.from([0xbb, 0, 0xfa, 0xb0, 0, 1]));
  expect(bytes.reduce((x, b) => x ^ b, 0)).toBe(0);
});
