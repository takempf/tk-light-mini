import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./lib/api";
import type { Rgb } from "./lib/types";
import { DEFAULT_SETTINGS, useLive, useScreen, useStore } from "./store";
import { startSync } from "./sync";
import { listeners } from "./test/mockApi";

vi.mock("./lib/api", async () => (await import("./test/mockApi")).mockApiModule());

beforeEach(() => {
  useStore.setState({ devices: [], enabled: false, settings: DEFAULT_SETTINGS });
  useLive.setState({ paths: {} });
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

  it("pushes again when the screen changes shape", () => {
    const stop = startSync();
    const calls = () => vi.mocked(api.setConfig).mock.calls.length;
    const before = calls();
    // Same config: a new frame alone sends nothing.
    useScreen.setState({ image: { width: 16, height: 9, rgb: new Uint8Array(16 * 9 * 3) } });
    expect(calls()).toBe(before);
    useStore.getState().addDevice({ id: "A", ip: "10.0.0.2", sku: "X" });
    const withLight = calls();
    // A new shape moves the fitted edge loop.
    useScreen.setState({ image: { width: 21, height: 9, rgb: new Uint8Array(21 * 9 * 3) } });
    expect(calls()).toBe(withLight + 1);
    useScreen.setState({ image: null });
    stop();
  });

  it("mirrors engine events into stores", async () => {
    const stop = startSync();
    await vi.waitFor(() => expect(listeners.paths).toBeDefined());
    const c: Rgb = [1, 2, 3];
    listeners.paths?.([{ ip: "10.0.0.2", colors: [c, c] }]);
    expect(useLive.getState().paths["10.0.0.2"]).toEqual([c, c]);
    listeners.status?.({ running: false, error: "boom" });
    expect(useStore.getState().status.error).toBe("boom");
    expect(useLive.getState().paths).toEqual({});
    stop();
  });

  it("keeps the one screen image in a shared store", async () => {
    const stop = startSync();
    await vi.waitFor(() => expect(listeners.screen).toBeDefined());
    const image = { width: 2, height: 1, rgb: new Uint8Array([1, 2, 3, 4, 5, 6]) };
    listeners.screen?.(image);
    expect(useScreen.getState().image).toBe(image);
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
