import { useEffect, useState } from "react";
import { format } from "date-fns";
import { OracleStatus, PriceLog } from "./types";
import "./App.css";

function App() {
    const [status, setStatus] = useState<OracleStatus | null>(null);
    const [logs, setLogs] = useState<PriceLog[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchData = async () => {
        try {
            const [sRes, lRes] = await Promise.all([
                fetch("http://localhost:3003/status"),
                fetch("http://localhost:3003/logs"),
            ]);
            setStatus(await sRes.json());
            setLogs(await lRes.json());
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        fetchData();
        const t = setInterval(fetchData, 2000);
        return () => clearInterval(t);
    }, []);

    const manualUpdate = async () => {
        setLoading(true);
        try {
            await fetch("http://localhost:3003/update", { method: "POST" });
            await fetchData();
        } catch (e) {
            console.error("Update failed", e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="container">
            <div className="card">
                <h1>Oracle Service</h1>

                <div className="status-badge">
                    <div className="status-dot"></div>
                    {status?.ready ? "Operational" : "Initializing"}
                </div>

                <div className="button-list">
                    <button className="action-button" onClick={manualUpdate} disabled={loading}>
                        {loading ? "Updating..." : "Force Price Update →"}
                    </button>

                    <button className="action-button" onClick={() => window.open("http://localhost:3003/status", "_blank")}>
                        Health Check API →
                    </button>

                    <div style={{ marginTop: '24px', width: '100%' }}>
                        <div style={{ textAlign: 'left', fontSize: '0.8rem', opacity: 0.5, marginBottom: '12px', fontWeight: 600, letterSpacing: '0.05em' }}>
                            LIVE PRICES (AVAX)
                        </div>
                        {status?.prices && Object.entries(status.prices).map(([symbol, price]) => (
                            <div key={symbol} className="price-card">
                                <span style={{ fontWeight: 500 }}>{symbol}</span>
                                <span className="mono">{price.toFixed(6)}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="footer">
                    v0.7 • Consensys Demo
                </div>
            </div>

            <div className="log-panel">
                {logs.map((log, i) => (
                    <div key={i} className={`log-item ${log.updated ? "update" : "skip"} ${log.error ? "error" : ""}`}>
                        <div className="log-ts">[{format(new Date(log.ts), "HH:mm:ss")}]</div>
                        <div className="log-msg">
                            {log.symbol}: {log.priceCheck.toFixed(6)} {log.updated ? "(Updated)" : "(Skipped)"}
                            {log.txHash && ` [tx: ${log.txHash.slice(0, 8)}...]`}
                            {log.error && ` [Error: ${log.error}]`}
                        </div>
                    </div>
                ))}
                {logs.length === 0 && <div className="log-msg">Waiting for logs...</div>}
            </div>
        </div>
    );
}

export default App;
