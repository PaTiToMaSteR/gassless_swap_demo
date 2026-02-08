import crypto from "node:crypto";

export function randomId(prefix: string): string {
  const rand = crypto.randomBytes(6).toString("hex");
  return `${prefix}_${rand}`;
}

export function nowTsSec(): number {
  return Math.floor(Date.now() / 1000);
}

