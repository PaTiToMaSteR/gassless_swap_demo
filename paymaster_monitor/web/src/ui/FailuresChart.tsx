import { useEffect, useState } from "react";

type Failure = { reason: string; count: number };

export function FailuresChart({ monitorUrl, adminToken }: { monitorUrl: string, adminToken: string }) {
    const [failures, setFailures] = useState<Failure[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const fetchFailures = async () => {
        setLoading(true);
        setError("");
        try {
            const res = await fetch(`${monitorUrl}/api/admin/metrics/failures`, {
                headers: { "Authorization": `Bearer ${adminToken}` }
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setFailures(data.failures || []);
        } catch (e: any) {
            setError(e.message || "Failed to load failures");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchFailures();
        const t = setInterval(fetchFailures, 10000);
        return () => clearInterval(t);
    }, [monitorUrl, adminToken]);

    const maxCount = Math.max(...failures.map(f => f.count), 1);

    return (
        <div className="panel">
            <div className="row space">
                <h3>Top Failure Reasons</h3>
                <button onClick={fetchFailures} disabled={loading} style={{ fontSize: "0.8rem", padding: "2px 6px" }}>
                    Refresh
                </button>
            </div>

            {error && <div className="warn">{error}</div>}

            <div className="failures-list">
                {failures.length === 0 && !loading && <div className="empty">No failures recorded</div>}

                {failures.map((f, i) => (
                    <div key={i} className="failure-item">
                        <div className="failure-row">
                            <span className="reason" title={f.reason}>{truncate(f.reason, 60)}</span>
                            <span className="count">{f.count}</span>
                        </div>
                        <div className="bar-bg">
                            <div
                                className="bar-fill"
                                style={{ width: `${(f.count / maxCount) * 100}%` }}
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function truncate(str: string, n: number) {
    return (str.length > n) ? str.slice(0, n - 1) + '...' : str;
}
