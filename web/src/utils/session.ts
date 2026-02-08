export function getOrCreateSessionId(): string {
  const key = "gasless_swap_session_id";
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const id = `sess_${Math.random().toString(16).slice(2, 10)}`;
    window.localStorage.setItem(key, id);
    return id;
  } catch {
    return `sess_${Math.random().toString(16).slice(2, 10)}`;
  }
}

