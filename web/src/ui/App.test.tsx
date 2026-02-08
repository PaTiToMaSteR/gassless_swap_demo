import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("App", () => {
  it("renders shell and connect button", async () => {
    const { App } = await import("./App");
    const { container } = render(<App />);
    expect(screen.getByText("Gasless Swap (ERC‑4337 v0.7)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect metamask/i })).toBeInTheDocument();
    expect(container.querySelector(".traffic")).toBeNull();
  });

  it("renders dev-wallet connect button when configured", async () => {
    vi.stubEnv("VITE_DEV_PRIVATE_KEY", `0x${"11".repeat(32)}`);
    vi.resetModules();

    const { App } = await import("./App");
    render(<App />);
    expect(screen.getAllByRole("button", { name: /connect dev wallet/i }).length).toBeGreaterThan(0);
  });
});
