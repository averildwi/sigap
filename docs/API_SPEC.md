# API_SPEC: WargaKita Lite

Source: `docs/PRD.md` rev 5.2 (Lite) and `docs/DATA_MODEL.md`. Full v1 spec archived in `docs/archive/full-v1/API_SPEC.md`; Lite rev 5 in `docs/archive/lite-rev5/API_SPEC.md`; Lite rev 5.1 in `docs/archive/lite-rev5.1/API_SPEC.md`. Items marked **[PHASE 2]** / **[DIBUANG di Lite]** / **[STRETCH]** in the PRD have no endpoint here (see section 10, "Not in Lite").

## 0. Conventions (pointers only)

| Topic | Source of truth |
|---|---|
| Envelope, markers (`MessageResponse`, `Paginated`), error body, status codes | `nest-response-and-errors` |
| Route naming, `[PREFIX]` derivation, Swagger, `main.ts` order | `nest-architecture` rules 9-12 |
| Auth endpoints, JWT, OTP, throttle, `:id` pipes, no account leaks | `nest-auth-and-security` (rules 10, 12, 14, 21, 22, 24) |
| DTO rules, `PaginationDto`, `ToBoolean`, env schema | `nest-validation-and-config` |
| Prisma usage (select, transactions, no N+1) | `nest-prisma` |
| Known deviation L-5 (throttle tiers) | PRD 8.13 |

All paths are under `/api`. All ids are uuid -> every `:xxxId` uses `ParseUUIDPipe`. Every list query DTO extends `PaginationDto` (`page`, `limit`).

### 0.1 Guards and prefixes

| Prefix | Guards | Meaning |
|---|---|---|
| `[PUBLIC]` | none | anyone |
| `[AUTH]` | `JwtAuthGuard`, `RolesGuard`, no `@Roles` | any logged-in user (`AuthUser.role` is always `USER` in Lite); every membership, ownership or admin check is in the service and named in the Swagger `description` |

No `@Roles` is used anywhere: `globalRole` exists (skill rule 5 / 22) but no Lite route restricts on it, so per `nest-architecture` rule 12 every guarded route is `[AUTH]` and the per-resource rule lives in the `description` (`references/per-resource-roles.md`: "the label never lies"). The route-guard meta-test (`references/test-recipes.md`) is used unchanged. Community checks use `src/common/helpers/community-access.helper.ts`:
- `assertMember(tx, userId, communityId)` -> ACTIVE membership or `403 'You are not a member of this community'` (also for an unknown community, BR-31).
- `assertAdmin(tx, userId, communityId)` -> as above, plus role ADMIN or `403 'Admin access required'` (BR-32).
- Resources of another community -> `404` (BR-33).

### 0.2 Throttle tiers

Per BR-80 and deviation L-5 (PRD 8.13): five named throttlers registered in `ThrottlerModule.forRootAsync`, each `{ name, ttl: THROTTLE_TTL * 1000, limit: <env> }` — `default` (`THROTTLE_LIMIT`, 100), `auth` (`AUTH_THROTTLE_LIMIT`, 5), `sendCode` (`SEND_CODE_THROTTLE_LIMIT`, 3), `join` (`JOIN_THROTTLE_LIMIT`, 10), `sos` (`SOS_THROTTLE_LIMIT`, 5). Notation below: `default`, `auth`, `sendCode`, `join`, `sos`. A tier is switched on per handler with `@ThrottleTier('<name>')` (`SetMetadata` + `skipIf` reading it); `default` applies to every route. Handler level, never class level. Defaults equal `nest-auth-and-security` rule 10 values (a unit test pins them); the venue raises them in `.env` only.

### 0.3 Shared response shapes

| Name | Fields |
|---|---|
| `UserRef` | `id`, `name` |
| `CommunitySummary` | `id`, `label` (`RT001/RW006`, BR-13), `name`, `rt`, `rw`, `village`, `district`, `city`, `province` |
| `MembershipView` | `id`, `status`, `role`, `houseBlock`, `requestedAt`, `decidedAt`, `joinedAt` |
| `AnnouncementView` | `id`, `communityId`, `title`, `body`, `isHighlight`, `author: UserRef`, `createdAt`, `updatedAt` |
| `ReportView` | `id`, `communityId`, `title`, `description`, `category`, `status`, `responseNote`, `respondedAt`, `respondedBy: UserRef \| null`, `reporter: UserRef & { houseBlock }`, `createdAt`, `updatedAt` |
| `SosView` | `id`, `communityId`, `type`, `note`, `latitude`, `longitude`, `houseBlock` (snapshot), `status`, `recipientCount`, `resolutionNote`, `sender: UserRef & { phone }`, `handler: UserRef \| null`, `acceptedAt`, `handlingAt`, `closedAt`, `createdAt` |
| `NotificationView` | `id`, `type`, `title`, `body`, `communityId`, `entityType`, `entityId`, `readAt`, `createdAt` |
| `ProfileView` (BR-83) | `id`, `email`, `name`, `phone`, `globalRole`, `emailVerifiedAt`, `createdAt` (one `profileSelect`, skill rule 17) |

Never returned: `passwordHash`, `codeHash`, `regionKey`, `escalatedAt`, `tokenVersion`, `isActive`.

### 0.4 Conflicts with the skills

| # | Conflict | Resolution |
|---|---|---|
| C-2 | Skill rule 21: `GET /auth/me` returns `id, email, role, emailVerifiedAt, createdAt` | Returns `ProfileView` (BR-83): adds `name`, `phone`; the role field is `globalRole` (`per-resource-roles.md` naming). |
| C-3 | Skill `RegisterDto` is `{ email, password }` | Extended with `name`. |
| C-4 | Skill rule 21: profile is `/auth/me`; profile edit not in the skill table | `PATCH /auth/me`, implemented in `src/users/` (`@Controller('auth/me')`). |
| C-5 | Skill reference registers with `{ email, password }` only and `role: DEFAULT_ROLE`; Lite adds `name` | Register stores `name`; `role: DEFAULT_ROLE` -> `globalRole: 'USER'` (N-1). |
| C-7 | ID pipe | All `ParseUUIDPipe`. |
| C-8 | The skill's mail port sends only OTP-shaped messages | OTP mail uses the skill port unchanged (Indonesian texts of 5.9.1); the SOS email uses a second port `SOS_MAILER` (`SosMailer.sendSosAlert`) in the same `MailModule`, same Resend `fetch` call (PRD 8.7). |

## 1. Module `auth` (`src/auth/`)

Copied from `nest-auth-and-security/references/reference-implementation.md` with the Lite changes: `name` and `phone` on `User` (C-3, C-5), `role` -> `globalRole` (`per-resource-roles.md`), OTP subjects/texts in Indonesian (5.9.1), throttles via tiers (L-5). Everything else as the reference: JWT payload `{ sub, email, tv }`, `JwtStrategy.validate` re-loads `id, email, globalRole, isActive, emailVerifiedAt, tokenVersion`, reset / change-password / logout-all bump `tokenVersion`.

| Method | Path | Summary | Guard | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|
| POST | `/auth/register` | `[PUBLIC] Register and send a verification code` | - | auth | 201 | F-AUTH-1 / BR-1, 2, 11, 80 |
| POST | `/auth/verify-otp` | `[PUBLIC] Verify the email with a code` | - | auth | 200 | F-AUTH-2 / BR-3, 80 |
| POST | `/auth/resend-otp` | `[PUBLIC] Send a new verification code` | - | sendCode | 200 | F-AUTH-2 / BR-80 |
| POST | `/auth/login` | `[PUBLIC] Log in with email and password` | - | auth | 200 | F-AUTH-3 / BR-3, 80 |
| POST | `/auth/forgot-password` | `[PUBLIC] Send a password reset code` | - | auth | 200 | F-AUTH-4 / BR-80 |
| POST | `/auth/reset-password` | `[PUBLIC] Reset the password with a code` | - | auth | 200 | F-AUTH-4 / BR-2, 5, 80 |
| POST | `/auth/change-password` | `[AUTH] Change my password, end other sessions` | Jwt, Roles | auth | 200 | F-AUTH-6 / BR-2, 5, 80 |
| POST | `/auth/logout-all` | `[AUTH] Log out on every device` | Jwt, Roles | default | 200 | F-AUTH-7 / BR-5, 77 |
| GET | `/auth/me` | `[AUTH] Get my profile` | Jwt, Roles | default | 200 | F-AUTH-5 / BR-83 |

### POST /auth/register
- **Request** body `RegisterDto`:

  | Field | Type | Validators | Example |
  |---|---|---|---|
  | `email` | string | `@IsAccountEmail()` (skill) | `"siti@example.com"` |
  | `password` | string | `@IsNewPassword()` (skill, 8-128) | `"rahasia123"` |
  | `name` | string | `@IsString() @Transform(trim) @Length(2, 100)` | `"Siti Aminah"` |
