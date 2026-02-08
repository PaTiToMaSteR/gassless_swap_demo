import { readQuoteServiceConfigFromEnv } from "./config";
import { QuoteServiceServer } from "./server";

async function main(): Promise<void> {
  const config = readQuoteServiceConfigFromEnv();
  const server = new QuoteServiceServer(config);
  await server.start();

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

