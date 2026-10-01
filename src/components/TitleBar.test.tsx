import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { useUpdates } from "../lib/updates";
import { TitleBar } from "./TitleBar";

vi.mock("../lib/api", async () => (await import("../test/mockApi")).mockApiModule());

beforeEach(() => {
  vi.resetAllMocks();
  useUpdates.setState({ status: { kind: "idle" }, auto: true });
});

describe("TitleBar update button", () => {
  it("shows only once an update is ready, and installs it", async () => {
    const user = userEvent.setup();
    render(<TitleBar />);
    expect(screen.queryByRole("button", { name: /Restart to update/ })).toBeNull();

    act(() => useUpdates.setState({ status: { kind: "checking" } }));
    expect(screen.queryByRole("button", { name: /Restart to update/ })).toBeNull();

    act(() =>
      useUpdates.setState({ status: { kind: "ready", update: { version: "2.0.0", notes: null } } }),
    );
    const button = screen.getByRole("button", { name: "Restart to update to version 2.0.0" });
    expect(button).toHaveTextContent("Update");
    await user.click(button);
    expect(api.installUpdate).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
  });
});
