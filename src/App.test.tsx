import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { api } from "./lib/api";
import { resolveCalibration } from "./lib/calibration";
import { flushSaves } from "./lib/storage";
import type { AddedDevice, LightPath } from "./lib/types";
import { PAD } from "./lib/view";
import { DEFAULT_SETTINGS, useScreen, useStore } from "./store";

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
    hoveredLight: null,
    hoveredSection: null,
    fills: {},
    drawing: false,
    points: [],
    calibrating: null,
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
  it("resizes the panels by dragging or keyboard and remembers the split", () => {
    const first = render(<App />);
    const divider = screen.getByRole("separator", { name: "Resize Lights and Details" });
    const sidebar = screen.getByRole("complementary", { name: "Lights, details, and canvas" });
    vi.spyOn(sidebar, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 320, 507));
    vi.spyOn(divider, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 200, 320, 7));
    divider.setPointerCapture = vi.fn();
    divider.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(divider, { button: 0, pointerId: 1, clientY: 200 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientY: 300 });
    fireEvent.pointerUp(divider, { pointerId: 1 });
    expect(divider).toHaveAttribute("aria-valuenow", "60");
    expect(sidebar.style.getPropertyValue("--layers-size")).toBe("60fr");
    fireEvent.keyDown(divider, { key: "ArrowUp" });
    expect(divider).toHaveAttribute("aria-valuenow", "58");
    first.unmount();
    render(<App />);
    const restored = screen.getByRole("separator", { name: "Resize Lights and Details" });
    expect(restored).toHaveAttribute("aria-valuenow", "58");
    fireEvent.keyDown(restored, { key: "End" });
    fireEvent.keyDown(restored, { key: "ArrowDown" });
    expect(restored).toHaveAttribute("aria-valuenow", "80");
    fireEvent.keyDown(restored, { key: "Home" });
    fireEvent.keyDown(restored, { key: "ArrowUp" });
    expect(restored).toHaveAttribute("aria-valuenow", "20");
    fireEvent.doubleClick(restored);
    expect(restored).toHaveAttribute("aria-valuenow", "40");
  });

  it("collapses sidebar panels from their headings", async () => {
    useStore.setState({ devices: [light({})] });
    const user = userEvent.setup();
    render(<App />);
    const sidebar = screen.getByRole("complementary", { name: "Lights, details, and canvas" });
    const lights = screen.getByRole("button", { name: "Lights" });
    const details = screen.getByRole("button", { name: "Details" });
    const screenOptions = screen.getByRole("button", { name: "Canvas" });
    expect(lights).toHaveAttribute("aria-expanded", "true");
    expect(details).toHaveAttribute("aria-expanded", "true");
    expect(screenOptions).toHaveAttribute("aria-expanded", "false");
    await user.click(lights);
    expect(lights).toHaveAttribute("aria-expanded", "false");
    expect(sidebar.style.getPropertyValue("--divider-size")).toBe("0px");
    expect(screen.queryByRole("separator", { name: "Resize Lights and Details" })).toBeNull();
    expect(document.getElementById(lights.getAttribute("aria-controls") ?? "")).toHaveAttribute(
      "inert",
    );
    expect(screen.queryByRole("button", { name: "Edit Lamp" })).toBeNull();
    await user.click(lights);
    expect(screen.getByRole("button", { name: "Edit Lamp" })).toBeInTheDocument();
    expect(
      screen.getByRole("separator", { name: "Resize Lights and Details" }),
    ).toBeInTheDocument();
    await user.click(details);
    expect(details).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("No light selected.")?.closest(".panel-body")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await user.click(screenOptions);
    expect(screenOptions).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("slider", { name: "Saturation" })).toBeInTheDocument();
    await user.click(screenOptions);
    expect(screen.queryByRole("slider", { name: "Saturation" })).toBeNull();
  });

  it("keeps grouped paths visible while editing in the separate details pane", async () => {
    const path: LightPath = {
      points: [
        [0.2, 0.2],
        [0.8, 0.2],
      ],
      width: 0.1,
      closed: false,
    };
    useStore.setState({
      devices: [
        light({
          razer: true,
          segments: 4,
          sections: [
            { count: 2, color: "path", path },
            {
              count: 2,
              color: "#ff0000",
              path: {
                ...path,
                points: [
                  [0.2, 0.8],
                  [0.8, 0.8],
                ],
              },
            },
          ],
        }),
        light({ id: "B", name: "Desk", ip: "10.0.0.3" }),
      ],
    });
    const user = userEvent.setup();
    const { container } = render(<App />);
    const layers = screen.getByRole("region", { name: "Lights" });
    const details = screen.getByRole("region", { name: "Details" });
    const second = within(layers).getByRole("button", { name: "Section 2 (3–4)" });
    const pathPower = within(layers).getByRole("switch", { name: "Power for Lamp Section 2" });
    await user.click(pathPower);
    expect(pathPower).toHaveAttribute("aria-checked", "false");
    expect(useStore.getState().selection).toBeNull();
    expect(lastDevice()?.segments).toEqual(["path", "path", "#000000", "#000000"]);
    await user.click(pathPower);
    expect(lastDevice()?.segments).toEqual(["path", "path", "#ff0000", "#ff0000"]);
    fireEvent.pointerEnter(second);
    expect(useStore.getState().hoveredSection).toBe(1);
    expect(container.querySelectorAll(".shape[data-hover]")).toHaveLength(1);
    expect(container.querySelectorAll(".shape[data-visible]")).toHaveLength(1);
    expect(within(layers).getAllByRole("button", { name: /Edit / })).toHaveLength(2);
    await user.click(second);
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(within(layers).queryByText(/sections|segments|100%/i)).toBeNull();
    expect(
      within(details).getByRole("textbox", { name: "Name for section 2 of Lamp" }),
    ).toHaveValue("Section 2");
    expect(within(details).getByText("Segments")).toBeInTheDocument();
    expect(within(details).getByText("2 (3–4)")).toBeInTheDocument();
    expect(within(details).queryByRole("textbox", { name: "Name for A" })).toBeNull();
    expect(within(details).queryByRole("heading", { level: 3 })).toBeNull();
    const parent = within(layers).getByRole("button", { name: "Edit Lamp" });
    expect(parent).toHaveAttribute("aria-pressed", "false");
    expect(container.querySelectorAll(".shape[data-selected]")).toHaveLength(1);
    expect(container.querySelectorAll(".shape[data-visible]")).toHaveLength(2);
    expect(container.querySelectorAll(".shape[data-filled]")).toHaveLength(1);
    expect(
      container.querySelector(".shape[data-visible]:not([data-selected]) .shape-outline"),
    ).not.toBeNull();
    expect(within(details).getByRole("switch", { name: "Show fill" })).toBeInTheDocument();
    await user.click(within(layers).getByRole("button", { name: "Collapse Lamp" }));
    expect(within(layers).queryByRole("group", { name: "Sections for Lamp" })).toBeNull();
    expect(useStore.getState().selection).toEqual({ id: "A", section: 1 });
    await user.click(within(layers).getByRole("button", { name: "Expand Lamp" }));
    expect(within(layers).getByRole("button", { name: "Section 2 (3–4)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(parent);
    expect(parent).toHaveAttribute("aria-pressed", "true");
    expect(within(details).getByText("2 sections · 4 segments")).toBeInTheDocument();
    expect(useStore.getState().selection).toEqual({ id: "A", section: null });
    expect(within(layers).getByRole("button", { name: "Section 2 (3–4)" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(container.querySelectorAll(".shape[data-selected]")).toHaveLength(2);
    expect(container.querySelectorAll(".editor-handle")).toHaveLength(0);
    expect(within(details).getByRole("textbox", { name: "Name for A" })).toBeInTheDocument();
    expect(within(details).queryByRole("button", { name: "Redraw" })).toBeNull();
    await user.click(within(layers).getByRole("button", { name: "Edit Desk" }));
    expect(within(details).getByRole("textbox", { name: "Name for B" })).toBeInTheDocument();
    expect(within(layers).getByRole("button", { name: "Edit Lamp" })).toBeInTheDocument();
  });

  it("edits a section name in Details and restores its default when cleared", async () => {
    useStore.setState({ devices: [light({})] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Section 1 (1)" }));
    const name = screen.getByRole("textbox", { name: "Name for section 1 of Lamp" });
    expect(name).toHaveValue("Section 1");
    await user.clear(name);
    await user.type(name, "Desk edge");
    expect(screen.getByRole("button", { name: "Desk edge (1)" })).toHaveTextContent("Desk edge");
    expect(screen.getByRole("switch", { name: "Power for Lamp Desk edge" })).toBeInTheDocument();
    flushSaves();
    const saved = JSON.parse(localStorage.getItem("tk-light-mini") ?? "{}");
    expect(saved.state?.devices[0]?.sections[0]?.name).toBe("Desk edge");
    await user.clear(name);
    await user.tab();
    expect(name).toHaveValue("Section 1");
    expect(screen.getByRole("button", { name: "Section 1 (1)" })).toBeInTheDocument();
  });

  it("scans on start, adds a light across the middle and colors it", async () => {
    vi.mocked(api.discoverDevices).mockResolvedValue([
      { id: "AA:BB", ip: "10.0.0.2", sku: "H6199" },
    ]);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Add H6199" }));
    // Adding opens it, placed across the middle and following the screen.
    expect(screen.getByRole("textbox", { name: /name for/i })).toHaveValue("H6199");
    expect(lastDevice()).toMatchObject({ segments: ["path"], sections: [{ count: 1 }] });
    expect(lastDevice()?.sections[0]?.path?.points).toEqual([
      [0, 0.5],
      [1, 0.5],
    ]);
    await user.click(screen.getByRole("button", { name: "Section 1 (1)" }));
    expect(screen.queryByRole("group", { name: /color for h6199/i })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Color for H6199" }));
    const picker = screen.getByRole("group", { name: /color for h6199/i });
    expect(within(picker).getByRole("button", { name: "Canvas" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // No segments without razer mode.
    expect(screen.queryByRole("group", { name: /segments of/i })).toBeNull();

    const red = within(picker).getByRole("button", { name: "Red" });
    expect(red).not.toHaveAttribute("title");
    await user.hover(red);
    expect(await screen.findByText("Red", { selector: ".tk-tooltip" })).toBeInTheDocument();
    await user.click(red);
    expect(screen.getByRole("button", { name: "Color for H6199" })).toHaveTextContent("Red");
    // A fixed color doesn't need the canvas.
    expect(lastDevice()).toMatchObject({ segments: ["#ff0000"], sections: [{ path: null }] });
    fireEvent.change(within(picker).getByLabelText("Custom color"), {
      target: { value: "#123456" },
    });
    expect(lastDevice()?.segments).toEqual(["#123456"]);
    await user.click(within(picker).getByRole("button", { name: "Canvas" }));
    expect(lastDevice()?.segments).toEqual(["path"]);
    await user.click(screen.getByRole("button", { name: "Edit H6199" }));
    fireEvent.change(screen.getByRole("slider", { name: "Brightness" }), {
      target: { value: "0.5" },
    });
    expect(lastDevice()?.brightness).toBe(0.5);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Red · 50%")).toBeNull();
  });

  it("adds a fan hub through iCUE with a segment per fan", async () => {
    const id = "icue:{fdbcaa26-7194-45f1-a2ed-d2aeff182ac0}";
    vi.mocked(api.discoverDevices).mockResolvedValue([
      { id, ip: id, sku: "VENGEANCE PC", segments: 6 },
    ]);
    const user = userEvent.setup();
    render(<App />);

    const add = await screen.findByRole("button", { name: "Add VENGEANCE PC" });
    const row = add.closest(".light") as HTMLElement;
    expect(within(row).getByText("Through iCUE")).toBeInTheDocument();
    expect(within(row).queryByText(id, { exact: false })).toBeNull();
    await user.click(add);
    expect(lastDevice()).toMatchObject({ ip: id, razer: true, segments: Array(6).fill("path") });

    await user.click(screen.getByRole("button", { name: "Edit VENGEANCE PC" }));
    expect(screen.getByText("VENGEANCE PC · through iCUE")).toBeInTheDocument();
    // It always takes a color per segment: no switch, just the count.
    expect(screen.queryByRole("switch", { name: /razer/i })).toBeNull();
    expect(screen.getByRole("slider", { name: "Segments" })).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Section 1 (1–12)" }));

    await user.click(screen.getByRole("button", { name: "Split in half" }));
    const second = screen.getByRole("button", { name: "Section 2 (7–12)" });
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(lastDevice()?.sections[1]?.path?.points).toEqual([
      [0, 0.5],
      [1, 0.5],
    ]);
    await user.click(screen.getByRole("button", { name: "Line" }));
    expect(lastDevice()?.sections.map((s) => s.count)).toEqual([6, 6]);
    expect(lastDevice()?.sections[1]?.path?.closed).toBe(false);

    // Segments 8-9 red, then back to following the section.
    const bar = screen.getByRole("group", { name: /segments of bars/i });
    await user.click(within(bar).getByRole("button", { name: "Segment 8" }));
    await user.keyboard("{Shift>}");
    await user.click(within(bar).getByRole("button", { name: "Segment 9" }));
    await user.keyboard("{/Shift}");
    expect(screen.getByText("Color", { selector: ".tk-range-label" })).toBeInTheDocument();
    expect(screen.getByText("2 segments")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Color for Bars" }));
    const picker = screen.getByRole("group", { name: /color for bars/i });
    await user.click(within(picker).getByRole("button", { name: "Red" }));
    expect(lastDevice()?.segments.slice(6, 10)).toEqual(["path", "#ff0000", "#ff0000", "path"]);
    await user.click(within(picker).getByRole("button", { name: "Follow section" }));
    expect(lastDevice()?.segments).toEqual(Array(12).fill("path"));

    // A picked segment moves the split.
    await user.click(screen.getByRole("button", { name: "Section 1 (1–6)" }));
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
    expect(row).toHaveAttribute("data-off");
  });

  it("toggles sync", async () => {
    const user = userEvent.setup();
    render(<App />);
    const power = screen.getByRole("switch", { name: "Syncing Off" });
    expect(power).toHaveAttribute("aria-checked", "false");
    expect(power.closest(".titlebar-toggle")).toHaveTextContent("SyncingOff");
    await user.click(power);
    expect(power).toHaveAttribute("aria-checked", "true");
    expect(power.closest(".titlebar-toggle")).toHaveTextContent("SyncingOn");
    expect(vi.mocked(api.setConfig).mock.lastCall?.[0].enabled).toBe(true);
  });

  it("turns every light off and back on from the titlebar", async () => {
    useStore.setState({
      devices: [light({}), light({ id: "B", ip: "10.0.0.3", name: "Desk" })],
      enabled: true,
    });
    const user = userEvent.setup();
    render(<App />);
    const power = screen.getByRole("switch", { name: "Lights On" });
    const syncing = screen.getByRole("switch", { name: "Syncing On" });
    expect(power.closest(".titlebar-toggle")).toHaveTextContent("LightsOn");
    await user.click(power);
    expect(power).toHaveAttribute("aria-checked", "false");
    expect(power.closest(".titlebar-toggle")).toHaveTextContent("LightsOff");
    expect(syncing).toHaveAttribute("aria-checked", "false");
    expect(useStore.getState().devices.every((d) => !d.on)).toBe(true);
    expect(api.lightsOff).toHaveBeenCalledWith(["10.0.0.2", "10.0.0.3"]);
    await user.click(power);
    expect(power).toHaveAttribute("aria-checked", "true");
    expect(useStore.getState().devices.every((d) => d.on)).toBe(true);
    expect(api.setPower).toHaveBeenCalledWith("10.0.0.2", true);
    expect(api.setPower).toHaveBeenCalledWith("10.0.0.3", true);
  });

  it("tunes the canvas from the sidebar", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Canvas" }));
    fireEvent.change(await screen.findByRole("slider", { name: "Saturation" }), {
      target: { value: "2" },
    });
    expect(vi.mocked(api.setConfig).mock.lastCall?.[0].tuning.saturation).toBe(2);
    expect(screen.queryByRole("slider", { name: /edge depth/i })).toBeNull();
  });

  it("follows a scene instead of the screen", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Canvas" }));
    const sources = screen.getByRole("group", { name: "Canvas source" });
    expect(within(sources).getByRole("button", { name: "Screen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(within(sources).getByRole("button", { name: "Night forest" }));
    expect(vi.mocked(api.setConfig).mock.lastCall?.[0].canvas).toBe("forest");
    expect(within(sources).getByRole("button", { name: "Night forest" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
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
  // jsdom has no layout: a 2:1 screen, fitted at 200x100 with room around it.
  // The viewport sits at -PAD on the page, so the screen spans 0..200 x 0..100.
  const size = (w: number, h: number) => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: w });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: h });
  };
  const getContext = HTMLCanvasElement.prototype.getContext;
  beforeEach(() => {
    size(200 + 2 * PAD, 100 + 2 * PAD);
    HTMLCanvasElement.prototype.getContext = () => null; // not in jsdom
    useScreen.setState({ image: { width: 2, height: 1, rgba: new Uint8ClampedArray(8) } });
  });
  afterEach(() => {
    size(0, 0);
    HTMLCanvasElement.prototype.getContext = getContext;
    useScreen.setState({ image: null });
  });

  const layout = () => {
    const svg = screen.getByRole("application", { name: "Light layout" });
    const rect = { left: -PAD, top: -PAD, width: 200 + 2 * PAD, height: 100 + 2 * PAD };
    svg.getBoundingClientRect = () => rect as DOMRect;
    const vp = svg.parentElement as HTMLElement;
    vp.getBoundingClientRect = () => rect as DOMRect;
    svg.setPointerCapture = () => {}; // not in jsdom
    return svg;
  };
  const points = () => useStore.getState().devices[0]?.sections[0]?.path?.points;

  it("draws, drags with guides, and edits points", async () => {
    useStore.setState({ devices: [light({ name: "Strip" })] });
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole("button", { name: "Section 1 (1)" }));
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

  it("selects from the list, moves the band, and deselects on empty space", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Edit Lamp" }));

    fireEvent.pointerDown(svg, { button: 0, clientX: 40, clientY: 52 });
    expect(useStore.getState().selection).toEqual({ id: "A", section: 0 });
    fireEvent.pointerMove(svg, { clientX: 50, clientY: 62, altKey: true });
    fireEvent.pointerUp(svg);
    expect(points()?.[0]?.[0]).toBeCloseTo(0.15);
    expect(points()?.[0]?.[1]).toBeCloseTo(0.6);

    fireEvent.pointerDown(svg, { button: 0, clientX: 190, clientY: 10 });
    fireEvent.pointerUp(svg);
    expect(useStore.getState().selection).toBeNull();
    expect(screen.getByRole("button", { name: "Edit Lamp" })).toBeInTheDocument();
  });

  const square = {
    points: [
      [0.2, 0.2],
      [0.8, 0.2],
      [0.8, 0.8],
      [0.2, 0.8],
    ] as [number, number][],
    width: 0.1,
    closed: true,
  };
  const selected = (path: LightPath) => {
    useStore.setState({
      devices: [light({ sections: [{ count: 1, color: "path", path }] })],
      selection: { id: "A", section: 0 },
    });
  };
  const handle = (name: string) => screen.getByRole("button", { name });
  const picked = () => useStore.getState().points;

  it("picks several points and moves them together", () => {
    selected(square);
    render(<App />);
    const svg = layout();
    fireEvent.pointerDown(handle("Point 2"), { button: 0, clientX: 160, clientY: 20 });
    fireEvent.pointerUp(svg);
    fireEvent.pointerDown(handle("Point 3"), { button: 0, shiftKey: true });
    fireEvent.pointerUp(svg);
    expect(picked()).toEqual([1, 2]);
    expect(handle("Point 3")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("2 points picked")).toBeInTheDocument();

    // Dragging one moves both; one undo puts them back.
    fireEvent.pointerDown(handle("Point 2"), { button: 0, clientX: 160, clientY: 20 });
    fireEvent.pointerMove(svg, { clientX: 170, clientY: 20 });
    fireEvent.pointerUp(svg);
    expect(points()?.map(([x]) => x)).toEqual([0.2, 0.85, 0.85, 0.2]);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(points()?.map(([x]) => x)).toEqual([0.2, 0.8, 0.8, 0.2]);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(points()?.[1]?.[0]).toBe(0.85);

    // Undo and redo unpick, since points may have come or gone.
    expect(picked()).toEqual([]);
    // Shift+click adds points, and takes them back out.
    for (const name of ["Point 2", "Point 3", "Point 2"]) {
      fireEvent.pointerDown(handle(name), { button: 0, shiftKey: true });
      fireEvent.pointerUp(svg);
    }
    expect(picked()).toEqual([2]);
  });

  it("picks points in a box and deletes them", () => {
    selected(square);
    const { container } = render(<App />);
    const svg = layout();
    fireEvent.pointerDown(svg, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(svg, { clientX: 190, clientY: 50 });
    expect(container.querySelector(".marquee")).not.toBeNull();
    fireEvent.pointerUp(svg);
    expect(picked()).toEqual([0, 1]);
    expect(useStore.getState().selection).not.toBeNull();
    // Shift adds another box.
    fireEvent.pointerDown(svg, { button: 0, clientX: 10, clientY: 60, shiftKey: true });
    fireEvent.pointerMove(svg, { clientX: 100, clientY: 95 });
    fireEvent.pointerUp(svg);
    expect(picked()).toEqual([0, 1, 3]);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(points()).toEqual([[0.8, 0.8]]);
    expect(picked()).toEqual([]);
  });

  it("picks all, nudges, and steps back with Esc", () => {
    selected(square);
    render(<App />);
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(picked()).toEqual([0, 1, 2, 3]);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowDown", shiftKey: true });
    expect(points()?.[0]?.[0]).toBeCloseTo(0.205);
    expect(points()?.[0]?.[1]).toBeCloseTo(0.3);
    // Keys typed in a field stay there.
    fireEvent.keyDown(screen.getByRole("slider", { name: "Thickness" }), { key: "Delete" });
    expect(points()).toHaveLength(4);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(picked()).toEqual([]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useStore.getState().selection).toBeNull();
  });

  it("moves a band straight with Shift, and snaps it to guides", () => {
    const line = {
      points: [
        [0.1, 0.5],
        [0.5, 0.5],
      ] as [number, number][],
      width: 0.12,
      closed: false,
    };
    selected(line);
    const { container } = render(<App />);
    const svg = layout();
    fireEvent.pointerDown(svg, { button: 0, clientX: 40, clientY: 50 });
    fireEvent.pointerMove(svg, { clientX: 60, clientY: 53, shiftKey: true });
    expect(points()?.[0]?.[0]).toBeCloseTo(0.2);
    expect(points()?.[0]?.[1]).toBeCloseTo(0.5);
    // 97px across puts the second point 3px from the right edge: it snaps there.
    fireEvent.pointerMove(svg, { clientX: 137, clientY: 70 });
    expect(points()?.[1]?.[0]).toBeCloseTo(1);
    expect(points()?.[0]?.[0]).toBeCloseTo(0.6);
    expect(points()?.[0]?.[1]).toBeCloseTo(0.7);
    expect(container.querySelector(".guide")).not.toBeNull();
    fireEvent.pointerUp(svg);
  });

  it("adds a point to the end with Ctrl+click", () => {
    selected({ ...square, closed: false });
    render(<App />);
    const svg = layout();
    fireEvent.pointerDown(svg, {
      button: 0,
      clientX: 150,
      clientY: 70,
      ctrlKey: true,
      altKey: true,
    });
    expect(points()).toHaveLength(5);
    expect(points()?.[4]).toEqual([0.75, 0.7]);
    expect(picked()).toEqual([4]);
  });

  it("draws with Backspace, closes on the first point, and ends on double-click", async () => {
    useStore.setState({ devices: [light({ name: "Strip" })] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Section 1 (1)" }));
    await user.click(screen.getByRole("button", { name: "Draw" }));
    const svg = layout();
    for (const [x, y] of [
      [30, 30],
      [170, 30],
      [120, 90],
      [170, 70],
    ]) {
      fireEvent.pointerDown(svg, { button: 0, clientX: x, clientY: y });
    }
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(points()).toHaveLength(3);
    fireEvent.pointerDown(handle("Point 1, start"), { button: 0 });
    expect(useStore.getState().drawing).toBe(false);
    expect(useStore.getState().devices[0]?.sections[0]?.path?.closed).toBe(true);
    // The whole drawing is one undo step.
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(points()).toBeUndefined();

    await user.click(screen.getByRole("button", { name: "Draw" }));
    fireEvent.pointerDown(svg, { button: 0, clientX: 30, clientY: 30 });
    fireEvent.pointerDown(svg, { button: 0, clientX: 170, clientY: 30 });
    fireEvent.pointerDown(svg, { button: 0, clientX: 170, clientY: 30 });
    fireEvent.doubleClick(svg, { clientX: 170, clientY: 30 });
    expect(useStore.getState().drawing).toBe(false);
    expect(points()).toHaveLength(2);
  });

  it("sets a picked point exactly, and where a loop starts", () => {
    selected(square);
    render(<App />);
    const svg = layout();
    fireEvent.pointerDown(handle("Point 3"), { button: 0, clientX: 160, clientY: 80 });
    fireEvent.pointerUp(svg);
    fireEvent.change(screen.getByRole("spinbutton", { name: /x, %/i }), {
      target: { value: "75" },
    });
    expect(points()?.[2]).toEqual([0.75, 0.8]);
    fireEvent.click(screen.getByRole("button", { name: "Start here" }));
    expect(points()?.[0]).toEqual([0.75, 0.8]);
    expect(picked()).toEqual([0]);
    fireEvent.click(screen.getByRole("button", { name: "Flip ↔" }));
    expect(points()?.[0]?.[0]).toBeCloseTo(0.25);
  });

  it("zooms at the pointer, pans, and fits", () => {
    selected(square);
    const { container } = render(<App />);
    const left = () => (container.querySelector(".artboard") as HTMLElement).style.left;
    const svg = layout();
    const zoom = () => screen.getByRole("button", { name: "Zoom to fit" });
    expect(zoom()).toHaveTextContent("100%");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(zoom()).toHaveTextContent("125%");
    fireEvent.keyDown(window, { key: "0", ctrlKey: true });
    expect(zoom()).toHaveTextContent("100%");

    // The wheel zooms around the pointer: the spot under it stays put.
    const vp = svg.parentElement as HTMLElement;
    fireEvent.wheel(vp, { deltaY: -462, clientX: 40, clientY: 20 });
    expect(zoom()).toHaveTextContent("200%");
    fireEvent.pointerDown(handle("Point 1, start"), { button: 0, clientX: 40, clientY: 20 });
    fireEvent.pointerUp(svg);
    expect(picked()).toEqual([0]);

    // Space+drag pans instead of editing.
    const before = Number.parseFloat(left());
    fireEvent.keyDown(window, { key: " " });
    fireEvent.pointerDown(svg, { button: 0, clientX: 100, clientY: 50 });
    fireEvent.pointerMove(svg, { clientX: 140, clientY: 50 });
    fireEvent.pointerUp(svg);
    fireEvent.keyUp(window, { key: " " });
    expect(points()).toEqual(square.points);
    expect(useStore.getState().selection).not.toBeNull();
    expect(Number.parseFloat(left())).toBeCloseTo(before + 40);

    fireEvent.click(zoom());
    expect(zoom()).toHaveTextContent("100%");
  });

  it("shows shapes only for selected lights or list hover, without canvas labels", () => {
    selected(square);
    const { container } = render(<App />);
    const svg = layout();
    expect(container.querySelector(".shape[data-visible]")).not.toBeNull();
    expect(container.querySelector(".shape[data-filled]")).not.toBeNull();
    expect(container.querySelectorAll(".shape[data-visible] .shape-piece")).toHaveLength(1);
    const fill = screen.getByRole("switch", { name: "Show fill" });
    expect(fill).toHaveAttribute("aria-checked", "true");
    fireEvent.click(fill);
    expect(fill).toHaveAttribute("aria-checked", "false");
    expect(container.querySelector(".shape[data-filled]")).toBeNull();
    expect(container.querySelector(".shape[data-visible] .shape-outline")).not.toBeNull();
    expect(container.querySelector(".tag, .editor-label")).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector(".shape[data-visible]")).toBeNull();
    fireEvent.pointerMove(svg, { clientX: 40, clientY: 20 });
    fireEvent.pointerDown(svg, { button: 0, clientX: 40, clientY: 20 });
    fireEvent.pointerUp(svg);
    expect(useStore.getState().selection).toBeNull();
    expect(container.querySelector(".shape[data-visible]")).toBeNull();
    const row = screen.getByRole("button", { name: "Edit Lamp" }).closest(".light");
    if (!row) throw new Error("Missing light row");
    fireEvent.pointerEnter(row);
    expect(container.querySelector(".shape[data-visible]")).not.toBeNull();
    expect(container.querySelector(".shape[data-filled]")).toBeNull();
    expect(container.querySelector(".tag, .editor-label")).toBeNull();
    fireEvent.pointerLeave(row);
    expect(container.querySelector(".shape[data-visible]")).toBeNull();
    fireEvent.pointerEnter(row);
    fireEvent.click(screen.getByRole("button", { name: "Edit Lamp" }));
    expect(container.querySelector(".shape[data-visible]")).not.toBeNull();
    expect(screen.getByRole("switch", { name: "Show fill" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector(".shape[data-visible]")).toBeNull();
  });

  it("fits a path to the screen on each axis", () => {
    // An L, 0.1 thick: along, then down. Its square start reaches only up and
    // down; its corner and square end reach 5px right.
    selected({
      points: [
        [0.4, 0.4],
        [0.6, 0.4],
        [0.6, 0.6],
      ],
      width: 0.1,
      closed: false,
    });
    render(<App />);
    const engine = () => lastDevice()?.sections[0]?.path?.points;
    const xs = () => engine()?.map(([x]) => Math.round(x * 1000) / 1000);
    expect(screen.getByRole("button", { name: "Horizontal: Exact" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Horizontal: Fit" }));
    expect(xs()).toEqual([0, 0.975, 0.975]);
    expect(engine()?.map(([, y]) => y)).toEqual([0.4, 0.4, 0.6]);
    expect(screen.queryByText(/Auto follows/)).toBeNull();
    // Auto scales the height with the width. The L was 40x20px; it stays
    // twice as wide as it is tall, now 195x97.5px.
    fireEvent.click(screen.getByRole("button", { name: "Vertical: Auto" }));
    const height = () => ((engine()?.[2]?.[1] ?? 0) - (engine()?.[0]?.[1] ?? 0)) * 100;
    expect(height()).toBeCloseTo(97.5);
    // The order doesn't matter: Auto first, then Fit, gives the same.
    fireEvent.click(screen.getByRole("button", { name: "Horizontal: Exact" }));
    fireEvent.click(screen.getByRole("button", { name: "Horizontal: Fit" }));
    expect(height()).toBeCloseTo(97.5);
    // Auto next to Exact does nothing, and says so.
    fireEvent.click(screen.getByRole("button", { name: "Horizontal: Exact" }));
    expect(screen.getByText(/Auto follows/)).toBeInTheDocument();
  });

  it("drags a fitted path: free on its exact axis, pinned on its fitted one", () => {
    selected({
      points: [
        [0.3, 0.5],
        [0.6, 0.5],
      ],
      width: 0.1,
      closed: false,
      fit: { x: "fit", y: "exact" },
      aspect: 2,
    });
    render(<App />);
    const svg = layout();
    // Shown edge to edge: its square ends reach nothing along the line.
    fireEvent.pointerDown(svg, { button: 0, clientX: 100, clientY: 50 });
    fireEvent.pointerMove(svg, { clientX: 130, clientY: 70, altKey: true });
    fireEvent.pointerUp(svg);
    const shown = lastDevice()?.sections[0]?.path?.points;
    expect(shown?.map(([x]) => x)).toEqual([0, 1]);
    expect(shown?.map(([, y]) => Math.round(y * 1000) / 1000)).toEqual([0.7, 0.7]);
  });

  it("calibrates a light step by step on a full screen test color", async () => {
    useStore.setState({ devices: [light({})] });
    vi.mocked(api.listMonitors).mockResolvedValue([
      { index: 0, name: "DISPLAY2", width: 1920, height: 1080 },
    ]);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Edit Lamp" }));
    expect(screen.getByText("Not calibrated")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Calibrate" }));
    const dialog = screen.getByRole("dialog", { name: "Calibrate Lamp" });
    expect(api.fullscreen).toHaveBeenCalledWith("DISPLAY2");
    expect(dialog).toHaveStyle({ background: "rgb(255 255 255)" });
    expect(lastDevice()).toMatchObject({ segments: ["#ffffff"], sections: [{ path: null }] });

    // White: lower blue for a wall that looks too cool.
    const inDialog = within(dialog);
    fireEvent.change(inDialog.getByRole("slider", { name: "Blue" }), { target: { value: "200" } });
    expect(lastDevice()?.calibration.white).toEqual([255, 255, 200]);
    expect(lastDevice()?.calibration.blue).toEqual([0, 0, 200]);
    // Compare with the uncalibrated color.
    await user.click(inDialog.getByRole("switch", { name: "Calibrated" }));
    expect(lastDevice()?.calibration.white).toEqual([255, 255, 255]);
    await user.click(inDialog.getByRole("switch", { name: "Calibrated" }));

    await user.click(inDialog.getByRole("button", { name: "Next" }));
    expect(lastDevice()?.segments).toEqual(["#404040"]);
    fireEvent.change(inDialog.getByRole("slider", { name: "Gamma" }), { target: { value: "2" } });
    expect(lastDevice()?.calibration.gamma).toBe(2);
    await user.click(inDialog.getByRole("button", { name: "Reset" }));
    expect(lastDevice()?.calibration.gamma).toBe(1);
    expect(inDialog.getByRole("button", { name: "Reset" })).toBeDisabled();

    await user.click(inDialog.getByRole("button", { name: /Magenta/ }));
    expect(lastDevice()?.segments).toEqual(["#ff00ff"]);
    await user.click(inDialog.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(lastDevice()?.segments).toEqual(["path"]);
    expect(lastDevice()?.calibration.white).toEqual([255, 255, 200]);
    expect(screen.getByText("Calibrated")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Calibrate" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText("Not calibrated")).toBeInTheDocument();
    expect(lastDevice()?.calibration).toEqual(resolveCalibration());
  });
});
