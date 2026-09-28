import { vi } from "vitest";
import type { EngineStatus, Rgb, ScreenImage } from "../lib/types";

/** Callbacks captured from the mocked event listeners. */
export const listeners: {
  paths?: (p: { ip: string; colors: Rgb[] }[]) => void;
  screen?: (s: ScreenImage) => void;
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
      setPower: vi.fn(async () => {}),
      lightsOff: vi.fn(async () => {}),
      onPaths: vi.fn(async (cb: (p: { ip: string; colors: Rgb[] }[]) => void) => {
        listeners.paths = cb;
        return () => {};
      }),
      onScreen: vi.fn(async (cb: (s: ScreenImage) => void) => {
        listeners.screen = cb;
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
