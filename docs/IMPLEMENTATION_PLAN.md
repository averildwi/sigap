# IMPLEMENTATION_PLAN: SIGAP backend (Turborepo monorepo)

Source: `docs/PRD.md` rev 5.2, `docs/DATA_MODEL.md`, `docs/API_SPEC.md`, `docs/SPEC_AUDIT.md` (READY), and the skills (git-workflow, nest-architecture, nest-prisma, nest-auth-and-security + references, nest-validation-and-config, nest-response-and-errors, nest-testing). No code is written by this plan.

## Monorepo layout (decided)

```
C:/Workspace/Competition/sigap          repo root (git)
├─ apps/
│  ├─ backend/        NestJS API (you own this — every step below)
│  │  ├─ .opencode/skills/   agent skills (`nest-skills --agent opencode`, run in apps/backend)
│  │  └─ AGENTS.md           skills index for the backend
│  └─ web/            Next.js (teammate; left as scaffold, untouched here)
├─ packages/          @repo/eslint-config, @repo/typescript-config, @repo/ui (create-turbo)
├─ docs/              PRD, DATA_MODEL, API_SPEC, SPEC_AUDIT, GAPS, this plan
├─ AGENTS.md          (turbo-managed block + our monorepo rules)
├─ turbo.json, package.json (npm workspaces: apps/*, packages/*)
```

**Live repo status (2026-10-18):** the root came from `create-turbo`, not the hand-written bootstrap below — commit `a7cc33a Initial commit from create-turbo` on `main`. Branch `chore/repo-cleanup`: `7a346e3` (drop the `devEngines` pin), `8ac6837` (add `packageManager: npm@11.20.0` — turborepo 2.11 requires one of the two fields; the legacy field is inert for npm, verified with the Node-dir npm 10.9.2), `6c63ab2` (remove the example docs app), `ece4d0e` (sync the lockfile). Branch `chore/backend-scaffold`: `4b1267b` (`nest new`, nested `.git` removed), `0305daf` (backend `dev` script), `4b296b9` (`test` task in `turbo.json`), `6942c92` (**committed by the `nest-prisma` CLI itself**: schema, `prisma7.config.ts`, `src/prisma/*`, nest-cli/tsconfig/jest edits), `703478f` (`nest-common` scaffold), `81a871b` (align TypeScript to `^5.9.3` in root + `apps/web` — the root pinned 7.0.2 while the hoisted `ts-api-utils` needs TS 5, which broke `npm run lint`). Gate now green from `apps/backend`: `npx eslint "{src,test}/**/*.ts"`, `npm run test`, `npm run build`. Tooling facts: shell npm 11.20.0, Node-dir npm 10.9.2 (turbo runs the latter), Node v22.17.1 vs root `engines.node >=24` (warning only — upgrade to Node 24 LTS when convenient). Step 1 remaining: `nest-skills` **from `apps/backend`** (its preflight requires `@nestjs/core` in the cwd `package.json`), then the AGENTS.md monorepo commit.

Conventions for this plan:

- Paths are **relative to `apps/backend/`** unless they start with `repo:` (then relative to `sigap/`).
- All shell commands run with `cwd = apps/backend`, except scaffold and turbo commands (marked).
- **Monorepo npm rules (must also be written into `repo:AGENTS.md` in Step 1):**
  - Plain `npm install` / `npm ci` only at the repo root — **never** inside `apps/backend` or `apps/web`.
  - Add/remove dependencies with the workspace flag from the root: `npm install <pkg> -w apps/backend`; or `cd apps/backend` first (npm resolves the workspace root automatically). The dependency must land in `apps/backend/package.json`, never the root `package.json` (root only carries tooling such as `turbo`).
  - Run workspace scripts from root (`npx turbo run <task> --filter=backend` or `npm run <task> -w apps/backend`) or from inside the app folder.
  - When `apps/backend/package.json` changes, `npm run build` inside `apps/backend` is also part of the gate (git-workflow rule 5).
