import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./lib/api";
import { resolvePath } from "./lib/path";
import type { GoveeDevice, LightPath } from "./lib/types";
import { DEFAULT_SETTINGS, migrate, toEngineConfig, useStore } from "./store";

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
    selection: null,
    drawing: false,
    points: [],
    past: [],
    future: [],
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

const path = {
  points: [
    [0, 0.5],
    [1, 0.5],
  ] as [number, number][],
  width: 0.1,
  closed: false,
};

const engineDevice = () => toEngineConfig(useStore.getState()).devices[0];

describe("devices", () => {
  it("adds once, around the screen edge, and selects it", () => {
    const { addDevice } = useStore.getState();
    addDevice(lamp);
    addDevice(lamp);
    const { devices, selection } = useStore.getState();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ id: lamp.id, name: "H6199", brightness: 1, on: true });
    expect(devices[0]?.sections).toHaveLength(1);
    expect(devices[0]?.sections[0]).toMatchObject({ color: "path", path: { closed: true } });
    expect(selection).toEqual({ id: lamp.id, section: 0 });
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

  it("renames, and removing clears the selection", () => {
    const s = useStore.getState();
    s.addDevice(lamp);
    s.addDevice(strip);
    s.renameDevice(strip.id, "Desk");
    s.setDeviceBrightness(strip.id, 0.4);
    expect(useStore.getState().devices.map((d) => [d.name, d.brightness])).toEqual([
      ["H6199", 1],
      ["Desk", 0.4],
    ]);
    s.removeDevice(strip.id);
    expect(useStore.getState().devices.map((d) => d.id)).toEqual([lamp.id]);
    expect(useStore.getState().selection).toBeNull();
  });
});

