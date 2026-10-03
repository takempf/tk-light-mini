import { create } from "zustand";
import { type PersistStorage, persist, type StorageValue } from "zustand/middleware";
import { api } from "./lib/api";
import { resolveCalibration, type Step, testColor, withStep } from "./lib/calibration";
import { rgbHex } from "./lib/colors";
import {
  mergeSections,
  sectionStarts,
  sectionsOf,
  segmentCount,
  segmentSources,
  splitSection,
} from "./lib/lights";
import { linePath, type OldZone, resolvePath, zonePath } from "./lib/path";
import { readSetupText, SETUP_FILE_NAME, setupText } from "./lib/setupFile";
import { forget, readSaved, saveLater } from "./lib/storage";
import type {
  AddedDevice,
  CanvasSource,
  EngineConfig,
  EngineStatus,
  GoveeDevice,
  Hex,
  LightPath,
  MonitorInfo,
  Rgb,
  ScreenImage,
  Section,
  Settings,
  Source,
  Tuning,
} from "./lib/types";

export const DEFAULT_SETTINGS: Settings = {
  fps: 30,
  monitor: 0,
  canvas: "screen",
  tuning: { saturation: 1.3, brightness: 1, smoothing: 0.5 },
};

/** Saved-state version. Bump it, and add to `migrate`, when the saved shape changes. */
const VERSION = 9;

/** A whole light (`section: null`) or one of its paths. */
export interface Selection {
  id: string;
  section: number | null;
}

/** The light being calibrated, and how far along. */
export interface Calibrating {
  id: string;
  step: Step;
  /** Send the test color uncalibrated, to compare. */
  raw: boolean;
}

interface AppState {
  // Persisted
  devices: AddedDevice[];
  enabled: boolean;
  settings: Settings;
  // Runtime
  discovered: GoveeDevice[];
  scanning: boolean;
  scanError: string | null;
  monitors: MonitorInfo[];
  status: EngineStatus;
  selection: Selection | null;
  hoveredLight: string | null;
  hoveredSection: number | null;
  fills: Record<string, boolean>;
  setFill: (id: string, visible: boolean) => void;
  setHoveredLight: (id: string | null, section?: number) => void;
  /** Clicks on the screen add points to the selected section. */
  drawing: boolean;
  /** Picked points of the selected section's path. */
  points: number[];
  /** Layout and color edits to undo, oldest first, and ones undone to redo. */
  past: Snapshot[];
  future: Snapshot[];
  /** While set, the light shows test colors and the screen shows them too. */
  calibrating: Calibrating | null;