- **Response** `MessageResponse(null, 'Registered, check your email for the code')`.
- **Errors**: `409 | Email is already registered | email exists (skill rule 12 exception, rule 19: never update the existing row)`; `400 | validation messages`.
- **Rules**: BR-1, BR-2, BR-11. **Transaction: yes** (nest-prisma rule 11): `user.create` and `OtpService.issue` (which retires older unused codes and inserts the new one) run in one interactive transaction, so a registered account always has exactly one live code; `OtpService.consume`-style atomic claim is unaffected. Concurrency: duplicate email race -> P2002 on `user.create` -> 409 via the filter, nothing else written.

### POST /auth/verify-otp, /resend-otp, /login, /forgot-password, /reset-password
As in the skill reference (`VerifyOtpDto`, `RequestCodeDto`, `LoginDto`, `ResetPasswordDto`; responses `{ accessToken }`, `null`, `{ accessToken }`, `null`, `null`).

| Endpoint | Errors |
|---|---|
| verify-otp | `400 | Code is invalid or expired | unknown email, wrong/expired/used code, attempts exhausted` |
| resend-otp | none (always `200 'If the account can receive a code, it has been sent'`) |
| login | `401 | Invalid credentials | unknown email or wrong password`; then, only after a correct password: `403 | Account is disabled` or `403 | Email is not verified` (order per skill rule 12, BR-3) |
| forgot-password | none (same 200 message; code only for an ACTIVE account) |
| reset-password | `400 | Code is invalid or expired` |

Rules: BR-2, BR-3, BR-5; OTP 6 digits, TTL `OTP_TTL_MINUTES` (10), max 5 attempts with the atomic claim of skill rule 11, cooldown `OTP_RESEND_COOLDOWN_SECONDS` (60), purpose-scoped. **Reset ends every session**: the consuming transaction also sets `tokenVersion: { increment: 1 }` (and `emailVerifiedAt ??= now`), so a leaked token gets 401 on the next request (E-39).

### POST /auth/change-password (F-AUTH-6, skill reference copy)
- **Request** `ChangePasswordDto` (skill): `currentPassword` (`@IsCurrentPassword()`), `newPassword` (`@IsNewPassword()`).
- **Response** `MessageResponse({ accessToken }, 'Password changed')` — a fresh token for this device; every other token dies (`tokenVersion + 1`).
- **Errors**: `400 | Current password is incorrect`; `401`.

### POST /auth/logout-all (F-AUTH-7, skill reference copy)
- **Response** `MessageResponse(null, 'Logged out on every device')`; `tokenVersion + 1`, open sockets disconnected (BR-77).
- **Errors**: `401`.

### GET /auth/me
- **Response** plain `ProfileView` (BR-83, C-2).
- **Errors**: `401 | Unauthorized`.

## 2. Module `users` (`src/users/`, `@Controller('auth/me')`, C-4)

| Method | Path | Summary | Guard | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|
| PATCH | `/auth/me` | `[AUTH] Update my profile` | Jwt, Roles | default | 200 | F-USERS-1 / BR-9, 11, 83 |

### PATCH /auth/me
- **Request** `UpdateProfileDto`:

  | Field | Type | Validators | Example |
  |---|---|---|---|
  | `name?` | string | `@IsOptional() @IsString() @Transform(trim) @Length(2, 100)` | `"Siti A."` |
  | `phone?` | string \| null | `@IsOptional() @IsString() @Matches(/^(\+62\|62\|0)8\d{8,11}$/)`; `null` clears; 11-14 digits after `+` (BR-9) | `"081234567890"` |
- **Response** `MessageResponse(ProfileView, 'Profile updated')` (BR-83); phone stored as `+628...` (BR-9, pure helper `normalisePhone`).
- **Errors**: `400 | validation messages | bad name/phone/city or any unknown field such as email, globalRole, isActive (forbidNonWhitelisted)`; `401`.
- **Rules**: BR-9, BR-11. Never spread the DTO into `data`.

## 3. Module `communities` (`src/communities/`)

| Method | Path | Summary | Guard | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|
| POST | `/communities` | `[AUTH] Create a community and become its admin` | Jwt, Roles | default | 201 | F-COMMUNITIES-1 / BR-12..16 |
| GET | `/communities/mine` | `[AUTH] List my communities and memberships` | Jwt, Roles | default | 200 | F-COMMUNITIES-2, F-MEMBERSHIPS-7 / BR-13, 23 |
| GET | `/communities/:communityId` | `[AUTH] Get a community card` | Jwt, Roles | default | 200 | F-COMMUNITIES-7 / BR-13, 31 |

Route order: `mine` before `:communityId`.

### POST /communities
- **Request** `CreateCommunityDto`:

  | Field | Type | Validators | Example |
  |---|---|---|---|
  | `rt` | int | `@Type(() => Number) @IsInt() @Min(1) @Max(999)` | `1` |
  | `rw` | int | same | `6` |
  | `province` | string | `@IsString() @Transform(trim) @Length(2, 100)` | `"Jawa Barat"` |
  | `city` | string | `@IsString() @Transform(trim) @Length(2, 100) @Matches(/^(kota\|kabupaten\|kab)\b/i, { message: 'City must start with Kota or Kabupaten' })` | `"Kota Cimahi"` |
  | `district` | string | same | `"Cimahi Tengah"` |
  | `village` | string | same | `"Kel. Suka Maju"` |
  | `name?` | string | `@IsOptional() @IsString() @Transform(trim) @Length(3, 100)` | `"Griya Asri"` |
  | `houseBlock` | string | `@IsString() @Transform(trim) @Length(1, 50)` | `"Blok A1 No. 1"` |
- **Response** `MessageResponse({ community: CommunitySummary, membership: MembershipView }, 'Community created')`.
- **Errors**: `409 | Community already registered, join with its QR code | same region key (BR-14)`; `400 | validation`.
- **Rules**: BR-12 (`normaliseRegionPart` + `buildRegionKey` helpers; the city check is part of BR-12), BR-14, BR-15, BR-16. **Transaction: yes** (community + ACTIVE ADMIN membership). Concurrency: unique `regionKey`; the service catches P2002 on this create and rethrows `ConflictException` with the BR-14 message (E-5).

### GET /communities/mine
- **Request** query `QueryMyCommunitiesDto extends PaginationDto { status?: MembershipStatus @IsOptional() @IsEnum(MembershipStatus) }`.
- **Response** `Paginated<{ community: CommunitySummary, membership: MembershipView }>`; ACTIVE and PENDING first, then `updatedAt desc`.
- **Errors**: `401`.

### GET /communities/:communityId
- **Request** path `communityId` (`ParseUUIDPipe`).
- **Response** plain `CommunitySummary & { activeMemberCount: number, myMembership: MembershipView }`.
- **Errors**: `403 | You are not a member of this community | unknown community or not ACTIVE (BR-31)`; `400 | Validation failed (uuid is expected)`.
- Description: "Caller must be an ACTIVE member (service check)".

## 4. Module `memberships` (`src/memberships/`)

Join token (BR-19, BR-20), pure helper `src/memberships/join-token.ts`, unit-tested:
- `w = floor(nowSeconds / 60)`.
- `token(communityId, w) = base64url(HMAC-SHA256(JOIN_TOKEN_SECRET, "qr:" + communityId + ":" + w)).slice(0, 22)`.
- `isValid(communityId, token, now)` = matches `w` or `w - 1`, compared with `timingSafeEqual` on equal-length buffers (length mismatch -> false).
- QR content: `wargakita:join:<communityId>:<token>` (not a URL). Manual fallback: the frontend shows the full `qrContent` string under the QR with a copy button; the join screen accepts the pasted string, parses `communityId` and `token`, and calls `POST /memberships/preview` (R-30). A token alone is not enough.
- The same `isValid` helper is used by `POST /memberships/preview` and `POST /memberships`.

