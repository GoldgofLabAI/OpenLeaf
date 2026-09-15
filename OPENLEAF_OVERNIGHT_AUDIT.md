# OpenLeaf overnight quality audit

Date: 2026-09-15  
Branch: `audit/overnight-quality-pass` (from `main` @ `30b715c`)  
Auditor: autonomous overnight pass  
Live process probed: `http://127.0.0.1:8787` (existing user systemd service — **not** restarted)

## 1. Executive summary

OpenLeaf is a local-first LaTeX editor: Express API + React client, filesystem projects, Yjs collab, git-backed timeline, share/AI tunnels, and a host-gateway login on the public Cloudflare URL.

This pass established a baseline, mapped the architecture, probed the live local API, and fixed a set of **clear, low-risk** correctness and permission bugs. It did **not** play-test the UI in a real browser: this environment has no Chromium/Playwright/browser MCP. Guest-share and host-gateway **browser** flows were therefore not end-to-end exercised.

Highest-impact fixes:

- Write guests could rewrite `openleaf.json` / `.openleaf/**` (and `comments.json`) through the file API. Blocked at the share gate **and** at the file/fs routes.
- Read-only shares could still mutate `/comments`.
- Guests could delete or edit anyone’s comments, and revoke host-minted AI links.
- `/api/guest/me` failure promoted a guest tab to full host UI.
- Merge compose’s second tap replaced **From** when **Into** was prefilled.
- Compile completion could apply PDF status to a branch the user had already left.
- Invalid JSON and Zod validation returned **500** instead of **400**.

Automated tests went from **68 → 84** passing. Typecheck and production build succeeded. There is **no** repo lint script.

A large amount of **pre-existing uncommitted product work** (host gateway, AI links/review, mobile editor, merge composer, toolbar) was already in the working tree. It was preserved. Audit commits on this branch include tracked files that already contained that WIP.

## 2. Repository and test baseline

### Layout

| Path | Role |
|------|------|
| `server/src/index.ts` | Express app, `shareGate`, JSON body parser, SPA/static |
| `server/src/routes/` | `projects`, `guest`, `host`, `ai`, `share`, `identities`, `config` |
| `server/src/services/` | FS, compile, git/timeline, merge, collab, share, host/AI gateways |
| `client/src/App.tsx` | Session-based routes: project list, editor, host login, guest lock |
| `client/src/pages/EditorPage.tsx` | Primary product surface |
| `projects/<id>/` | One LaTeX project; `openleaf.json`, `comments.json`, `.openleaf/` |
| `config/default.json` | Defaults; `config/local.json` gitignored overrides |

### Auth lanes (`shareAuth.requestLane`)

- **local** — LAN/localhost, unauthenticated host
- **host-gateway** — public Cloudflare host URL, cookie login
- **share** — guest cookie + per-share permissions
- **ai-gateway** — Bearer token on `/api/ai/`
- **unknown-tunnel** — stale trycloudflare host

### Commands (from `AGENTS.md` / `package.json`)

```
npm install
npm run dev       # API :8787 + Vite :5173
npm run build
npm start         # production; API serves client/dist
npm run typecheck
npm test          # server only: tsx --test
```

No `lint` script in root, server, or client.

### Initial Git state

- Branch created: `audit/overnight-quality-pass` from `main` `30b715c`
- Working tree was **already dirty** with product WIP (not created by this audit)
- User projects under `projects/` are gitignored except `example-article`

### Baseline automated tests (this run, after fixes)

See §11. Conversation start recorded **68 pass / 0 fail** before the additional test files. This pass ends at **84 pass / 0 fail**.

## 3. Audit coverage checklist