  scan: () => Promise<void>;
  loadMonitors: () => Promise<void>;
  /** Add a light across the screen's middle, and select it. */
  addDevice: (d: GoveeDevice) => void;
  removeDevice: (id: string) => void;
  renameDevice: (id: string, name: string) => void;
  renameSection: (id: string, section: number, name?: string) => void;
  setDeviceBrightness: (id: string, brightness: number) => void;
  /** Switch one light on or off, right away and for sync. */
  setPower: (id: string, on: boolean) => void;
  setSectionPower: (id: string, section: number, on: boolean) => void;
  setRazer: (id: string, on: boolean) => void;
  setSegments: (id: string, segments: number) => void;
  /** Color a whole section. Clears its segment overrides. */
  setSectionColor: (id: string, section: number, color: Source) => void;
  /** Override single segments, or clear them with null. */
  setSegmentColors: (id: string, segments: readonly number[], color: Source | null) => void;
  /** Place a section, or clear its path with undefined. */
  setSectionPath: (id: string, section: number, path: LightPath | undefined) => void;
  /** Split a section after `at` of its segments (default: half), and select the new part. */
  splitSection: (id: string, section: number, at?: number) => void;
  /** Join a section with the next. */
  mergeSections: (id: string, section: number) => void;
  /** Select a section. Clears the picked points. */
  select: (s: Selection | null) => void;
  setPoints: (points: number[]) => void;
  /** Start or stop drawing. Stopping drops a path left with under two points. */
  setDrawing: (on: boolean) => void;
  setEnabled: (on: boolean) => void;
  /** Switch every light on or off; turning them off also stops syncing. */
  setAllPower: (on: boolean) => Promise<void>;
  /** Stop syncing and switch every light off. */
  lightsOff: () => Promise<void>;
  setFps: (fps: number) => void;
  setMonitor: (index: number) => void;
  setCanvas: (canvas: CanvasSource) => void;
  setTuning: (t: Partial<Tuning>) => void;
  resetTuning: () => void;
  /** Undo or redo the last layout or color edit. */
  undo: () => void;
  redo: () => void;
  /** End the current edit, so the next change is its own undo step. */
  breakUndo: () => void;
  /** Start calibrating a light, switching it on if it's off. */
  startCalibration: (id: string) => void;
  /** Move to another step, or compare with the uncalibrated color. */
  updateCalibrating: (patch: Partial<Omit<Calibrating, "id">>) => void;
  stopCalibration: () => void;
  /** Set one step's match, or clear it with undefined. */
  setCalibration: (id: string, step: Step, value: Hex | number | undefined) => void;
  resetCalibration: (id: string) => void;
  /** Give the light's calibration to every other light of the same model. */
  copyCalibration: (id: string) => void;
  /** Save the lights and canvas settings to a file the user picks. False if cancelled. */
  exportSetup: () => Promise<boolean>;
  /**
   * Replace the lights and canvas settings with a file the user picks. False
   * if cancelled; throws with a message fit to show if the file is bad.
   */
  importSetup: () => Promise<boolean>;
}

/** Each light's sections and colors, for undo. */
type Snapshot = { id: string; sections: Section[]; segmentColors?: (Source | null)[] }[];

const snapshot = (devices: readonly AddedDevice[]): Snapshot =>
  devices.map(({ id, sections, segmentColors }) => ({ id, sections, segmentColors }));

/** `devices` with sections and colors from `snap`. Lights removed since stay removed. */
const restore = (devices: readonly AddedDevice[], snap: Snapshot): AddedDevice[] =>
  devices.map((d) => {
    const s = snap.find((x) => x.id === d.id);
    return s ? { ...d, sections: s.sections, segmentColors: s.segmentColors } : d;
  });

const UNDO_LIMIT = 100;
/** Changes with the same key this close together are one undo step (a drag, a slider). */
const UNDO_MERGE_MS = 1000;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The screen's width over height, from the latest frame. 16:9 until one arrives. */
export const screenAspect = () => {
  const img = useScreen.getState().image;
  return img ? img.width / img.height : 16 / 9;
};

/** `screenAspect`, re-rendering when it changes. */
export const useScreenAspect = () =>
  useScreen((s) => (s.image ? s.image.width / s.image.height : 16 / 9));

/**
 * Saves once edits settle, and only when the saved part changed: most updates
 * (hover, selection, engine status) don't touch it.
 */