| Method | Path | Summary | Guard | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|
| GET | `/communities/:communityId/join-qr` | `[AUTH] Get the current join QR` | Jwt, Roles | default | 200 | F-MEMBERSHIPS-1 / BR-19, 32 |
| POST | `/memberships/preview` | `[AUTH] Preview the community of a scanned QR` | Jwt, Roles | join | 200 | F-MEMBERSHIPS-2 / BR-19, 20, 80 |
| POST | `/memberships` | `[AUTH] Submit a join request from a scanned QR` | Jwt, Roles | join | 201 | F-MEMBERSHIPS-3 / BR-19, 20, 23, 24, 80 |
| GET | `/communities/:communityId/join-requests` | `[AUTH] List pending join requests` | Jwt, Roles | default | 200 | F-MEMBERSHIPS-4 / BR-32 |
| POST | `/communities/:communityId/memberships/:membershipId/approve` | `[AUTH] Approve a join request` | Jwt, Roles | default | 200 | F-MEMBERSHIPS-5 / BR-25, 66 |
| POST | `/communities/:communityId/memberships/:membershipId/reject` | `[AUTH] Reject a join request` | Jwt, Roles | default | 200 | F-MEMBERSHIPS-6 / BR-23, 25 |
| GET | `/communities/:communityId/memberships` | `[AUTH] List members` | Jwt, Roles | default | 200 | F-MEMBERSHIPS-10 / BR-32 |
| PATCH | `/communities/:communityId/memberships/:membershipId/role` | `[AUTH] Change a member's role` | Jwt, Roles | default | 200 | F-MEMBERSHIPS-11 / BR-27, 29 |
| POST | `/communities/:communityId/memberships/:membershipId/remove` | `[AUTH] Remove a member` | Jwt, Roles | default | 200 | F-MEMBERSHIPS-9 / BR-27, 28, 30 |
| POST | `/communities/:communityId/leave` | `[AUTH] Leave a community` | Jwt, Roles | default | 200 | F-MEMBERSHIPS-8 / BR-27, 30 |

Every row's `description` names its service check: join-qr / join-requests / memberships list / role / remove / approve / reject -> "Caller must be an ACTIVE ADMIN of :communityId (service check, `assertAdmin`)"; preview / join -> "Any logged-in user; the QR token is the authority"; leave -> "Any ACTIVE member (service check)".

### GET /communities/:communityId/join-qr
- **Response** plain `{ communityId, label, qrContent, token, window, expiresInSeconds }` (`expiresInSeconds` until the window changes; the frontend refreshes then). `qrContent` is also the manual fallback string (copy button, R-30).
- **Errors**: `403 | You are not a member of this community`; `403 | Admin access required`.
- **Rules**: BR-19, BR-32. No write.

### POST /memberships/preview
- **Request** `PreviewMembershipDto`:

  | Field | Type | Validators | Example |
  |---|---|---|---|
  | `communityId` | uuid | `@IsUUID('4')` | `"3f0c6c1e-..."` |
  | `token` | string | `@IsString() @Length(22, 22)` | `"pX2fK9...Q"` |
- **Response** `MessageResponse({ community: CommunitySummary, myMembershipStatus: MembershipStatus | null }, 'Code accepted')`; `HttpCode(200)`.
- **Errors**: `400 | Invalid or expired code | unknown community or bad/old token (BR-20)`; `400 | validation`; `429`.
- **Rules**: BR-19, BR-20, BR-80. No transaction, no write. Uses the same `isValid` helper as `POST /memberships`. `communityId` in the body is the scanned target (GAPS G-L6). Description: "Any logged-in user; read-only".

### POST /memberships
- **Request** `CreateMembershipDto`:

  | Field | Type | Validators | Example |
  |---|---|---|---|
  | `communityId` | uuid | `@IsUUID('4')` | `"3f0c6c1e-..."` |
  | `token` | string | `@IsString() @Length(22, 22)` | `"pX2fK9...Q"` |
  | `houseBlock` | string | `@IsString() @Transform(trim) @Length(1, 50)` | `"Blok C2 No. 14"` |
- **Response** `MessageResponse({ membership: MembershipView, community: CommunitySummary }, 'Join request sent')`.
- **Errors**: `400 | Invalid or expired code | unknown community or bad/old token (one message, BR-20)`; `409 | You already have a request or membership in this community | row is PENDING or ACTIVE, or the conditional reuse won nothing (BR-23)`; `400 | validation`; `429`.
- **Rules**: BR-19, BR-20, BR-23, BR-24. `communityId` in the body is the scanned target (it is what the QR names), not a privileged field. **Transaction: yes**: `community.findUnique` (missing -> 400 same message), token check, then the reuse of BR-23: first `updateMany({ userId, communityId, status: { in: [REJECTED, LEFT, REMOVED] } }, { status: PENDING, role: WARGA, houseBlock, requestedAt: now, decidedAt: null, joinedAt: null })`; when `count === 0`, `create` (the unique `(userId, communityId)` index rejects a PENDING/ACTIVE owner with P2002 -> 409). Only the request that produced a row change inserts `notification.createMany(JOIN_REQUEST)` for ACTIVE admins. After commit: `join-request:new` + `notification:new` to those admins. Concurrency: a double submit gives exactly one PENDING row and one notification set; the loser gets 409 (E-8).

### GET /communities/:communityId/join-requests
- **Request** query `QueryJoinRequestsDto extends PaginationDto { search?: string @IsOptional() @IsString() @MaxLength(100) }` (name or house block, `mode: 'insensitive'`).
- **Response** `Paginated<{ id, user: { id, name, email }, houseBlock, requestedAt }>`, oldest first. Every requester is verified (BR-3), so no verified badge exists.
- **Errors**: `403` (member / admin).

### POST .../memberships/:membershipId/approve, /reject
- **Request** paths `communityId`, `membershipId` (`ParseUUIDPipe`); no body.
- **Response** `MessageResponse(MembershipView & { user: UserRef }, 'Join request approved' | 'Join request rejected')`.
- **Errors**: `403` (member / admin); `404 | Join request not found | missing or other community (BR-33)`; `400 | Join request is no longer pending | already decided or lost race (E-1)`.
- **Rules**: BR-25 (approve: ACTIVE, WARGA, `joinedAt`, `decidedAt`; reject: REJECTED, `decidedAt`), BR-66 (`JOIN_APPROVED` / `JOIN_REJECTED`, in-app + realtime only; no email, R-35). **Transaction: yes**: `updateMany({ id, communityId, status: PENDING })`, count 0 -> re-read for 404 vs 400; `notification.create(JOIN_APPROVED | JOIN_REJECTED)`. After commit: realtime.

### GET /communities/:communityId/memberships
- **Request** query `QueryMembersDto extends PaginationDto`: `status?` (`@IsEnum(MembershipStatus)`, default `ACTIVE`), `role?` (`@IsEnum(MembershipRole)`), `search?` (`@MaxLength(100)`, name or house block, insensitive).
- **Response** `Paginated<{ id, user: { id, name, phone }, houseBlock, role, status, joinedAt }>`; ADMIN first, then name.
- **Errors**: `403` (member / admin).

### PATCH /communities/:communityId/memberships/:membershipId/role
- **Request** paths; body `ChangeMembershipRoleDto { role: MembershipRole @IsEnum(MembershipRole) }`, example `{ "role": "ADMIN" }`. This is the action of the endpoint, guarded by `assertAdmin` (G-L7).
- **Response** `MessageResponse(MembershipView & { user: UserRef }, 'Role updated')`.
- **Errors**: `403` (member / admin); `404 | Member not found`; `400 | Member is not active`; `400 | A community needs at least one admin | demoting the last ACTIVE ADMIN (BR-27)`.
- **Rules**: BR-27, BR-29. **Transaction: yes**: read target; if demoting an ADMIN, `membership.count({ communityId, status: ACTIVE, role: ADMIN })` must be > 1; `updateMany({ id, communityId, status: ACTIVE }, { role })` (count 0 -> 400). Same role -> returns unchanged (idempotent). Two admins demoting each other at once can both pass the count (GAPS G-L2).

### POST /communities/:communityId/memberships/:membershipId/remove
- **Request** paths; no body.
- **Response** `MessageResponse(MembershipView & { user: UserRef }, 'Member removed')`.
- **Errors**: `403` (member / admin); `404 | Member not found`; `400 | You cannot remove yourself, leave instead`; `400 | Member is not active`; `400 | A community needs at least one admin | target is the last ADMIN`.
- **Rules**: BR-27, BR-28, BR-30. Transaction: yes (same count check when target is ADMIN; `updateMany({ id, communityId, status: ACTIVE }, { status: REMOVED, role: WARGA, decidedAt })`).

### POST /communities/:communityId/leave
- **Request** path `communityId`; no body.
- **Response** `MessageResponse(null, 'You left the community')`.
- **Errors**: `403 | You are not a member of this community`; `400 | Promote another admin first | caller is the last ACTIVE ADMIN (BR-27), also when they are the only member (G-L14)`.
- **Rules**: BR-27, BR-30. Transaction: yes (count check, then `updateMany({ userId, communityId, status: ACTIVE }, { status: LEFT, role: WARGA })`). Description: "Any ACTIVE member (service check)".

## 5. Module `announcements` (`src/announcements/`)

