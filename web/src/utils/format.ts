import { BigNumber, ethers } from "ethers";

export function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function formatCountdown(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}s`;
  return `${m}m ${r}s`;
}

export function formatUnitsSafe(value: string, decimals: number): string {
  try {
    return ethers.utils.formatUnits(BigNumber.from(value), decimals);
  } catch {
    return "0";
  }
}

export function parseUnitsSafe(value: string, decimals: number): BigNumber | null {
  try {
    if (!value || value.trim() === "") return null;
    return ethers.utils.parseUnits(value, decimals);
  } catch {
    return null;
  }
}

