import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./lib/api";
import { edgeLoop } from "./lib/path";
import type { Rgb } from "./lib/types";
import { DEFAULT_SETTINGS, useLive, useScreen, useStore } from "./store";
import { startSync } from "./sync";
import { resetPreview, sendPreview } from "./test/mockApi";

vi.mock("./lib/api", async () => (await import("./test/mockApi")).mockApiModule());

beforeEach(() => {
  useStore.setState({ devices: [], enabled: false, settings: DEFAULT_SETTINGS });
  useLive.setState({ paths: {} });
  resetPreview();
});

const image = (width: number, height: number) => ({
  width,
  height,
  rgba: new Uint8ClampedArray(width * height * 4),
});

/** The sync is waiting on a poll. */
const polling = () => vi.waitFor(() => expect(api.nextPreview).toHaveBeenCalled());

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
    useScreen.setState({ image: image(16, 9) });
    useScreen.setState({ image: image(32, 18) });
    expect(calls()).toBe(before);
    useStore.getState().addDevice({ id: "A", ip: "10.0.0.2", sku: "X" });
    useStore.getState().setSectionPath("A", 0, edgeLoop(16 / 9, 0.12));
    const withLight = calls();
    // A new shape moves the fitted edge loop.
    useScreen.setState({ image: image(21, 9) });
    expect(calls()).toBe(withLight + 1);
    useScreen.setState({ image: null });
    stop();
  });

  it("mirrors the engine's preview into stores", async () => {
    const stop = startSync();
    await polling();
    const c: Rgb = [1, 2, 3];
    sendPreview({ paths: [{ ip: "10.0.0.2", colors: [c, c] }] });
    await vi.waitFor(() => expect(useLive.getState().paths["10.0.0.2"]).toEqual([c, c]));
    sendPreview({ status: { running: false, error: "boom" } });
    await vi.waitFor(() => expect(useStore.getState().status.error).toBe("boom"));
    expect(useLive.getState().paths).toEqual({});
    stop();
  });

  it("keeps unchanged colors, so their components don't re-render", async () => {
    const stop = startSync();
    await polling();
    sendPreview({
      paths: [
        {
          ip: "A",
          colors: [
            [1, 1, 1],
            [2, 2, 2],
          ],
        },
      ],
    });
    await vi.waitFor(() => expect(useLive.getState().paths.A).toHaveLength(2));
    const before = useLive.getState().paths;
    const first = before.A?.[0];
    sendPreview({
      paths: [
        {
          ip: "A",
          colors: [
            [1, 1, 1],
            [9, 9, 9],
          ],
        },
      ],
    });
    await vi.waitFor(() => expect(useLive.getState().paths.A?.[1]).toEqual([9, 9, 9]));
    expect(useLive.getState().paths.A?.[0]).toBe(first);
    stop();
  });

  it("keeps the one screen image in a shared store", async () => {
    const stop = startSync();
    await polling();
    const frame = image(2, 1);
    sendPreview({ image: frame });
    await vi.waitFor(() => expect(useScreen.getState().image).toBe(frame));
    stop();
  });

  it("only previews while visible, and asks for everything again when shown", async () => {
    const stop = startSync();
    await polling();
    expect(api.setPreview).toHaveBeenLastCalledWith(true);
    sendPreview({ paths: [{ ip: "A", colors: [[1, 1, 1]] }] });
    await vi.waitFor(() => expect(useLive.getState().paths.A).toBeDefined());
    const visibility = (value: string) => {
      Object.defineProperty(document, "visibilityState", { value, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    visibility("hidden");
    expect(api.setPreview).toHaveBeenLastCalledWith(false);
    expect(useLive.getState().paths).toEqual({});
    vi.mocked(api.nextPreview).mockClear();
    visibility("visible");
    expect(api.setPreview).toHaveBeenLastCalledWith(true);
    // The poll from before hiding answers first; the next one starts over.
    sendPreview({});
    await vi.waitFor(() => expect(api.nextPreview).toHaveBeenLastCalledWith(0));
    stop();
  });
});
