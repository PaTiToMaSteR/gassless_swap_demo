import { readConfigFromEnv } from "./config";
import { readDeployments } from "./deployments";
import { OracleService } from "./service";
import { OracleServer } from "./server";

async function main() {
    const config = readConfigFromEnv();
    const deployments = readDeployments(config.deploymentsPath);

    const service = new OracleService(config, deployments);
    await service.start();

    const server = new OracleServer(config, service);
    server.start();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
