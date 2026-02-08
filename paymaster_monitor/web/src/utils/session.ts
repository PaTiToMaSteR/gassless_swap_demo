export function getOrCreateAdminSessionId(): string {
  const key = "gasless_swap_admin_session_id";
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const id = `admin_sess_${Math.random().toString(16).slice(2, 10)}`;
    window.localStorage.setItem(key, id);
    return id;
  } catch {
    return `admin_sess_${Math.random().toString(16).slice(2, 10)}`;
  }
}

export function getStoredAdminToken(): string {
  const key = "gasless_swap_admin_token";
  const fromEnv = (import.meta.env.VITE_ADMIN_TOKEN as string | undefined) ?? "";
  try {
    return window.localStorage.getItem(key) ?? fromEnv;
  } catch {
    return fromEnv;
  }
}

export function storeAdminToken(token: string): void {
  const key = "gasless_swap_admin_token";
  try {
    window.localStorage.setItem(key, token);
  } catch {
    // ignore
  }
}

