# SPEC_AUDIT: SIGAP (PRD rev 5.2, DATA_MODEL, API_SPEC)

Auditor note: the rev 5.1 audit was produced by an independent reviewer subagent. For rev 5.2 the subagent runner returned empty results in three attempts, so this re-audit was performed **in the same session that wrote the fixes** — it is a mechanical verification pass (greps + reading every changed section against the skill files), **not independent**. Treat it as a pre-check; an independent audit is still worthwhile if time allows. Source of truth: the skills in the unpacked `@averildwi/nest-skills@1.0.2` package (AGENTS.md, git-workflow, nest-architecture, nest-auth-and-security + all 7 references, nest-prisma, nest-response-and-errors, nest-testing, nest-validation-and-config). Every rule number cited was grepped in those files.

## 1. Verdict

**READY** — 0 blockers, 0 majors, 5 minors (below). The rev 5.1 verdict (FIX FIRST: 2 blockers, 8 majors, 21 minors) is resolved; see section 4.

## 2. Status of the rev 5.1 findings

| Rev 5.1 finding | Resolution in rev 5.2 | Verified |
|---|---|---|
| #1 blocker: `[ADMIN]` without `@Roles` | All guarded routes are `[AUTH]` with the admin/membership check named in the `description` (R-34; API_SPEC 0.1 describes the rule). L-4 and G-L8 deleted; the route-guard meta-test is used unchanged | pass |
| #2 blocker: no token revocation | `User.tokenVersion`, JWT `{ sub, email, tv }`, `validate()` checks `tv`; `change-password` and `logout-all` restored as skill-reference copies (R-33; API_SPEC 1, DATA_MODEL `User`) | pass |
| #3 major: no `Role` enum / `isActive` | `enum GlobalRole { ADMIN, USER }`, `globalRole @default(USER)`, `isActive @default(true)` on `User` (N-1); per-resource naming per rule 5 | pass |
| #4-#5 major: throttle values | Skill defaults (5 / 3) as env-backed named tiers + `JOIN_THROTTLE_LIMIT` (10) and `SOS_THROTTLE_LIMIT` (5); `THROTTLE_TTL * 1000`; deviation L-5 documented with the decorator-vs-config reason; unit test pins the defaults | pass |
| #6-#7 major: mail | `OTP_SENDER` port + `ResendOtpSender` / `ConsoleOtpSender` as in the reference (Indonesian texts), env `OTP_SENDER` / `RESEND_API_KEY` / `MAIL_FROM`, default `resend`; SOS email via a second `SOS_MAILER` port (R-35). L-3 deleted | pass |
| #8 major: SOS transitions | `handle` <- ACCEPTED only, `resolve` <- HANDLING only; re-read order 404 -> 403 -> 400 (R-37; BR-58, PRD 6.5, API_SPEC 7); both wrong-state cases in API_SPEC 14 | pass |
| #9-#10 major: test coverage | API_SPEC 14 has one row per Lite BR (incl. BR-33, 49, 58-60, 65, 77) + the four required auth specs + `test/auth.e2e-spec.ts` | pass |
| Minors #11..#31 | BR-11 exceptions named; F-IDs BR-83/BR-84 added; orphan filters documented in the features; BR-9 boundaries; BR-12 per-field normalisation + city marker; E-8 aligned; 2.2 vs 12 aligned; SC-2 manual; badge dropped; seed env + `HashingService`; DTO names `<Verb><Entity>Dto`; descriptions added; N-4 declared as the rule-12 answer; `APP_URL`; socket recipe reused | pass |

## 3. Checklist (rev 5.2)

