import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startAdminSession } from "./adminSync";
import { browserApi, type ServerSetup } from "./lib/browserApi";
import { DEFAULT_SETTINGS, useStore } from "./store";

vi.mock("./lib/browserApi", () => ({
  browserApi: {
    getSetup: vi.fn(),
    saveSetup: vi.fn(),
    setPreviewTarget: vi.fn(),
    setCalibrationOverride: vi.fn(async () => ({})),
  },
}));
vi.mock("./sync", () => ({ startSync: vi.fn(() => () => {}) }));

const base: ServerSetup = {
  version: 1,
  revision: 4,
  enabled: false,
  devices: [],
  source: { kind: "scene", scene: "forest" },
  fps: 30,
  tuning: DEFAULT_SETTINGS.tuning,
};
let stop = () => {};
beforeEach(() => {
  vi.useFakeTimers();
  useStore.setState({ devices: [], enabled: false, settings: DEFAULT_SETTINGS, calibrating: null });
  vi.mocked(browserApi.getSetup).mockResolvedValue(structuredClone(base));
  vi.mocked(browserApi.saveSetup).mockImplementation(async (setup, revision) => ({
    ...setup,
    revision: revision + 1,
  }));
});
afterEach(() => {
  stop();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("loads server setup and saves a canvas edit with its revision", async () => {
  const ready = vi.fn(),
    error = vi.fn();
  stop = startAdminSession(error, ready);
  await Promise.resolve();
  expect(ready).toHaveBeenCalledOnce();
  expect(useStore.getState().settings.canvas).toBe("forest");
  useStore.getState().setCanvas("sunset");
  await vi.advanceTimersByTimeAsync(350);
  expect(browserApi.saveSetup).toHaveBeenCalledWith(
    expect.objectContaining({ source: { kind: "scene", scene: "sunset" } }),
    4,
  );
});

it("stops saving after a revision conflict", async () => {
  const error = vi.fn();
  vi.mocked(browserApi.saveSetup).mockRejectedValue(new Error("Revision conflict"));
  stop = startAdminSession(error, () => {});
  await Promise.resolve();
  useStore.getState().setCanvas("sunset");
  await vi.advanceTimersByTimeAsync(350);
  useStore.getState().setCanvas("aurora");
  await vi.advanceTimersByTimeAsync(350);
  expect(browserApi.saveSetup).toHaveBeenCalledTimes(1);
  expect(error).toHaveBeenCalledWith(expect.stringContaining("Revision conflict"));
});
