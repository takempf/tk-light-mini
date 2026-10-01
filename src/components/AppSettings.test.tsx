import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { useUpdates } from "../lib/updates";
import { AppSettings } from "./AppSettings";

vi.mock("../lib/api", async () => (await import("../test/mockApi")).mockApiModule());

beforeEach(() => {
  vi.resetAllMocks();
  useUpdates.setState({ status: { kind: "idle" }, auto: true });
});

async function openSettings() {
  const user = userEvent.setup();
  render(<AppSettings />);
  await user.click(screen.getByRole("button", { name: "Settings" }));
  return user;
}

describe("AppSettings", () => {
  it("shows and changes whether the app starts with Windows", async () => {
    const user = userEvent.setup();
    vi.mocked(api.autostart).mockResolvedValue(false);
    render(<AppSettings />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const toggle = await screen.findByRole("switch", { name: "Start with Windows" });
    await vi.waitFor(() => expect(toggle).not.toHaveAttribute("aria-disabled", "true"));
    expect(toggle).not.toBeChecked();

    vi.mocked(api.autostart).mockResolvedValue(true);
    await user.click(toggle);
    expect(api.setAutostart).toHaveBeenCalledWith(true);
    await vi.waitFor(() => expect(toggle).toBeChecked());
  });

  it("puts the switch back and says why when Windows refuses", async () => {
    const user = userEvent.setup();
    vi.mocked(api.autostart).mockResolvedValue(false);
    vi.mocked(api.setAutostart).mockRejectedValue("Access is denied.");
    render(<AppSettings />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const toggle = await screen.findByRole("switch", { name: "Start with Windows" });
    await vi.waitFor(() => expect(toggle).not.toHaveAttribute("aria-disabled", "true"));
    await user.click(toggle);
    expect(await screen.findByText("Access is denied.")).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
  });
});

describe("AppSettings updates", () => {
  it("shows the version and finds it's the latest", async () => {
    vi.mocked(api.version).mockResolvedValue("0.4.2");
    vi.mocked(api.checkUpdate).mockResolvedValue(null);
    const user = await openSettings();
    expect(await screen.findByText("Version 0.4.2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("You have the latest version.")).toBeInTheDocument();
  });

  it("offers a downloaded update with its notes, and installs it", async () => {
    vi.mocked(api.checkUpdate).mockResolvedValue({ version: "0.5.0", notes: "- Faster scans" });
    const user = await openSettings();
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("Version 0.5.0 is ready to install.")).toBeInTheDocument();
    expect(screen.getByText("- Faster scans")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restart to update" }));
    expect(api.installUpdate).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Installing version 0.5.0…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart to update" })).toBeDisabled();
  });

  it("says why a check or an install failed", async () => {
    vi.mocked(api.checkUpdate).mockRejectedValue("no network");
    const user = await openSettings();
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("Couldn't check for updates: no network")).toBeInTheDocument();

    vi.mocked(api.installUpdate).mockRejectedValue("installer missing");
    act(() =>
      useUpdates.setState({ status: { kind: "ready", update: { version: "0.5.0", notes: null } } }),
    );
    await user.click(screen.getByRole("button", { name: "Restart to update" }));
    expect(
      await screen.findByText("Couldn't install version 0.5.0: installer missing"),
    ).toBeInTheDocument();
  });

  it("switches automatic checks off and on", async () => {
    const user = await openSettings();
    const toggle = screen.getByRole("switch", { name: "Check for updates automatically" });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(useUpdates.getState().auto).toBe(false);
    expect(api.checkUpdate).not.toHaveBeenCalled();
    await user.click(toggle);
    expect(api.checkUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("AppSettings iCUE", () => {
  it("says it's ready once the app has the SDK file", async () => {
    vi.mocked(api.icueStatus).mockResolvedValue({ sdk: true, icue: true });
    await openSettings();
    expect(await screen.findByText(/Ready\. Corsair lights show up/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download from Corsair" })).toBeNull();
  });

  it("downloads the SDK at the user's request, then scans", async () => {
    vi.mocked(api.icueStatus).mockResolvedValue({ sdk: false, icue: true });
    const user = await openSettings();
    expect(await screen.findByText(/Corsair's license doesn't let/)).toBeInTheDocument();
    expect(api.downloadIcueSdk).not.toHaveBeenCalled();

    vi.mocked(api.icueStatus).mockResolvedValue({ sdk: true, icue: true });
    await user.click(screen.getByRole("button", { name: "Download from Corsair" }));
    expect(api.downloadIcueSdk).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Ready\./)).toBeInTheDocument();
    expect(api.discoverDevices).toHaveBeenCalled();
  });

  it("takes a file the user picks, and does nothing if they cancel", async () => {
    vi.mocked(api.icueStatus).mockResolvedValue({ sdk: false, icue: true });
    vi.mocked(api.chooseIcueSdk).mockResolvedValue(false);
    const user = await openSettings();
    await user.click(await screen.findByRole("button", { name: "Choose file…" }));
    expect(api.chooseIcueSdk).toHaveBeenCalledTimes(1);
    expect(api.discoverDevices).not.toHaveBeenCalled();

    vi.mocked(api.chooseIcueSdk).mockResolvedValue(true);
    vi.mocked(api.icueStatus).mockResolvedValue({ sdk: true, icue: true });
    await user.click(screen.getByRole("button", { name: "Choose file…" }));
    expect(await screen.findByText(/Ready\./)).toBeInTheDocument();
    expect(api.discoverDevices).toHaveBeenCalled();
  });

  it("says why getting it failed", async () => {
    vi.mocked(api.icueStatus).mockResolvedValue({ sdk: false, icue: true });
    vi.mocked(api.downloadIcueSdk).mockRejectedValue("download: offline");
    const user = await openSettings();
    await user.click(await screen.findByRole("button", { name: "Download from Corsair" }));
    expect(await screen.findByText("download: offline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download from Corsair" })).toBeEnabled();
  });

  it("says when iCUE itself isn't installed", async () => {
    vi.mocked(api.icueStatus).mockResolvedValue({ sdk: false, icue: false });
    await openSettings();
    expect(await screen.findByText(/iCUE isn't installed/)).toBeInTheDocument();
  });
});
