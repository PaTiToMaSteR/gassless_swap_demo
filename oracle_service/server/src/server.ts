import express from "express";
import path from "node:path";
import cors from "cors";
import bodyParser from "body-parser";
import { OracleService } from "./service";
import { OracleConfig } from "./config";

export class OracleServer {
    private app = express();

    constructor(
        readonly config: OracleConfig,
        readonly service: OracleService
    ) {
        this.app.use(cors());
        this.app.use(bodyParser.json());

        const publicDir = path.resolve(__dirname, "../public");
        this.app.use(express.static(publicDir));

        this.app.get("/", (req, res) => {
            res.sendFile(path.join(publicDir, "index.html"));
        });

        this.app.get("/status", (req, res) => {
            res.json(this.service.status);
        });

        this.app.get("/logs", (req, res) => {
            res.json(this.service.logs);
        });

        this.app.post("/update", async (req, res) => {
            await this.service.manualUpdate();
            res.json({ ok: true });
        });
    }

    start() {
        this.app.listen(this.config.port, this.config.host, () => {
            console.log(`Oracle Service running at http://${this.config.host}:${this.config.port}`);
        });
    }
}
