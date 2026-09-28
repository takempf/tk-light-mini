import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./lib/api";
import type { Rgb } from "./lib/types";
import { DEFAULT_SETTINGS, useStore, useZoneColors } from "./store";
import { startSync } from "./sync";
import { listeners } from "./test/mockApi";

vi.mock("./lib/api", async () => (await import("./test/mockApi")).mockApiModule());

beforeEach(() => {
  useStore.setState({ devices: [], enabled: false, settings: DEFAULT_SETTINGS });
  useZoneColors.setState({ colors: null });
});

describe("startSync", () => {
  it("pushes config on change and skips unrelated updates", () => {
    const stop = startSync();
    expect(api.setConfig).toHaveBeenCalledTimes(1);
    useStore.getState().setEnabled(true);
    expect(api.setConfig).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.setConfig).mock.lastCall?.[0].enabled).toBe(true);
    useStore.setState({ scanning: true }); // not part of engine config
    expect(api.setConfig).toHaveBeenCalledTimes(2);
    stop();
  });

  it("mirrors engine events into stores", async () => {
    const stop = startSync();
    await vi.waitFor(() => expect(listeners.zones).toBeDefined());
    const c: Rgb = [1, 2, 3];
    listeners.zones?.([c, c, c, c, c]);
    expect(useZoneColors.getState().colors?.[0]).toEqual(c);
    listeners.paths?.([{ ip: "10.0.0.2", colors: [c, c] }]);
    expect(useZoneColors.getState().paths["10.0.0.2"]).toEqual([c, c]);
    listeners.status?.({ running: false, error: "boom" });
    expect(useStore.getState().status.error).toBe("boom");
    expect(useZoneColors.getState().colors).toBeNull();
    expect(useZoneColors.getState().paths).toEqual({});
    stop();
  });

  it("only previews while visible", () => {
    const stop = startSync();
    expect(api.setPreview).toHaveBeenLastCalledWith(true);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(api.setPreview).toHaveBeenLastCalledWith(false);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    stop();
  });
});