| Method | Path | Summary | Guard | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|
| POST | `/communities/:communityId/announcements` | `[AUTH] Publish an announcement` | Jwt, Roles | default | 201 | F-ANNOUNCEMENTS-1 / BR-35, 36, 37 |
| PATCH | `/communities/:communityId/announcements/:announcementId` | `[AUTH] Edit an announcement` | Jwt, Roles | default | 200 | F-ANNOUNCEMENTS-2 / BR-33, 35, 36 |
| DELETE | `/communities/:communityId/announcements/:announcementId` | `[AUTH] Delete an announcement` | Jwt, Roles | default | 200 | F-ANNOUNCEMENTS-3 / BR-38 |
| GET | `/communities/:communityId/announcements` | `[AUTH] List announcements` | Jwt, Roles | default | 200 | F-ANNOUNCEMENTS-4 / BR-31, 39 |
| GET | `/communities/:communityId/announcements/:announcementId` | `[AUTH] Get an announcement` | Jwt, Roles | default | 200 | F-ANNOUNCEMENTS-5 / BR-31, 33 |

Descriptions: POST/PATCH/DELETE -> "Caller must be an ACTIVE ADMIN of :communityId (service check, `assertAdmin`)"; the two GETs -> "Any ACTIVE member (service check)".

### POST /communities/:communityId/announcements
- **Request** `CreateAnnouncementDto`:

  | Field | Type | Validators | Example |
  |---|---|---|---|
  | `title` | string | `@IsString() @Transform(trim) @Length(3, 150)` | `"Kerja bakti Minggu"` |
  | `body` | string | `@IsString() @Length(1, 5000)` | `"Kumpul jam 07.00 di pos ronda."` |
  | `isHighlight?` | boolean | `@IsOptional() @IsBoolean()` (JSON body) | `true` |
- **Response** `MessageResponse(AnnouncementView, 'Announcement published')`.
- **Errors**: `403` (member / admin); `400 | validation`.
- **Rules**: BR-35, BR-36, BR-37. **Transaction: yes**: if `isHighlight`, `updateMany({ communityId, isHighlight: true }, { isHighlight: false })`; create; `notification.createMany(ANNOUNCEMENT)` for ACTIVE members except the author. After commit: `notification:new` to them.

### PATCH /communities/:communityId/announcements/:announcementId
- **Request** `UpdateAnnouncementDto extends PartialType(CreateAnnouncementDto)`.
- **Response** `MessageResponse(AnnouncementView, 'Announcement updated')`.
- **Errors**: `403`; `404 | Announcement not found | missing or other community`; `400 | validation`.
- **Rules**: BR-35, BR-36 (same clear-then-set transaction when `isHighlight: true`). No new notification. Any admin of the community may edit.

### DELETE /communities/:communityId/announcements/:announcementId
- **Response** `MessageResponse(null, 'Announcement deleted')`.
- **Errors**: `403`; `404 | Announcement not found`.
- **Rules**: BR-38. Transaction: yes (`notification.deleteMany({ entityType: ANNOUNCEMENT, entityId })`, then `announcement.deleteMany({ id, communityId })`, count 0 -> 404).

### GET /communities/:communityId/announcements
- **Request** query `QueryAnnouncementsDto extends PaginationDto { search?: string @IsOptional() @IsString() @MaxLength(100) }` (title, insensitive).
- **Response** `Paginated<AnnouncementView>`; order `[{ isHighlight: 'desc' }, { createdAt: 'desc' }]` (BR-39).
- **Errors**: `403 | You are not a member of this community`.
- Description: "Any ACTIVE member (service check)".

### GET /communities/:communityId/announcements/:announcementId
- **Response** plain `AnnouncementView`.
- **Errors**: `403`; `404 | Announcement not found`.

## 6. Module `reports` (`src/reports/`)

JSON bodies only (no upload in Lite).

| Method | Path | Summary | Guard | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|
| POST | `/communities/:communityId/reports` | `[AUTH] Submit a report` | Jwt, Roles | default | 201 | F-REPORTS-1 / BR-48, 52 |
| GET | `/communities/:communityId/reports/me` | `[AUTH] List my reports` | Jwt, Roles | default | 200 | F-REPORTS-2 / BR-49 |
| GET | `/communities/:communityId/reports` | `[AUTH] List all reports of the community` | Jwt, Roles | default | 200 | F-REPORTS-6 / BR-32 |
| GET | `/communities/:communityId/reports/:reportId` | `[AUTH] Get a report` | Jwt, Roles | default | 200 | F-REPORTS-3 / BR-49 |
| PATCH | `/communities/:communityId/reports/:reportId` | `[AUTH] Edit my pending report` | Jwt, Roles | default | 200 | F-REPORTS-4 / BR-48, 50 |
| DELETE | `/communities/:communityId/reports/:reportId` | `[AUTH] Delete my pending report` | Jwt, Roles | default | 200 | F-REPORTS-5 / BR-50 |
| POST | `/communities/:communityId/reports/:reportId/process` | `[AUTH] Mark a report as in progress` | Jwt, Roles | default | 200 | F-REPORTS-7 / BR-51, 52 |
| POST | `/communities/:communityId/reports/:reportId/resolve` | `[AUTH] Resolve a report` | Jwt, Roles | default | 200 | F-REPORTS-7 / BR-51, 52 |
| POST | `/communities/:communityId/reports/:reportId/reject` | `[AUTH] Reject a report` | Jwt, Roles | default | 200 | F-REPORTS-7 / BR-51, 52 |

Descriptions: POST/PATCH/DELETE + `reports/me` -> "Any ACTIVE member; edit/delete/detail restricted to the reporter (service check)"; `reports` list + process/resolve/reject -> "Caller must be an ACTIVE ADMIN of :communityId (service check, `assertAdmin`)"; detail -> "Reporter or ADMIN (service check)".

Route order: `reports/me` before `reports/:reportId`.

### POST /communities/:communityId/reports
- **Request** `CreateReportDto`:

  | Field | Type | Validators | Example |
  |---|---|---|---|
  | `title` | string | `@IsString() @Transform(trim) @Length(3, 150)` | `"Lampu jalan mati"` |
  | `description` | string | `@IsString() @Length(10, 5000)` | `"Lampu di depan blok C mati sejak Senin."` |
  | `category` | enum | `@IsEnum(ReportCategory)` | `"INFRASTRUCTURE"` |
- **Response** `MessageResponse(ReportView, 'Report submitted')`.
- **Errors**: `403 | You are not a member of this community`; `400 | validation`.
- **Rules**: BR-48, BR-52. Transaction: yes (create + `notification.createMany(REPORT_NEW)` for ACTIVE admins except the reporter). After commit: `notification:new`. Description: "Any ACTIVE member".

### GET .../reports/me
- **Request** query `QueryMyReportsDto extends PaginationDto { status?: ReportStatus @IsOptional() @IsEnum(ReportStatus) }`.
- **Response** `Paginated<ReportView>` (`reporterId = me`), newest first.
- **Errors**: `403`.

### GET .../reports
- **Request** query `QueryReportsDto extends PaginationDto`: `status?` (`@IsEnum(ReportStatus)`), `category?` (`@IsEnum(ReportCategory)`), `search?` (`@MaxLength(100)`, title insensitive).
- **Response** `Paginated<ReportView>`, newest first.
- **Errors**: `403` (member / admin).

### GET .../reports/:reportId
- **Response** plain `ReportView`; `reporter.houseBlock` only for admins (null otherwise).
- **Errors**: `403`; `404 | Report not found | missing, other community, or caller is neither the reporter nor an admin (BR-49)`.
- Description: "Reporter or ADMIN (service check)".

### PATCH .../reports/:reportId
- **Request** `UpdateReportDto extends PartialType(CreateReportDto)`.
- **Response** `MessageResponse(ReportView, 'Report updated')`.
- **Errors**: `403`; `404 | Report not found | not the caller's`; `400 | Only pending reports can be changed`.
- **Rules**: BR-48, BR-50. Conditional `updateMany({ id, communityId, reporterId: me, status: PENDING })`; count 0 -> re-read for 404 vs 400. Description: "Reporter only".

### DELETE .../reports/:reportId
- **Response** `MessageResponse(null, 'Report deleted')`.
- **Errors**: `403`; `404 | Report not found`; `400 | Only pending reports can be changed`.
- **Rules**: BR-50. Transaction: yes (`report.deleteMany({ id, communityId, reporterId: me, status: PENDING })`, count 0 -> 404/400; `notification.deleteMany({ entityType: REPORT, entityId })`).

### POST .../reports/:reportId/process, /resolve, /reject
- **Request** body:
  - process: `ProcessReportDto { note?: string @IsOptional() @IsString() @Transform(trim) @MaxLength(1000) }`.
  - resolve: `ResolveReportDto { note?: string @IsOptional() @IsString() @Transform(trim) @MaxLength(1000) }`.
  - reject: `RejectReportDto { note: string @IsString() @Transform(trim) @Length(5, 1000) }`.