function settledStorage<S extends object>(): PersistStorage<S> {
  let last: S | undefined;
  return {
    getItem: (name) => {
      const raw = readSaved(name);
      return raw ? (JSON.parse(raw) as StorageValue<S>) : null;
    },
    setItem: (name, value) => {
      const s = value.state;
      const was = last;
      if (was && (Object.keys(s) as (keyof S)[]).every((k) => s[k] === was[k])) return;
      last = s;
      saveLater(name, () => JSON.stringify(value));
    },
    removeItem: forget,
  };
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => {
      const edit = (id: string, f: (d: AddedDevice) => AddedDevice) =>
        set((s) => ({ devices: s.devices.map((d) => (d.id === id ? f(d) : d)) }));
      /** Edit a light's fitted sections. */
      const editSections = (id: string, f: (sections: Section[], d: AddedDevice) => Section[]) =>
        edit(id, (d) => ({ ...d, sections: f(sectionsOf(d), d) }));
      let lastKey: string | null = null;
      let lastAt = 0;
      /**
       * Save an undo step before a change. Changes with the same `key` in a row
       * merge into one; no key is always its own step.
       */
      const record = (key: string | null = null) => {
        const now = Date.now();
        const merge = key !== null && key === lastKey && now - lastAt < UNDO_MERGE_MS;
        lastKey = key;
        lastAt = now;
        if (merge) return;
        set((s) => ({
          past: [...s.past.slice(1 - UNDO_LIMIT), snapshot(s.devices)],
          future: [],
        }));
      };
      /** Stop drawing. A path left with under two points is dropped. */
      const endDrawing = () => {
        const { drawing, selection } = get();
        if (!drawing || !selection || selection.section === null) return;
        editSections(selection.id, (sections) =>
          sections.map((s, k) =>
            k === selection.section && s.path && s.path.points.length < 2
              ? { ...s, path: undefined }
              : s,
          ),
        );
        set({ drawing: false });
      };

      return {
        devices: [],
        enabled: false,
        settings: DEFAULT_SETTINGS,
        discovered: [],
        scanning: false,
        scanError: null,
        monitors: [],
        status: { running: false, error: null },
        selection: null,
        hoveredLight: null,
        hoveredSection: null,
        fills: {},
        setFill: (id, visible) => set((s) => ({ fills: { ...s.fills, [id]: visible } })),
        setHoveredLight: (hoveredLight, section) =>
          set({ hoveredLight, hoveredSection: section ?? null }),
        drawing: false,
        points: [],
        past: [],
        future: [],
        calibrating: null,

        scan: async () => {
          if (get().scanning) return;
          set({ scanning: true, scanError: null });
          try {
            const found = await api.discoverDevices();
            // DHCP may have moved a known device: follow it by id.
            const byId = new Map(found.map((d) => [d.id, d]));
            set((s) => ({
              discovered: found,
              devices: s.devices.map((d) => {
                const f = byId.get(d.id);
                return f && f.ip !== d.ip ? { ...d, ip: f.ip } : d;
              }),
            }));
          } catch (e) {
            set({ scanError: errorText(e) });
          } finally {
            set({ scanning: false });
          }
        },

        loadMonitors: async () => {
          try {
            set({ monitors: await api.listMonitors() });
          } catch {
            set({ monitors: [] });
          }
        },

        addDevice: (d) =>
          set((s) =>
            s.devices.some((x) => x.id === d.id)
              ? s
              : {
                  devices: [
                    ...s.devices,
                    {
                      ...d,
                      name: d.sku || d.id,
                      on: true,
                      brightness: 1,
                      razer: false,
                      sections: [{ count: 1, color: "path", path: linePath() }],
                    },
                  ],
                  selection: { id: d.id, section: null },
                  drawing: false,
                  points: [],
                },
          ),
        removeDevice: (id) =>
          set((s) => ({
            devices: s.devices.filter((d) => d.id !== id),
            selection: s.selection?.id === id ? null : s.selection,
            drawing: s.selection?.id === id ? false : s.drawing,
            points: s.selection?.id === id ? [] : s.points,
          })),
        renameDevice: (id, name) => edit(id, (d) => ({ ...d, name })),
        renameSection: (id, section, name) =>
          edit(id, (d) => ({
            ...d,
            sections: d.sections.map((s, k) => (k === section ? { ...s, name } : s)),
          })),
        setDeviceBrightness: (id, brightness) => edit(id, (d) => ({ ...d, brightness })),
        setPower: (id, on) => {
          edit(id, (d) => ({ ...d, on }));
          const d = get().devices.find((x) => x.id === id);
          if (d) api.setPower(d.ip, on).catch((e) => console.error("set_power", e));
        },
        setRazer: (id, razer) => {
          edit(id, (d) => ({ ...d, razer }));
          // Without razer mode a light is one section: keep the selection on it.
          const sel = get().selection;
          if (!razer && sel?.id === id && sel.section !== null)
            set({ selection: { id, section: 0 }, points: [], drawing: false });
        },
        setSectionPower: (id, section, on) => {
          record();
          editSections(id, (sections) =>
            sections.map((s, k) => (k === section ? { ...s, on } : s)),
          );
        },
        setSegments: (id, segments) => {
          edit(id, (d) => ({ ...d, segments }));
          const sel = get().selection;
          const d = get().devices.find((x) => x.id === id);
          if (d && sel?.id === id && sel.section !== null && sel.section >= sectionsOf(d).length) {
            set({ selection: { id, section: sectionsOf(d).length - 1 } });
          }
        },
        setSectionColor: (id, section, color) => {
          record();
          edit(id, (d) => {
            const sections = sectionsOf(d);
            const target = sections[section];
            if (!target) return d;
            const start = sectionStarts(sections)[section] as number;
            const segmentColors = d.segmentColors?.map((c, i) =>
              i >= start && i < start + target.count ? null : c,
            );
            return {
              ...d,
              sections: sections.map((s, k) => (k === section ? { ...s, color } : s)),
              segmentColors,
            };
          });
        },
        setSegmentColors: (id, segments, color) => {
          record();
          edit(id, (d) => {
            const segmentColors = [...(d.segmentColors ?? [])];
            for (const i of segments) segmentColors[i] = color;
            return { ...d, segmentColors: Array.from(segmentColors, (c) => c ?? null) };
          });
        },
        setSectionPath: (id, section, path) => {
          if (!get().drawing) record(`path:${id}:${section}`);
          // A fitted path remembers the screen's shape, to keep its proportions.
          const saved = path?.fit && !path.aspect ? { ...path, aspect: screenAspect() } : path;
          editSections(id, (sections) =>
            sections.map((s, k) => (k === section ? { ...s, path: saved } : s)),
          );
        },
        splitSection: (id, section, at) => {
          record();
          editSections(id, (sections) => splitSection(sections, section, at));
          const d = get().devices.find((x) => x.id === id);
          if (d && sectionsOf(d).length > section + 1) {
            set({ selection: { id, section: section + 1 }, drawing: false, points: [] });
          }
        },
        mergeSections: (id, section) => {
          record();
          editSections(id, (sections) => mergeSections(sections, section));
          const sel = get().selection;
          if (sel?.id === id && sel.section !== null && sel.section > section) {
            set({ selection: { id, section: sel.section - 1 }, drawing: false, points: [] });
          }
        },
        select: (selection) => {
          endDrawing();
          const same =
            selection?.id === get().selection?.id &&
            selection?.section === get().selection?.section;
          set({ selection, hoveredLight: null, drawing: false, points: same ? get().points : [] });
        },
        setPoints: (points) => set({ points }),
        setDrawing: (drawing) => {
          if (!drawing) return endDrawing();
          if (get().selection?.section == null) return;
          // The whole drawing is one undo step.
          record();
          set({ drawing, points: [] });
        },
        setEnabled: (enabled) => set({ enabled }),
        setAllPower: async (on) => {
          if (!on) return get().lightsOff();
          const devices = get().devices;
          set({ devices: devices.map((d) => ({ ...d, on: true })) });
          await Promise.all(devices.map((d) => api.setPower(d.ip, true)));
        },
        lightsOff: async () => {
          set((s) => ({
            enabled: false,
            devices: s.devices.map((d) => ({ ...d, on: false })),
          }));
          await api.lightsOff(get().devices.map((d) => d.ip));
        },
        setFps: (fps) => set((s) => ({ settings: { ...s.settings, fps } })),
        setMonitor: (monitor) => set((s) => ({ settings: { ...s.settings, monitor } })),
        setCanvas: (canvas) => set((s) => ({ settings: { ...s.settings, canvas } })),
        setTuning: (t) =>
          set((s) => ({ settings: { ...s.settings, tuning: { ...s.settings.tuning, ...t } } })),
        resetTuning: () =>
          set((s) => ({ settings: { ...s.settings, tuning: DEFAULT_SETTINGS.tuning } })),
        undo: () => {
          const { past, drawing } = get();
          const prev = past[past.length - 1];
          if (!prev || drawing) return;
          lastKey = null;
          set((s) => ({
            past: s.past.slice(0, -1),
            future: [...s.future, snapshot(s.devices)],
            devices: restore(s.devices, prev),
            points: [],
          }));
        },
        redo: () => {
          const { future, drawing } = get();
          const next = future[future.length - 1];
          if (!next || drawing) return;
          lastKey = null;
          set((s) => ({
            future: s.future.slice(0, -1),
            past: [...s.past, snapshot(s.devices)],
            devices: restore(s.devices, next),
            points: [],
          }));
        },
        breakUndo: () => {
          lastKey = null;
        },
        startCalibration: (id) => {
          const d = get().devices.find((x) => x.id === id);
          if (!d) return;
          endDrawing();
          if (!d.on) get().setPower(id, true);
          set({ calibrating: { id, step: "white", raw: false } });
        },
        updateCalibrating: (patch) =>
          set((s) => (s.calibrating ? { calibrating: { ...s.calibrating, ...patch } } : s)),
        stopCalibration: () => set({ calibrating: null }),
        setCalibration: (id, step, value) =>
          edit(id, (d) => ({ ...d, calibration: withStep(d.calibration, step, value) })),
        resetCalibration: (id) => edit(id, (d) => ({ ...d, calibration: undefined })),
        copyCalibration: (id) =>
          set((s) => {
            const from = s.devices.find((d) => d.id === id);
            if (!from) return s;
            return {
              devices: s.devices.map((d) =>
                d.sku === from.sku && d.id !== id ? { ...d, calibration: from.calibration } : d,
              ),
            };
          }),
        exportSetup: async () => {
          const { devices, settings } = get();
          return api.exportSetup(SETUP_FILE_NAME, setupText({ devices, settings }, VERSION));
        },
        importSetup: async () => {
          const text = await api.importSetup();
          if (text === null) return false;
          const { state, version } = readSetupText(text, VERSION);
          const { devices, settings } = migrate(state, version);
          endDrawing();
          lastKey = null;
          set({
            devices,
            settings: {
              ...DEFAULT_SETTINGS,
              ...settings,
              tuning: { ...DEFAULT_SETTINGS.tuning, ...settings.tuning },
            },
            selection: null,
            drawing: false,
            points: [],
            // Undo steps belong to the lights just replaced.
            past: [],
            future: [],
            calibrating: null,
          });
          // The lights may have moved on the network since the file was saved.
          void get().scan();
          return true;
        },
      };
    },
    {
      name: "tk-light-mini",
      version: VERSION,
      migrate: (old, version) => migrate(old, version),
      partialize: (s) => ({ devices: s.devices, enabled: s.enabled, settings: s.settings }),
      storage: settledStorage(),
    },
  ),
);

