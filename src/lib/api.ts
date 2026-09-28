import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  EngineConfig,
  EngineStatus,
  GoveeDevice,
  MonitorInfo,
  Rgb,
  ScreenImage,
} from "./types";

const decodeRgb = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Thin wrapper over Tauri IPC, so tests can mock one module. */
export const api = {
  discoverDevices: () => invoke<GoveeDevice[]>("discover_devices"),
  listMonitors: () => invoke<MonitorInfo[]>("list_monitors"),
  setConfig: (config: EngineConfig) => invoke<void>("set_config", { config }),
  setPreview: (enabled: boolean) => invoke<void>("set_preview", { enabled }),
  identifyDevice: (ip: string) => invoke<void>("identify_device", { ip }),
  setPower: (ip: string, on: boolean) => invoke<void>("set_power", { ip, on }),
  lightsOff: (ips: string[]) => invoke<void>("lights_off", { ips }),
  onPaths: (cb: (p: { ip: string; colors: Rgb[] }[]) => void): Promise<UnlistenFn> =>
    listen<{ ip: string; colors: Rgb[] }[]>("paths", (e) => cb(e.payload)),
  onScreen: (cb: (s: ScreenImage) => void): Promise<UnlistenFn> =>
    listen<{ width: number; height: number; rgb: string }>("screen", (e) =>
      cb({ ...e.payload, rgb: decodeRgb(e.payload.rgb) }),
    ),
  onStatus: (cb: (s: EngineStatus) => void): Promise<UnlistenFn> =>
    listen<EngineStatus>("engine-status", (e) => cb(e.payload)),
  minimize: async () => getCurrentWindow().minimize(),
  toggleMaximize: async () => getCurrentWindow().toggleMaximize(),
  close: async () => getCurrentWindow().close(),
  isMaximized: async () => getCurrentWindow().isMaximized(),
  onResized: async (cb: () => void): Promise<UnlistenFn> => getCurrentWindow().onResized(cb),
};