- **Response** `MessageResponse(ReportView, 'Report marked as in progress' | 'Report resolved' | 'Report rejected')`.
- **Errors**: `403` (member / admin); `404 | Report not found`; `400 | Invalid status change | not allowed by PRD 6.4 or stale`; `400 | validation`.
- **Rules**: BR-51, BR-52. **Transaction: yes**: allowed-from (`process <- [PENDING]`, `resolve <- [PENDING, IN_PROGRESS]`, `reject <- [PENDING, IN_PROGRESS]`); `updateMany({ id, communityId, status: { in: allowedFrom } })` with the target status, `responseNote` = the note sent or **`null` when none is sent** (so `responseNote` + `respondedAt` always describe the latest status change, BR-51), `respondedById`, `respondedAt`; count 0 -> 404/400; `REPORT_STATUS` to the reporter unless the caller is the reporter. One service method `changeStatus(target, ...)`. After commit: `notification:new`.

## 7. Module `sos-alerts` (`src/sos-alerts/`)

"Open" = `SENT`, `ACCEPTED`, `HANDLING`. Every change is a conditional `sosAlert.updateMany` (+ notification) in one `$transaction`; realtime and email after commit. Closing (RESOLVED, CANCELLED, FALSE_ALARM) sets `closedAt`. Notification and email texts: PRD 5.9.1 (`notification-templates.ts`).

| Method | Path | Summary | Guard | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|
| POST | `/communities/:communityId/sos-alerts` | `[AUTH] Send an SOS` | Jwt, Roles | sos | 201 | F-SOS-1 / BR-53, 54, 55, 62, 64, 68, 80 |
| GET | `/communities/:communityId/sos-alerts/me` | `[AUTH] List my SOS alerts` | Jwt, Roles | default | 200 | F-SOS-9 / BR-31 |
| GET | `/communities/:communityId/sos-alerts` | `[AUTH] List SOS alerts of the community` | Jwt, Roles | default | 200 | F-SOS-8 / BR-32 |
| GET | `/communities/:communityId/sos-alerts/:sosAlertId` | `[AUTH] Get an SOS alert` | Jwt, Roles | default | 200 | F-SOS-2, F-SOS-8 / BR-32, 33 |
| POST | `.../sos-alerts/:sosAlertId/accept` | `[AUTH] Accept an SOS` | Jwt, Roles | default | 200 | F-SOS-4 / BR-57, 58 |
| POST | `.../sos-alerts/:sosAlertId/handle` | `[AUTH] Mark an SOS as being handled` | Jwt, Roles | default | 200 | F-SOS-5 / BR-58 |
| POST | `.../sos-alerts/:sosAlertId/resolve` | `[AUTH] Resolve an SOS` | Jwt, Roles | default | 200 | F-SOS-5 / BR-58 |
| POST | `.../sos-alerts/:sosAlertId/false-alarm` | `[AUTH] Mark an SOS as a false alarm` | Jwt, Roles | default | 200 | F-SOS-6 / BR-60 |
| POST | `.../sos-alerts/:sosAlertId/cancel` | `[AUTH] Cancel my SOS` | Jwt, Roles | default | 200 | F-SOS-3 / BR-59 |

Descriptions: send / cancel / `me` -> "Any ACTIVE member; cancel and `me` restricted to the sender (service check)"; list / get -> "Sender or ADMIN (service check)"; accept -> "ADMIN, not the sender (service check)"; handle / resolve -> "The current HANDLER, from exactly one state (service check)"; false-alarm -> "ADMIN from SENT (not the sender) or the handler from ACCEPTED/HANDLING (service check)".

`...` = `/communities/:communityId`. Route order: `sos-alerts/me` before `sos-alerts/:sosAlertId`.

### POST /communities/:communityId/sos-alerts
- **Request** `CreateSosAlertDto`:

  | Field | Type | Validators | Example |
  |---|---|---|---|
  | `type` | enum | `@IsEnum(SosType)` | `"MEDICAL"` |
  | `note?` | string | `@IsOptional() @IsString() @Transform(trim) @MaxLength(280)` | `"Bapak pingsan"` |
  | `latitude?` | number | `@ValidateIf(o => o.longitude !== undefined) @IsLatitude()` | `-6.8722` |
  | `longitude?` | number | `@ValidateIf(o => o.latitude !== undefined) @IsLongitude()` | `107.5425` |
- **Response** `MessageResponse(SosView, 'SOS sent')`; `recipientCount` lets the frontend highlight 112 when 0 (BR-62).
- **Errors**: `403 | You are not a member of this community`; `409 | You already have an active SOS | open SOS by the caller here (BR-55)`; `400 | validation`; `429`.
- **Rules**: BR-53, BR-54, BR-55, BR-62, BR-64, BR-68. **Transaction: yes**: `assertMember` (gets `houseBlock`), `findFirst({ communityId, senderId: me, status: { in: open } })` -> 409, list ACTIVE admins except the caller -> `recipientCount`, create, `notification.createMany(SOS_NEW)`. **After commit**: `sos:new` + `notification:new` to the recipients, then **email `SOS_NEW` to each recipient admin via `SosMailer.sendSosAlert()`, fire-and-log** (a failure is logged without the address and never changes the response). The email contains only name, house block, type, label and the app link (`APP_URL`): no GPS, no note, no phone (BR-68, PRD 5.9.1). Description: "Any ACTIVE member".

### GET .../sos-alerts/me
- **Request** query `QueryMySosDto extends PaginationDto { status?: SosStatus @IsOptional() @IsEnum(SosStatus) }`.
- **Response** `Paginated<SosView>` (`senderId = me`), newest first.
- **Errors**: `403`.

### GET .../sos-alerts
- **Request** query `QuerySosDto extends PaginationDto`: `status?` (`@IsEnum(SosStatus)`), `type?` (`@IsEnum(SosType)`), `openOnly?` (`@IsOptional() @ToBoolean() @IsBoolean()`).
- **Response** `Paginated<SosView>`; open first, then newest (`orderBy: [{ closedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }]`).
- **Errors**: `403` (member / admin).

### GET .../sos-alerts/:sosAlertId
- **Response** plain `SosView`; `sender.phone` only for admins.
- **Errors**: `403`; `404 | SOS alert not found | missing, other community, or caller is neither the sender nor an admin`.
- Description: "Sender or ADMIN (service check)".

### POST .../accept
- **Response** `MessageResponse(SosView, 'SOS accepted')`.
- **Errors**: `403` (member / admin); `404 | SOS alert not found`; `403 | You cannot accept your own SOS`; `400 | SOS already accepted | not SENT or lost race (E-2)`.
- **Rules**: BR-57, BR-58. `updateMany({ id, communityId, status: SENT, senderId: { not: me } }, { status: ACCEPTED, handlerId: me, acceptedAt })`; count 0 -> re-read for 404 / 403 / 400; `SOS_ACCEPTED` to the sender. After commit: `sos:updated` to sender + admins.

### POST .../handle
- **Request** body `HandleSosAlertDto { note?: string @IsOptional() @IsString() @Transform(trim) @MaxLength(280) }` (accepted but not stored on `handle`; kept so both handler actions share one shape).
- **Response** `MessageResponse(SosView, 'SOS marked as handling')`.
- **Errors**: `403` (member / admin); `404`; `403 | Only the handler can do this`; `400 | Invalid SOS state | not ACCEPTED (e.g. HANDLING -> HANDLING again)` — checked in that order (BR-58).
- **Rules**: BR-58. `updateMany({ id, communityId, handlerId: me, status: ACCEPTED }, { status: HANDLING, handlingAt: now })`; count 0 -> re-read and pick 404 / 403 / 400 in that order.

### POST .../resolve
- **Request** body `ResolveSosAlertDto { note?: string @IsOptional() @IsString() @Transform(trim) @MaxLength(280) }` (stored in `resolutionNote`).
- **Response** `MessageResponse(SosView, 'SOS resolved')`.
- **Errors**: `403` (member / admin); `404`; `403 | Only the handler can do this`; `400 | Invalid SOS state | not HANDLING (e.g. ACCEPTED -> RESOLVED skips the mandatory HANDLING step)` — checked in that order (BR-58).
- **Rules**: BR-58. `updateMany({ id, communityId, handlerId: me, status: HANDLING }, { status: RESOLVED, resolutionNote, closedAt: now })`; count 0 -> re-read (404 / 403 / 400); `SOS_RESOLVED` to the sender. After commit: `sos:updated`.