/** A saved device before v7: one color, maybe a zone, and one path. */
type V6Device = Omit<AddedDevice, "sections" | "segmentColors"> & {
  color?: string;
  zone?: string;
  path?: LightPath;
  whiteLeds?: boolean;
  segmentColors?: (string | null)[];
};

const OLD_ZONES = new Set(["top", "left", "bottom", "right", "all", "center"]);
const isHex = (c: unknown): c is `#${string}` => typeof c === "string" && c.startsWith("#");

/** Bring saved state from `version` up to date. */
export function migrate(old: unknown, version: number): AppState {
  const s = old as {
    devices?: V6Device[];
    settings?: Settings & { tuning: Tuning & { depth?: number } };
  };
  if (version < 7 && s.devices) {
    const depth = s.settings?.tuning.depth ?? 0.15;
    const width = Math.min(Math.max(depth, 0.02), 0.4);
    s.devices = s.devices.map(({ whiteLeds: _, zone, color: c, path, segmentColors, ...d }) => {
      // v5 and older: `zone`, before it became `color`.
      const color = c ?? zone ?? "all";
      let sectionPath = path;
      if (!sectionPath && OLD_ZONES.has(color)) {
        sectionPath = zonePath(color as OldZone, 16 / 9, width);
      }
      const section: Section = {
        count: 1,
        color: isHex(color) ? color : "path",
        path: sectionPath,
      };
      return {
        ...d,
        brightness: d.brightness ?? 1,
        on: d.on ?? true,
        razer: d.razer ?? false,
        sections: [section],
        // Old zone overrides follow the path now.
        segmentColors: segmentColors?.map((x) => (isHex(x) || x === "path" ? x : null)),
      } satisfies AddedDevice;
    }) as unknown as V6Device[];
  }
  if (version < 7 && s.settings?.tuning) {
    const { depth: _, ...tuning } = s.settings.tuning;
    s.settings = { ...s.settings, tuning };
  }
  // v8: the lights follow a canvas, the screen until picked otherwise.
  if (version < 8 && s.settings) {
    s.settings = { ...s.settings, canvas: s.settings.canvas ?? "screen" };
  }
  // v9: Corsair lights through iCUE are gone.
  if (version < 9 && s.devices) {
    s.devices = s.devices.filter((d) => !d.ip.startsWith("icue:"));
  }
  return s as unknown as AppState;
}

