# paymaster_monitor/web/ — Admin Dashboard (React + Vite)

Admin UI for:

- Paymaster solvency + revenue metrics
- Bundler marketplace + spawning new bundlers with different fee configs
- User analytics (wallets, sessions, volume)
- Mandatory backend logs explorer

Style: dark, macOS-like dashboard.

UI policy:

- keep the macOS-inspired visual language, but avoid non-functional desktop controls in the titlebar

See `PLAN.md` for page layout and components.

## Runtime config (planned)

- `VITE_MONITOR_URL` — backend base URL (default `http://127.0.0.1:3002`)
- `VITE_ADMIN_TOKEN` — optional default token prefilled in the admin token input

## Paymaster page troubleshooting UX

When paymaster status cannot be loaded, the UI now surfaces:

- raw backend reason (for example `DEPLOYMENTS_PATH not configured`, `unauthorized`, ABI file errors)
- actionable remediation guidance tied to that reason

This avoids the previous generic placeholder and makes setup/debug faster.
