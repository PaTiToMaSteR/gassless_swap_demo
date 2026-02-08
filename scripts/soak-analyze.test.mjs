#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSoakRun } from "./soak-analyze.mjs";

test("analyzeSoakRun passes healthy run", () => {
  const report = analyzeSoakRun({
    attempts: 5,
    runnerFailures: 0,
    maxRunnerFailures: 0,
    maxUserOpFailures: 0,
    maxErrorLogs: 0,
    minSuccessfulSwaps: 5,
    summary: {
      ok: true,
      userOps: {
        totalActualGasCostWei: "5000000000000000",
        totalFeeAmount: "100000000000000000",
      },
    },
    userops: {
      userops: [
        { success: true },
        { success: true },
        { success: true },
        { success: true },
        { success: true },
      ],
    },
    logs: { logs: [{ level: "info" }, { level: "debug" }] },
  });

  assert.equal(report.passed, true);
  assert.equal(report.failedChecks.length, 0);
  assert.equal(report.successfulAttempts, 5);
  assert.equal(report.userOpFailures, 0);
  assert.equal(report.paymasterSponsorship.paymasterSponsorshipRevenueWei, "100000000000000000");
  assert.equal(report.paymasterSponsorship.paymasterSponsorshipExpenseWei, "5000000000000000");
  assert.equal(report.paymasterSponsorship.paymasterSponsorshipNetWei, "95000000000000000");
  assert.equal(report.paymasterSponsorship.paymasterSponsorshipMarginPct, 95);
});

test("analyzeSoakRun fails threshold breaches", () => {
  const report = analyzeSoakRun({
    attempts: 6,
    runnerFailures: 2,
    maxRunnerFailures: 0,
    maxUserOpFailures: 0,
    maxErrorLogs: 1,
    minSuccessfulSwaps: 6,
    summary: {},
    userops: { userops: [{ success: true }, { success: false }] },
    logs: {
      logs: [{ level: "error" }, { level: "ERROR" }, { level: "warn" }],
    },
  });

  assert.equal(report.passed, false);
  assert.equal(report.failedChecks.length, 4);
  assert.equal(report.runnerFailures, 2);
  assert.equal(report.userOpFailures, 1);
  assert.equal(report.errorLogs, 2);
  assert.equal(report.successfulAttempts, 4);
  assert.equal(report.paymasterSponsorship.paymasterSponsorshipRevenueWei, "0");
  assert.equal(report.paymasterSponsorship.paymasterSponsorshipExpenseWei, "0");
  assert.equal(report.paymasterSponsorship.paymasterSponsorshipMarginPct, 0);
});
