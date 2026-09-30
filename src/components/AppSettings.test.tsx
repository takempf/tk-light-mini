import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { AppSettings } from "./AppSettings";

vi.mock("../lib/api", async () => (await import("../test/mockApi")).mockApiModule());

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
