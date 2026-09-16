# Config directory

| File | Tracked? | Role |
|------|----------|------|
| `default.json` | yes | Shipped defaults |
| `local.json` | no | Optional overrides (see `local.json.example`) |
| `host-auth.json` | no | Host password hash + cookie secret (created on first boot) |
| `host-credentials.txt` | no | Operator cheat-sheet: username, password, public URL |
| `host-gateway.json` | no | Live host Cloudflare tunnel metadata |

Copy `local.json.example` to `local.json` only if you need overrides. Never commit the `host-*` files.