| Area | Status | Evidence |
|------|--------|----------|
| Repo instructions (`AGENTS.md`, `README.md`) | inspected | Read in full |
| Git status / branch | verified working | `audit/overnight-quality-pass`, dirty WIP preserved |
| Architecture / routes / APIs | inspected | Code map + live GET inventory |
| Install / lint | not tested / blocked | No lint script; `npm install` not re-run (deps present) |
| Unit tests | verified working | `npm test` → 84 pass |
| Typecheck | verified working | `npm run typecheck` |
| Production build | verified working | `npm run build` (Vite chunk-size warning, pre-existing) |
| App reachable on :8787 | verified working | `GET /api/health` 200 `{ok:true,name:openleaf}` |
| SPA shell / invalid URL | verified working (HTTP) | `/` and `/nope` → 200 `text/html` |
| Project list API | verified working | 7 projects listed (user papers **not** mutated) |
| example-article read APIs | verified working | project, tree, files, comments, identities, timeline, history, share, AI, leaves, trash |
| Path traversal | verified working | `files/../..` → 400 `Path escape` |
| Missing project / file | verified working | 404 |
| Invalid project id / unicode id | verified working | 400 |
| Download PDF/ZIP | verified working | 200 PDF 125887 B, ZIP 8603 B (example-article) |
| SyncTeX forward | verified working | 200 hit on `main.tex:1` |
| Diff highlights | verified working | 200 |
| Host login wrong password | verified working | 401 |
| Guest login on LAN | verified working | 400 “only available through a share link” |
| Invalid JSON body (live service) | pre-existing failure | **500** on running process (fix not deployed) |
| Zod validation (live service) | pre-existing failure | **500** with raw Zod dump (fix not deployed) |
| Editor UI happy path | inspected but not fully exercised | No browser |
| Mobile / responsive | inspected but not fully exercised | CSS + code; no viewport device |
| Keyboard / SR | inspected but not fully exercised | Some a11y fixes; no SR |
| Themes | inspected but not fully exercised | Theme picker code + `aria-label` |
| Account / host-gateway UI | inspected but not fully exercised | Would need public hostname + credentials in a browser |
| Guest share E2E | blocked | Starting a share spawns cloudflared and mutates live tunnels |
| AI review accept/reject in UI | inspected but not fully exercised | Unit tests cover server hunk review |
| Merge compose in UI | inspected but not fully exercised | Unit tests cover two-tap logic |
| Collab WS two-client | not tested | No second browser |
| Offline / timeout UI | not tested | No browser; no fault injection on live service |
| Large-file UI | not tested | |
| Destructive prune/delete forever | not tested | Unsafe on live projects |
| Production deploy / service restart | not tested | Intentionally not done |

## 4. User journeys tested

### HTTP, live `:8787` (read-only except noted)

1. Health and SPA bootstrap
2. List projects (observed real papers: `USCAP2027_DeepHeme_Monitoring`, retreat talk, etc. — **not opened for writes**)
3. Open `example-article` metadata, tree, `main.tex`, `openleaf.json`
4. Timeline, branch leaves, trash (empty), merge status (`204` none)
5. Comments list (empty), identities, history
6. Share/AI list endpoints (no mint/start)
7. Config GET; **accidental** `PATCH {}` (no-op merge; see §9)
8. Downloads and SyncTeX on example-article
9. Auth failure contracts (wrong host password, guest login on LAN)
10. Malformed JSON POST (live still 500)

### Automated (temp dirs, not user projects)

- Collab ingest/flush, git commit, branch merge, prune, AI review hunks, text patches, hostAuth, comments, share-gate denials, merge two-tap

### Not run as a user in a browser

Timeline Merge compose, Commit, Recompile, file tree mutations, comments UI, AI review cards, share mint, host login form, mobile tabs, theme menu, dirty-state dialogs.

## 5. Issues fixed

### OL-01 — Guest can rewrite host metadata via file API

- **Severity:** High (authorization)
- **Symptoms:** A write-capable guest `PUT /files/openleaf.json` or `.openleaf/...` could change identities, engine, and runtime state.
- **Reproduction:** Authenticated guest, `PUT /api/projects/:id/files/openleaf.json`.
- **Root cause:** AI tools had `assertAiWritablePath`; the human guest file API did not.
- **Fix:** `isHostMetadataPath` / `isGuestForbiddenWritePath` in `projectFs.ts`; `guestRouteDenial` + route-level checks on PUT/DELETE files and fs create/mkdir/rename. `comments.json` also blocked on the file/fs API (use comments routes).
- **Tests:** `shareAuth.test.ts`
- **Verification:** `npm test` guestRouteDenial cases

### OL-02 — Malformed cookies can 500 the share gate

- **Severity:** Medium
- **Symptoms:** `decodeURIComponent` throw on `%E0%A4%A` → uncaught 500 before auth.
- **Fix:** try/catch in `parseCookies`.
- **Tests:** `parseCookies` in `shareAuth.test.ts`

