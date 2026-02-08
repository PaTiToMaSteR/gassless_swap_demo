/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_MONITOR_URL?: string;
  readonly VITE_QUOTE_SERVICE_URL?: string;
  readonly VITE_DEV_PRIVATE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

