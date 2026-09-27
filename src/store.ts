import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "./lib/api";
import {
  type AddedDevice,
  defaultSegments,
  type EngineConfig,
  type EngineStatus,
  type GoveeDevice,
  type MonitorInfo,
  type Settings,
  type Tuning,
  type Zone,
  type ZoneColors,
} from "./lib/types";

export const DEFAULT_SETTINGS: Settings = {
  fps: 30,
  monitor: 0,
  tuning: { saturation: 1.3, brightness: 1, depth: 0.15, smoothing: 0.5 },
};

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

  scan: () => Promise<void>;
  loadMonitors: () => Promise<void>;
  addDevice: (d: GoveeDevice) => void;
  removeDevice: (id: string) => void;
  setZone: (id: string, zone: Zone) => void;
  renameDevice: (id: string, name: string) => void;
  setDeviceBrightness: (id: string, brightness: number) => void;
  /** Switch one light on or off, right away and for sync. */
  setPower: (id: string, on: boolean) => void;
  setRazer: (id: string, on: boolean) => void;
  setSegments: (id: string, segments: number) => void;
  setEnabled: (on: boolean) => void;
  /** Stop syncing and switch every light off. */
  lightsOff: () => Promise<void>;
  setFps: (fps: number) => void;
  setMonitor: (index: number) => void;
  setTuning: (t: Partial<Tuning>) => void;
  resetTuning: () => void;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      devices: [],
      enabled: false,
      settings: DEFAULT_SETTINGS,
      discovered: [],
      scanning: false,
      scanError: null,
      monitors: [],
      status: { running: false, error: null },

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
                    zone: "all",
                    brightness: 1,
                    razer: false,
                  },
                ],
              },
        ),
      removeDevice: (id) => set((s) => ({ devices: s.devices.filter((d) => d.id !== id) })),
      setZone: (id, zone) =>
        set((s) => ({ devices: s.devices.map((d) => (d.id === id ? { ...d, zone } : d)) })),
      renameDevice: (id, name) =>
        set((s) => ({ devices: s.devices.map((d) => (d.id === id ? { ...d, name } : d)) })),
      setDeviceBrightness: (id, brightness) =>
        set((s) => ({ devices: s.devices.map((d) => (d.id === id ? { ...d, brightness } : d)) })),
      setPower: (id, on) => {
        set((s) => ({ devices: s.devices.map((d) => (d.id === id ? { ...d, on } : d)) }));
        const d = get().devices.find((x) => x.id === id);
        if (d) api.setPower(d.ip, on).catch((e) => console.error("set_power", e));
      },
      setRazer: (id, razer) =>
        set((s) => ({ devices: s.devices.map((d) => (d.id === id ? { ...d, razer } : d)) })),
      setSegments: (id, segments) =>
        set((s) => ({ devices: s.devices.map((d) => (d.id === id ? { ...d, segments } : d)) })),
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
    }),
    {
      name: "tk-light-mini",
      version: 5,
      migrate: (old, version) => {
        const s = old as { devices?: AddedDevice[] };
        if (version < 2 && s.devices) {
          s.devices = s.devices.map((d) => ({ ...d, brightness: d.brightness ?? 1 }));
        }
        if (version < 4 && s.devices) {
          s.devices = s.devices.map((d) => ({ ...d, on: d.on ?? true }));
        }
        if (version < 5 && s.devices) {
          // v3-4 had an experimental `whiteLeds` flag, replaced by razer mode.
          s.devices = s.devices.map(
            ({ whiteLeds: _, ...d }: AddedDevice & { whiteLeds?: boolean }) => ({
              ...d,
              razer: d.razer ?? false,
            }),
          );
        }
        return s as AppState;
      },
      partialize: (s) => ({ devices: s.devices, enabled: s.enabled, settings: s.settings }),
    },
  ),
);

/** Live zone colors, split out so 10 Hz updates only re-render the preview. */
export const useZoneColors = create<{ colors: ZoneColors | null }>(() => ({ colors: null }));

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
      .map(({ ip, zone, brightness, sku, razer, segments }) => ({
        ip,
        zone,
        brightness,
        razer,
        segments: segments ?? defaultSegments(sku),
      })),
  };
}