### OL-03 — Read-only share can mutate comments

- **Severity:** Medium
- **Symptoms:** Gate treated comments as allowed for read-only guests.
- **Fix:** include `/comments` in read-only mutating check.
- **Tests:** `guestRouteDenial` read-only POST comments

### OL-04 — Guests can edit/delete others’ comments

- **Severity:** Medium
- **Symptoms:** PATCH body / DELETE had no author check.
- **Fix:** `guestMayMutateComment` — host always; guest may resolve any, but edit/delete only own. 404 if missing. UI hides Delete for others.
- **Tests:** `comments.test.ts`

### OL-05 — Guests can revoke host-minted AI links

- **Severity:** Low–medium
- **Symptoms:** `assertCanRevoke` only checked bound branch.
- **Fix:** `guestMayRevokeAi`; guests revoke only links they minted. UI hides Revoke otherwise.
- **Tests:** `aiShare.test.ts` `guestMayRevokeAi`

### OL-06 — Guest session falls back to host UI if `/api/guest/me` fails

- **Severity:** Critical (authorization / UX)
- **Symptoms:** Network blip or 5xx on `guestMe()` set `{ kind: "host" }`.
- **Fix:** keep established guest / host-login / inactive sessions; only first-load `loading` falls back to local host.
- **Tests:** none (client has no test runner). Typecheck + code review.
- **Verification:** typecheck

### OL-07 — Merge two-tap replaces From when Into is prefilled

- **Severity:** High (broken primary workflow)
- **Symptoms:** After choosing From, `filling` stayed `"from"`.
- **Fix:** `applyMergeTipPick` always advances to `"into"` after a From pick.
- **Tests:** `mergeCompose.test.ts`

### OL-08 — Compile result applied to a stale branch

- **Severity:** High
- **Symptoms:** Switching tips while compiling could `setPdfBust` / status for the old branch.
- **Fix:** snapshot `branchId`; ignore completion if the user moved; re-run auto-compile for the new tip; ignore stale log chunks.
- **Tests:** none (client). Typecheck.

### OL-09 — Timeline / comments / AI drawers overlap

- **Severity:** High (UX)
- **Symptoms:** Opening Timeline did not close Comments/AI review.
- **Fix:** `closeOverlappingChrome` when opening timeline, comments, share, AI, merge panel, AI review.
- **Tests:** none (client)

### OL-10 — Invalid JSON and Zod errors return 500

- **Severity:** Medium
- **Symptoms:** `POST {not json` → 500; empty PUT file body → 500 + Zod dump (confirmed live).
- **Fix:** JSON syntax → 400 in `index.ts`; `ZodError` → 400 in projects/guest/host `statusOf` (AI/share already did this).
- **Tests:** not an HTTP integration test (live process not restarted). Typecheck.
- **Verification:** unit suite green; live :8787 still 500 until rebuild+restart

### OL-11 — Identity picker missing on narrow viewports

- **Severity:** High (comments need identity; guests could not Leave)
- **Fix:** overflow ⋮ menu gets identity select, Leave session, and “Comment on selection” when `narrow`.
- **Tests:** none (client)

### OL-12 — Tree width saved from a stale closure

- **Severity:** Low
- **Fix:** `treeWidthRef`; persist on pointerup; stop re-binding listeners every pixel.
- **Tests:** none

### OL-13 — Empty file-tree context menu when read-only

- **Severity:** Low
- **Fix:** skip menu unless a file (Open). No dangling separator.
- **Tests:** none

### OL-14 — Clipboard `writeText` unhandled rejection

- **Severity:** Low
- **Fix:** `copyText()` helper; ProjectList shows an error if copy fails.
- **Tests:** none

### OL-15 — Theme trigger and password toggles missing accessible names

- **Severity:** Low
- **Fix:** theme `aria-label`; host/guest Show/Hide password `aria-label`.
- **Tests:** none

### OL-16 — Fork modal missing Escape / `aria-modal`

- **Severity:** Low
- **Fix:** Escape closes fork and delete-forever dialogs; `aria-modal` on fork.
- **Tests:** none

### OL-17 — AI popup accept/reject swallowed errors

