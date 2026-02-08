export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly data?: unknown,
  ) {
    super(message);
  }
}

export const RpcErrorCodes = {
  InvalidParams: -32602,
  MethodNotFound: -32601,
  InternalError: -32603,
} as const;