- The [PRD](PRD.md)/API_SPEC reference `src/...`: read that as `apps/backend/src/...`. Docs keep living in `docs/` at the root.
- Deploy later: Railway Root Directory = `apps/backend`; Vercel Root Directory = `apps/web` (frontend teammate's concern).
- One commit = one complete change (code + DTOs + tests + migration). **Never** `git add .`, no push/merge/rebase, no destructive Prisma command (nest-prisma rule 15) anywhere in this plan.
- Verification before every commit (git-workflow rules 5-6), from `apps/backend`:
  - `npx eslint "{src,test}/**/*.ts"` (whole backend, no `--fix`)
  - `npm run test`
  - `npm run build` whenever `prisma/schema.prisma`, `tsconfig*.json`, `nest-cli.json`, `package.json` or `main.ts` changed, plus `npx prisma generate` when the schema changed
  - e2e on the real DB: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config ./test/jest-e2e.json --runInBand` (test-recipes note, [SPEC_AUDIT](SPEC_AUDIT.md) minor #3)
- Every step below states: branch, commits (one commit per row), files, F-IDs/BRs, tests (exception paths first, then happy path, then "the write did not happen"), and open risks.

---

## Step 0 — Turborepo root (hand-written bootstrap)

**Branch:** `chore/turbo-scaffold`

| Commit | Files |
|---|---|
| `chore(repo): bootstrap the turborepo root` | root `package.json` (`workspaces: ["apps/*", "packages/*"]`), `turbo.json` (tasks `build`, `lint`, `test`, `dev` defined up front — no later edit needed), `.gitignore` (`.env*`, `.turbo/`, `node_modules/`, `dist/`, `.next/`, `apps/backend/generated/`), minimal root `README.md` |
| `docs: add the revision 5.2 spec docs` | `docs/` ([PRD](PRD.md), [DATA_MODEL](DATA_MODEL.md), [API_SPEC](API_SPEC.md), [SPEC_AUDIT](SPEC_AUDIT.md), [GAPS](GAPS.md), IMPLEMENTATION_PLAN) |

- Delivers: the workspace contract every later tool expects. F-IDs: none.
- **Rule before Step 1:** `package.json` must already declare the workspaces when the first `npm install` runs, or every app gets its own nested `node_modules`.
- Tests: none. Verify: `npx turbo --version` (or `turbo -v`) at root; `git status` clean.
- Risks: the only hand-written files of the whole build are these three; keep them minimal. Note this deliberately leaves create-turbo unused — accepted by decision (repo owner prefers manual root + explicit app scaffolds).

## Step 1 — Apps and backend scaffolds (one commit per tool)

**Branch:** `chore/backend-scaffold` — all commands with `--skip-install`, then exactly one `npm install` at the root.

**Who runs what (per `nest-auth-and-security` rule 24, the agent stops and the user runs the scaffolds):**

```powershell
# 1. you, from C:/Workspace/Competition/sigap/apps
nest new backend --strict --skip-git --skip-install --package-manager npm
npx create-next-app@latest frontend --typescript --eslint --app --src-dir --import-alias "@/*" --skip-install   # or the teammate's own flags

# 2. you, from C:/Workspace/Competition/sigap  (one install, after workspaces exist)
npm install

# 3. you, from C:/Workspace/Competition/sigap/apps/backend  (prisma FIRST, then common;
#    run `npm install` at the root after each: these scaffolds edit package.json)
npx @averildwi/nest-prisma
#   cd ../.. ; npm install ; cd apps/backend
npx @averildwi/nest-common
#   cd ../.. ; npm install

# 4. you, from C:/Workspace/Competition/sigap/apps/backend  (the installer preflight requires
#    @nestjs/core in the cwd package.json, so it must run inside the Nest app, NOT at the root)
npx @averildwi/nest-skills@latest --agent opencode

# 5. you, from C:/Workspace/Competition/sigap/apps/backend
npx prisma generate
```

The agent then verifies each tool, runs the gate, and commits each tool's output **as generated, one commit per tool** (git-workflow rule 6):

| Commit | Staged by the agent, produced by your command |
|---|---|
| `chore(repo): add the backend and frontend apps` | both apps as generated: backend tsconfig(eslint)/`nest-cli.json`/`package.json`/jest config/`src/main.ts` placeholder/`test/`; frontend Next.js default; `create-next-app` skips `git init` by itself because the root is already a repo |
| `chore(prisma): set up prisma with pg adapter` | `prisma/`, `prisma7.config.ts`, `src/prisma/`, `generated/` ignored — as generated |
| `chore(common): add nest-common scaffold` | `src/common/` (guards, filters, interceptors, `PaginationDto`, `HashingService`, `AppConfigModule`, `AuthUser` placeholder), `.env.example`, `app.module.ts` + `main.ts` wiring — as generated |
| `chore(backend): add agent skills` | run from `apps/backend`: `--agent opencode` -> `apps/backend/.opencode/skills/**` + `apps/backend/AGENTS.md` + `apps/backend/.nest-skills.json` (with `--agent both` it is `.claude/skills/**` + `CLAUDE.md`, and the root `AGENTS.md` stays untouched either way — the installer falls back to `AGENTS.nest-skills.md` only if that app already has its own `AGENTS.md`) |
| `docs(repo): document the monorepo npm workspace rules` | append the "Monorepo (npm workspaces + Turborepo)" section **plus a pointer to `apps/backend/AGENTS.md`** to the root `AGENTS.md` (turbo's file; turbo only manages its own `BEGIN/END` block, so appended text survives) | the block below |

Content of the appended section (`repo:AGENTS.md`):

```markdown
## Monorepo (npm workspaces + Turborepo)

- This repo is an npm-workspaces monorepo. Plain `npm install` / `npm ci` runs only at the repo root — never inside `apps/backend` or `apps/frontend`.
- Add or remove dependencies with the workspace flag from the root: `npm install <pkg> -w apps/backend` / `npm uninstall <pkg> -w apps/backend`. Running `npm install <pkg>` inside the app folder also works (npm resolves the workspace root), but the dependency must still land in `apps/backend/package.json`.
- Never put an app dependency in the root `package.json`; the root carries tooling only (for example `turbo`).
- Run workspace scripts from the root (`npx turbo run <task> --filter=backend`, or `npm run <task> -w apps/backend`) or from inside the app folder.
- When `apps/backend/package.json` changes, `npm run build` inside `apps/backend` is part of the gate (`git-workflow` rule 5).
- Scaffold output (`nest new`, `create-next-app`, `npx @averildwi/nest-*`) is committed as generated, one commit per tool (`git-workflow` rule 6).
```

- Delivers: skill rule 24 preflight (`src/common/` + `src/prisma/` exist). F-IDs: none.
- Tests: the scaffold's own generated specs stay (`it('should be defined')` gets replaced by real tests when the module is built, nest-testing rule 9).
- Verify: gate from `apps/backend` (lint, test, build — `package.json` touched). Scaffold commits must pass as-is; if a scaffold is red, report it and commit as generated with the lint result in the body (git-workflow rule 6).
- Risks/decisions: (1) skill agent flavor — `--agent both` recommended; use `--agent opencode` for `.opencode/skills` instead. (2) `nest new` pins Nest 11; keep `@nestjs/jwt@^11` in Step 4. (3) frontend tooling choices (Tailwind etc.) are left to the teammate — not touched in any backend step. (4) Running the scaffolds **without** `--skip-install` is also safe, but only because the root workspaces already exist (Step 0): npm then resolves to the root and keeps one lockfile. If an app is ever scaffolded before the root bootstrap, delete its nested `node_modules` and `package-lock.json` and redo. After every scaffold that edits `package.json`, run `npm install` once at the root so the lockfile stays single and whole.

## Step 2 — Project config, env schema, throttle tiers, health

**Branch:** `feat/config`

| Commit | Files | Delivers |
|---|---|---|
| `feat(config): add the env schema and throttle tiers` | `src/config/env.schema.ts`, `.env.example`, `src/config/throttle.config.ts`, `src/config/throttle.config.spec.ts`, `src/config/env.schema.spec.ts` | [API_SPEC](API_SPEC.md) 11 (20 vars, Joi per table), BR-80 tiers (`default`/`auth`/`sendCode`/`join`/`sos`, `skipIf` reading `@ThrottleTier` metadata), L-5 pin test (skill defaults 100/5/3/10/5, `ttl = THROTTLE_TTL * 1000`); env boot-fail tests from test-recipes (`JWT_SECRET`, `RESEND_API_KEY` required, `OTP_SENDER=console` refuses production) |
| `feat(health): wire main and add the health check` | `src/main.ts`, `src/app.module.ts`, `src/health/health.module.ts`, `health.controller.ts`, `health.service.ts`, `health.service.spec.ts` | `main.ts` order of nest-architecture rule 10 (`trust proxy`, `api` prefix, CORS, pipes, interceptors, filters, Swagger), `ThrottlerModule.forRootAsync` with the five tiers, `APP_GUARD` ThrottlerGuard; F-HEALTH-1 / BR-84 |

- Tests: health — DB error -> `ServiceUnavailableException` (first), happy path `SELECT 1` -> 200, no secrets in the response.
- Verify: gate + build (`main.ts`, `package.json` touched).
- Risks: none. `.env.example` includes every var of [API_SPEC](API_SPEC.md) 11 incl. `APP_URL`; local `.env` (never committed) sets `OTP_SENDER=console` ([SPEC_AUDIT](SPEC_AUDIT.md) minor #1 is then a non-issue locally).

## Step 3 — Prisma schema, migration, seed

**Branch:** `feat/prisma-schema`

| Commit | Files | Delivers |
|---|---|---|
| `feat(prisma): add the initial schema, migration and demo seed` | `prisma/schema.prisma` (8 models exactly as [DATA_MODEL](DATA_MODEL.md)), `prisma/migrations/<ts>_init/migration.sql` (from `npx prisma migrate dev --name init`), `prisma/seed.ts` | [DATA_MODEL](DATA_MODEL.md) whole schema incl. `GlobalRole`/`isActive`/`tokenVersion` (R-33); seed per [PRD](PRD.md) 8.14 (`SEED_ADMIN_EMAIL`, `SEED_DEMO_PASSWORD` required, idempotent, `HashingService` imported) |

- Tests: none by rule (seed is verified by running it); typecheck via build.
- Verify: `npx prisma generate` + gate + build.
- Risks/decisions: **needs your env** — set `DATABASE_URL` to your Railway/local Postgres before `migrate dev`. `migrate dev` on the empty DB is not destructive; if Prisma ever asks to reset, stop and ask (rule 15). After deploy, run `npx prisma migrate deploy` + `npx prisma db seed` manually on Railway.

## Step 4 — Auth module (copied from the skill reference, not rewritten)

**Branch:** `feat/auth`

| Commit | Files | Delivers |
|---|---|---|
| `refactor(common): type auth-user against the prisma role enum` | `src/common/types/auth-user.ts` only | AGENTS.md exception: `RoleName = GlobalRole`, `UserId = string`, `JwtPayload { sub, email, tv }` |
| `feat(common): add the otp mail port and adapters` | `src/common/mail/otp-sender.ts`, `resend-otp-sender.ts`, `console-otp-sender.ts`, `mail.module.ts` | skill rule 23 port (`OTP_SENDER` token, `fetch` Resend, console refuses production); BR-68 OTP half |
| `feat(auth): add the otp service` | `src/auth/otp/otp.service.ts`, `otp.service.spec.ts` | skill rule 11: atomic attempt claim, single consume, DB cooldown, purpose-scoped |
| `feat(auth): add the jwt strategy` | `src/auth/strategies/jwt.strategy.ts`, `jwt.strategy.spec.ts` | skill rules 1-2: `{ sub, email, tv }`, checks `isActive`/`emailVerifiedAt`/`tokenVersion`; F-AUTH-5 read model |
| `feat(auth): add register, verification and resend` | `dto/register.dto.ts`, `dto/verify-otp.dto.ts`, `dto/request-code.dto.ts`, `auth.service.ts` (register/verifyEmail/resendVerification/me), `auth.controller.ts` (4 handlers), `auth.service.spec.ts` | F-AUTH-1/2/5, BR-1/2/11/83, `auth`/`sendCode` tiers; register + first code in one `$transaction` |
| `feat(auth): add login, forgot and reset` | `dto/login.dto.ts`, `dto/reset-password.dto.ts`, service + controller additions, spec additions | F-AUTH-3/4, BR-3 (password first, then 403 disabled -> unverified), BR-5 (reset bumps `tokenVersion` in the consuming transaction) |
| `feat(auth): add change-password and logout-all` | `dto/change-password.dto.ts`, service + controller additions, spec additions | F-AUTH-6/7, BR-5/77 (fresh token returned; sockets disconnected on bump) |
| `test(auth): add the route-guard meta-test and auth e2e` | `test/route-guards.e2e-spec.ts`, `test/auth.e2e-spec.ts` | meta-test from test-recipes **unchanged** (only `[PUBLIC]`/`[AUTH]`, R-34); e2e: token in body, identical 401s, old token after reset -> 401, 6th login -> 429, bad `:id` -> 400, extra field -> 400 |

- Test priority inside each commit: exception paths first (409 no-overwrite, 400 invalid code with no write, 401 identical bodies, 403 order), then happy paths, then write-not-happened assertions.
- Verify: gate + test + e2e command (real DB) + build (`main.ts` untouched here, but `package.json` gains `@nestjs/jwt@^11 passport-jwt passport`).
- Risks/decisions: `JWT_SECRET` (min 32 chars) and Resend key in local `.env` for e2e. `npm i @nestjs/jwt@^11 passport-jwt passport` + `@types/passport-jwt` (the reference forbids `@nestjs/jwt` 12 under Jest/CJS). **Auth must be green before any feature.**

## Step 5 — Communities

**Branch:** `feat/communities`

| Commit | Files | Delivers |
|---|---|---|
| `feat(communities): add the region and label helpers` | `src/common/helpers/region-normalise.helper.ts`, `region-key.helper.ts`, `format-label.helper.ts`, 2 specs | BR-12 (`normaliseRegionPart(field, text)` incl. city `kota:`/`kab:` marker), BR-13 (`RT001/RW006`) as pure functions |
| `feat(communities): add create community` | `src/communities/dto/create-community.dto.ts`, `communities.service.ts`, `communities.controller.ts`, `communities.module.ts`, `communities.service.spec.ts` | F-COMMUNITIES-1, BR-12/13/14/15/16; city prefix check 400; P2002 -> 409 (BR-14); community + ADMIN membership in one `$transaction` |
| `feat(communities): add my communities and the community card` | `dto/query-my-communities.dto.ts`, `src/common/helpers/community-access.helper.ts` + its spec, service + controller additions, spec additions | F-COMMUNITIES-2/7, F-MEMBERSHIPS-7, BR-23/31 (first use of `assertMember`), shared helper for all later modules |

- Tests: helper edge cases first (Kelapa Gading, Kotabaru, Kota vs Kabupaten, prefix word boundary), then create/409/transaction, then card 403 cross-tenant.
- Verify: gate + test + build (schema unchanged).

## Step 6 — Notifications (templates, service, gateway) — needed before memberships

**Branch:** `feat/notifications`

| Commit | Files | Delivers |
|---|---|---|
| `feat(notifications): add the templates and the service` | `src/notifications/notification-templates.ts`, `notification-templates.spec.ts`, `notifications.service.ts`, `notifications.service.spec.ts`, `notifications.module.ts` | BR-65/66 write side; 5.9.1 pure texts (9 types, `{title}` cut at 100, false-alarm variant) |
| `feat(realtime): add the socket gateway and cors adapter` | `src/recipes/frontend-cors-io.adapter.ts` (path from the websocket-auth recipe), `src/notifications/realtime.gateway.ts`, `realtime.gateway.spec.ts`, `src/main.ts` (`app.useWebSocketAdapter`) | F-NOTIFICATIONS-4, BR-69 (after-commit emit helper: `notification:new`, `sos:new`, `sos:updated`, `join-request:new` to `user:<id>` rooms), BR-77 (handshake `auth.token` -> `JwtStrategy.validate`, `disconnect(true)`), BR-81 (CORS from `FRONTEND_URL`) |
| `feat(notifications): add list, count, read and read-all` | `dto/query-notifications.dto.ts`, service + controller additions, spec additions | F-NOTIFICATIONS-1/2, BR-65 (404 for another user's id; `updateMany` where `userId: me`) |

- Tests: template purity + gateway handshake (invalid token -> disconnect, `strategy.validate` called) first; ownership 404s; read-all no-write on foreign rows.
- Verify: gate + test + build (`main.ts` touched).

## Step 7 — Memberships (join by QR)

**Branch:** `feat/memberships`

| Commit | Files | Delivers |
|---|---|---|
| `feat(memberships): add the join token helper` | `src/memberships/join-token.ts`, `join-token.spec.ts` | BR-19 (HMAC window token, 22 chars) / BR-20 (w and w-1, `timingSafeEqual`) pure part |
| `feat(memberships): add qr preview and the join request` | `dto/preview-membership.dto.ts`, `dto/create-membership.dto.ts`, `memberships.service.ts`, `memberships.controller.ts`, `memberships.module.ts`, specs | F-MEMBERSHIPS-2/3, BR-19/20/23/24, `join` tier; one error message for unknown community/bad token; conditional reuse (`updateMany` from REJECTED/LEFT/REMOVED, else create) -> exactly one `JOIN_REQUEST` set, loser 409 (E-8) |
| `feat(memberships): add the join qr screen data and the queue` | service + controller additions (`GET join-qr`, `GET join-requests`), `dto/query-join-requests.dto.ts`, spec additions | F-MEMBERSHIPS-1/4, BR-19/32 (descriptions name `assertAdmin`) |
| `feat(memberships): add approve and reject` | service + controller additions, spec additions | F-MEMBERSHIPS-5/6, BR-25 (conditional update, lost race 400), BR-66 (in-app only, R-35) |
| `feat(memberships): add member list, role, remove and leave` | `dto/query-members.dto.ts`, `dto/change-membership-role.dto.ts`, service + controller additions, spec additions | F-MEMBERSHIPS-8/9/10/11, BR-27/28/29/30 (last-ADMIN guard incl. sole member, G-L14) |

- Tests: invalid/expired token 400 with no write; 409 when PENDING/ACTIVE; double-submit single-notification assertion; approve 400-on-lost-race; demoting last admin 400; remove self 400; leave 400 as sole admin.
- Verify: gate + test.

## Step 8 — Announcements

**Branch:** `feat/announcements`

| Commit | Files | Delivers |
|---|---|---|
| `feat(announcements): add publish with highlight` | `dto/create-announcement.dto.ts`, service, controller, module, spec | F-ANNOUNCEMENTS-1, BR-35/36/37 (clear-then-set in the same `$transaction`, bulk `createMany` minus author) |
| `feat(announcements): add edit, delete, list and detail` | `dto/update-announcement.dto.ts`, `dto/query-announcements.dto.ts`, service + controller additions, spec additions | F-ANNOUNCEMENTS-2..5, BR-33 (404 cross-tenant), BR-38 (delete removes notifications), BR-39 (order) |

- Tests: highlight race comment (G-L4, no unique), 404 other-community, delete-with-notifications atomicity, list order.
- Verify: gate + test.

## Step 9 — Reports

**Branch:** `feat/reports`

| Commit | Files | Delivers |
|---|---|---|
| `feat(reports): add submit, my list and detail` | `dto/create-report.dto.ts`, `dto/query-my-reports.dto.ts`, service, controller, module, specs | F-REPORTS-1/2/3, BR-48/49/52 (`REPORT_NEW` minus reporter; detail 404 for non-reporter member) |
| `feat(reports): add edit and delete while pending` | `dto/update-report.dto.ts`, service + controller additions, spec additions | F-REPORTS-4/5, BR-50 (conditional update, notifications removed in the same transaction) |
| `feat(reports): add the admin list and status changes` | `dto/query-reports.dto.ts`, `dto/process-report.dto.ts`, `dto/resolve-report.dto.ts`, `dto/reject-report.dto.ts`, service + controller additions, spec additions | F-REPORTS-6/7, BR-32/51 (`process`<-PENDING, `resolve`<-PENDING|IN_PROGRESS, `reject`<-PENDING|IN_PROGRESS with required note; note **overwritten/null per change**), BR-52 (`REPORT_STATUS` unless self) |

- Tests: invalid transitions 400 with no write (RESOLVED->*, REJECTED->*, IN_PROGRESS->process), reject without note 400, cross-tenant 404, reporter edit after status change 400.
- Verify: gate + test.

## Step 10 — SOS alerts

**Branch:** `feat/sos-alerts`

| Commit | Files | Delivers |
|---|---|---|
| `feat(common): add the sos mailer port and adapters` | `src/common/mail/sos-mailer.ts`, `resend-sos-mailer.ts`, `console-sos-mailer.ts` + spec (mocked `fetch`) | BR-68 SOS half: `SOS_MAILER` token, `sendSosAlert`, same Resend call, console variant logs nothing but "SOS mail skipped" |
| `feat(sos-alerts): add send and my list` | `dto/create-sos-alert.dto.ts`, `dto/query-my-sos.dto.ts`, service, controller, module, specs | F-SOS-1/9, BR-53/54/55/62/64, `sos` tier; after-commit `sos:new` + `notification:new` + fire-and-log mail (name/block/type/label/`APP_URL` only) |
| `feat(sos-alerts): add the admin list and detail` | `dto/query-sos.dto.ts`, service + controller additions, spec additions | F-SOS-8, BR-32/33; resolve audit minor #2 here: `openOnly` wins over `status` (doc line in `docs/API_SPEC.md` section 7 updated in the same commit) |
| `feat(sos-alerts): add accept and cancel` | service + controller additions, spec additions | F-SOS-3/4, BR-57 (first-accept-wins, sender 403), BR-59 (sender cancels from SENT/ACCEPTED/HANDLING) |
| `feat(sos-alerts): add handle, resolve and false alarm` | `dto/handle-sos-alert.dto.ts`, `dto/resolve-sos-alert.dto.ts`, `dto/false-alarm-sos-alert.dto.ts`, service + controller additions, spec additions | F-SOS-5/6, BR-58 (`handle`<-ACCEPTED only, `resolve`<-HANDLING only, error order 404 -> 403 -> 400; E-40), BR-60 |

- Tests: open-SOS 409 with no create; accept race (one winner, others 400); ACCEPTED->RESOLVED 400 no write; non-handler 403; cancel from closed 400; false-alarm actor matrix; mail failure logged, method resolves.
- Verify: gate + test.

## Step 11 — Final pass

**Branch:** `chore/final-pass`

| Commit | Files | Delivers |
|---|---|---|
| `test(e2e): add the demo flow and the cross-tenant checks` | `test/sigap.e2e-spec.ts` | the [API_SPEC](API_SPEC.md) 14 e2e flow end-to-end incl. `handle` -> `resolve` and the SC-4 isolation check (admin A -> 403 on B), + E-40 |
| `docs(readme): document setup, env vars and deployment` | `apps/backend/README.md`, root `README.md`, `.env.example` final review | 20 env vars documented, Railway root directory note, seed instructions, venue `.env` throttle tuning (Q2) |
| (no third commit) whole-workspace verification | — | at root: `npx turbo run lint test build --filter=backend` green; endpoint count 51 REST + 1 WS re-counted against [API_SPEC](API_SPEC.md) 17 |

- Risks: none planned. Any `migrate reset`/data-loss command stays out; if ever needed, it needs your explicit approval in the conversation (nest-prisma rule 15).

---

## Decisions already taken (from PRD 0 / 8.13 / SPEC_AUDIT answers)

| # | Decision |
|---|---|
| 1 | Turborepo, npm, `apps/backend` + `apps/frontend`; root bootstrapped by hand (Step 0), app scaffolds generated; no shared `packages/` code (frontend never imports backend internals). |
| 2 | ID type uuid, PostgreSQL ([PRD](PRD.md) 0). |
| 3 | Throttle tiers via `ThrottleTier` + `skipIf` (L-5); defaults 100/5/3/10/5, venue raises them in `.env` only (Q2). |
| 4 | Mail: skill `OTP_SENDER` port + `SOS_MAILER` port; `OTP_SENDER=resend` default; local `console` (R-35). |
| 5 | Skills installed once at repo root with `--agent both`; backend agents read `.claude/skills`. |
| 6 | The last admin cannot leave; no community deletion (G-L14) — no extra endpoints planned. |
| 7 | `openOnly` wins over `status` on the SOS admin list (audit minor #2), implemented in Step 10 with the one-line [API_SPEC](API_SPEC.md) doc fix. |

## Checklist

| Step | Status |
|---|---|
| 0 Turborepo root (workspaces, turbo.json, .gitignore, docs) | done |
| 1 Apps + backend scaffolds (nest, nest-prisma, nest-common, skills) | done |
| 2 Config + env + throttle tiers + health | done |
| 3 Prisma schema + migration + seed | done |
| 4 Auth (port, otp, strategy, flows, change-password, logout-all, meta-test, e2e) | done |
| 5 Communities (+ shared region/access helpers) | done |
| 6 Notifications (templates, service, gateway, endpoints) | done |
| 7 Memberships (token, preview/join, queue, decisions, admin ops) | todo |
| 8 Announcements | todo |
| 9 Reports | todo |
| 10 SOS (mailer, send, lists, transitions) | todo |
| 11 Final pass (e2e, README, full workspace verify) | todo |

Snapshot of what exists (updated 2026-10-20): see `docs/PROJECT_STATUS.md`.