### POST .../false-alarm
- **Request** body `FalseAlarmSosAlertDto { note?: string @IsOptional() @IsString() @Transform(trim) @MaxLength(280) }` (stored in `resolutionNote`).
- **Response** `MessageResponse(SosView, 'SOS marked as false alarm')`.
- **Errors**: `403` (member / admin); `404`; `403 | You cannot mark your own SOS`; `403 | Only the handler can do this`; `400 | Invalid SOS state`.
- **Rules**: BR-60. `updateMany` where `OR: [{ status: SENT, senderId: { not: me } }, { status: { in: [ACCEPTED, HANDLING] }, handlerId: me }]`; `SOS_RESOLVED` to the sender; `closedAt`.

### POST .../cancel
- **Response** `MessageResponse(SosView, 'SOS cancelled')`.
- **Errors**: `403`; `404 | SOS alert not found | not the caller's`; `400 | Invalid SOS state | already closed`.
- **Rules**: BR-59. `updateMany({ id, communityId, senderId: me, status: { in: open } }, { status: CANCELLED, closedAt })`. No notification row; `sos:updated` to handler + admins. Description: "Sender only".

### [STRETCH] SosEscalationJob (F-SOS-7, BR-63)
`@Interval(15000)`: `findMany({ status: SENT, escalatedAt: null, createdAt: { lte: now - 120 s } }, take: 50)`; per alert `updateMany({ id, status: SENT, escalatedAt: null }, { escalatedAt: now })`; only when count = 1: `notification.createMany(SOS_NEW)` to current recipients, `sos:new`, email via `SosMailer` (fire-and-log). Not part of the definition of done.

## 8. Module `notifications` (`src/notifications/`)

| Method | Path | Summary | Guard | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|
| GET | `/notifications` | `[AUTH] List my notifications` | Jwt, Roles | default | 200 | F-NOTIFICATIONS-1 / BR-65, 66 |
| GET | `/notifications/unread-count` | `[AUTH] Count my unread notifications` | Jwt, Roles | default | 200 | F-NOTIFICATIONS-1 / BR-65 |
| POST | `/notifications/:notificationId/read` | `[AUTH] Mark a notification as read` | Jwt, Roles | default | 200 | F-NOTIFICATIONS-2 / BR-65 |
| POST | `/notifications/read-all` | `[AUTH] Mark all my notifications as read` | Jwt, Roles | default | 200 | F-NOTIFICATIONS-2 / BR-65 |
| WS | Socket.IO namespace `/realtime` | handshake `auth: { token }` | JWT (BR-77) | - | - | F-NOTIFICATIONS-4 / BR-69, 77, 81 |

Route order: `read-all` and `unread-count` before `:notificationId`.

Every notification row's `title` / `body` / `entityType` comes from the pure function in `src/notifications/notification-templates.ts` (PRD 5.9.1); no service writes literal texts.

### GET /notifications
- **Request** query `QueryNotificationsDto extends PaginationDto { unread?: boolean @IsOptional() @ToBoolean() @IsBoolean(), communityId?: string @IsOptional() @IsUUID('4') }` (`communityId` is a filter, not a write).
- **Response** `Paginated<NotificationView>`, newest first.

### GET /notifications/unread-count
- **Response** plain `{ count }`.

### POST /notifications/:notificationId/read
- **Response** `MessageResponse(NotificationView, 'Notification marked as read')`.
- **Errors**: `404 | Notification not found | missing or another user's (BR-65)`.
- **Rules**: `updateMany({ id, userId: me, readAt: null }, { readAt: now })`; if count 0, `findFirst({ id, userId: me })` decides 404 vs return as is.

### POST /notifications/read-all
- **Response** `MessageResponse({ updated }, 'All notifications marked as read')`.
- **Rules**: `updateMany({ userId: me, readAt: null }, { readAt: now })`.

### Socket.IO `/realtime`
- **Handshake** (`references/websocket-auth.md` recipe, BR-77): token only from `handshake.auth.token` (never query); `JwtService.verifyAsync`, then the payload goes to the **same `JwtStrategy.validate`** as HTTP (user exists, `isActive`, `emailVerifiedAt`, `tokenVersion`); any failure -> `disconnect(true)`. Joins room `user:<userId>` only. CORS from `FRONTEND_URL` via `FrontendCorsIoAdapter` (BR-81). When `tokenVersion` is bumped (reset, change-password, logout-all), the user's open sockets are disconnected (E-39).
- **Server -> client events** (emitted after commit, recipients from the DB, BR-69):

  | Event | Payload | Sent to |
  |---|---|---|
  | `notification:new` | `NotificationView` | the notification's user |
  | `sos:new` | `SosView` | recipients of BR-62 |
  | `sos:updated` | `SosView` | sender + current ACTIVE admins |
  | `join-request:new` | `{ communityId, membershipId }` | current ACTIVE admins |
- **Client -> server**: none.

## 9. Module `health` (`src/health/`)

| Method | Path | Summary | Guard | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|
| GET | `/health` | `[PUBLIC] Check that the API and database are up` | - | default | 200 | F-HEALTH-1 |

- **Response** plain `{ status: 'ok' }`; DB down -> `503 | Service unavailable` (`ServiceUnavailableException`), the error logged and not returned (BR-84). `SELECT 1` via `$queryRaw`.

## 10. Not in Lite

Endpoints / mechanisms (see archive): admin deactivation endpoint (deactivation is database-only in Lite, E-41), account deletion, profile photo; community deletion (G-L14); community applications and every review endpoint, `GET /communities` for super admin, duplicate candidates; join tickets, manual join code; promote / demote / transfer-ownership as separate endpoints; notification archive / delete; socket tickets; BFF platform gate (`X-Internal-Key`, `X-Client-IP`); membership expiry job; report photo upload; SOS escalation beyond the Stretch item; events, dashboard, web push. Emails: only OTP and `SOS_NEW` exist (`JOIN_APPROVED` email dibuang, R-35).

## 11. Environment variables

Same list as PRD 8.12. Joi in `src/config/env.schema.ts` (project) or nest-common base, and all in `.env.example`.

| Variable | Joi | Read by |
|---|---|---|
| `DATABASE_URL` | base | `PrismaService` |
| `PORT` | base | `main.ts` |
| `NODE_ENV` | base | mail adapter choice, Swagger |
| `JWT_SECRET` | base | `JwtModule`, gateway |
| `JWT_EXPIRES_IN` | base (set `1d` in `.env.example`) | `JwtModule` |
| `FRONTEND_URL` | base | REST CORS + Socket.IO adapter |
| `APP_URL` | `string().uri().required()` | email texts (BR-68) |
| `TRUST_PROXY_HOPS` | base | `main.ts` |
| `JOIN_TOKEN_SECRET` | `string().min(32).required()` | `join-token.ts` |
| `OTP_TTL_MINUTES` | `number().integer().min(1).max(60).default(10)` | `OtpService` |
| `OTP_RESEND_COOLDOWN_SECONDS` | `number().integer().min(0).default(60)` | `OtpService` |
| `OTP_SENDER` | `string().valid('resend', 'console').default('resend')` (skill reference; `console` refuses production, rule 23) | `MailModule` factory (OTP + SOS) |
| `RESEND_API_KEY` | `when('OTP_SENDER', { is: 'resend', then: string().required(), otherwise: string().allow('').optional() })` | `ResendOtpSender`, `ResendSosMailer` |
| `MAIL_FROM` | same rule as `RESEND_API_KEY` (e.g. `"WargaKita <no-reply@averil.tech>"`) | `ResendOtpSender`, `ResendSosMailer` |
| `THROTTLE_TTL` | `number().integer().min(1).default(60)` (seconds; passed as `* 1000` ms) | `ThrottlerModule.forRootAsync` |
| `THROTTLE_LIMIT` | `number().integer().min(1).default(100)` | `default` throttler |
| `AUTH_THROTTLE_LIMIT` | `number().integer().min(1).default(5)` | `auth` tier |
| `SEND_CODE_THROTTLE_LIMIT` | `number().integer().min(1).default(3)` | `sendCode` tier |
| `JOIN_THROTTLE_LIMIT` | `number().integer().min(1).default(10)` | `join` tier |
| `SOS_THROTTLE_LIMIT` | `number().integer().min(1).default(5)` | `sos` tier |

20 variables (same as PRD 8.12). Defaults of the four tier limits are pinned to `nest-auth-and-security` rule 10 by a unit test (L-5).

Seed only (not in the boot schema): `SEED_DEMO_PASSWORD` (required by the seed script).

## 12. Access matrix

`allow` / `own` (service checks ownership) / `deny` (401 for PUBLIC, 403 otherwise). USER = logged in, no ACTIVE membership in the addressed community.

