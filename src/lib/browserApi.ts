import { decodePreview, type Preview } from "./preview";
import type { EngineConfig, GoveeDevice, LightFrameSource, MonitorInfo } from "./types";

export interface ServerSetup {
  version: number;
  revision: number;
  enabled: boolean;
  devices: import("./types").AddedDevice[];
  source: LightFrameSource;
  tuning: import("./types").Tuning;
  fps: number;
}
export interface SenderStatus {
  id: string;
  name: string;
  online: boolean;
  width: number | null;
  height: number | null;
}

const token = () => localStorage.getItem("tk-light-admin-token") ?? "";
let previewTarget: { id: string; section: number | null } | null = null;
/** The preview target the last poll asked for. */
let askedTarget = "";
/** Ends the poll in flight when the target changes, so the new frame comes at once. */
let retarget = new AbortController();
async function send(path: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, {
    ...options,
    headers: {
      authorization: `Bearer ${token()}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? res.statusText);
  }
  return res;
}
const request = async <T>(path: string, options: RequestInit = {}): Promise<T> =>
  (await send(path, options)).json() as Promise<T>;

export const browserApi = {
  setPreviewTarget: (target: { id: string; section: number | null } | null) => {
    const same = target?.id === previewTarget?.id && target?.section === previewTarget?.section;
    previewTarget = target;
    if (same) return;
    retarget.abort();
    retarget = new AbortController();
  },
  getSetup: () => request<ServerSetup>("/api/setup"),
  saveSetup: (setup: ServerSetup, expectedRevision: number) =>
    request<ServerSetup>("/api/setup", {
      method: "PUT",
      body: JSON.stringify({ setup, expectedRevision }),
    }),
  getStatus: () =>
    request<{ senders: SenderStatus[]; running: boolean; error: string | null }>("/api/status"),
  discoverDevices: () => request<GoveeDevice[]>("/api/scan", { method: "POST" }),
  probeDevice: (ip: string) =>
    request<GoveeDevice>("/api/probe", { method: "POST", body: JSON.stringify({ ip }) }),
  setCalibrationOverride: (id?: string, color?: string, raw?: boolean) =>
    request("/api/calibration", { method: "POST", body: JSON.stringify({ id, color, raw }) }),
  listMonitors: async (): Promise<MonitorInfo[]> => [],
  setConfig: async (_config: EngineConfig) => {},
  setPreview: async (_enabled: boolean) => {},
  identifyDevice: async (ip: string) => {
    const setup = await browserApi.getSetup();
    const device = setup.devices.find((d) => d.ip === ip);
    if (device)
      await request(`/api/devices/${encodeURIComponent(device.id)}/identify`, { method: "POST" });
  },
  setPower: async (ip: string, on: boolean) => {
    await request("/api/power-now", { method: "POST", body: JSON.stringify({ ip, on }) });
  },
  lightsOff: async (_ips: string[]) => {
    await request("/api/lights-off-now", { method: "POST" });
  },
  exportSetup: async (name: string, text: string) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    return true;
  },
  importSetup: async (): Promise<string | null> =>
    new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.onchange = () => {
        const file = input.files?.[0];
        if (file) void file.text().then(resolve);
        else resolve(null);
      };
      input.oncancel = () => resolve(null);
      input.click();
    }),
  autostart: async () => false,
  setAutostart: async (_on: boolean) => {},
  version: async () => "server",
  checkUpdate: async () => null,
  installUpdate: async () => {},
  /** Waits on the server until something changes, as the desktop app's does. */
  nextPreview: async (after: number): Promise<Preview> => {
    for (;;) {
      const { signal } = retarget;
      const params = new URLSearchParams();
      if (previewTarget) {
        params.set("device", previewTarget.id);
        if (previewTarget.section !== null) params.set("section", String(previewTarget.section));
      }
      // This target's frame may not have come yet: ask for everything.
      const target = params.toString();
      params.set("after", String(target === askedTarget ? after : 0));
      askedTarget = target;
      try {
        return decodePreview(
          await (await send(`/api/preview?${params}`, { signal })).arrayBuffer(),
        );
      } catch (error) {
        // Ask again, for the new target.
        if (!signal.aborted) throw error;
      }
    }
  },
  minimize: async () => {},
  toggleMaximize: async () => {},
  close: async () => {},
  isMaximized: async () => false,
  onResized: async (_cb: () => void) => () => {},
  fullscreen: async () => {
    await document.documentElement.requestFullscreen();
    return async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
    };
  },
};
