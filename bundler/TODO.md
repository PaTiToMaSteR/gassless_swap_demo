# bundler/TODO

- [x] Initialize Node/TS project (build/test scripts)
- [x] Implement v0.7 UserOp types + packer (`PackedUserOperation`)
- [x] Implement EntryPointSimulations via `eth_call` + state override
- [x] Implement RPC server (`/rpc`) + required methods
- [x] Implement mempool + bundling loop (`handleOps`)
- [x] Receipt tracking (decode `UserOperationEvent`)
- [x] Structured logging + optional log push to monitor
- [x] Synthetic tests: start bundler, send op, get receipt (Anvil)
