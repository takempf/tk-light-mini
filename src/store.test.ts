import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./lib/api";
import type { GoveeDevice } from "./lib/types";
import { DEFAULT_SETTINGS, toEngineConfig, useStore } from "./store";

vi.mock("./lib/api", async () => (await import("./test/mockApi")).mockApiModule());

const lamp: GoveeDevice = { id: "AA:BB", ip: "192.168.1.10", sku: "H6199" };
const strip: GoveeDevice = { id: "CC:DD", ip: "192.168.1.11", sku: "H619A" };

beforeEach(() => {
  useStore.setState({
    devices: [],
    enabled: false,
    settings: DEFAULT_SETTINGS,
    discovered: [],
    scanning: false,
    scanError: null,
  });
});

describe("lights off", () => {
  it("stops syncing and switches every light off", async () => {
    const s = useStore.getState();
    s.addDevice(lamp);
    s.addDevice(strip);
    s.setEnabled(true);
    await useStore.getState().lightsOff();
    expect(useStore.getState().enabled).toBe(false);
    expect(api.lightsOff).toHaveBeenCalledWith([lamp.ip, strip.ip]);
  });
});

describe("devices", () => {
  it("adds once, defaults to the average color", () => {
    const { addDevice } = useStore.getState();
    addDevice(lamp);
    addDevice(lamp);
    const { devices } = useStore.getState();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      id: lamp.id,
      color: "all",
      name: "H6199",
      brightness: 1,
      on: true,
    });
  });

  it("switches a light off and back on", () => {
    const s = useStore.getState();
    s.addDevice(lamp);
    s.addDevice(strip);
    s.setPower(lamp.id, false);
    expect(api.setPower).toHaveBeenLastCalledWith(lamp.ip, false);
    expect(toEngineConfig(useStore.getState()).devices.map((d) => d.ip)).toEqual([strip.ip]);
    s.setPower(lamp.id, true);
    expect(api.setPower).toHaveBeenLastCalledWith(lamp.ip, true);
    expect(toEngineConfig(useStore.getState()).devices).toHaveLength(2);
  });

  it("colors segments, and the whole light clears them", () => {
    const s = useStore.getState();
    s.addDevice(strip);
    s.setRazer(strip.id, true);
    s.setSegments(strip.id, 4);
    s.setColor(strip.id, "#ff0000", [1, 3]);
    const segments = () => toEngineConfig(useStore.getState()).devices[0]?.segments;
    expect(segments()).toEqual(["all", "#ff0000", "all", "#ff0000"]);
    s.setColor(strip.id, "top");
    expect(segments()).toEqual(["top", "top", "top", "top"]);
    s.setRazer(strip.id, false);
    expect(segments()).toEqual([]);
  });

  it("sets color, renames and removes", () => {
    const s = useStore.getState();
    s.addDevice(lamp);
    s.addDevice(strip);
    s.setColor(lamp.id, "left");
    s.renameDevice(strip.id, "Desk");
    s.setDeviceBrightness(strip.id, 0.4);
    expect(useStore.getState().devices.map((d) => [d.color, d.name, d.brightness])).toEqual([
      ["left", "H6199", 1],
      ["all", "Desk", 0.4],
    ]);
    s.removeDevice(lamp.id);
    expect(useStore.getState().devices.map((d) => d.id)).toEqual([strip.id]);
  });
});

describe("scan", () => {
  it("stores results and follows IP changes of added devices", async () => {
    useStore.getState().addDevice(lamp);
    vi.mocked(api.discoverDevices).mockResolvedValueOnce([{ ...lamp, ip: "192.168.1.99" }, strip]);
    await useStore.getState().scan();
    const s = useStore.getState();
    expect(s.discovered).toHaveLength(2);
    expect(s.devices[0]?.ip).toBe("192.168.1.99");
    expect(s.scanning).toBe(false);
  });

  it("reports errors", async () => {
    vi.mocked(api.discoverDevices).mockRejectedValueOnce("cannot listen on UDP 4002");
    await useStore.getState().scan();
    expect(useStore.getState().scanError).toMatch(/4002/);
  });
});

describe("settings", () => {
  it("merges tuning and resets", () => {
    const s = useStore.getState();
    s.setTuning({ saturation: 2 });
    expect(useStore.getState().settings.tuning).toEqual({
      ...DEFAULT_SETTINGS.tuning,
      saturation: 2,
    });
    s.resetTuning();
    expect(useStore.getState().settings.tuning).toEqual(DEFAULT_SETTINGS.tuning);
  });

  it("maps to the engine config shape", () => {
    useStore.getState().addDevice(lamp);
    useStore.getState().setEnabled(true);
    expect(toEngineConfig(useStore.getState())).toEqual({
      enabled: true,
      fps: 30,
      monitor: 0,
      tuning: DEFAULT_SETTINGS.tuning,
      devices: [{ ip: lamp.ip, color: "all", brightness: 1, razer: false, segments: [] }],
    });
  });
});
