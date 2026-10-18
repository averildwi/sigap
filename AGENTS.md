<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": true` in the root `turbo.json` or `turbo.jsonc` to opt in; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

## Monorepo (npm workspaces + Turborepo)

- This repo is an npm-workspaces monorepo. Plain `npm install` / `npm ci` runs only at the repo root — never inside `apps/backend` or `apps/web`.
- Add or remove dependencies with the workspace flag from the root: `npm install <pkg> -w apps/backend` / `npm uninstall <pkg> -w apps/backend`. Running `npm install <pkg>` inside the app folder also works (npm resolves the workspace root), but the dependency must still land in `apps/backend/package.json`.
- Never put an app dependency in the root `package.json`; the root carries tooling only (for example `turbo`).
- Run workspace scripts from the root (`npx turbo run <task> --filter=backend`, or `npm run <task> -w apps/backend`) or from inside the app folder.
- When `apps/backend/package.json` changes, `npm run build` inside `apps/backend` is part of the gate (`git-workflow` rule 5).
- Scaffold output (`nest new`, `create-next-app`, `npx @averildwi/nest-*`) is committed as generated, one commit per tool (`git-workflow` rule 6).

## Where the backend standards and specs live

- Skills (NestJS standards): `apps/backend/.opencode/skills/<name>/SKILL.md` — 7 skills; `nest-auth-and-security` also ships `references/*.md`. Index: `apps/backend/AGENTS.md`. Manifest: `apps/backend/.nest-skills.json` (all committed).
- If they are missing, run **inside `apps/backend`** (its preflight needs `@nestjs/core` in that `package.json`): `npx @averildwi/nest-skills@latest --agent opencode` (`--agent both` installs to `.claude/skills` instead).
- Project specs: `docs/PRD.md`, `docs/DATA_MODEL.md`, `docs/API_SPEC.md`, `docs/SPEC_AUDIT.md`, `docs/GAPS.md`, `docs/IMPLEMENTATION_PLAN.md` (older revisions in `docs/archive/`).
- `git-workflow` applies to **every** commit in this repo, frontend included.