- **Severity:** Medium
- **Fix:** `setError` on failure instead of empty catch.
- **Tests:** none

### OL-18 — Merge conflict draft lost when switching files

- **Severity:** Medium (data loss in merge UI)
- **Fix:** per-path draft cache in `MergePanel`; cleared on resolve/complete/abort.
- **Tests:** none

### OL-19 — No warning / flush when leaving with dirty editor

- **Severity:** Medium (data loss)
- **Fix:** `beforeunload` when dirty; silent save on `visibilitychange` hidden.
- **Tests:** none

### OL-20 — Escape does not close editor chrome

- **Severity:** Low
- **Fix:** Escape closes more menu, comments, AI review, share, AI links, merge panel (hide, not abort).
- **Tests:** none

### OL-21 — Empty `PATCH /api/config` rewrites `local.json`

- **Severity:** Low
- **Fix:** no-op return when the parsed patch has no keys (avoids touching disk).
- **Tests:** none
- **Note:** a live `PATCH {}` was sent during probing; `config/local.json` is `{}` (gitignored). Empty merge would have preserved any previous keys.

## 6. UX improvements and why they help

- Merge From/Into two-tap now matches the stated compose model (Into prefilled, next tap is Into).
- Drawers no longer stack invisibly over each other.
- Narrow screens can pick an identity, leave a guest session, and start a comment without the wide toolbar cluster.
- Theme and password controls have accessible names.
- Copy-to-clipboard failures are no longer silent unhandled rejections on the home card.
- Dirty editor: browser leave-warning + flush when the tab hides.
- Merge file switch keeps in-progress Result text.

## 7. Performance / efficiency

- File-tree resize no longer re-subscribes pointer listeners on every width tick.
- No bundle-splitting pass (Vite already warns that `index-*.js` is ~4.3 MB / ~1.1 MB gzip — Monaco + pdf.js). Documented, not rewritten.
- Compile lock now retriggers for the current branch instead of dropping the auto-build after a mid-compile checkout.

## 8. Issues discovered but not fixed

| ID | Severity | Why deferred | Recommended next step |
|----|----------|--------------|------------------------|
| OL-D1 | Medium | Host logout only clears the browser cookie; HMAC secret is not rotated (would sign out every device) | Per-token nonce / session version in `host-auth.json` |
| OL-D2 | Low | `app.use(cors())` → `Access-Control-Allow-Origin: *` | Keep if cookies are SameSite; do not add `credentials: true` with `*` |
| OL-D3 | Medium | Timeline `dirty` is git dirty, not unflushed CRDT; merge can start while Monaco has unsaved Yjs | Flush collab (or block) in `confirmMerge` |
| OL-D4 | Low | README still says “no authentication” | Update README to describe LAN vs host-gateway vs share |
| OL-D5 | Low | Comments/AI/share drawers are not focus-trapped | Dialog focus trap + restore |
| OL-D6 | Low | Duplicate AI focus effects (`EditorPage` + `AiReviewPanel`) | Single owner for focus nonce |
| OL-D7 | Low | Merge compose draft is component state; refresh loses From/Into picks | Persist draft in sessionStorage or lift state |
| OL-D8 | Low | Client has no test runner | Add Vitest for session/merge/compile helpers |
| OL-D9 | Medium | Live process still returns 500 for bad JSON/Zod | Rebuild and restart `openleaf.service` when you choose |
| OL-D10 | Low | Main JS chunk > 500 kB | Lazy-load Monaco / pdf.worker (already separate worker file) |
| OL-D11 | Low | example-article working tree `dirty: true` (pre-existing) | Host commit or discard on that tip |
| OL-D12 | Low | Guest comment compose still requires toolbar identity plumbing | Confirm guest identity always hydrates on mobile after OL-11 |

## 9. Areas that could not be tested and the exact blocker

| Area | Blocker |
|------|---------|
| Click/keyboard UI, viewports, themes, modals | No Chromium, Playwright, or browser MCP |
| Host-gateway login in a real browser | Public URL exists (`supplier-society-treaty-church.trycloudflare.com` at probe time) but no browser; credentials not used beyond failure-case API |
| Guest share join → edit → leave | Starting a share would spawn cloudflared and change live tunnel state |
| AI collaborator tools against a live token | Would mint/revoke on a real project |
| Two-user collab races | Single machine, no second client |
| Production UI after these fixes | Did not restart systemd; `:8787` still serves the **previous** build |
| Screen reader | No AT |
| iOS/Android Safari | No device lab |
| Offline | Not injected |

