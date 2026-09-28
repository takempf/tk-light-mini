import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "./lib/api";
import {
  mergeSections,
  sectionStarts,
  sectionsOf,
  segmentSources,
  splitSection,
} from "./lib/lights";
import { edgeLoop, type OldZone, zonePath } from "./lib/path";
import type {
  AddedDevice,
  EngineConfig,
  EngineStatus,
  GoveeDevice,
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
  tuning: { saturation: 1.3, brightness: 1, smoothing: 0.5 },
};

/** The section being edited. */
export interface Selection {
  id: string;
  section: number;
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
  /** Clicks on the screen add points to the selected section. */
  drawing: boolean;
  /** Picked points of the selected section's path. */
  points: number[];
  /** Layout and color edits to undo, oldest first, and ones undone to redo. */
  past: Snapshot[];
  future: Snapshot[];

  scan: () => Promise<void>;
  loadMonitors: () => Promise<void>;
  /** Add a light around the screen's edge, and select it. */
  addDevice: (d: GoveeDevice) => void;
  removeDevice: (id: string) => void;
  renameDevice: (id: string, name: string) => void;
  setDeviceBrightness: (id: string, brightness: number) => void;
  /** Switch one light on or off, right away and for sync. */
  setPower: (id: string, on: boolean) => void;
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
  /** Stop syncing and switch every light off. */
  lightsOff: () => Promise<void>;
  setFps: (fps: number) => void;
  setMonitor: (index: number) => void;
  setTuning: (t: Partial<Tuning>) => void;
  resetTuning: () => void;
  /** Undo or redo the last layout or color edit. */
  undo: () => void;
  redo: () => void;
  /** End the current edit, so the next change is its own undo step. */
  breakUndo: () => void;
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

/** The screen's shape, from the latest frame. */
const aspect = () => {
  const img = useScreen.getState().image;
  return img ? img.width / img.height : 16 / 9;
};

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
        if (!drawing || !selection) return;
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
        drawing: false,
        points: [],
        past: [],
        future: [],

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
                      sections: [{ count: 1, color: "path", path: edgeLoop(aspect(), 0.12) }],
                    },
                  ],
                  selection: { id: d.id, section: 0 },
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
          if (!razer && sel?.id === id) set({ selection: { id, section: 0 } });
        },
        setSegments: (id, segments) => {
          edit(id, (d) => ({ ...d, segments }));
          const sel = get().selection;
          const d = get().devices.find((x) => x.id === id);
          if (d && sel?.id === id && sel.section >= sectionsOf(d).length) {
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
          editSections(id, (sections) =>
            sections.map((s, k) => (k === section ? { ...s, path } : s)),
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
          if (sel?.id === id && sel.section > section) {
            set({ selection: { id, section: sel.section - 1 }, drawing: false, points: [] });
          }
        },
        select: (selection) => {
          endDrawing();
          const same =
            selection?.id === get().selection?.id &&
            selection?.section === get().selection?.section;
          set({ selection, drawing: false, points: same ? get().points : [] });
        },
        setPoints: (points) => set({ points }),
        setDrawing: (drawing) => {
          if (!drawing) return endDrawing();
          // The whole drawing is one undo step.
          record();
          set({ drawing, points: [] });
        },
        setEnabled: (enabled) => set({ enabled }),
        lightsOff: async () => {
          set({ enabled: false });
          await api.lightsOff(get().devices.map((d) => d.ip));
        },
        setFps: (fps) => set((s) => ({ settings: { ...s.settings, fps } })),
        setMonitor: (monitor) => set((s) => ({ settings: { ...s.settings, monitor } })),
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
      };
    },
    {
      name: "tk-light-mini",
      version: 7,
      migrate: (old, version) => migrate(old, version),
      partialize: (s) => ({ devices: s.devices, enabled: s.enabled, settings: s.settings }),
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
  return s as unknown as AppState;
}

/**
 * Live path colors by light IP, one per segment. Split out so 10 Hz updates
 * only re-render what shows them.
 */
export const useLive = create<{ paths: Record<string, Rgb[]> }>(() => ({ paths: {} }));

/**
 * The engine's small screen frame: the one capture, shared by every component.
 * Updated about 4 times a second while the window is visible.
 */
export const useScreen = create<{ image: ScreenImage | null }>(() => ({ image: null }));

export function toEngineConfig(
  s: Pick<AppState, "enabled" | "settings" | "devices">,
): EngineConfig {
  return {
    enabled: s.enabled,
    fps: s.settings.fps,
    monitor: s.settings.monitor,
    tuning: s.settings.tuning,
    devices: s.devices
      .filter((d) => d.on)
      .map((d) => {
        const segments = segmentSources(d);
        const sections = sectionsOf(d);
        const starts = sectionStarts(sections);
        return {
          ip: d.ip,
          brightness: d.brightness,
          razer: d.razer,
          segments,
          sections: sections.map((sec, k) => {
            const start = starts[k] as number;
            const used = segments.slice(start, start + sec.count).includes("path");
            return { path: used ? (sec.path ?? null) : null, count: sec.count };
          }),
        };
      }),
  };
}
