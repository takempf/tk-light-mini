import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { flushSaves } from "./storage";
import { AUTO_KEY, CHECK_EVERY_MS, FIRST_CHECK_MS, startUpdateChecks, useUpdates } from "./updates";

vi.mock("./api", async () => (await import("../test/mockApi")).mockApiModule());

const update = { version: "9.9.9", notes: "- Faster" };
const initial = useUpdates.getState();

beforeEach(() => {
  // Back to the mock's own answers.
  vi.resetAllMocks();
  useUpdates.setState({ ...initial, status: { kind: "idle" }, auto: true });
});

describe("check", () => {
  it("says when this is the latest version", async () => {
    vi.mocked(api.checkUpdate).mockResolvedValue(null);
    await useUpdates.getState().check();
    expect(useUpdates.getState().status).toEqual({ kind: "latest" });
  });

  it("holds a downloaded update", async () => {
    vi.mocked(api.checkUpdate).mockResolvedValue(update);
    await useUpdates.getState().check();
    expect(useUpdates.getState().status).toEqual({ kind: "ready", update });
  });

  it("shows checking until the backend answers", async () => {
    let answer: (u: null) => void = () => {};
    vi.mocked(api.checkUpdate).mockReturnValue(new Promise((r) => (answer = r)));
    const done = useUpdates.getState().check();
    expect(useUpdates.getState().status).toEqual({ kind: "checking" });
    answer(null);
    await done;
    expect(useUpdates.getState().status).toEqual({ kind: "latest" });
  });

  it("says why a check failed", async () => {
    vi.mocked(api.checkUpdate).mockRejectedValue("offline");
    await useUpdates.getState().check();
    expect(useUpdates.getState().status).toEqual({ kind: "error", message: "offline" });
    vi.mocked(api.checkUpdate).mockRejectedValue(new Error("bad signature"));
    await useUpdates.getState().check();
    expect(useUpdates.getState().status).toEqual({ kind: "error", message: "bad signature" });
  });

  it("doesn't check twice at once or once an update is ready", async () => {
    let answer: (u: typeof update) => void = () => {};
    vi.mocked(api.checkUpdate).mockReturnValue(new Promise((r) => (answer = r)));
    const first = useUpdates.getState().check();
    await useUpdates.getState().check();
    answer(update);
    await first;
    await useUpdates.getState().check();
    expect(api.checkUpdate).toHaveBeenCalledTimes(1);
    expect(useUpdates.getState().status.kind).toBe("ready");
  });
});

describe("install", () => {
  it("installs only a ready update", async () => {
    await useUpdates.getState().install();
    expect(api.installUpdate).not.toHaveBeenCalled();

    useUpdates.setState({ status: { kind: "ready", update } });
    await useUpdates.getState().install();
    expect(api.installUpdate).toHaveBeenCalledTimes(1);
    // The app exits from here.
    expect(useUpdates.getState().status).toEqual({ kind: "installing", update });
  });

  it("saves pending edits first, since the app exits mid-install", async () => {
    const order: string[] = [];
    const storage = await import("./storage");
    const flush = vi.spyOn(storage, "flushSaves");
    vi.mocked(api.installUpdate).mockImplementation(async () => {
      order.push(flush.mock.calls.length ? "flushed, then install" : "install unflushed");
    });
    useUpdates.setState({ status: { kind: "ready", update } });
    await useUpdates.getState().install();
    expect(order).toEqual(["flushed, then install"]);
  });

  it("keeps the update ready to try again when installing fails", async () => {
    vi.mocked(api.installUpdate).mockRejectedValue("installer busy");
    useUpdates.setState({ status: { kind: "ready", update } });
    await useUpdates.getState().install();
    expect(useUpdates.getState().status).toEqual({
      kind: "ready",
      update,
      error: "installer busy",
    });
  });
});

describe("automatic checks", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("checks after launch and then every few hours", async () => {
    const stop = startUpdateChecks();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS - 1);
    expect(api.checkUpdate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.checkUpdate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(api.checkUpdate).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 2);
    expect(api.checkUpdate).toHaveBeenCalledTimes(2);
  });

  it("stays quiet while switched off", async () => {
    useUpdates.getState().setAuto(false);
    const stop = startUpdateChecks();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS + CHECK_EVERY_MS);
    expect(api.checkUpdate).not.toHaveBeenCalled();
    stop();
  });

  it("checks at once when switched back on", async () => {
    useUpdates.setState({ auto: false });
    useUpdates.getState().setAuto(true);
    expect(api.checkUpdate).toHaveBeenCalledTimes(1);
  });

  it("remembers the choice", () => {
    useUpdates.getState().setAuto(false);
    flushSaves();
    expect(localStorage.getItem(AUTO_KEY)).toBe("false");
    useUpdates.getState().setAuto(true);
    flushSaves();
    expect(localStorage.getItem(AUTO_KEY)).toBe("true");
  });
});

describe("saved choice", () => {
  it("defaults to on and reads a saved off", async () => {
    vi.resetModules();
    expect((await import("./updates")).useUpdates.getState().auto).toBe(true);
    localStorage.setItem(AUTO_KEY, "false");
    vi.resetModules();
    expect((await import("./updates")).useUpdates.getState().auto).toBe(false);
  });
});
