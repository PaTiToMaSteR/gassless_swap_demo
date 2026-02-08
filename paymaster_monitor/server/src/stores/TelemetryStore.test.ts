import { describe, expect, it } from "vitest";

import { TelemetryStore } from "./TelemetryStore";

describe("TelemetryStore", () => {
  it("tracks paid fallback metrics counters", () => {
    const store = new TelemetryStore();

    store.recordEvent("paid_fallback_attempt");
    store.recordEvent("paid_fallback_attempt");
    store.recordEvent("paid_fallback_success");
    store.recordEvent("paid_fallback_failure");

    expect(store.getPaidFallbackMetrics()).toEqual({
      attempted: 2,
      succeeded: 1,
      failed: 1,
    });
  });
});
