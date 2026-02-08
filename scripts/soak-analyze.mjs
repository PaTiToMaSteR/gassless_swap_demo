#!/usr/bin/env node
import fs from "node:fs";

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBigInt(value, fallback = 0n) {
  try {
    if (value == null) return fallback;
    return BigInt(value);
  } catch {
    return fallback;
  }
}

export function analyzeSoakRun(input) {
  const attempts = toNumber(input.attempts, 0);
  const maxRunnerFailures = toNumber(input.maxRunnerFailures, 0);
  const maxUserOpFailures = toNumber(input.maxUserOpFailures, 0);
  const maxErrorLogs = toNumber(input.maxErrorLogs, 0);
  const minSuccessfulSwaps = toNumber(input.minSuccessfulSwaps, attempts);

  const userops = Array.isArray(input.userops?.userops) ? input.userops.userops : [];
  const logs = Array.isArray(input.logs?.logs) ? input.logs.logs : [];

  const runnerFailures = toNumber(input.runnerFailures, 0);
  const successfulAttempts = Math.max(0, attempts - runnerFailures);

  const userOpFailures = userops.filter((op) => op && op.success === false).length;
  const userOpSuccesses = userops.filter((op) => op && op.success === true).length;
  const errorLogs = logs.filter((entry) => entry && String(entry.level || "").toLowerCase() === "error").length;

  const checks = [
    {
      name: "runner_failures",
      ok: runnerFailures <= maxRunnerFailures,
      actual: runnerFailures,
      expected: `<= ${maxRunnerFailures}`,
    },
    {
      name: "userop_failures",
      ok: userOpFailures <= maxUserOpFailures,
      actual: userOpFailures,
      expected: `<= ${maxUserOpFailures}`,
    },
    {
      name: "error_logs",
      ok: errorLogs <= maxErrorLogs,
      actual: errorLogs,
      expected: `<= ${maxErrorLogs}`,
    },
    {
      name: "successful_attempts",
      ok: successfulAttempts >= minSuccessfulSwaps,
      actual: successfulAttempts,
      expected: `>= ${minSuccessfulSwaps}`,
    },
  ];

  const failedChecks = checks.filter((check) => !check.ok);
  const totalActualGasCostWei = toBigInt(input.summary?.userOps?.totalActualGasCostWei, 0n);
  const totalFeeAmountWei = toBigInt(input.summary?.userOps?.totalFeeAmount, 0n);
  const paymasterSponsorshipNetWei = totalFeeAmountWei - totalActualGasCostWei;
  const paymasterSponsorshipMarginBps =
    totalFeeAmountWei > 0n ? Number((paymasterSponsorshipNetWei * 10000n) / totalFeeAmountWei) : 0;
  const attemptsBigInt = BigInt(Math.max(attempts, 0));
  const perSwapExpenseWei = attemptsBigInt > 0n ? totalActualGasCostWei / attemptsBigInt : 0n;
  const perSwapRevenueWei = attemptsBigInt > 0n ? totalFeeAmountWei / attemptsBigInt : 0n;
  const perSwapNetWei = perSwapRevenueWei - perSwapExpenseWei;

  return {
    passed: failedChecks.length === 0,
    attempts,
    runnerFailures,
    successfulAttempts,
    userOpsTotal: userops.length,
    userOpSuccesses,
    userOpFailures,
    errorLogs,
    summary: input.summary ?? null,
    paymasterSponsorship: {
      paymasterSponsorshipRevenueWei: totalFeeAmountWei.toString(),
      paymasterSponsorshipExpenseWei: totalActualGasCostWei.toString(),
      paymasterSponsorshipNetWei: paymasterSponsorshipNetWei.toString(),
      paymasterSponsorshipMarginBps,
      paymasterSponsorshipMarginPct: paymasterSponsorshipMarginBps / 100,
      paymasterSponsorshipPerSwapRevenueWei: perSwapRevenueWei.toString(),
      paymasterSponsorshipPerSwapExpenseWei: perSwapExpenseWei.toString(),
      paymasterSponsorshipPerSwapNetWei: perSwapNetWei.toString(),
    },
    checks,
    failedChecks,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith("--")) {
      args[key] = value;
      i += 1;
    } else {
      args[key] = "1";
    }
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/soak-analyze.mjs \\",
    "    --summary <summary.json> \\",
    "    --userops <userops.json> \\",
    "    --logs <logs.json> \\",
    "    --attempts <n> \\",
    "    --runner-failures <n> \\",
    "    [--max-runner-failures <n>] \\",
    "    [--max-userop-failures <n>] \\",
    "    [--max-error-logs <n>] \\",
    "    [--min-successful-swaps <n>] \\",
    "    [--report <path>]",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  const required = ["summary", "userops", "logs", "attempts", "runner-failures"];
  for (const field of required) {
    if (!args[field]) {
      console.error(`Missing required argument: --${field}`);
      console.error(usage());
      process.exit(1);
    }
  }

  const result = analyzeSoakRun({
    summary: readJson(args.summary),
    userops: readJson(args.userops),
    logs: readJson(args.logs),
    attempts: args.attempts,
    runnerFailures: args["runner-failures"],
    maxRunnerFailures: args["max-runner-failures"] ?? process.env.MAX_RUNNER_FAILURES ?? "0",
    maxUserOpFailures: args["max-userop-failures"] ?? process.env.MAX_USEROP_FAILURES ?? "0",
    maxErrorLogs: args["max-error-logs"] ?? process.env.MAX_ERROR_LOGS ?? "0",
    minSuccessfulSwaps: args["min-successful-swaps"] ?? process.env.MIN_SUCCESSFUL_SWAPS ?? args.attempts,
  });

  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (args.report) fs.writeFileSync(args.report, output, "utf8");
  process.stdout.write(output);
  process.exit(result.passed ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
