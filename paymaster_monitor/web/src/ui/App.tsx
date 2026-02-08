import { useEffect, useMemo, useState } from "react";

import type { BundlerInstance, LogEvent, MetricsSummary, PaymasterStatus, UserOpSummary, UsersResponse } from "../utils/types";
import { fetchBundlers, fetchPaymasterStatus, fetchSummary, fetchTimeseries, fetchUserOps, fetchUsers, queryLogs, registerBundler, spawnBundler, stopBundler, unregisterBundler } from "../utils/api";
import { getOrCreateAdminSessionId, getStoredAdminToken, storeAdminToken } from "../utils/session";

type Page = "dashboard" | "bundlers" | "paymaster" | "users" | "ops" | "logs";

function short(s: string): string {
  if (!s) return "—";
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function tsToTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString();
}

function msToTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString();
}

function format18(wei: string): string {
  try {
    const w = BigInt(wei);
    const base = 10n ** 18n;
    const whole = w / base;
    const frac = (w % base).toString().padStart(18, "0").slice(0, 4);
    return `${whole.toString()}.${frac}`;
  } catch {
    return wei;
  }
}

function paymasterTroubleshootingMessage(errorMessage: string): string {
  const message = errorMessage.trim().toLowerCase();

  if (message.includes("deployments_path not configured")) {
    return "Configure DEPLOYMENTS_PATH on paymaster_monitor/server and point it to paymaster/deployments/<network>/addresses.json.";
  }

  if (message.includes("unauthorized") || message.includes("http 401")) {
    return "Set the correct ADMIN_TOKEN in the monitor backend and in the Admin UI token input.";
  }

  if (
    message.includes("enoent")
    || message.includes("no such file")
    || message.includes("abi")
  ) {
    return "Export ABI files with paymaster/scripts/export-abis.sh <network> so paymaster/deployments/<network>/abis exists.";
  }

  return "Verify monitor RPC_URL, DEPLOYMENTS_PATH, and deployment artifacts for the selected network.";
}

