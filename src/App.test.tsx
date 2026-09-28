import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { api } from "./lib/api";
import type { AddedDevice } from "./lib/types";
import { DEFAULT_SETTINGS, useStore } from "./store";

vi.mock("./lib/api", async () => (await import("./test/mockApi")).mockApiModule());

beforeEach(() => {
  useStore.setState({
    devices: [],
    enabled: false,
    settings: DEFAULT_SETTINGS,
    discovered: [],
    scanning: false,
    scanError: null,
    selection: null,
    drawing: false,
  });
  vi.mocked(api.discoverDevices).mockResolvedValue([]);
});

const light = (over: Partial<AddedDevice>): AddedDevice => ({
  id: "A",
  ip: "10.0.0.2",
  sku: "H6199",
  name: "Lamp",
  on: true,
  brightness: 1,
  razer: false,
  sections: [{ count: 1, color: "path" }],
  ...over,
});

const lastDevice = () => vi.mocked(api.setConfig).mock.lastCall?.[0].devices[0];

describe("App", () => {
  it("scans on start, adds a light around the screen and colors it", async () => {
    vi.mocked(api.discoverDevices).mockResolvedValue([
      { id: "AA:BB", ip: "10.0.0.2", sku: "H6199" },
    ]);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Add H6199" }));
    // Adding opens it, placed around the edge and following the screen.
    expect(screen.getByRole("textbox", { name: /name for/i })).toHaveValue("H6199");
    expect(lastDevice()).toMatchObject({ segments: ["path"], sections: [{ count: 1 }] });
    expect(lastDevice()?.sections[0]?.path?.closed).toBe(true);
    const picker = screen.getByRole("group", { name: /color for h6199/i });
    expect(within(picker).getByRole("button", { name: "Screen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // No segments without razer mode.
    expect(screen.queryByRole("group", { name: /segments of/i })).toBeNull();

    await user.click(within(picker).getByRole("button", { name: "Red" }));
    // A fixed color doesn't need the screen.
    expect(lastDevice()).toMatchObject({ segments: ["#ff0000"], sections: [{ path: null }] });
    fireEvent.change(screen.getByRole("slider", { name: "Brightness" }), {
      target: { value: "0.5" },
    });
    expect(lastDevice()?.brightness).toBe(0.5);

    await user.click(screen.getByRole("button", { name: "Back to lights" }));
    expect(screen.getByText("Red · 50%")).toBeInTheDocument();
  });

  it("splits a razer light into sections and colors single segments", async () => {
    useStore.setState({ devices: [light({ sku: "H6056", name: "Bars" })] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Edit Bars" }));
    expect(screen.queryByRole("slider", { name: "Segments" })).toBeNull();
    await user.click(screen.getByRole("switch", { name: /razer/i }));
    expect(screen.getByRole("slider", { name: "Segments" })).toBeInTheDocument();
    expect(lastDevice()).toMatchObject({ razer: true, segments: Array(12).fill("path") });

    await user.click(screen.getByRole("button", { name: "Split in half" }));
    const second = screen.getByRole("button", { name: "Section 2, segments 7–12" });
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Placement · not placed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Line" }));
    expect(lastDevice()?.sections.map((s) => s.count)).toEqual([6, 6]);
    expect(lastDevice()?.sections[1]?.path?.closed).toBe(false);

    // Segments 8-9 red, then back to following the section.
    const bar = screen.getByRole("group", { name: /segments of bars/i });
    await user.click(within(bar).getByRole("button", { name: "Segment 8" }));
    await user.keyboard("{Shift>}");
    await user.click(within(bar).getByRole("button", { name: "Segment 9" }));
    await user.keyboard("{/Shift}");
    expect(screen.getByText("Color · 2 segments")).toBeInTheDocument();
    const picker = screen.getByRole("group", { name: /color for bars/i });
    await user.click(within(picker).getByRole("button", { name: "Red" }));
    expect(lastDevice()?.segments.slice(6, 10)).toEqual(["path", "#ff0000", "#ff0000", "path"]);
    await user.click(within(picker).getByRole("button", { name: "Follow section" }));
    expect(lastDevice()?.segments).toEqual(Array(12).fill("path"));

    // A picked segment moves the split.
    await user.click(screen.getByRole("button", { name: "Section 1, segments 1–6" }));
    await user.click(screen.getByRole("button", { name: "Segment 3" }));
    await user.click(screen.getByRole("button", { name: "Split before 3" }));
    expect(lastDevice()?.sections.map((s) => s.count)).toEqual([2, 4, 6]);
    await user.click(screen.getByRole("button", { name: "Merge with next" }));
    expect(lastDevice()?.sections.map((s) => s.count)).toEqual([2, 10]);
  });

  it("switches one light off and leaves it out of sync", async () => {
    useStore.setState({ devices: [light({})] });
    const user = userEvent.setup();
    render(<App />);
    const power = screen.getByRole("switch", { name: "Power for Lamp" });
    await user.click(power);
    expect(power).toHaveAttribute("aria-checked", "false");
    expect(api.setPower).toHaveBeenCalledWith("10.0.0.2", false);
    expect(vi.mocked(api.setConfig).mock.lastCall?.[0].devices).toEqual([]);
    const row = power.closest(".light") as HTMLElement;
    expect(within(row).getByText("Off")).toBeInTheDocument();
  });

  it("toggles sync", async () => {
    const user = userEvent.setup();
    render(<App />);
    const power = screen.getByRole("switch", { name: /off|syncing/i });
    expect(power).toHaveAttribute("aria-checked", "false");
    await user.click(power);
    expect(power).toHaveAttribute("aria-checked", "true");
    expect(vi.mocked(api.setConfig).mock.lastCall?.[0].enabled).toBe(true);
  });

  it("tunes the screen from the settings popover", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(await screen.findByRole("slider", { name: "Saturation" }), {
      target: { value: "2" },
    });
    expect(vi.mocked(api.setConfig).mock.lastCall?.[0].tuning.saturation).toBe(2);
    expect(screen.queryByRole("slider", { name: /edge depth/i })).toBeNull();
  });

  it("drives the window from the title bar", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Minimize" }));
    expect(api.minimize).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Maximize" }));
    expect(api.toggleMaximize).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(api.close).toHaveBeenCalled();
  });

  it("shows a helpful empty state", async () => {
    render(<App />);
    expect(await screen.findByText(/LAN Control/)).toBeInTheDocument();
  });
});

describe("Canvas", () => {
  // jsdom has no layout: make the screen 200x100 on the page.
  const size = (w: number, h: number) => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: w });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: h });
  };
  beforeEach(() => size(200, 100));
  afterEach(() => size(0, 0));

  const layout = () => {
    const svg = screen.getByRole("application", { name: "Light layout" });
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;
    svg.setPointerCapture = () => {}; // not in jsdom
    return svg;
  };
  const points = () => useStore.getState().devices[0]?.sections[0]?.path?.points;

  it("draws, drags with guides, and edits points", async () => {
    useStore.setState({ devices: [light({ name: "Strip" })] });
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole("button", { name: "Edit Strip" }));
    await user.click(screen.getByRole("button", { name: "Draw" }));
    const svg = layout();

    // Two clicks; Shift keeps the second level with the first.
    fireEvent.pointerDown(svg, { button: 0, clientX: 20, clientY: 50 });
    fireEvent.pointerDown(svg, { button: 0, clientX: 180, clientY: 57, shiftKey: true });
    expect(points()).toEqual([
      [0.1, 0.5],
      [0.9, 0.5],
    ]);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(useStore.getState().drawing).toBe(false);

    // Drag the second point near the middle: it snaps there, with a guide.
    fireEvent.pointerDown(screen.getByRole("button", { name: "Point 2" }), { button: 0 });
    fireEvent.pointerMove(svg, { clientX: 103, clientY: 30 });
    expect(points()?.[1]).toEqual([0.5, 0.3]);
    expect(container.querySelector(".guide")).not.toBeNull();
    fireEvent.pointerUp(svg);
    expect(container.querySelector(".guide")).toBeNull();
    // Alt skips the guides.
    fireEvent.pointerDown(screen.getByRole("button", { name: "Point 2" }), { button: 0 });
    fireEvent.pointerMove(svg, { clientX: 103, clientY: 30, altKey: true });
    fireEvent.pointerUp(svg);
    expect(points()?.[1]).toEqual([0.515, 0.3]);

    // Double-click the band to add a point; right-click to remove it.
    fireEvent.doubleClick(svg, { clientX: 61, clientY: 40 });
    expect(points()).toHaveLength(3);
    expect(points()?.[1]).toEqual([0.305, 0.4]);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Point 2" }));
    expect(points()).toHaveLength(2);
  });

  it("selects by clicking a band, moves it, and deselects on empty space", async () => {
    const path = {
      points: [
        [0.1, 0.5],
        [0.5, 0.5],
      ] as [number, number][],
      width: 0.12,
      closed: false,
    };
    useStore.setState({ devices: [light({ sections: [{ count: 1, color: "path", path }] })] });
    render(<App />);
    const svg = layout();
    expect(screen.getByRole("button", { name: "Edit Lamp" })).toBeInTheDocument();

    fireEvent.pointerDown(svg, { button: 0, clientX: 40, clientY: 52 });
    expect(useStore.getState().selection).toEqual({ id: "A", section: 0 });
    fireEvent.pointerMove(svg, { clientX: 50, clientY: 62 });
    fireEvent.pointerUp(svg);
    expect(points()?.[0]?.[0]).toBeCloseTo(0.15);
    expect(points()?.[0]?.[1]).toBeCloseTo(0.6);

    fireEvent.pointerDown(svg, { button: 0, clientX: 190, clientY: 10 });
    expect(useStore.getState().selection).toBeNull();
    expect(screen.getByRole("button", { name: "Edit Lamp" })).toBeInTheDocument();
  });
});