| Endpoint | PUBLIC | USER | WARGA | ADMIN |
|---|---|---|---|---|
| POST auth/register, verify-otp, resend-otp, login, forgot-password, reset-password | allow | allow | allow | allow |
| GET/PATCH auth/me, POST auth/change-password, POST auth/logout-all | deny | allow | allow | allow |
| POST communities, GET communities/mine | deny | allow | allow | allow |
| GET communities/:communityId | deny | deny | allow | allow |
| POST memberships/preview, POST memberships (join) | deny | allow | allow (other communities) | allow (other communities) |
| GET join-qr, GET join-requests, POST approve/reject, GET memberships, PATCH role, POST remove | deny | deny | deny | allow |
| POST leave | deny | deny | allow | allow (not last admin) |
| GET announcements, GET :announcementId | deny | deny | allow | allow |
| POST/PATCH/DELETE announcements | deny | deny | deny | allow |
| POST reports, GET reports/me | deny | deny | allow | allow |
| GET reports/:reportId | deny | deny | own | allow |
| PATCH/DELETE reports/:reportId | deny | deny | own (PENDING) | own (PENDING) |
| GET reports (all), POST process/resolve/reject | deny | deny | deny | allow |
| POST sos-alerts, GET sos-alerts/me | deny | deny | allow | allow |
| POST cancel | deny | deny | own | own |
| GET sos-alerts/:sosAlertId | deny | deny | own | allow |
| GET sos-alerts (all), POST accept | deny | deny | deny | allow (not own) |
| POST handle, resolve | deny | deny | deny | own (handler) |
| POST false-alarm | deny | deny | deny | allow (SENT, not own) / own (handler) |
| notifications (list, count, read, read-all), WS /realtime | deny | own | own | own |
| GET health | allow | allow | allow | allow |

## 13. Coverage matrix

| Feature | Endpoint(s) |
|---|---|
| F-AUTH-1 | POST /auth/register |
| F-AUTH-2 | POST /auth/verify-otp, POST /auth/resend-otp |
| F-AUTH-3 | POST /auth/login |
| F-AUTH-4 | POST /auth/forgot-password, POST /auth/reset-password |
| F-AUTH-5 | GET /auth/me |
| F-AUTH-6 | POST /auth/change-password |
| F-AUTH-7 | POST /auth/logout-all |
| F-USERS-1 | PATCH /auth/me |
| F-COMMUNITIES-1 | POST /communities |
| F-COMMUNITIES-2, F-MEMBERSHIPS-7 | GET /communities/mine |
| F-COMMUNITIES-7 | GET /communities/:communityId |
| F-MEMBERSHIPS-1 | GET .../join-qr |
| F-MEMBERSHIPS-2 | POST /memberships/preview |
| F-MEMBERSHIPS-3 | POST /memberships |
| F-MEMBERSHIPS-4 | GET .../join-requests |
| F-MEMBERSHIPS-5 | POST .../memberships/:membershipId/approve |
| F-MEMBERSHIPS-6 | POST .../memberships/:membershipId/reject |
| F-MEMBERSHIPS-8 | POST .../leave |
| F-MEMBERSHIPS-9 | POST .../memberships/:membershipId/remove |
| F-MEMBERSHIPS-10 | GET .../memberships |
| F-MEMBERSHIPS-11 | PATCH .../memberships/:membershipId/role |
| F-ANNOUNCEMENTS-1..5 | POST, PATCH, DELETE, GET list, GET one under .../announcements |
| F-REPORTS-1 | POST .../reports |
| F-REPORTS-2 | GET .../reports/me |
| F-REPORTS-3 | GET .../reports/:reportId |
| F-REPORTS-4 | PATCH .../reports/:reportId |
| F-REPORTS-5 | DELETE .../reports/:reportId |
| F-REPORTS-6 | GET .../reports |
| F-REPORTS-7 | POST .../process, /resolve, /reject |
| F-SOS-1 | POST .../sos-alerts |
| F-SOS-2 | GET .../sos-alerts/:sosAlertId + `sos:updated` |
| F-SOS-3 | POST .../cancel |
| F-SOS-4 | POST .../accept |
| F-SOS-5 | POST .../handle, /resolve |
| F-SOS-6 | POST .../false-alarm |
| F-SOS-7 (Stretch) | SosEscalationJob |
| F-SOS-8 | GET .../sos-alerts, GET .../sos-alerts/:sosAlertId |
| F-SOS-9 | GET .../sos-alerts/me |
| F-NOTIFICATIONS-1 | GET /notifications, GET /notifications/unread-count |
| F-NOTIFICATIONS-2 | POST /notifications/:notificationId/read, POST /notifications/read-all |
| F-NOTIFICATIONS-4 | WS /realtime |
| F-NOTIFICATIONS-6 | `OtpService.issue`, SOS send (after commit) |
| F-HEALTH-1 | GET /health |

Orphan endpoints: none. Orphan Lite features: none.

## 14. Test targets

Service-level targets (one row per Lite BR, per `nest-testing` rule 5: exception paths first, then the happy path, then "the write did not happen"). Prisma is mocked (`{ provide: PrismaService, useValue }`), never a real DB in unit tests.

| BR | Target | Assertion |
|---|---|---|
| BR-1, BR-2, BR-11 | `AuthService.register`, `UsersService.updateProfile` | 409 on existing email and no user update call (rule 19); unknown body field -> 400; phone normalised / rejected (BR-9); register + first code in one `$transaction` |
| BR-3, skill rule 11 | `OtpService.consume` / `AuthService.verifyEmail`, `AuthService.login` | `BadRequestException` for wrong / expired / exhausted code; attempt claimed before compare; success sets `emailVerifiedAt`; login: password first, then `403` disabled -> unverified order |
| BR-5 | `AuthService.resetPassword`, `changePassword`, `logoutAll`, `JwtStrategy.validate` | `tokenVersion` incremented in the consuming transaction; `validate` rejects `payload.tv !== user.tokenVersion` and a missing `tv`; old token -> 401 |
| BR-9 | `normalisePhone` (pure) | `0812345678` -> `+62812345678`; 9 and 15 digits -> rejected |
| BR-12 | `normaliseRegionPart` + `buildRegionKey` (pure) | "Kel. Suka Maju" and "sukamaju" -> same village part; "Kelapa Gading" -> `kelapagading` (no cut); "Kotabaru" -> `kotabaru`; "Kota Bogor" != "Kabupaten Bogor" but = "Kab. Bogor"; city without prefix -> 400 at the DTO |
| BR-13 | `formatLabel` (pure) | `RT001/RW006` |
| BR-15, BR-48, BR-53 | DTO validators | name 3-100 / title 3-150 + description 10-5000 / SOS note 280, category and type enums, GPS both-or-neither -> 400 |
| BR-14, BR-16 | `CommunitiesService.create` | P2002 -> `ConflictException` with the BR-14 message; community + ADMIN membership in one `$transaction`, neither written when the other fails |
| BR-19, BR-20 | `join-token.ts` (pure), `MembershipsService.previewJoin` | same token for (id, w); valid for w and w-1, invalid for w-2, other community, wrong length; `previewJoin` throws `BadRequestException('Invalid or expired code')` and calls no write |
| BR-23 | `MembershipsService.requestJoin`, `previewJoin` | `ConflictException` from PENDING/ACTIVE; conditional reuse from REJECTED/LEFT/REMOVED (`updateMany` where asserted); double submit: exactly one `JOIN_REQUEST` notification set; `previewJoin` returns the current `myMembershipStatus` (or null) |
| BR-24 | `MembershipsService.requestJoin` | `requestedAt = now`, `decidedAt`/`joinedAt` cleared on reuse; houseBlock overwritten with the new value |
| BR-25 | `MembershipsService.approve/reject` | 400 'no longer pending' on count 0; approve sets ACTIVE + WARGA + `joinedAt`; no write on the lost race |
| BR-27, BR-28, BR-30 | `MembershipsService.changeRole/remove/leave` | `BadRequestException` when the last ADMIN would go, including the sole member (G-L14); remove targets self -> 400; REMOVED/LEFT rows carry role WARGA and `decidedAt` |
| BR-29 | `MembershipsService.changeRole` | non-ACTIVE target -> 400; same role idempotent |
| BR-31, BR-32 | `community-access.helper` | `ForbiddenException` for no row / PENDING / other community; admin check |
| BR-33 | `ReportsService`, `SosAlertsService`, `AnnouncementsService` (findOne paths) | an id of another community -> `NotFoundException` identical to a missing id |
| BR-36, BR-37, BR-38, BR-39 | `AnnouncementsService.create/update/remove/findAll` | highlight clear-then-set in one `$transaction`; one bulk `createMany` excluding the author; delete removes the notifications in the same transaction; list order highlighted first, then `createdAt desc` |
| BR-49 | `ReportsService.findOne` | member (not reporter) -> 404; reporter and admin -> 200 |
| BR-50 | `ReportsService.update/remove` | non-PENDING -> 400, delete removes notifications in the same transaction, no write when the conditional update misses |
| BR-51 | `ReportsService.changeStatus` | `BadRequestException('Invalid status change')` for RESOLVED->*, REJECTED->*, IN_PROGRESS->process; `RejectReportDto` requires a note; a noteless change sets `responseNote = null` |
| BR-52 | `ReportsService.create`, `changeStatus` | `REPORT_NEW` to admins except the reporter; `REPORT_STATUS` to the reporter unless the caller is the reporter |
| BR-55, BR-54 | `SosAlertsService.send` | open SOS -> `ConflictException`, nothing created; `houseBlockSnapshot` copied from the membership and never updated later |
| BR-57 | `SosAlertsService.accept` | `ForbiddenException` own SOS; `BadRequestException('SOS already accepted')` when `updateMany` count 0; notification not created then |
| BR-58 | `SosAlertsService.handle`, `resolve` | `handle` only from ACCEPTED, `resolve` only from HANDLING (ACCEPTED -> RESOLVED is 400, E-40); non-handler -> 403; order 404 -> 403 -> 400; no write on a refused state |
| BR-59 | `SosAlertsService.cancel` | sender only, from SENT/ACCEPTED/HANDLING; closed -> 400 |
| BR-60 | `SosAlertsService.markFalseAlarm` | admin from SENT (not own), handler from ACCEPTED/HANDLING; others 403/400 |
| BR-62, BR-64 | `SosAlertsService.send` | `recipientCount` = ACTIVE admins minus the sender; 0 allowed; SOS notifications created regardless of mutes (none exist, BR-64) |
| BR-65 | `NotificationsService` | another user's id -> 404; `read-all` `updateMany` where `userId: me` |
| BR-66, BR-68 (5.9.1) | `notification-templates.ts` (pure) | title / body / entityType for each of the 9 types; `{title}` cut to 100 chars; `SOS_RESOLVED` false-alarm variant; SOS email text contains no latitude, longitude, note or phone; OTP emails contain the TTL |
| BR-68 | `SosMailer` (with a mocked `fetch`) | rejection is logged, `sendSosAlert` still resolves; the console variant never logs the address |
| BR-69 | episode emit helper | recipients computed from the DB after commit; a REMOVED member's room no longer receives community events (`user:<id>` rooms only) |
| BR-77 | `RealtimeGateway.handleConnection` | token from `handshake.auth.token` only; `strategy.validate` called (not a second check); invalid -> `disconnect(true)` |
| BR-80 | `throttle.config.ts` (pure) | the five tiers carry the skill defaults (100/5/3/10/5) and `ttl = THROTTLE_TTL * 1000` (L-5 pin) |
| BR-81 | `FrontendCorsIoAdapter` | origins parsed from `FRONTEND_URL` (comma, trim, filter); empty -> none |
| BR-83 | `AuthService.me`, `UsersService.updateProfile` | the response keys equal `profileSelect` (`id, email, name, phone, globalRole, emailVerifiedAt, createdAt`); never `passwordHash`/`tokenVersion`/`isActive` |
| BR-84 | `HealthService.check` | DB error -> `ServiceUnavailableException`, error logged |