| Check | Result | Location |
|---|---|---|
| Guard decision on every endpoint; prefix = guards | **PASS** | API_SPEC 1-9: every row has a Guard column; only `[PUBLIC]` / `[AUTH]` exist (self-check #9); PRD 2.2 legend states it (R-34) |
| No `role`/`isActive` in a body; one password policy | **PASS** | All body DTOs audited: no `globalRole`/`isActive`; `role` only in `PATCH .../role` (BR-11 exception G-L7); `BR-2` = skill rule 20 (`IsNewPassword` 8-128, `IsCurrentPassword` elsewhere) |
| No account-existence leak; status after password | **PASS** | resend-otp / forgot-password always the same 200; login 401 identical, then 'Account is disabled' -> 'Email is not verified' (API_SPEC 1, BR-3); register 409 = skill rule 12's own exception (BR-11/E-13 cite the rule) |
| Throttle on login-like / code endpoints, not at class level | **PASS** | `auth` tier on register, verify-otp, login, forgot, reset, change-password; `sendCode` on resend-otp; `join` on preview+join; `sos` on SOS send; all per handler (L-5), `logout-all` and everything else `default` |
| `:id` pipes match the ID type | **PASS** | API_SPEC 0 + C-7: all `ParseUUIDPipe`, ids `@db.Uuid` |
| Ownership rules for every "only ..." sentence | **PASS** | PRD 2.2 + API_SPEC descriptions + BR-33 404 cross-tenant; SOS handler-only with fixed error order (BR-58) |
| `@@map`, timestamps, `onDelete`, no `@map` on columns | **PASS** | DATA_MODEL 2: 8 models, 15 explicit relations, N-11 |
| Soft delete only where approved; no `insensitive` on MySQL | **PASS** | PRD 0 "Soft delete: None"; provider `postgresql`, `insensitive` allowed (nest-prisma rule 14) |
| Multi-step writes in `$transaction`; concurrency answers | **PASS** | register (now yes), community create, join reuse, approve/reject, role/remove/leave, announcements, reports, SOS — all flagged; regionKey unique, `(userId, communityId)` unique + conditional reuse (BR-23/E-8), OTP atomic claim, conditional `updateMany` (N-4), accepted G-L2/G-L3/G-L4 |
| Markers, no `{ message }`, `RawResponse` unused | **PASS** | API_SPEC 0.3; markers `MessageResponse` / `Paginated` / plain |
| Status codes (409 dupes, 200 action POSTs) | **PASS** | register, community create, join, SOS send = 409; every action POST has 200 |
| `ToBoolean`, `PaginationDto`, env list complete | **PASS** | `openOnly`, `unread` use `@ToBoolean()`; 9 query DTOs extend `PaginationDto`; PRD 8.12 = API_SPEC 11 = **20** vars (+2 seed-only), all with Joi (`APP_URL` required, `OTP_SENDER` default `resend`, tiers with skill defaults) |
| Traceability F <-> endpoints <-> BR <-> tests | **PASS** | PRD 11; API_SPEC 13 (51 REST + WS, count matches section 17 and PRD 11); API_SPEC 14 now names every Lite BR (BR-4, 6-8, 10, 17, 18, 21, 22, 26, 34, 40-47, 56, 61, 67, 70-79, 82 are P2 / DIBUANG / STRETCH and excluded by definition) |
| State machines: endpoint + role + invalid-state error | **PASS** | 6.1 memberships (409/400 rows), 6.4 reports (400, final states), 6.5 SOS (400 incl. ACCEPTED->RESOLVED; 404->403->400 order) |
| Product logic | **PASS** | BR-51 defines the "latest admin response"; E-8 = BR-23 conditional reuse; G-L14 records the last-admin decision; G-L15 covers the city marker; no contradictions found between PRD sections, API_SPEC and DATA_MODEL |

## 4. Findings

| # | Severity | Doc + section | Problem | Suggested fix |
|---|---|---|---|---|
| 1 | minor | API_SPEC 11 `APP_URL` | `required()` forces local devs who run with `OTP_SENDER=console` to set `APP_URL` too, although no mail is sent | Accept (documented in `.env.example`), or `allow('')` with the email helper skipping the link when empty |
| 2 | minor | API_SPEC 7 `QuerySosDto` | `status` + `openOnly` combined is undefined (filter AND open-only?) | Define: `openOnly` wins over `status`, or reject the combination with 400 |
| 3 | minor | API_SPEC 14 e2e | The Prisma 7 + Jest note from `references/test-recipes.md` (`node --experimental-vm-modules ... --runInBand`) is not carried into the docs; an implementer will hit the dynamic-import failure | Copy the run command note into the implementation plan's verification commands |
| 4 | minor | API_SPEC 0.2 / PRD 8.4 (L-5) | The `@ThrottleTier` decorator + `skipIf` mechanism is specified, but only the defaults are pinned by a test; the tier-switch helper itself has none | Add a `throttle.config.ts` test asserting `throttleTierOf()` reads the handler metadata |
| 5 | minor | DATA_MODEL N-1 vs auth rule 24 | `RoleName = GlobalRole` renames the enum the rule mentions; legal via rule 5 (both role levels exist), but the implementer must keep the type import from `generated/prisma/client` and only touch the three allowed lines of `auth-user.ts` | No doc change; carry the note into the plan's auth step |

## 5. Questions for the product owner

None. All five rev 5.1 questions were answered and applied (PRD 10.2 records them).