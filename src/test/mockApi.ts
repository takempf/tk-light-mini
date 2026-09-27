import { vi } from "vitest";
import type { EngineStatus, ZoneColors } from "../lib/types";

/** Callbacks captured from the mocked event listeners. */
export const listeners: {
  zones?: (c: ZoneColors) => void;
  status?: (s: EngineStatus) => void;
} = {};

/** Mock for `src/lib/api`. Load it via dynamic import inside the `vi.mock` factory. */
export function mockApiModule() {
  return {
    api: {
      discoverDevices: vi.fn(async () => []),
      listMonitors: vi.fn(async () => []),
      setConfig: vi.fn(async () => {}),
      setPreview: vi.fn(async () => {}),
      identifyDevice: vi.fn(async () => {}),
      lightsOff: vi.fn(async () => {}),
      onZones: vi.fn(async (cb: (c: ZoneColors) => void) => {
        listeners.zones = cb;
        return () => {};
      }),
      onStatus: vi.fn(async (cb: (s: EngineStatus) => void) => {
        listeners.status = cb;
        return () => {};
      }),
      minimize: vi.fn(async () => {}),
      toggleMaximize: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      isMaximized: vi.fn(async () => false),
      onResized: vi.fn(async () => () => {}),
    },
  };
}
