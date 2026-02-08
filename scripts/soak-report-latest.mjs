#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const soakRoot = path.join(rootDir, "output", "soak");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function toEthString(weiString) {
  try {
    const wei = BigInt(weiString);
    const ethWhole = wei / 1000000000000000000n;
    const ethFrac = (wei % 1000000000000000000n).toString().padStart(18, "0").replace(/0+$/, "");
    return ethFrac.length > 0 ? `${ethWhole}.${ethFrac}` : `${ethWhole}`;
  } catch {
    return "0";
  }
}

function findLatestRunDir() {
  if (!fs.existsSync(soakRoot)) return null;
  const entries = fs
    .readdirSync(soakRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (entries.length === 0) return null;
  return path.join(soakRoot, entries[entries.length - 1]);
}

function printLine(label, value) {
  process.stdout.write(`${label}: ${value}\n`);
}

function deriveEconomics(report) {
  const current = report.paymasterSponsorship;
  if (current) return current;

  const attempts = Math.max(Number(report.attempts ?? 0), 0);
  const summaryUserOps = report.summary?.userOps ?? {};
  const revenue = BigInt(summaryUserOps.totalFeeAmount ?? "0");
  const expense = BigInt(summaryUserOps.totalActualGasCostWei ?? "0");
  const net = revenue - expense;
  const marginBps = revenue > 0n ? Number((net * 10000n) / revenue) : 0;
  const attemptsBigInt = BigInt(attempts);
  const perSwapRevenue = attemptsBigInt > 0n ? revenue / attemptsBigInt : 0n;
  const perSwapExpense = attemptsBigInt > 0n ? expense / attemptsBigInt : 0n;

  return {
    paymasterSponsorshipRevenueWei: revenue.toString(),
    paymasterSponsorshipExpenseWei: expense.toString(),
    paymasterSponsorshipNetWei: net.toString(),
    paymasterSponsorshipMarginBps: marginBps,
    paymasterSponsorshipMarginPct: marginBps / 100,
    paymasterSponsorshipPerSwapRevenueWei: perSwapRevenue.toString(),
    paymasterSponsorshipPerSwapExpenseWei: perSwapExpense.toString(),
    paymasterSponsorshipPerSwapNetWei: (perSwapRevenue - perSwapExpense).toString(),
  };
}

function main() {
  const runDir = process.argv[2] ? path.resolve(process.argv[2]) : findLatestRunDir();
  if (!runDir) {
    console.error("No soak run found under output/soak.");
    process.exit(1);
  }

  const reportPath = path.join(runDir, "report.json");
  if (!fs.existsSync(reportPath)) {
    console.error(`Missing report file: ${reportPath}`);
    process.exit(1);
  }

  const report = readJson(reportPath);
  const economics = deriveEconomics(report);

  printLine("Soak Run Directory", runDir);
  printLine("Passed", String(Boolean(report.passed)));
  printLine("Attempts", String(report.attempts ?? 0));
  printLine("Successful Attempts", String(report.successfulAttempts ?? 0));
  printLine("Runner Failures", String(report.runnerFailures ?? 0));
  printLine("UserOperation Failures", String(report.userOpFailures ?? 0));
  printLine("Error Logs (run window)", String(report.errorLogs ?? 0));
  const paidFallback = report.summary?.paidFallback ?? {};
  printLine("Paid Fallback Attempts", String(paidFallback.attempted ?? 0));
  printLine("Paid Fallback Successes", String(paidFallback.succeeded ?? 0));
  printLine("Paid Fallback Failures", String(paidFallback.failed ?? 0));
  process.stdout.write("\n");
  printLine("Paymaster Sponsorship Revenue (wei)", String(economics.paymasterSponsorshipRevenueWei ?? "0"));
  printLine("Paymaster Sponsorship Revenue (ETH)", toEthString(String(economics.paymasterSponsorshipRevenueWei ?? "0")));
  printLine("Paymaster Sponsorship Expense (wei)", String(economics.paymasterSponsorshipExpenseWei ?? "0"));
  printLine("Paymaster Sponsorship Expense (ETH)", toEthString(String(economics.paymasterSponsorshipExpenseWei ?? "0")));
  printLine("Paymaster Sponsorship Net (wei)", String(economics.paymasterSponsorshipNetWei ?? "0"));
  printLine("Paymaster Sponsorship Net (ETH)", toEthString(String(economics.paymasterSponsorshipNetWei ?? "0")));
  printLine(
    "Paymaster Sponsorship Margin (%)",
    String(Number(economics.paymasterSponsorshipMarginPct ?? 0).toFixed(2)),
  );
  printLine(
    "Paymaster Sponsorship Per-Swap Revenue (wei)",
    String(economics.paymasterSponsorshipPerSwapRevenueWei ?? "0"),
  );
  printLine(
    "Paymaster Sponsorship Per-Swap Expense (wei)",
    String(economics.paymasterSponsorshipPerSwapExpenseWei ?? "0"),
  );
  printLine(
    "Paymaster Sponsorship Per-Swap Net (wei)",
    String(economics.paymasterSponsorshipPerSwapNetWei ?? "0"),
  );
}

main();