/**
 * Live path colors by light IP, one per segment. Split out so 10 Hz updates
 * only re-render what shows them.
 */
export const useLive = create<{ paths: Record<string, Rgb[]> }>(() => ({ paths: {} }));

/**
 * The engine's small canvas frame: the screen capture or a painted scene,
 * shared by every component. Updated 4 to 10 times a second while the window
 * is visible.
 */
export const useScreen = create<{ image: ScreenImage | null }>(() => ({ image: null }));

type EngineDevice = EngineConfig["devices"][number];

/**
 * A light while calibrating: every segment shows `color`, calibrated unless
 * `raw`, and nothing is sampled.
 */
function testDevice(d: AddedDevice, color: Hex, raw: boolean): EngineDevice {
  return {
    ip: d.ip,
    brightness: d.brightness,
    razer: d.razer,
    segments: Array(segmentCount(d)).fill(color),
    sections: sectionsOf(d).map((s) => ({ path: null, count: s.count })),
    calibration: resolveCalibration(raw ? undefined : d.calibration),
  };
}

/**
 * What the engine needs, with paths fitted to a screen `aspect` wide.
 *
 * While calibrating, the light shows the step's test color, even with sync
 * off. With sync on, the other lights go dark, so only its glow is on the wall.
 */
export function toEngineConfig(
  s: Pick<AppState, "enabled" | "settings" | "devices"> & Partial<Pick<AppState, "calibrating">>,
  aspect = 16 / 9,
): EngineConfig {
  const cal = s.calibrating;
  const testing = cal ? s.devices.find((d) => d.id === cal.id) : undefined;
  const base = {
    enabled: s.enabled || testing !== undefined,
    fps: s.settings.fps,
    monitor: s.settings.monitor,
    canvas: s.settings.canvas,
    tuning: s.settings.tuning,
  };
  if (cal && testing) {
    const others = s.enabled ? s.devices.filter((d) => d.on && d !== testing) : [];
    return {
      ...base,
      devices: [
        testDevice(testing, rgbHex(testColor(cal.step)), cal.raw),
        ...others.map((d) => testDevice(d, "#000000", true)),
      ],
    };
  }
  return {
    ...base,
    devices: s.devices
      .filter((d) => d.on)
      .map((d) => {
        const segments = segmentSources(d);
        const sections = sectionsOf(d);
        const starts = sectionStarts(sections);
        sections.forEach((section, k) => {
          if (section.on === false) {
            const start = starts[k] ?? 0;
            segments.fill("#000000", start, start + section.count);
          }
        });
        return {
          ip: d.ip,
          brightness: d.brightness,
          razer: d.razer,
          segments,
          sections: sections.map((sec, k) => {
            const start = starts[k] as number;
            const used = segments.slice(start, start + sec.count).includes("path");
            const path = used && sec.path ? resolvePath(sec.path, aspect) : null;
            return { path, count: sec.count };
          }),
          calibration: resolveCalibration(d.calibration),
        };
      }),
  };
}
