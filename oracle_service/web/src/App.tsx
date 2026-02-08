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
            alert("Update failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="container">
            <header>
                <h1>Oracle Service</h1>
                <div className="status-badge">
                    {status?.ready ? <span className="good">Running</span> : <span className="bad">Stopped</span>}
                </div>
            </header>

            <main>
                <section className="panel">
                    <h2>Current Prices</h2>
                    <div className="prices-grid">
                        {status?.prices && Object.entries(status.prices).map(([symbol, price]) => (
                            <div key={symbol} className="price-card">
                                <div className="symbol">{symbol}</div>
                                <div className="price">{price.toFixed(6)} AVAX</div>
                            </div>
                        ))}
                        {!status?.prices && <div>No prices yet...</div>}
                    </div>
                    <div className="actions">
                        <button onClick={manualUpdate} disabled={loading}>
                            {loading ? "Updating..." : "Force Update Now"}
                        </button>
                        <div className="last-update">
                            Last update: {status?.lastUpdateTs ? format(new Date(status.lastUpdateTs), "HH:mm:ss") : "Never"}
                        </div>
                    </div>
                </section>

                <section className="panel">
                    <h2>Activity Log</h2>
                    <div className="logs-list">
                        {logs.map((log, i) => (
                            <div key={i} className={`log-item ${log.updated ? "update" : "skip"} ${log.error ? "error" : ""}`}>
                                <div className="ts">{format(new Date(log.ts), "HH:mm:ss")}</div>
                                <div className="details">
                                    <span className="symbol">{log.symbol}</span>
                                    <span className="price">{log.priceCheck.toFixed(6)}</span>
                                    {log.txHash && <a href={`#`} className="tx">{log.txHash.slice(0, 10)}...</a>}
                                    {log.error && <span className="err">{log.error}</span>}
                                </div>
                            </div>
                        ))}
                        {logs.length === 0 && <div className="empty">No logs yet</div>}
                    </div>
                </section>
            </main>
        </div>
    );
}

export default App;
