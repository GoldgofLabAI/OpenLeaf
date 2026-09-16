# Security

## What OpenLeaf is (and is not)

OpenLeaf is a **local-first** LaTeX editor. On the local / LAN port there is **no host login**: anyone who can reach that port can read and write projects and trigger compiles. Public access is meant to go through the **Share** / host-gateway flows (Cloudflare Quick Tunnel + credentials), not by port-forwarding `:8787` or `:5173`.

## Data security disclaimer

**OpenLeaf contributors are not responsible for the security, privacy, or integrity of your data**, nor for misuse of any access you grant.

This especially applies to features that expose your machine or manuscript beyond a trusted local network, including but not limited to:

- **Share** — temporary public invitation links (Cloudflare Quick Tunnel + credentials)
- **AI collaborator links** — bearer tokens / public URLs that can read and edit an AI sandbox
- **Host gateway** tunnels and any credentials you distribute
- Guests, collaborators, or external models acting on a link or token you create

You are solely responsible for deciding whom to trust, what permissions to grant (write, compile, downloads, history), rotating or ending sessions, and for any consequences of a leaked link, token, or credential. The UI requires an explicit checkbox acknowledgment before creating a public Share or AI link; that acknowledgment does not transfer any liability to OpenLeaf contributors.

Use these features only with people and tools you trust. Treat invitation links, usernames/passwords, and AI bearer tokens like passwords.

## Do not commit secrets

These paths are gitignored and must stay local to each deploy:

| Path | Contents |
|------|----------|
| `config/host-auth.json` | Host password hash + cookie HMAC secret |
| `config/host-credentials.txt` | Bootstrap username / password / public URL (operator file) |
| `config/host-gateway.json` | Live Cloudflare tunnel URL |
| `config/local.json` | Runtime config overrides |
| `.env`, `.env.*` | Environment overrides |
| `projects/*` (except `example-article`) | Your papers and data |

Also never commit API tokens, share-session credentials, AI collaborator bearer tokens, private keys, or real Cloudflare Quick Tunnel hostnames from a live machine.

If you accidentally commit a secret, rotate it immediately (delete the relevant `config/host-*` files and restart to regenerate host login; end any live share / AI sessions) and treat the old value as burned — rewriting git history may still be needed if the repo was pushed.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems that could let someone access others’ projects, bypass share auth, or escalate on a host.

Email or message the maintainers privately (via the contact method on the GitHub repo / organization profile), and include:

- affected version or commit
- reproduction steps
- impact (who can do what)

We will acknowledge the report and work on a fix before any public write-up.

## Dependency licenses

Third-party npm packages keep their own licenses. OpenLeaf’s own source is MIT — see [LICENSE](LICENSE).
