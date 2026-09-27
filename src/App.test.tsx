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
  it("scans on start, adds a light and assigns a zone", async () => {
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
    await user.click(screen.getByText("All · 100%"));
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const light = trigger.closest(".light") as HTMLElement;

    const zones = screen.getByRole("group", { name: /zone for h6199/i });
    expect(within(zones).getByRole("button", { name: /all/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const left = within(zones).getByRole("button", { name: /left/i });
    await user.click(left);
    expect(left).toHaveAttribute("aria-pressed", "true");
    expect(useStore.getState().devices[0]?.zone).toBe("left");

    const brightness = within(light).getByRole("slider", { name: "Brightness" });
    fireEvent.change(brightness, { target: { value: "0.5" } });
    expect(useStore.getState().devices[0]?.brightness).toBe(0.5);
    expect(screen.getByText("Left · 50%")).toBeInTheDocument();
    expect(vi.mocked(api.setConfig).mock.lastCall?.[0].devices[0]?.brightness).toBe(0.5);
  });

  it("offers white LEDs only on supported lights", async () => {
    useStore.setState({
      devices: [
        {
          id: "A",
          ip: "10.0.0.2",
          sku: "H61F5",
          name: "Strip",
          zone: "all",
          brightness: 1,
          whiteLeds: false,
        },
        {
          id: "B",
          ip: "10.0.0.3",
          sku: "H6199",
          name: "Lamp",
          zone: "all",
          brightness: 1,
          whiteLeds: false,
        },
      ],
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /strip/i }));
    await user.click(screen.getByRole("button", { name: /lamp/i }));
    expect(screen.getAllByRole("switch", { name: /white leds/i })).toHaveLength(1);
    await user.click(screen.getByRole("switch", { name: /white leds/i }));
    expect(useStore.getState().devices[0]?.whiteLeds).toBe(true);
    expect(vi.mocked(api.setConfig).mock.lastCall?.[0].devices[0]).toMatchObject({
      sku: "H61F5",
      whiteLeds: true,
    });
  });

  it("toggles sync", async () => {
    const user = userEvent.setup();
    render(<App />);
    const power = screen.getByRole("switch");
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
