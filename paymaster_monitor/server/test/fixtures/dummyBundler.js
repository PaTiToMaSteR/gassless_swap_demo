/* eslint-disable no-console */
const fs = require("node:fs");
const http = require("node:http");
const url = require("node:url");

function parseArgs(argv) {
  const idx = argv.indexOf("--config");
  if (idx === -1) throw new Error("missing --config");
  return { configPath: argv[idx + 1] };
}

function readConfig(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function sendJson(res, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(body);
}

function main() {
  const { configPath } = parseArgs(process.argv.slice(2));
  const config = readConfig(configPath);
  const port = Number(config.port);
  if (!Number.isFinite(port)) throw new Error("invalid config.port");

  const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url);
    if (parsed.pathname !== "/rpc") {
      res.writeHead(404);
      return res.end();
    }

    let raw = "";
    req.on("data", (c) => (raw += c.toString("utf8")));
    req.on("end", () => {
      const json = JSON.parse(raw || "{}");
      const method = json.method;
      if (method === "web3_clientVersion") return sendJson(res, { jsonrpc: "2.0", id: json.id, result: "dummy-bundler/0.0.0" });
      if (method === "eth_chainId") return sendJson(res, { jsonrpc: "2.0", id: json.id, result: "0x7a69" });
      if (method === "eth_supportedEntryPoints") return sendJson(res, { jsonrpc: "2.0", id: json.id, result: [config.entryPoint] });
      return sendJson(res, { jsonrpc: "2.0", id: json.id, error: { code: -32601, message: "method not found" } });
    });
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`dummy bundler listening on ${port}`);
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();