**Auth spec files copied from `references/test-recipes.md`** (skill: "always" / OTP module / rule 25 env):
`test/route-guards.e2e-spec.ts` (meta-test, unchanged — now expects only `[PUBLIC]` / `[AUTH]`), `jwt.strategy.spec.ts`, `auth.service.spec.ts` (identical login errors, status after password, register never overwrites, reset bumps `tv`), `otp.service.spec.ts` (20 parallel guesses -> 5 compares; parallel consume -> 1), `env.schema.spec.ts` (boot fails without `JWT_SECRET` / `RESEND_API_KEY`; `OTP_SENDER=console` refuses production), plus `test/auth.e2e-spec.ts` on the real database.

**e2e (one flow, real database)**: register (admin) -> verify-otp (code read from a capturing fake `OTP_SENDER` provider in the test, not from logs) -> `POST /communities` -> register + verify (warga) -> admin `GET join-qr` -> warga `POST /memberships/preview` then `POST /memberships` with the token -> admin approve -> warga `POST sos-alerts` -> admin `accept` -> admin `handle` -> admin `resolve` -> assert statuses. Plus one isolation check: admin of community A gets 403 on `GET /communities/<B>/reports`.

Route-guard meta-test (skill, unchanged): every handler has `JwtAuthGuard` or a `[PUBLIC]` summary; prefixes limited to `[PUBLIC]`, `[AUTH]`.

## 15. Gaps

See `docs/GAPS.md`.

## 16. Questions

None.

## 17. Self-check (Lite rev 5.2)

| # | Check | Result |
|---|---|---|
| 1 | No `SMTP_`, `nodemailer`, `MAIL_PROVIDER`, `SOCKET_ALLOWED_ORIGINS`, "Gmail" in active docs (outside `docs/archive/`) | **pass**: grep over `docs/PRD.md`, `API_SPEC.md`, `DATA_MODEL.md`, `GAPS.md` finds "SMTP" only in the 8.7 rationale ("Railway Hobby blocks outbound SMTP"). Earlier Lite checks (BFF gate, socket ticket, super admin, owner, `joinCode`, `ipHash`, AuditLog, SosEvent, Cloudinary) still only appear in Phase 2 / Not in Lite text. |
| 2 | Env list PRD 8.12 = API_SPEC 11 | **pass**: **20** variables in both tables (`DATABASE_URL`, `PORT`, `NODE_ENV`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `FRONTEND_URL`, `APP_URL`, `TRUST_PROXY_HOPS`, `JOIN_TOKEN_SECRET`, `OTP_TTL_MINUTES`, `OTP_RESEND_COOLDOWN_SECONDS`, `OTP_SENDER`, `RESEND_API_KEY`, `MAIL_FROM`, `THROTTLE_TTL`, `THROTTLE_LIMIT`, `AUTH_THROTTLE_LIMIT`, `SEND_CODE_THROTTLE_LIMIT`, `JOIN_THROTTLE_LIMIT`, `SOS_THROTTLE_LIMIT`) + `SEED_ADMIN_EMAIL`, `SEED_DEMO_PASSWORD` seed-only. |
| 3 | Endpoint count = 51 REST + 1 WS here, in PRD 11 and in the coverage matrix | **pass**: module tables list 51 REST rows (auth 9, users 1, communities 3, memberships 10, announcements 5, reports 9, sos-alerts 9, notifications 4, health 1) + WS `/realtime`; section 13 maps all of them. |
| 4 | Every endpoint has a PRD feature and vice versa; F-MEMBERSHIPS-2 is ✓ in PRD 11 | **pass**: section 13 covers every row; F-MEMBERSHIPS-2 -> `POST /memberships/preview`, ✓ in PRD 11. F-NOTIFICATIONS-6 is a side effect (mail calls). |
| 5 | Every field used here exists in DATA_MODEL | **pass**: `globalRole`, `isActive`, `tokenVersion` added in rev 5.2; preview returns `CommunitySummary` + `Membership.status`; no other new columns. |
| 6 | 5.9.1 text table has the same 9 types as BR-66 and `NotificationType`; email table = OTP + `SOS_NEW` only | **pass**: `JOIN_REQUEST`, `JOIN_APPROVED`, `JOIN_REJECTED`, `ANNOUNCEMENT`, `REPORT_NEW`, `REPORT_STATUS`, `SOS_NEW`, `SOS_ACCEPTED`, `SOS_RESOLVED` in all three; no `JOIN_APPROVED` email (R-35). |
| 7 | No dead references (section, BR, F-, E-, G-, L-, R-) | **pass**: new references (R-33..R-41, BR-83, BR-84, G-L14, G-L15, `APP_URL`, tier names) all resolve; L-1..L-4 and their G-L5/G-L8 counterparts are gone from every active doc. |
| 8 | No body DTO accepts `role`, `status`, `communityId` (outside path), `handlerId`, `reporterId`, `globalRole`, `isActive` | **pass with documented exceptions (BR-11)**: `communityId` in `POST /memberships` and `POST /memberships/preview` (scanned QR target, G-L6); membership `role` in `PATCH .../role` (the action itself, G-L7). |
| 9 | Every guarded route is `[AUTH]`; no `[ADMIN]` prefix remains | **pass**: sections 1-9 use `[PUBLIC]` / `[AUTH]` only; every admin/ownership check is named in the `description` list of its section (R-34). |

Endpoint count: full v1 63 REST + WS -> Lite rev 5 48 REST + WS -> Lite rev 5.1 49 REST + WS -> **Lite rev 5.2: 51 REST + 1 WS** (+ Stretch job).
