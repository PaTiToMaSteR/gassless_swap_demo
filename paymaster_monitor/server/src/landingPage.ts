export type LandingPageOptions = {
  title: string;
  status: "UP" | "DOWN" | "MAINTENANCE";
  version: string;
  links: Array<{ label: string; url: string }>;
};

export function getLandingPage(opts: LandingPageOptions): string {
  const statusColor = opts.status === "UP" ? "#2bd576" : opts.status === "DOWN" ? "#ff5c7a" : "#ffcc66";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${opts.title}</title>
  <style>
    :root {
      --bg0: #0b0d12;
      --text: rgba(255, 255, 255, 0.92);
      --muted: rgba(255, 255, 255, 0.68);
      --border: rgba(255, 255, 255, 0.12);
      --card-bg: rgba(255, 255, 255, 0.04);
      --accent: #6aa9ff;
    }
    html, body {
      height: 100%;
      margin: 0;
      background: radial-gradient(1200px 800px at 20% 0%, rgba(106, 169, 255, 0.12), transparent 60%),
                  radial-gradient(900px 700px at 100% 40%, rgba(255, 92, 122, 0.08), transparent 55%),
                  var(--bg0);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      width: 100%;
      max-width: 420px;
      padding: 32px;
      border-radius: 20px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      backdrop-filter: blur(20px);
      box-shadow: 0 20px 50px rgba(0,0,0,0.5);
      text-align: center;
    }
    h1 {
      margin: 0 0 8px 0;
      font-size: 24px;
      letter-spacing: -0.5px;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin: 16px 0 24px 0;
      padding: 6px 12px;
      border-radius: 99px;
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--border);
      font-size: 13px;
      font-weight: 500;
      color: ${statusColor};
    }
    .pulse {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: ${statusColor};
      box-shadow: 0 0 10px ${statusColor};
    }
    .links {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 24px;
    }
    a {
      display: block;
      padding: 12px;
      border-radius: 12px;
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--border);
      color: var(--muted);
      text-decoration: none;
      transition: all 0.2s;
    }
    a:hover {
      background: rgba(255,255,255,0.08);
      color: var(--text);
      border-color: rgba(255,255,255,0.2);
    }
    .footer {
      margin-top: 32px;
      font-size: 12px;
      color: rgba(255,255,255,0.3);
    }
    .logs-panel {
      width: 100%;
      max-width: 800px;
      height: 400px;
      margin-top: 24px;
      background: #0d1117;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      overflow-y: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      color: #c9d1d9;
      text-align: left;
    }
    .log-entry { margin-bottom: 4px; display: flex; gap: 8px; }
    .log-ts { color: #8b949e; min-width: 140px; }
    .log-service { color: #d1d5db; min-width: 100px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .log-level { font-weight: bold; min-width: 50px; text-transform: uppercase; }
    .level-info { color: #58a6ff; }
    .level-warn { color: #d29922; }
    .level-error { color: #f85149; }
    .log-msg { color: #e6edf3; }
  </style>
</head>
<body>
  <div style="display:flex;flex-direction:column;align-items:center;width:100%;gap:20px;padding:20px;">
    <div class="card">
      <h1>${opts.title}</h1>
      <div class="status">
        <div class="pulse"></div>
        ${opts.status === "UP" ? "Operational" : opts.status}
      </div>
      
      <div class="links">
        ${opts.links.map(l => `<a href="${l.url}">${l.label} &rarr;</a>`).join("")}
      </div>

      <div class="footer">
        ${opts.version} &bull; Consensys Demo
      </div>
    </div>

    <div class="logs-panel" id="logs">
      <div style="color:#8b949e;text-align:center;padding:20px;">Loading live logs...</div>
    </div>
  </div>

  <script>
    const LOGS_URL = "/api/logs?limit=50";
    const el = document.getElementById("logs");

    function timeStr(ts) {
      return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19);
    }

    async function poll() {
      try {
        const res = await fetch(LOGS_URL);
        const data = await res.json();
        const logs = Array.isArray(data) ? data : (data.logs || []);
        
        if (logs.length === 0) {
          el.innerHTML = '<div style="color:#8b949e;text-align:center;padding:20px;">No logs yet</div>';
          return;
        }

        el.innerHTML = logs.map(l => {
          const levelClass = "level-" + l.level.toLowerCase();
          return \`<div class="log-entry">
            <span class="log-ts">\${timeStr(l.ts)}</span>
            <span class="log-service">\${l.service || '-'}</span>
            <span class="log-level \${levelClass}">\${l.level}</span>
            <span class="log-msg">\${l.msg}</span>
          </div>\`;
        }).join("");
      } catch (err) {
        console.error("poll failed", err);
      }
    }

    poll();
    setInterval(poll, 2000);
  </script>
</body>
</html>`;
}
