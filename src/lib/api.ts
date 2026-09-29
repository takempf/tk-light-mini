import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import { decodePreview, type Preview } from "./preview";
import type { EngineConfig, GoveeDevice, MonitorInfo } from "./types";

/** Thin wrapper over Tauri IPC, so tests can mock one module. */
export const api = {
  discoverDevices: () => invoke<GoveeDevice[]>("discover_devices"),
  listMonitors: () => invoke<MonitorInfo[]>("list_monitors"),
  setConfig: (config: EngineConfig) => invoke<void>("set_config", { config }),
  setPreview: (enabled: boolean) => invoke<void>("set_preview", { enabled }),
  identifyDevice: (ip: string) => invoke<void>("identify_device", { ip }),
  setPower: (ip: string, on: boolean) => invoke<void>("set_power", { ip, on }),
  lightsOff: (ips: string[]) => invoke<void>("lights_off", { ips }),
  /** Ask where to save `text`, suggesting `name`, and save it. False if cancelled. */
  exportSetup: (name: string, text: string) => invoke<boolean>("export_setup", { name, text }),
  /** Ask for a setup file and read it. Null if cancelled. */
  importSetup: () => invoke<string | null>("import_setup"),
  /**
   * What changed in the engine's status, live colors and screen image after
   * `after`. Waits up to a second for something to. Raw bytes, not an event:
   * Tauri delivers events by eval'ing script.
   */
  nextPreview: async (after: number): Promise<Preview> =>
    decodePreview(await invoke<ArrayBuffer>("next_preview", { after })),
  minimize: async () => getCurrentWindow().minimize(),
  toggleMaximize: async () => getCurrentWindow().toggleMaximize(),
  close: async () => getCurrentWindow().close(),
  isMaximized: async () => getCurrentWindow().isMaximized(),
  onResized: async (cb: () => void): Promise<UnlistenFn> => getCurrentWindow().onResized(cb),
  /**
   * Fill the monitor `monitor` names (as `listMonitors` does), or the window's
   * own. Resolves to a function that puts the window back.
   */
  fullscreen: async (monitor?: string): Promise<() => Promise<void>> => {
    const w = getCurrentWindow();
    const [position, maximized] = await Promise.all([w.outerPosition(), w.isMaximized()]);
    // Windows names them `\.\DISPLAY1`; `listMonitors` drops the prefix.
    const target = monitor
      ? (await availableMonitors()).find((m) => m.name?.endsWith(`\${monitor}`))
      : undefined;
    if (target) {
      if (maximized) await w.unmaximize();
      await w.setPosition(target.position);
    }
    await w.setFullscreen(true);
    return async () => {
      await w.setFullscreen(false);
      if (!target) return;
      await w.setPosition(position);
      if (maximized) await w.maximize();
    };
  },
};
