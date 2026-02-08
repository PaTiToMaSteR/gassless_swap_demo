import bodyParser from "body-parser";
import cors from "cors";
import Debug from "debug";
import express from "express";
import type { Express, Request, Response } from "express";

import { RpcError, RpcErrorCodes } from "./rpcErrors";
import type { BundlerConfig } from "./types";
import { BundlerEngine } from "./BundlerEngine";

const debug = Debug("gasless-swap:bundler:rpc");

export class BundlerServer {
  private readonly app: Express;
  private httpServer?: ReturnType<Express["listen"]>;

  constructor(readonly engine: BundlerEngine, readonly config: BundlerConfig) {
    this.app = express();
    this.app.use(cors());
    this.app.use(bodyParser.json({ limit: "2mb" }));

    this.app.get("/", (_req, res) => res.send("ERC-4337 Bundler (v0.7) — use /rpc"));
    this.app.post("/rpc", async (req, res) => this._rpc(req, res));
  }

  async start(): Promise<void> {
    await this.engine.start();
    await new Promise<void>((resolve) => {
      this.httpServer = this.app.listen(Number(this.config.port), () => resolve());
    });
  }

  async stop(): Promise<void> {
    await this.engine.stop();
    await new Promise<void>((resolve) => {
      this.httpServer?.close(() => resolve());
    });
  }

  private async _rpc(req: Request, res: Response): Promise<void> {
    const body = req.body;
    const result = Array.isArray(body)
      ? await Promise.all(body.map((item) => this._handleRpcItem(item)))
      : await this._handleRpcItem(body);

    res.json(result);
  }

  private async _handleRpcItem(item: any): Promise<any> {
    const { method, params, jsonrpc, id } = item ?? {};
    debug(">> %s %o", method, params);
    try {
      const result = await this._handleMethod(method, params ?? []);
      debug("<< %s ok", method);
      return { jsonrpc: jsonrpc ?? "2.0", id, result };
    } catch (err: any) {
      const rpcErr =
        err instanceof RpcError ? err : new RpcError(err?.message ?? "Internal error", RpcErrorCodes.InternalError, err);
      debug("<< %s err %o", method, rpcErr);
      return { jsonrpc: jsonrpc ?? "2.0", id, error: { code: rpcErr.code, message: rpcErr.message, data: rpcErr.data } };
    }
  }

  private async _handleMethod(method: string, params: any[]): Promise<any> {
    switch (method) {
      case "eth_chainId":
        return await this.engine.getChainId();
      case "eth_accounts":
        return await this.engine.getAccounts();
      case "eth_supportedEntryPoints":
        return await this.engine.getSupportedEntryPoints();
      case "eth_sendUserOperation":
        return await this.engine.sendUserOperation(params[0], params[1]);
      case "eth_estimateUserOperationGas":
        return await this.engine.estimateUserOperationGas(params[0], params[1]);
      case "eth_getUserOperationReceipt":
        return await this.engine.getUserOperationReceipt(params[0]);
      case "eth_getUserOperationByHash":
        return await this.engine.getUserOperationByHash(params[0]);
      case "web3_clientVersion":
        return this.engine.clientVersion();
      default:
        throw new RpcError(`Method ${method} is not supported`, RpcErrorCodes.MethodNotFound);
    }
  }
}

