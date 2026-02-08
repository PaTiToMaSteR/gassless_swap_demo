import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

type JsonBody = Record<string, unknown> | Array<unknown>;

function mockJsonResponse(status: number, body: JsonBody): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function getUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function createFetchMock(opts?: { paymasterStatus?: Response }): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = getUrl(input);

    if (url.includes("/api/telemetry/session")) return mockJsonResponse(200, { ok: true });
    if (url.includes("/api/admin/metrics/summary")) {
      return mockJsonResponse(200, {
        startedAt: 0,
        sessions: { web: 0, admin: 0, total: 0 },
        uniqueOwners: 0,
        bundlersUp: 0,
        bundlersTotal: 0,
        logsCount: 0,
        userOps: {
          total: 0,
          succeeded: 0,
          failed: 0,
          uniqueSenders: 0,
          totalActualGasCostWei: "0",
          totalFeeAmount: "0",
        },
      });
    }

    if (url.includes("/api/admin/bundlers") && init?.method !== "POST") return mockJsonResponse(200, []);
    if (url.includes("/api/admin/metrics/timeseries")) return mockJsonResponse(200, { series: [] });
    if (url.includes("/api/admin/users")) return mockJsonResponse(200, { owners: [], senders: [] });
    if (url.includes("/api/admin/userops")) return mockJsonResponse(200, { userops: [] });
    if (url.includes("/api/logs")) return mockJsonResponse(200, { logs: [] });
    if (url.includes("/api/admin/paymaster/status")) {
      return opts?.paymasterStatus ?? mockJsonResponse(200, {
        chainId: 31337,
        rpcUrl: "http://127.0.0.1:8545",
        addresses: { paymaster: "0x0000000000000000000000000000000000000001", entryPoint: "0x0000000000000000000000000000000000000002" },
        entryPointDepositWei: "1",
        paymasterEthBalanceWei: "1",
        tokenOutBalanceWei: "1",
        tokenInBalanceWei: "0",
        policy: { gasBufferBps: 500, fixedMarkupWei: "0" },
        counters: { sponsoredOps: 1, sponsoredOpsSucceeded: 1, sponsoredOpsReverted: 0 },
      });
    }

    return mockJsonResponse(200, { ok: true });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("fetch", createFetchMock() as any);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Admin App", () => {
  it("renders shell", () => {
    const { container } = render(<App />);
    expect(screen.getByText("Admin Console — Gasless Swap")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ops" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Logs" })).toBeInTheDocument();
    expect(container.querySelector(".traffic")).toBeNull();
  });

  it("shows actionable paymaster backend errors", async () => {
    vi.stubGlobal(
      "fetch",
      createFetchMock({
        paymasterStatus: mockJsonResponse(400, { error: "DEPLOYMENTS_PATH not configured" }),
      }) as any,
    );

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Paymaster" }));

    await waitFor(() => {
      expect(screen.getByText("Paymaster status unavailable.")).toBeInTheDocument();
    });

    expect(screen.getByText("Reason: DEPLOYMENTS_PATH not configured")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Fix: Configure DEPLOYMENTS_PATH on paymaster_monitor/server and point it to paymaster/deployments/<network>/addresses.json.",
      ),
    ).toBeInTheDocument();
  });
});