function sparklinePath(values: number[], width: number, height: number): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 4;
  const w = width - pad * 2;
  const h = height - pad * 2;

  return values
    .map((v, i) => {
      const x = pad + (w * i) / Math.max(1, values.length - 1);
      const y = pad + h - ((v - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function App() {
  const monitorUrl = (import.meta.env.VITE_MONITOR_URL as string | undefined) ?? "http://127.0.0.1:3002";
  const [adminToken, setAdminToken] = useState<string>(() => getStoredAdminToken());
  const sessionId = useMemo(() => getOrCreateAdminSessionId(), []);

  const [page, setPage] = useState<Page>("dashboard");
  const [err, setErr] = useState<string>("");

  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [bundlers, setBundlers] = useState<BundlerInstance[]>([]);
  const [paymaster, setPaymaster] = useState<PaymasterStatus | null>(null);
  const [paymasterLoading, setPaymasterLoading] = useState<boolean>(false);
  const [paymasterError, setPaymasterError] = useState<string>("");

  const [spawnBase, setSpawnBase] = useState<"bundler1" | "bundler2">("bundler2");
  const [spawnName, setSpawnName] = useState<string>("");
  const [spawnMinPrio, setSpawnMinPrio] = useState<string>("0.2");
  const [spawnMinMax, setSpawnMinMax] = useState<string>("10");
  const [spawnStrict, setSpawnStrict] = useState<boolean>(false);
  const [spawnDelayMs, setSpawnDelayMs] = useState<string>("0");
  const [spawnFailureRate, setSpawnFailureRate] = useState<string>("0");

  const [registerName, setRegisterName] = useState<string>("");
  const [registerRpcUrl, setRegisterRpcUrl] = useState<string>("");

  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [logFilters, setLogFilters] = useState<{ service: string; level: string; q: string }>({ service: "", level: "", q: "" });
  const [selectedLog, setSelectedLog] = useState<LogEvent | null>(null);
  const [live, setLive] = useState<boolean>(false);

  const [userOps, setUserOps] = useState<UserOpSummary[]>([]);
  const [opFilters, setOpFilters] = useState<{ sender: string; success: "" | "true" | "false" }>({ sender: "", success: "" });
  const [selectedOp, setSelectedOp] = useState<UserOpSummary | null>(null);
  const [opsSeries, setOpsSeries] = useState<Array<{ t: number; ops: number; feesWei: string; gasWei: string }>>([]);

  const [users, setUsers] = useState<UsersResponse | null>(null);
  const [usersTab, setUsersTab] = useState<"owners" | "senders">("owners");
  const [userQuery, setUserQuery] = useState<string>("");

  useEffect(() => {
    storeAdminToken(adminToken);
  }, [adminToken]);

  // heartbeat (admin sessions)
  useEffect(() => {
    const send = async () => {
      try {
        await fetch(`${monitorUrl}/api/telemetry/session`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, app: "admin" }),
        });
      } catch {
        // ignore
      }
    };
    void send();
    const t = setInterval(() => void send(), 10_000);
    return () => clearInterval(t);
  }, [monitorUrl, sessionId]);

  async function refresh(): Promise<void> {
    setErr("");
    try {
      const [s, b] = await Promise.all([fetchSummary(monitorUrl, adminToken), fetchBundlers(monitorUrl, adminToken)]);
      setSummary(s);
      setBundlers(b);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to refresh admin data");
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 4_000);
    return () => clearInterval(t);
  }, [monitorUrl, adminToken]);

  useEffect(() => {
    if (page !== "paymaster") return;
    (async () => {
      setPaymasterLoading(true);
      setPaymasterError("");
      try {
        setPaymaster(await fetchPaymasterStatus(monitorUrl, adminToken));
      } catch (e: any) {
        const message = e?.message ?? "Failed to load paymaster";
        setPaymaster(null);
        setPaymasterError(message);
        setErr(message);
      } finally {
        setPaymasterLoading(false);
      }
    })();
  }, [page, monitorUrl, adminToken]);

  useEffect(() => {
    if (page !== "logs") return;
    (async () => {
      const next = await queryLogs(monitorUrl, {
        limit: "200",
        ...(logFilters.service ? { service: logFilters.service } : {}),
        ...(logFilters.level ? { level: logFilters.level } : {}),
        ...(logFilters.q ? { q: logFilters.q } : {}),
      });
      setLogs(next);
    })();
  }, [page, monitorUrl, logFilters]);

  useEffect(() => {
    if (page !== "dashboard") return;
    (async () => {
      try {
        setOpsSeries(await fetchTimeseries(monitorUrl, adminToken, { windowSec: "86400", bucketSec: "3600" }));
      } catch {
        // ignore
      }
    })();
  }, [page, monitorUrl, adminToken]);

  useEffect(() => {
    if (page !== "ops") return;
    (async () => {
      try {
        const next = await fetchUserOps(monitorUrl, adminToken, {
          limit: "200",
          ...(opFilters.sender ? { sender: opFilters.sender } : {}),
          ...(opFilters.success ? { success: opFilters.success } : {}),
        });
        setUserOps(next);
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load userOps");
      }
    })();
  }, [page, monitorUrl, adminToken, opFilters]);

  useEffect(() => {
    if (page !== "users") return;
    let cancelled = false;
    const load = async () => {
      try {
        const next = await fetchUsers(monitorUrl, adminToken);
        if (!cancelled) setUsers(next);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to load users");
      }
    };
    void load();
    const t = setInterval(() => void load(), 4_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [page, monitorUrl, adminToken]);

  // live tail via SSE
  useEffect(() => {
    if (!live || page !== "logs") return;
    const es = new EventSource(`${monitorUrl}/api/logs/stream`);
    es.addEventListener("log", (ev) => {
      try {
        const e = JSON.parse((ev as MessageEvent).data) as LogEvent;
        setLogs((prev) => [...prev.slice(-400), e]);
      } catch {
        // ignore
      }
    });
    es.onerror = () => {
      // ignore
    };
    return () => es.close();
  }, [live, page, monitorUrl]);

  async function onSpawn(): Promise<void> {
    setErr("");
    try {
      await spawnBundler(monitorUrl, adminToken, {
        base: spawnBase,
        name: spawnName || undefined,
        policy: {
          strict: spawnStrict,
          minPriorityFeeGwei: Number(spawnMinPrio),
          minMaxFeeGwei: Number(spawnMinMax),
          delayMs: Number(spawnDelayMs),
          failureRate: Number(spawnFailureRate),
        },
      });
      await refresh();
      setSpawnName("");
    } catch (e: any) {
      setErr(e?.message ?? "Spawn failed");
    }
  }

  async function onRegister(): Promise<void> {
    setErr("");
    try {
      await registerBundler(monitorUrl, adminToken, { name: registerName, rpcUrl: registerRpcUrl });
      setRegisterName("");
      setRegisterRpcUrl("");
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Register failed");
    }
  }

  const dashboard = (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="panel">
        <div className="row space">
          <h2 className="h1">Dashboard</h2>
          <span className={`pill ${summary?.bundlersUp ? "good" : "warn"}`}>{summary ? `${summary.bundlersUp}/${summary.bundlersTotal} bundlers up` : "—"}</span>
        </div>

        <div className="kpis">
          <div className="kpi">
            <div className="label">Sessions (web/admin)</div>
            <div className="value">{summary ? `${summary.sessions.web}/${summary.sessions.admin}` : "—"}</div>
          </div>
          <div className="kpi">
            <div className="label">Unique wallets</div>
            <div className="value">{summary ? String(summary.uniqueOwners) : "—"}</div>
          </div>
          <div className="kpi">
            <div className="label">Logs retained</div>
            <div className="value">{summary ? String(summary.logsCount) : "—"}</div>
          </div>
          <div className="kpi">
            <div className="label">UserOps (total)</div>
            <div className="value">{summary?.userOps ? String(summary.userOps.total) : "—"}</div>
          </div>
          <div className="kpi">
            <div className="label">UserOps (success)</div>
            <div className="value">
              {summary?.userOps ? `${summary.userOps.succeeded}/${summary.userOps.total}` : "—"}
            </div>
          </div>
          <div className="kpi">
            <div className="label">Fees collected (wei)</div>
            <div className="value">{summary?.userOps ? summary.userOps.totalFeeAmount : "—"}</div>
          </div>
        </div>

        <div style={{ height: 12 }} />
        <div className="mono">monitor: {monitorUrl} • session: {sessionId}</div>
      </div>

      <div className="panel">
        <div className="row space">
          <h2 className="h1">Ops (last 24h)</h2>
          <span className="pill">{opsSeries.length ? `${opsSeries.reduce((a, b) => a + b.ops, 0)} ops` : "—"}</span>
        </div>
        <svg width="100%" height="64" viewBox="0 0 520 64" preserveAspectRatio="none">
          <path
            d={sparklinePath(opsSeries.map((p) => p.ops), 520, 64)}
            fill="none"
            stroke="rgba(106, 169, 255, 0.9)"
            strokeWidth="2"
          />
        </svg>
        <div className="mono">hourly buckets • powered by `/api/admin/metrics/timeseries`</div>
      </div>
    </div>
  );

  const bundlersPage = (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="panel">
        <div className="row space">
          <h2 className="h1">Bundlers</h2>
          <button onClick={refresh}>Refresh</button>
        </div>

        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>RPC</th>
              <th>Policy</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {bundlers.map((b) => (
              <tr key={b.id}>
                <td className="mono">{b.id}</td>
                <td className="mono">{b.rpcUrl}</td>
                <td className="mono">
                  {b.policy.strict ? "strict" : "lenient"} • minPrio {b.policy.minPriorityFeeGwei ?? 0} • minMax {b.policy.minMaxFeeGwei ?? 0}
                </td>
                <td>
                  <span className={`pill ${b.status === "UP" ? "good" : b.status === "DOWN" ? "warn" : "bad"}`}>{b.status}</span>
                </td>
                <td>
                  <div className="row">
                    {b.spawned && b.status !== "STOPPED" && (
                      <button onClick={async () => { await stopBundler(monitorUrl, adminToken, b.id); await refresh(); }}>
                        Stop
                      </button>
                    )}
                    <button onClick={async () => { await unregisterBundler(monitorUrl, adminToken, b.id); await refresh(); }}>
                      Unregister
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {bundlers.length === 0 && (
              <tr>
                <td colSpan={5} className="mono">No bundlers registered yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <div className="row space">
          <h2 className="h1">Spawn bundler</h2>
          <span className="pill">writes config + spawns process</span>
        </div>
        <div className="row">
          <div style={{ flex: 1 }}>
            <div className="mono">Base</div>
            <select value={spawnBase} onChange={(e) => setSpawnBase(e.target.value as any)}>
              <option value="bundler1">bundler1 (strict)</option>
              <option value="bundler2">bundler2 (fast)</option>
            </select>
          </div>
          <div style={{ flex: 2 }}>
            <div className="mono">Name</div>
            <input value={spawnName} onChange={(e) => setSpawnName(e.target.value)} placeholder="Optional label" />
          </div>
        </div>
        <div style={{ height: 10 }} />
        <div className="row">
          <div style={{ flex: 1 }}>
            <div className="mono">minPriorityFee (gwei)</div>
            <input value={spawnMinPrio} onChange={(e) => setSpawnMinPrio(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="mono">minMaxFee (gwei)</div>
            <input value={spawnMinMax} onChange={(e) => setSpawnMinMax(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="mono">delayMs</div>
            <input value={spawnDelayMs} onChange={(e) => setSpawnDelayMs(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="mono">failureRate</div>
            <input value={spawnFailureRate} onChange={(e) => setSpawnFailureRate(e.target.value)} />
          </div>
        </div>
        <div style={{ height: 10 }} />
        <div className="row space">
          <label className="mono">
            <input type="checkbox" checked={spawnStrict} onChange={(e) => setSpawnStrict(e.target.checked)} /> strict
          </label>
          <button className="primary" onClick={onSpawn}>Spawn</button>
        </div>
      </div>

      <div className="panel">
        <div className="row space">
          <h2 className="h1">Register external bundler</h2>
          <span className="pill">no process spawn</span>
        </div>
        <div className="row">
          <input value={registerName} onChange={(e) => setRegisterName(e.target.value)} placeholder="Name" />
          <input value={registerRpcUrl} onChange={(e) => setRegisterRpcUrl(e.target.value)} placeholder="http://.../rpc" />
          <button onClick={onRegister}>Register</button>
        </div>
      </div>
    </div>
  );

  const paymasterPage = (
    <div className="panel">
      <div className="row space">
        <h2 className="h1">Paymaster</h2>
        <span className="pill">{paymaster ? `chain ${paymaster.chainId}` : "—"}</span>
      </div>

      {paymaster ? (
        <div style={{ display: "grid", gap: 10 }}>
          <div className="kpis">
            <div className="kpi">
              <div className="label">EntryPoint deposit (wei)</div>
              <div className="value">{paymaster.entryPointDepositWei}</div>
            </div>
            <div className="kpi">
              <div className="label">Paymaster ETH balance (wei)</div>
              <div className="value">{paymaster.paymasterEthBalanceWei}</div>
            </div>
            <div className="kpi">
              <div className="label">TokenOut fees (wei)</div>
              <div className="value">{paymaster.tokenOutBalanceWei}</div>
            </div>
          </div>

          <div className="mono">paymaster: {short(paymaster.addresses.paymaster)} • entryPoint: {short(paymaster.addresses.entryPoint)}</div>
          <div className="mono">policy: bufferBps={paymaster.policy.gasBufferBps} fixedMarkupWei={paymaster.policy.fixedMarkupWei}</div>
          <div className="mono">ops: total={paymaster.counters.sponsoredOps} success={paymaster.counters.sponsoredOpsSucceeded} reverted={paymaster.counters.sponsoredOpsReverted}</div>
        </div>
      ) : paymasterLoading ? (
        <div className="mono">Loading paymaster status...</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <div className="mono">Paymaster status unavailable.</div>
          {paymasterError && <div className="mono">Reason: {paymasterError}</div>}
          <div className="mono">Fix: {paymasterTroubleshootingMessage(paymasterError)}</div>
        </div>
      )}
    </div>
  );

  const usersQuery = userQuery.trim().toLowerCase();

  const usersPage = (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="panel">
        <div className="row space">
          <h2 className="h1">Users</h2>
          <span className="pill">
            {users ? `${users.owners.length} owners • ${users.senders.length} accounts` : "—"}
          </span>
        </div>
        <div className="row">
          <button className={usersTab === "owners" ? "primary" : ""} onClick={() => setUsersTab("owners")}>Owners</button>
          <button className={usersTab === "senders" ? "primary" : ""} onClick={() => setUsersTab("senders")}>Accounts</button>
          <input value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="filter by address…" />
          <button onClick={() => setUserQuery("")}>Clear</button>
        </div>
        <div className="mono">
          Owners and account mappings come from telemetry; UserOp stats come from the on-chain indexer.
        </div>
      </div>

      <div className="panel">
        {usersTab === "owners" ? (
          <table>
            <thead>
              <tr>
                <th>Last seen</th>
                <th>Owner</th>
                <th>Accounts</th>
                <th>Ops</th>
                <th>Gas (ETH)</th>
                <th>Fees (TokenOut)</th>
              </tr>
            </thead>
            <tbody>
              {(users?.owners ?? [])
                .filter((o) => !usersQuery || o.owner.toLowerCase().includes(usersQuery) || o.senders.some((s) => s.toLowerCase().includes(usersQuery)))
                .map((o) => (
                  <tr key={o.owner}>
                    <td className="mono">{msToTime(o.lastSeenMs)}</td>
                    <td className="mono">{short(o.owner)}</td>
                    <td className="mono">
                      {o.senders.length === 0 ? (
                        "—"
                      ) : (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {o.senders.slice(0, 4).map((s) => (
                            <span
                              key={s}
                              className="pill"
                              style={{ cursor: "pointer" }}
                              title="Jump to Ops filtered by this account"
                              onClick={() => {
                                setOpFilters({ sender: s, success: "" });
                                setPage("ops");
                              }}
                            >
                              {short(s)}
                            </span>
                          ))}
                          {o.senders.length > 4 && <span className="pill">+{o.senders.length - 4}</span>}
                        </div>
                      )}
                    </td>
                    <td className="mono">
                      {o.succeeded}/{o.total} ({o.total ? Math.round((100 * o.succeeded) / o.total) : 0}%)
                    </td>
                    <td className="mono">{format18(o.totalActualGasCostWei)}</td>
                    <td className="mono">{format18(o.totalFeeAmount)}</td>
                  </tr>
                ))}
              {(users?.owners ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="mono">No telemetry yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Last op</th>
                <th>Account (sender)</th>
                <th>Owner</th>
                <th>Ops</th>
                <th>Gas (ETH)</th>
                <th>Fees (TokenOut)</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {(users?.senders ?? [])
                .filter((s) => !usersQuery || s.sender.toLowerCase().includes(usersQuery) || (s.owner ?? "").toLowerCase().includes(usersQuery))
                .map((s) => (
                  <tr
                    key={s.sender}
                    onClick={() => {
                      setOpFilters({ sender: s.sender, success: "" });
                      setPage("ops");
                    }}
                    style={{ cursor: "pointer" }}
                    title="Jump to Ops filtered by this account"
                  >
                    <td className="mono">{s.lastOpTs ? tsToTime(s.lastOpTs) : "—"}</td>
                    <td className="mono">{short(s.sender)}</td>
                    <td className="mono">{s.owner ? short(s.owner) : "—"}</td>
                    <td className="mono">
                      {s.succeeded}/{s.total} ({s.total ? Math.round((100 * s.succeeded) / s.total) : 0}%)
                    </td>
                    <td className="mono">{format18(s.totalActualGasCostWei)}</td>
                    <td className="mono">{format18(s.totalFeeAmount)}</td>
                    <td className="mono">{s.lastSeenMs ? msToTime(s.lastSeenMs) : "—"}</td>
                  </tr>
                ))}
              {(users?.senders ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="mono">No accounts indexed yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  const logsPage = (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="panel">
        <div className="row space">
          <h2 className="h1">Logs Explorer</h2>
          <label className="mono">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> live tail (SSE)
          </label>
        </div>
        <div className="row">
          <input
            value={logFilters.service}
            onChange={(e) => setLogFilters((p) => ({ ...p, service: e.target.value }))}
            placeholder="service (bundler1_..., quote_service, ...)"
          />
          <select value={logFilters.level} onChange={(e) => setLogFilters((p) => ({ ...p, level: e.target.value }))}>
            <option value="">level (any)</option>
            <option value="debug">debug</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </select>
          <input value={logFilters.q} onChange={(e) => setLogFilters((p) => ({ ...p, q: e.target.value }))} placeholder="contains…" />
          <button onClick={async () => setLogs(await queryLogs(monitorUrl, { limit: "200" }))}>Clear filters</button>
        </div>
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Service</th>
              <th>Level</th>
              <th>Message</th>
              <th>Refs</th>
            </tr>
          </thead>
          <tbody>
            {logs.slice(-200).reverse().map((l, idx) => (
              <tr key={`${l.ts}-${idx}`} onClick={() => setSelectedLog(l)} style={{ cursor: "pointer" }}>
                <td className="mono">{tsToTime(l.ts)}</td>
                <td className="mono">{l.service}</td>
                <td>
                  <span className={`pill ${l.level === "error" ? "bad" : l.level === "warn" ? "warn" : "good"}`}>{l.level}</span>
                </td>
                <td className="mono">{l.msg}</td>
                <td className="mono">
                  {l.userOpHash ? `op=${short(l.userOpHash)}` : ""} {l.txHash ? `tx=${short(l.txHash)}` : ""}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={5} className="mono">No logs yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedLog && (
        <div className="drawer">
          <div className="row space">
            <h2 className="h1">Log</h2>
            <button onClick={() => setSelectedLog(null)}>Close</button>
          </div>
          <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(selectedLog, null, 2)}</pre>
        </div>
      )}
    </div>
  );

  const opsPage = (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="panel">
        <div className="row space">
          <h2 className="h1">Operations</h2>
          <span className="pill">indexed from on-chain events</span>
        </div>
        <div className="row">
          <input
            value={opFilters.sender}
            onChange={(e) => setOpFilters((p) => ({ ...p, sender: e.target.value }))}
            placeholder="sender (0x...)"
          />
          <select value={opFilters.success} onChange={(e) => setOpFilters((p) => ({ ...p, success: e.target.value as any }))}>
            <option value="">status (any)</option>
            <option value="true">success</option>
            <option value="false">failed</option>
          </select>
          <button onClick={() => setOpFilters({ sender: "", success: "" })}>Clear</button>
        </div>
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Sender</th>
              <th>Status</th>
              <th>Gas (wei)</th>
              <th>Fee (wei)</th>
              <th>Bundler</th>
              <th>Refs</th>
            </tr>
          </thead>
          <tbody>
            {userOps.slice(0, 200).map((u, idx) => (
              <tr key={`${u.userOpHash}-${idx}`} onClick={() => setSelectedOp(u)} style={{ cursor: "pointer" }}>
                <td className="mono">{tsToTime(u.ts)}</td>
                <td className="mono">{short(u.sender)}</td>
                <td>
                  <span className={`pill ${u.success ? "good" : "bad"}`}>{u.success ? "success" : "failed"}</span>
                </td>
                <td className="mono">{u.actualGasCostWei}</td>
                <td className="mono">{u.feeAmount ?? "—"}</td>
                <td className="mono">{u.bundler ? short(u.bundler) : "—"}</td>
                <td className="mono">op={short(u.userOpHash)} tx={short(u.txHash)}</td>
              </tr>
            ))}
            {userOps.length === 0 && (
              <tr>
                <td colSpan={7} className="mono">No indexed operations yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedOp && (
        <div className="drawer">
          <div className="row space">
            <h2 className="h1">Operation</h2>
            <button onClick={() => setSelectedOp(null)}>Close</button>
          </div>
          <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(selectedOp, null, 2)}</pre>
        </div>
      )}
    </div>
  );

  return (
    <div className="window">
      <div className="titlebar">
        <div className="title">Admin Console — Gasless Swap</div>
        <div className="row" style={{ width: 460 }}>
          <input
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            placeholder="ADMIN_TOKEN"
          />
          <span className={`pill ${err ? "bad" : "good"}`}>{err ? "auth/error" : "ok"}</span>
        </div>
      </div>

      <div className="content">
        <div className="sidebar">
          <div className="nav">
            <button className={page === "dashboard" ? "active" : ""} onClick={() => setPage("dashboard")}>Dashboard</button>
            <button className={page === "bundlers" ? "active" : ""} onClick={() => setPage("bundlers")}>Bundlers</button>
            <button className={page === "paymaster" ? "active" : ""} onClick={() => setPage("paymaster")}>Paymaster</button>
            <button className={page === "users" ? "active" : ""} onClick={() => setPage("users")}>Users</button>
            <button className={page === "ops" ? "active" : ""} onClick={() => setPage("ops")}>Ops</button>
            <button className={page === "logs" ? "active" : ""} onClick={() => setPage("logs")}>Logs</button>
          </div>
          <div style={{ height: 12 }} />
          <div className="mono">monitor: {monitorUrl}</div>
        </div>

        <div className="main">
          {err && <div className="mono" style={{ marginBottom: 10 }}>Error: {err}</div>}
          {page === "dashboard" && dashboard}
          {page === "bundlers" && bundlersPage}
          {page === "paymaster" && paymasterPage}
          {page === "users" && usersPage}
          {page === "ops" && opsPage}
          {page === "logs" && logsPage}
        </div>
      </div>
    </div>
  );
}
