import type { QuoteServiceConfig } from "./config";
import { QuoteServiceServer } from "./server";

export async function startQuoteService(config: QuoteServiceConfig): Promise<QuoteServiceServer> {
  const server = new QuoteServiceServer(config);
  await server.start();
  return server;
}

export { QuoteServiceServer };