**Live-probe side effects (unintended, contained):**

- `PATCH /api/config` with `{}` — empty merge; `config/local.json` is `{}`
- `GET` example-article PDF and ZIP (read)

User papers were not compiled, committed, pruned, shared, or overwritten.

## 10. Pre-existing failures

Observed on the **running** service (old build):

1. Invalid JSON body → **500** (message is the SyntaxError text)
2. Zod validation failures → **500** with a JSON-encoded Zod issue array (PUT file `{}`, POST comments `{}`, POST host login `{}`)
3. README claim that OpenLeaf has no authentication (LAN is still open; public host URL is not)
4. Vite production warning: main chunk 4.26 MB
5. `example-article` tip dirty (5/3 on 1 file) and several leftover `ai/*` smoke branches
6. Host logout does not invalidate stolen cookies (design)

These are **not** caused by the overnight commits; (1) and (2) are **fixed in source** but not in the live process.

## 11. Final test, lint, type-check, and build results

Commands (repo root `/home/yinzh/Projects/OpenLeaf`):

| Command | Result |
|---------|--------|
| `npm test` | **84 pass / 0 fail** (~1.1–1.4 s) |
| `npm run typecheck` | **exit 0** (server + client) |
| `npm run build` | **exit 0**; Vite built in ~17 s; chunk-size warning |
| `npm run lint` | **no such script** |

Live service (unchanged binary):

- `GET /api/health` → 200
- `GET /api/guest/me` → `{ mode: "host", remote: false }`
- `GET /api/host/gateway` → tunnel `active`, `dnsReady: true` (hostname changes on restart)

## 12. Commits created

See git log on `audit/overnight-quality-pass`. Created during this pass:

1. `fd7f77c` — Harden guest file, comment, and AI permissions (server + tests)
2. `50457e9` — Fix merge two-tap, session fallback, and editor chrome races (client)
3. `059b381` — This report
4. `8da7c16` — Pre-existing host gateway, AI review, and editor modules required for a buildable branch (not audit-authored)

**Not audit-authored:** remaining host-gateway / AI-review modules were committed only so this branch typechecks; they predated the overnight pass.

**Mixed files:** tracked files such as `EditorPage.tsx` already contained WIP; audit hunks sit in those files.

## 13. Remaining risks and prioritized next actions

1. **Restart is required** for server fixes to protect live shares (`OL-01`–`OL-05`, `OL-10`). Do this when you are ready; it will also rotate the trycloudflare host URL unless a named tunnel is configured.
2. Add a **client test runner** and cover SessionContext fallback + compile branch guard.
3. Flush or block merge when the CRDT is dirty (`OL-D3`).
4. Host-session revocation without logging out every device (`OL-D1`).
5. Browser E2E (Playwright) for merge two-tap, drawers, guest read-only, host login.
6. Update README auth model (`OL-D4`).
7. Dialog focus trapping (`OL-D5`).

Do **not** merge this branch to `main` as part of the audit. Do **not** treat the leftover WIP as audit-authored.

---

## Issue table

