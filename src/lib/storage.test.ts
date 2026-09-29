import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store";
import { flushSaves, readSaved, saveLater } from "./storage";

vi.mock("./api", async () => (await import("../test/mockApi")).mockApiModule());

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  flushSaves();
  vi.useRealTimers();
});

describe("saveLater", () => {
  it("saves once edits settle", () => {
    const set = vi.spyOn(Storage.prototype, "setItem");
    for (let i = 1; i <= 20; i++) {
      saveLater("k", () => String(i));
      vi.advanceTimersByTime(100);
    }
    expect(set).not.toHaveBeenCalled();
    // Still reads what's waiting.
    expect(readSaved("k")).toBe("20");
    vi.advanceTimersByTime(500);
    expect(set).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("k")).toBe("20");
  });

  it("skips saves that change nothing, and only builds the value when saving", () => {
    localStorage.setItem("k", "same");
    const set = vi.spyOn(Storage.prototype, "setItem");
    const value = vi.fn(() => "same");
    saveLater("k", value);
    saveLater("k", value);
    expect(value).not.toHaveBeenCalled();
    flushSaves();
    expect(value).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
  });

  it("flushes when the window is hidden", () => {
    saveLater("k", () => "v");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    expect(localStorage.getItem("k")).toBe("v");
  });
});

describe("the store's saves", () => {
  it("skip updates that don't touch saved state", () => {
    useStore.getState().setEnabled(true);
    flushSaves();
    const set = vi.spyOn(Storage.prototype, "setItem");
    for (let i = 0; i < 10; i++) useStore.getState().setHoveredLight(i % 2 ? "A" : null);
    useStore.setState({ status: { running: true, error: null } });
    flushSaves();
    expect(set).not.toHaveBeenCalled();
    useStore.getState().setEnabled(false);
    flushSaves();
    expect(set).toHaveBeenCalledTimes(1);
  });
});