describe("sections", () => {
  const bars = () => {
    const s = useStore.getState();
    s.addDevice(strip);
    s.setRazer(strip.id, true);
    s.setSegments(strip.id, 12);
    return useStore.getState();
  };

  it("splits a light in two and places each part", () => {
    const s = bars();
    s.splitSection(strip.id, 0);
    expect(useStore.getState().selection).toEqual({ id: strip.id, section: 1 });
    s.setSectionPath(strip.id, 1, path);
    const d = engineDevice();
    expect(d?.segments).toEqual(Array(12).fill("path"));
    expect(d?.sections.map((x) => x.count)).toEqual([6, 6]);
    expect(d?.sections[1]?.path).toEqual(path);
    expect(d?.sections[0]?.path?.closed).toBe(true);
  });

  it("colors a section, and single segments", () => {
    const s = bars();
    s.splitSection(strip.id, 0, 4);
    s.setSegmentColors(strip.id, [0, 5], "#00ff00");
    s.setSectionColor(strip.id, 1, "#ff0000");
    // The section's color clears overrides in it only.
    expect(engineDevice()?.segments).toEqual([
      "#00ff00",
      "path",
      "path",
      "path",
      ...Array(8).fill("#ff0000"),
    ]);
    // No segment follows the second section's path: the engine skips it.
    s.setSectionPath(strip.id, 1, path);
    expect(engineDevice()?.sections[1]?.path).toBeNull();
    s.setSegmentColors(strip.id, [0], null);
    expect(engineDevice()?.segments[0]).toBe("path");
  });

  it("merges, and keeps the selection on the merged part", () => {
    const s = bars();
    s.splitSection(strip.id, 0);
    s.mergeSections(strip.id, 0);
    expect(useStore.getState().devices[0]?.sections.map((x) => x.count)).toEqual([12]);
    expect(useStore.getState().selection).toEqual({ id: strip.id, section: 0 });
  });

  it("drops a path with under two points when drawing ends", () => {
    const s = bars();
    s.setSectionPath(strip.id, 0, { ...path, points: [[0.5, 0.5]] });
    s.setDrawing(true);
    s.setDrawing(false);
    expect(useStore.getState().devices[0]?.sections[0]?.path).toBeUndefined();
    s.setSectionPath(strip.id, 0, path);
    s.setDrawing(true);
    s.select(null);
    expect(useStore.getState().devices[0]?.sections[0]?.path).toEqual(path);
  });

  it("is one section of one segment without razer mode, but keeps the split", () => {
    const s = bars();
    s.splitSection(strip.id, 0);
    s.setRazer(strip.id, false);
    expect(engineDevice()).toMatchObject({ segments: ["path"], sections: [{ count: 1 }] });
    expect(useStore.getState().selection).toEqual({ id: strip.id, section: 0 });
    s.setRazer(strip.id, true);
    expect(engineDevice()?.sections.map((x) => x.count)).toEqual([6, 6]);
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

  const saved = () => useStore.getState().devices[0]?.sections[0]?.path as LightPath;

  it("maps to the engine config shape", () => {
    useStore.getState().addDevice(lamp);
    useStore.getState().setEnabled(true);
    expect(toEngineConfig(useStore.getState())).toEqual({
      enabled: true,
      fps: 30,
      monitor: 0,
      tuning: DEFAULT_SETTINGS.tuning,
      devices: [
        {
          ip: lamp.ip,
          brightness: 1,
          razer: false,
          segments: ["path"],
          sections: [{ path: resolvePath(saved(), 16 / 9), count: 1 }],
        },
      ],
    });
  });
});

describe("fit", () => {
  it("sends paths fitted to the screen's shape", () => {
    const s = useStore.getState();
    s.addDevice(strip);
    s.setSectionPath(strip.id, 0, {
      points: [
        [0.4, 0.5],
        [0.6, 0.5],
      ],
      width: 0.2,
      closed: false,
      fit: { x: "fit", y: "exact" },
    });
    // Its square ends run right to the screen's edges.
    const path = toEngineConfig(useStore.getState(), 2).devices[0]?.sections[0]?.path;
    expect(path?.points.map(([x]) => x)).toEqual([0, 1]);
    expect(path?.points.map(([, y]) => y)).toEqual([0.5, 0.5]);
  });
});

describe("migrate from v6", () => {
  it("turns zones into paths and moves a path into the first section", () => {
    const v6 = {
      enabled: true,
      settings: {
        fps: 30,
        monitor: 0,
        tuning: { saturation: 1, brightness: 1, depth: 0.2, smoothing: 0.5 },
      },
      devices: [
        {
          id: "1",
          ip: "a",
          sku: "X",
          name: "Top",
          on: true,
          brightness: 1,
          razer: false,
          color: "top",
        },
        {
          id: "2",
          ip: "b",
          sku: "X",
          name: "Red",
          on: true,
          brightness: 1,
          razer: false,
          color: "#ff0000",
        },
        {
          id: "3",
          ip: "c",
          sku: "X",
          name: "Strip",
          on: true,
          brightness: 1,
          razer: true,
          segments: 3,
          color: "path",
          path,
          segmentColors: ["left", "#00ff00", null],
        },
        // Before v2: no brightness, a `zone`, and the old white LED flag.
        { id: "4", ip: "d", sku: "X", name: "Old", zone: "all", whiteLeds: true },
      ],
    };
    const s = migrate(v6, 6);
    expect(s.settings.tuning).toEqual({ saturation: 1, brightness: 1, smoothing: 0.5 });
    const [top, red, strip3, old] = s.devices;
    expect(top?.sections).toEqual([
      {
        count: 1,
        color: "path",
        path: {
          points: [
            [0, 0.1],
            [1, 0.1],
          ],
          width: 0.2,
          closed: false,
        },
      },
    ]);
    expect(red?.sections).toEqual([{ count: 1, color: "#ff0000", path: undefined }]);
    expect(strip3?.sections).toEqual([{ count: 1, color: "path", path }]);
    expect(strip3?.segmentColors).toEqual([null, "#00ff00", null]);
    expect(old).toMatchObject({ brightness: 1, on: true, razer: false });
    expect(old).not.toHaveProperty("whiteLeds");
    expect(old?.sections[0]?.path?.width).toBe(1);
  });
});

describe("undo", () => {
  const moved = (y: number) => ({
    ...path,
    points: [
      [0, y],
      [1, y],
    ] as [number, number][],
  });
  const current = () => useStore.getState().devices[0]?.sections[0]?.path;

  it("merges a drag into one step, and breaks between edits", () => {
    const s = useStore.getState();
    s.addDevice(strip);
    s.setSectionPath(strip.id, 0, path);
    s.breakUndo();
    s.setSectionPath(strip.id, 0, moved(0.6));
    s.setSectionPath(strip.id, 0, moved(0.7));
    s.breakUndo();
    s.setSectionColor(strip.id, 0, "#ff0000");
    s.undo();
    expect(useStore.getState().devices[0]?.sections[0]?.color).toBe("path");
    expect(current()).toEqual(moved(0.7));
    s.undo();
    expect(current()).toEqual(path);
    s.redo();
    expect(current()).toEqual(moved(0.7));
    // A new edit drops what could be redone.
    s.setSectionPath(strip.id, 0, moved(0.1));
    expect(useStore.getState().future).toEqual([]);
  });

  it("undoes a whole drawing at once, but not while drawing", () => {
    const s = useStore.getState();
    s.addDevice(strip);
    const before = current();
    s.setDrawing(true);
    s.setSectionPath(strip.id, 0, { ...path, points: [[0.1, 0.1]] });
    s.setSectionPath(strip.id, 0, path);
    s.undo();
    expect(current()).toEqual(path);
    s.setDrawing(false);
    s.undo();
    expect(current()).toEqual(before);
  });

  it("undoes splits, and leaves removed lights removed", () => {
    const s = useStore.getState();
    s.addDevice(lamp);
    s.addDevice(strip);
    s.setRazer(strip.id, true);
    s.splitSection(strip.id, 0);
    s.removeDevice(lamp.id);
    s.undo();
    expect(useStore.getState().devices.map((d) => d.id)).toEqual([strip.id]);
    expect(useStore.getState().devices[0]?.sections).toHaveLength(1);
  });

  it("clears picked points when the selection changes", () => {
    const s = useStore.getState();
    s.addDevice(strip);
    s.setPoints([0, 1]);
    s.select({ id: strip.id, section: 0 });
    expect(useStore.getState().points).toEqual([0, 1]);
    s.select(null);
    expect(useStore.getState().points).toEqual([]);
  });
});