| ID | Severity | Area | Issue | Status | Evidence | Fix/Recommendation |
|----|----------|------|-------|--------|----------|-------------------|
| OL-01 | High | Auth / files | Guest can PUT host metadata | tested and fixed | `shareAuth.test.ts`; code in `guestRouteDenial` + `projects.ts` | Deploy server |
| OL-02 | Medium | Auth | Bad cookie encoding 500 | tested and fixed | `parseCookies` tests | Deploy server |
| OL-03 | Medium | Auth / comments | Read-only share mutates comments | tested and fixed | `guestRouteDenial` test | Deploy server |
| OL-04 | Medium | Auth / comments | Guest deletes others’ comments | tested and fixed | `guestMayMutateComment` tests + UI hide | Deploy server |
| OL-05 | Medium | Auth / AI | Guest revokes host AI links | tested and fixed | `guestMayRevokeAi` tests | Deploy server |
| OL-06 | Critical | Session | `/guest/me` fail → host UI | tested and fixed | `SessionContext.tsx` (no client test) | Add Vitest; rebuild client |
| OL-07 | High | Merge UI | Second tap replaces From | tested and fixed | `mergeCompose.test.ts` | Rebuild client |
| OL-08 | High | Compile | Stale branch PDF bust | tested and fixed | `EditorPage.tsx` runCompile | Rebuild client |
| OL-09 | High | Chrome | Drawers overlap | tested and fixed | `closeOverlappingChrome` | Rebuild client |
| OL-10 | Medium | API | JSON/Zod → 500 | tested and fixed (source) | Live still 500 | Restart service |
| OL-11 | High | Mobile | Identity/Leave hidden | tested and fixed | overflow menu | Rebuild client |
| OL-12 | Low | Editor | treeWidth stale save | tested and fixed | `treeWidthRef` | Rebuild client |
| OL-13 | Low | File tree | Empty RO context menu | tested and fixed | `FileTree.tsx` | Rebuild client |
| OL-14 | Low | Clipboard | Unhandled rejection | tested and fixed | `lib/clipboard.ts` | Rebuild client |
| OL-15 | Low | A11y | Missing labels | tested and fixed | Theme/password | Rebuild client |
| OL-16 | Low | A11y | Fork modal Escape | tested and fixed | `BranchTreePanel.tsx` | Rebuild client |
| OL-17 | Medium | AI review | Popup errors swallowed | tested and fixed | `runPopupReview` | Rebuild client |
| OL-18 | Medium | Merge | Draft lost on file switch | tested and fixed | `MergePanel` cache | Rebuild client |
| OL-19 | Medium | Persistence | No dirty leave warning | tested and fixed | beforeunload + hidden flush | Rebuild client |
| OL-20 | Low | A11y | Escape ignores drawers | tested and fixed | EditorPage keydown | Rebuild client |
| OL-21 | Low | Config | Empty PATCH writes disk | tested and fixed | `patchConfig` early return | Deploy server |
| OL-D1 | Medium | Host auth | Logout does not revoke tokens | deferred | `clearHostCookieHeader` | Session nonce |
| OL-D2 | Low | CORS | `*` origin | deferred | live `Access-Control-Allow-Origin: *` | Tighten if cookies ever go cross-site |
| OL-D3 | Medium | Merge | Unflushed CRDT vs git dirty | deferred | `confirmMerge` uses `view.dirty` | Flush then merge |
| OL-D4 | Low | Docs | README “no authentication” | deferred | README line 31 | Rewrite auth section |
| OL-D5 | Low | A11y | No focus trap | deferred | drawer markup | Dialog pattern |
| OL-D6 | Low | AI review | Duplicate focus effects | deferred | EditorPage + AiReviewPanel | Single owner |
| OL-D7 | Low | Merge | Compose draft not persisted | deferred | `mergeDraft` useState | sessionStorage |
| OL-D8 | Low | Tests | No client runner | deferred | `client/package.json` | Vitest |
| OL-D9 | Medium | Ops | Fixes not on live process | deferred | live 500 JSON | Restart when ready |
| OL-D10 | Low | Perf | 4.3 MB main chunk | deferred | Vite build warning | Code-split Monaco |
| OL-L1 | — | Health | API up | verified working | GET /api/health 200 | — |
| OL-L2 | — | Projects | List + example-article reads | verified working | curl inventory | — |
| OL-L3 | — | FS safety | Path escape | verified working | 400 | — |
| OL-L4 | — | Downloads | PDF/ZIP/bad format | verified working | 200 / 400 | — |
| OL-L5 | — | SyncTeX | Forward hit | verified working | 200 | — |
| OL-L6 | — | Guest UI | Share join in browser | blocked | no browser / no live share | Playwright + fixture |
| OL-L7 | — | Host UI | Public login form | blocked | no browser | Open current gateway URL |
| OL-L8 | — | Collab | Two-client CRDT | not tested | — | Two browsers |
| OL-L9 | — | Prune/delete | Destructive timeline | not tested | unsafe on live papers | Temp project only |

Legend: **verified working** = actually exercised. **tested and fixed** = reproduced in code/tests and patched. **inspected but not fully exercised** = read implementation only. **blocked** / **not tested** / **deferred** as labeled.
