import type { Preview } from "./preview";
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
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
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
  return res.json() as Promise<T>;
}

function decodeImage(image: { width: number; height: number; bgra: string }) {
  const bytes = Uint8Array.from(atob(image.bgra), (c) => c.charCodeAt(0));
  for (let i = 0; i < bytes.length; i += 4)
    [bytes[i], bytes[i + 2]] = [bytes[i + 2] as number, bytes[i] as number];
  return { width: image.width, height: image.height, rgba: new Uint8ClampedArray(bytes.buffer) };
}

export const browserApi = {
  setPreviewTarget: (target: { id: string; section: number | null } | null) => {
    previewTarget = target;
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
  nextPreview: async (_after: number): Promise<Preview> => {
    const data = await request<{
      seq: number;
      status: Preview["status"];
      paths: Record<string, import("./types").Rgb[]>;
      image: { width: number; height: number; bgra: string } | null;
    }>(
      previewTarget
        ? `/api/preview?device=${encodeURIComponent(previewTarget.id)}${previewTarget.section === null ? "" : `&section=${previewTarget.section}`}`
        : "/api/preview",
    );
    await new Promise((r) => setTimeout(r, 250));
    return {
      seq: data.seq,
      status: data.status,
      paths: Object.entries(data.paths).map(([ip, colors]) => ({ ip, colors })),
      image: data.image ? decodeImage(data.image) : null,
    };
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
