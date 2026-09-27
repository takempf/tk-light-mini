import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { api } from "./lib/api";
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
  });
  vi.mocked(api.discoverDevices).mockResolvedValue([]);
});

describe("App", () => {
  it("scans on start, adds a light and picks its color", async () => {
    vi.mocked(api.discoverDevices).mockResolvedValue([
      { id: "AA:BB", ip: "10.0.0.2", sku: "H6199" },
    ]);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Add H6199" }));
    // It moves from the found rows into your lights, in the same list.
    expect(screen.queryByRole("button", { name: "Add H6199" })).toBeNull();

    const trigger = screen.getByRole("button", { name: /h6199/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByText("Average · 100%"));
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const light = trigger.closest(".light") as HTMLElement;

    const picker = screen.getByRole("group", { name: /color for h6199/i });
    expect(within(picker).getByRole("button", { name: "Average" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const left = within(picker).getByRole("button", { name: "Left" });
    await user.click(left);
    expect(left).toHaveAttribute("aria-pressed", "true");
    expect(useStore.getState().devices[0]?.color).toBe("left");
    // No segments without razer mode.
    expect(within(light).queryByRole("group", { name: /segments of/i })).toBeNull();

    const brightness = within(light).getByRole("slider", { name: "Brightness" });
    fireEvent.change(brightness, { target: { value: "0.5" } });
    expect(useStore.getState().devices[0]?.brightness).toBe(0.5);
    expect(screen.getByText("Left · 50%")).toBeInTheDocument();
    expect(vi.mocked(api.setConfig).mock.lastCall?.[0].devices[0]?.brightness).toBe(0.5);
  });

  it("streams a light in razer mode with its segment count", async () => {
    useStore.setState({
      devices: [
        {
          id: "A",
          ip: "10.0.0.2",
          sku: "H61F5",
          name: "Strip",
          color: "all",
          brightness: 1,
          razer: false,
          on: true,
        },
      ],
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /strip/i }));
    expect(screen.queryByRole("slider", { name: "Segments" })).toBeNull();
    await user.click(screen.getByRole("switch", { name: /razer/i }));
    expect(useStore.getState().devices[0]?.razer).toBe(true);
    expect(screen.getByRole("slider", { name: "Segments" })).toBeInTheDocument();
    const lastDevice = () => vi.mocked(api.setConfig).mock.lastCall?.[0].devices[0];
    expect(lastDevice()).toMatchObject({ razer: true, segments: Array(10).fill("all") });

    // Segments 2-4 red, the rest stay live.
    const bar = screen.getByRole("group", { name: /segments of strip/i });
    await user.click(within(bar).getByRole("button", { name: "Segment 2" }));
    await user.keyboard("{Shift>}");
    await user.click(within(bar).getByRole("button", { name: "Segment 4" }));
    await user.keyboard("{/Shift}");
    expect(screen.getByText("Color · 3 segments")).toBeInTheDocument();
    const picker = screen.getByRole("group", { name: /color for strip/i });
    await user.click(within(picker).getByRole("button", { name: "Red" }));
    expect(lastDevice()?.segments.slice(0, 5)).toEqual([
      "all",
      "#ff0000",
      "#ff0000",
      "#ff0000",
      "all",
    ]);
    expect(within(picker).getByRole("button", { name: "Red" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Nothing selected: the whole light, which clears the segments.
    await user.click(
      within(bar.parentElement as HTMLElement).getByRole("button", { name: "None" }),
    );
    expect(screen.getByText("Color · Whole light")).toBeInTheDocument();
    await user.click(within(picker).getByRole("button", { name: "Center" }));
    expect(lastDevice()?.segments).toEqual(Array(10).fill("center"));
  });

  it("switches one light off and leaves it out of sync", async () => {
    useStore.setState({
      devices: [
        {
          id: "A",
          ip: "10.0.0.2",
          sku: "H6199",
          name: "Lamp",
          color: "all",
          brightness: 1,
          razer: false,
          on: true,
        },
      ],
    });
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
