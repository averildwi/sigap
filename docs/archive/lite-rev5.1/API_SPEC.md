# API_SPEC: WargaKita Lite

Source: `docs/PRD.md` rev 5.1 (Lite) and `docs/DATA_MODEL.md`. Full v1 spec archived in `docs/archive/full-v1/API_SPEC.md`; Lite rev 5 in `docs/archive/lite-rev5/API_SPEC.md`. Items marked **[PHASE 2]** / **[DIBUANG di Lite]** / **[STRETCH]** in the PRD have no endpoint here (see section 10, "Not in Lite").

## 0. Conventions (pointers only)

| Topic | Source of truth |
|---|---|
| Envelope, markers (`MessageResponse`, `Paginated`), error body, status codes | `nest-response-and-errors` |
| Route naming, `[PREFIX]` derivation, Swagger, `main.ts` order | `nest-architecture` rules 9-12 (Lite deviation L-4) |
| Auth endpoints, JWT, OTP, throttle, `:id` pipes, no account leaks | `nest-auth-and-security` (rules 10, 12, 14, 21; Lite deviations L-1..L-3) |
| DTO rules, `PaginationDto`, `ToBoolean`, env schema | `nest-validation-and-config` |
| Prisma usage (select, transactions, no N+1) | `nest-prisma` |
| Known deviations L-1..L-4 | PRD 8.13 |

All paths are under `/api`. All ids are uuid -> every `:xxxId` uses `ParseUUIDPipe`. Every list query DTO extends `PaginationDto` (`page`, `limit`).

### 0.1 Guards and prefixes

| Prefix | Guards | Meaning |
|---|---|---|
| `[PUBLIC]` | none | anyone |
| `[AUTH]` | `JwtAuthGuard`, `RolesGuard`, no `@Roles` | any verified user; membership checks (if any) are in the service and named in the description |
| `[ADMIN]` | `JwtAuthGuard`, `RolesGuard`, no `@Roles` | caller must be an ACTIVE ADMIN of `:communityId`, checked by `assertAdmin` in the service (L-4); description says so |

No `@Roles` is used anywhere (L-2). Community checks use `src/common/helpers/community-access.helper.ts`:
- `assertMember(tx, userId, communityId)` -> ACTIVE membership or `403 'You are not a member of this community'` (also for an unknown community, BR-31).
- `assertAdmin(tx, userId, communityId)` -> as above, plus role ADMIN or `403 'Admin access required'` (BR-32).
- Resources of another community -> `404` (BR-33).

### 0.2 Throttle notation

`5/1m` = 5 requests per minute per IP (`req.ip`, `trust proxy = TRUST_PROXY_HOPS`). `global` = `THROTTLE_LIMIT` (default 100) per `THROTTLE_TTL` seconds (default 60). `auth` = `AUTH_THROTTLE_LIMIT` (default 10) per `THROTTLE_TTL`. Values are set per handler with `@Throttle`, never on the class, and are read from env through constants evaluated after the env is loaded (`ThrottlerModule.forRootAsync` + `ConfigService`; handler limits as functions of the same config), never hard-coded (BR-80).

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

Never returned: `passwordHash`, `codeHash`, `regionKey`, `escalatedAt`.

### 0.4 Conflicts with the skills

| # | Conflict | Resolution |
|---|---|---|
| C-2 | Skill rule 21: `GET /auth/me` returns `id, email, role, emailVerifiedAt, createdAt` | Returns `id, email, name, phone, emailVerifiedAt, createdAt` (no role column exists, L-2). |
| C-3 | Skill `RegisterDto` is `{ email, password }` | Extended with `name`. |
| C-4 | Skill rule 21: profile is `/auth/me`; profile edit not in the skill table | `PATCH /auth/me`, implemented in `src/users/` (`@Controller('auth/me')`). |
| C-7 | ID pipe | All `ParseUUIDPipe`. |
| C-8 | Skill reference uses the Resend SDK + `OTP_SENDER`; `tokenVersion` in `JwtStrategy`; `@Roles` prefixes | Deviations L-1 (no `tokenVersion`), L-2 (no `@Roles`), L-3 (`fetch`-based Resend `MailService` behind `OtpSender`, env `MAIL_PROVIDER` / `RESEND_API_KEY` / `RESEND_FROM_EMAIL`), L-4 (`[ADMIN]` prefix). |

## 1. Module `auth` (`src/auth/`)

Copied from `nest-auth-and-security/references/reference-implementation.md` with the Lite changes: no `role`/`isActive`/`tokenVersion` on `User` (JWT payload `{ sub, email }`; `JwtStrategy.validate()` reloads `id, email, emailVerifiedAt` and returns `{ id, email, role: 'USER' }`); no change-password / logout-all.

| Method | Path | Summary | Guard | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|
| POST | `/auth/register` | `[PUBLIC] Register and send a verification code` | - | auth | 201 | F-AUTH-1 / BR-1, 2, 11, 80 |
| POST | `/auth/verify-otp` | `[PUBLIC] Verify the email with a code` | - | auth | 200 | F-AUTH-2 / BR-3, 80 |
| POST | `/auth/resend-otp` | `[PUBLIC] Send a new verification code` | - | auth | 200 | F-AUTH-2 / BR-80 |
| POST | `/auth/login` | `[PUBLIC] Log in with email and password` | - | auth | 200 | F-AUTH-3 / BR-3, 80 |
| POST | `/auth/forgot-password` | `[PUBLIC] Send a password reset code` | - | auth | 200 | F-AUTH-4 / BR-80 |
| POST | `/auth/reset-password` | `[PUBLIC] Reset the password with a code` | - | auth | 200 | F-AUTH-4 / BR-2, 80 |
| GET | `/auth/me` | `[AUTH] Get my profile` | Jwt, Roles | global | 200 | F-AUTH-5 |

### POST /auth/register
- **Request** body `RegisterDto`:

  | Field | Type | Validators | Example |
  |---|---|---|---|
  | `email` | string | `@IsAccountEmail()` (skill) | `"siti@example.com"` |
  | `password` | string | `@IsNewPassword()` (skill, min 8) | `"rahasia123"` |
  | `name` | string | `@IsString() @Transform(trim) @Length(2, 100)` | `"Siti Aminah"` |
- **Response** `MessageResponse(null, 'Registered, check your email for the code')`.
- **Errors**: `409 | Email is already registered | email exists (skill exception)`; `400 | validation messages`.
- **Rules**: BR-1, BR-2, BR-11. Transaction: no (create, then `OtpService.issue`). Concurrency: duplicate email race -> P2002 -> 409 via filter.

### POST /auth/verify-otp, /resend-otp, /login, /forgot-password, /reset-password
As in the skill reference (`VerifyOtpDto`, `RequestCodeDto`, `LoginDto`, `ResetPasswordDto`; responses `{ accessToken }`, `null`, `{ accessToken }`, `null`, `null`).

| Endpoint | Errors |
|---|---|
| verify-otp | `400 | Code is invalid or expired | unknown email, wrong/expired/used code, attempts exhausted` |
| resend-otp | none (always `200 'If the account can receive a code, it has been sent'`) |
| login | `401 | Invalid credentials | unknown email or wrong password`; `403 | Email is not verified | after a correct password` |
| forgot-password | none (same 200 message; code only for a verified account) |
| reset-password | `400 | Code is invalid or expired` |

Rules: BR-2, BR-3; OTP 6 digits, TTL `OTP_TTL_MINUTES` (10), max 5 attempts with the atomic claim of skill rule 11, cooldown `OTP_RESEND_COOLDOWN_SECONDS` (60), purpose-scoped. Reset does not end sessions (L-1).

### GET /auth/me
- **Response** plain `{ id, email, name, phone, emailVerifiedAt, createdAt }` (C-2).
- **Errors**: `401 | Unauthorized`.

## 2. Module `users` (`src/users/`, `@Controller('auth/me')`, C-4)

| Method | Path | Summary | Guard | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|
| PATCH | `/auth/me` | `[AUTH] Update my profile` | Jwt, Roles | global | 200 | F-USERS-1 / BR-9, 11 |

### PATCH /auth/me
- **Request** `UpdateProfileDto`:

  | Field | Type | Validators | Example |
  |---|---|---|---|
  | `name?` | string | `@IsOptional() @IsString() @Transform(trim) @Length(2, 100)` | `"Siti A."` |
  | `phone?` | string \| null | `@IsOptional() @IsString() @Matches(/^(\+62\|62\|0)8\d{8,12}$/)`; `null` clears | `"081234567890"` |
- **Response** `MessageResponse({ id, email, name, phone, emailVerifiedAt, createdAt }, 'Profile updated')`; phone stored as `+628...` (BR-9, pure helper `normalisePhone`).
- **Errors**: `400 | validation messages | bad name/phone or any unknown field such as email, role (forbidNonWhitelisted)`; `401`.
- **Rules**: BR-9, BR-11. Never spread the DTO into `data`.

## 3. Module `communities` (`src/communities/`)

| Method | Path | Summary | Guard | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|
| POST | `/communities` | `[AUTH] Create a community and become its admin` | Jwt, Roles | global | 201 | F-COMMUNITIES-1 / BR-12..16 |
| GET | `/communities/mine` | `[AUTH] List my communities and memberships` | Jwt, Roles | global | 200 | F-COMMUNITIES-2, F-MEMBERSHIPS-7 / BR-13, 23 |
| GET | `/communities/:communityId` | `[AUTH] Get a community card` | Jwt, Roles | global | 200 | F-COMMUNITIES-7 / BR-13, 31 |

Route order: `mine` before `:communityId`.

### POST /communities
- **Request** `CreateCommunityDto`:

  | Field | Type | Validators | Example |
  |---|---|---|---|
  | `rt` | int | `@Type(() => Number) @IsInt() @Min(1) @Max(999)` | `1` |
  | `rw` | int | same | `6` |
  | `province` | string | `@IsString() @Transform(trim) @Length(2, 100)` | `"Jawa Barat"` |
  | `city` | string | same | `"Kota Cimahi"` |
  | `district` | string | same | `"Cimahi Tengah"` |
  | `village` | string | same | `"Kel. Suka Maju"` |
  | `name?` | string | `@IsOptional() @IsString() @Transform(trim) @Length(3, 100)` | `"Griya Asri"` |
  | `houseBlock` | string | `@IsString() @Transform(trim) @Length(1, 50)` | `"Blok A1 No. 1"` |
- **Response** `MessageResponse({ community: CommunitySummary, membership: MembershipView }, 'Community created')`.
- **Errors**: `409 | Community already registered, join with its QR code | same region key (BR-14)`; `400 | validation`.
- **Rules**: BR-12 (`buildRegionKey` helper), BR-14, BR-15, BR-16. **Transaction: yes** (community + ACTIVE ADMIN membership). Concurrency: unique `regionKey`; the service catches P2002 on this create and rethrows `ConflictException` with the BR-14 message (E-5).

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
| GET | `/communities/:communityId/join-qr` | `[ADMIN] Get the current join QR` | Jwt, Roles | global | 200 | F-MEMBERSHIPS-1 / BR-19, 32 |
| POST | `/memberships/preview` | `[AUTH] Preview the community of a scanned QR` | Jwt, Roles | 10/1m | 200 | F-MEMBERSHIPS-2 / BR-19, 20, 80 |
| POST | `/memberships` | `[AUTH] Submit a join request from a scanned QR` | Jwt, Roles | 10/1m | 201 | F-MEMBERSHIPS-3 / BR-19, 20, 23, 24, 80 |
| GET | `/communities/:communityId/join-requests` | `[ADMIN] List pending join requests` | Jwt, Roles | global | 200 | F-MEMBERSHIPS-4 / BR-32 |
| POST | `/communities/:communityId/memberships/:membershipId/approve` | `[ADMIN] Approve a join request` | Jwt, Roles | global | 200 | F-MEMBERSHIPS-5 / BR-25, 68 |
| POST | `/communities/:communityId/memberships/:membershipId/reject` | `[ADMIN] Reject a join request` | Jwt, Roles | global | 200 | F-MEMBERSHIPS-6 / BR-23, 25 |
| GET | `/communities/:communityId/memberships` | `[ADMIN] List members` | Jwt, Roles | global | 200 | F-MEMBERSHIPS-10 / BR-32 |
| PATCH | `/communities/:communityId/memberships/:membershipId/role` | `[ADMIN] Change a member's role` | Jwt, Roles | global | 200 | F-MEMBERSHIPS-11 / BR-27, 29 |
| POST | `/communities/:communityId/memberships/:membershipId/remove` | `[ADMIN] Remove a member` | Jwt, Roles | global | 200 | F-MEMBERSHIPS-9 / BR-27, 28, 30 |
| POST | `/communities/:communityId/leave` | `[AUTH] Leave a community` | Jwt, Roles | global | 200 | F-MEMBERSHIPS-8 / BR-27, 30 |

### GET /communities/:communityId/join-qr
- **Response** plain `{ communityId, label, qrContent, token, window, expiresInSeconds }` (`expiresInSeconds` until the window changes; the frontend refreshes then). `qrContent` is also the manual fallback string (copy button, R-30).
- **Errors**: `403 | You are not a member of this community`; `403 | Admin access required`.
- **Rules**: BR-19, BR-32. No write.

### POST /memberships/preview
- **Request** `PreviewJoinDto`:

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
- **Errors**: `400 | Invalid or expired code | unknown community or bad/old token (one message, BR-20)`; `409 | You already have a request or membership in this community | row is PENDING or ACTIVE (BR-23)`; `400 | validation`; `429`.
- **Rules**: BR-19, BR-20, BR-23, BR-24. `communityId` in the body is the scanned target (it is what the QR names), not a privileged field. **Transaction: yes**: `community.findUnique` (missing -> 400 same message), token check, read existing row, 409 if PENDING/ACTIVE, `upsert` to PENDING (role WARGA, houseBlock, `requestedAt = now`, `decidedAt = null`, `joinedAt = null`), `notification.createMany(JOIN_REQUEST)` for ACTIVE admins. After commit: `join-request:new` + `notification:new` to those admins. Concurrency: unique `(userId, communityId)`; a double submit that races the upsert ends with one PENDING row and the second gets 409 or the same row (E-8).

### GET /communities/:communityId/join-requests
- **Request** query `QueryJoinRequestsDto extends PaginationDto { search?: string @IsOptional() @IsString() @MaxLength(100) }` (name or house block, `mode: 'insensitive'`).
- **Response** `Paginated<{ id, user: { id, name, email, emailVerifiedAt }, houseBlock, requestedAt }>`, oldest first.
- **Errors**: `403` (member / admin).

### POST .../memberships/:membershipId/approve, /reject
- **Request** paths `communityId`, `membershipId` (`ParseUUIDPipe`); no body.
- **Response** `MessageResponse(MembershipView & { user: UserRef }, 'Join request approved' | 'Join request rejected')`.
- **Errors**: `403` (member / admin); `404 | Join request not found | missing or other community (BR-33)`; `400 | Join request is no longer pending | already decided or lost race (E-1)`.
- **Rules**: BR-25 (approve: ACTIVE, WARGA, `joinedAt`, `decidedAt`; reject: REJECTED, `decidedAt`), BR-68 (approve email optional). **Transaction: yes**: `updateMany({ id, communityId, status: PENDING })`, count 0 -> re-read for 404 vs 400; `notification.create(JOIN_APPROVED | JOIN_REJECTED)`. After commit: realtime (+ optional email for approve, fire-and-log).

### GET /communities/:communityId/memberships
- **Request** query `QueryMembersDto extends PaginationDto`: `status?` (`@IsEnum(MembershipStatus)`, default `ACTIVE`), `role?` (`@IsEnum(MembershipRole)`), `search?` (`@MaxLength(100)`, name or house block, insensitive).
- **Response** `Paginated<{ id, user: { id, name, phone }, houseBlock, role, status, joinedAt }>`; ADMIN first, then name.
- **Errors**: `403` (member / admin).

### PATCH /communities/:communityId/memberships/:membershipId/role
- **Request** paths; body `ChangeRoleDto { role: MembershipRole @IsEnum(MembershipRole) }`, example `{ "role": "ADMIN" }`. This is the action of the endpoint, guarded by `assertAdmin`.
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
- **Errors**: `403 | You are not a member of this community`; `400 | Promote another admin first | caller is the last ACTIVE ADMIN (BR-27)`.
- **Rules**: BR-27, BR-30. Transaction: yes (count check, then `updateMany({ userId, communityId, status: ACTIVE }, { status: LEFT, role: WARGA })`). Description: "Any ACTIVE member (service check)".

## 5. Module `announcements` (`src/announcements/`)

| Method | Path | Summary | Guard | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|
| POST | `/communities/:communityId/announcements` | `[ADMIN] Publish an announcement` | Jwt, Roles | global | 201 | F-ANNOUNCEMENTS-1 / BR-35, 36, 37 |
| PATCH | `/communities/:communityId/announcements/:announcementId` | `[ADMIN] Edit an announcement` | Jwt, Roles | global | 200 | F-ANNOUNCEMENTS-2 / BR-33, 35, 36 |
| DELETE | `/communities/:communityId/announcements/:announcementId` | `[ADMIN] Delete an announcement` | Jwt, Roles | global | 200 | F-ANNOUNCEMENTS-3 / BR-38 |
| GET | `/communities/:communityId/announcements` | `[AUTH] List announcements` | Jwt, Roles | global | 200 | F-ANNOUNCEMENTS-4 / BR-31, 39 |
| GET | `/communities/:communityId/announcements/:announcementId` | `[AUTH] Get an announcement` | Jwt, Roles | global | 200 | F-ANNOUNCEMENTS-5 / BR-31, 33 |

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
| POST | `/communities/:communityId/reports` | `[AUTH] Submit a report` | Jwt, Roles | global | 201 | F-REPORTS-1 / BR-48, 52 |
| GET | `/communities/:communityId/reports/me` | `[AUTH] List my reports` | Jwt, Roles | global | 200 | F-REPORTS-2 / BR-49 |
| GET | `/communities/:communityId/reports` | `[ADMIN] List all reports of the community` | Jwt, Roles | global | 200 | F-REPORTS-6 / BR-32 |
| GET | `/communities/:communityId/reports/:reportId` | `[AUTH] Get a report` | Jwt, Roles | global | 200 | F-REPORTS-3 / BR-49 |
| PATCH | `/communities/:communityId/reports/:reportId` | `[AUTH] Edit my pending report` | Jwt, Roles | global | 200 | F-REPORTS-4 / BR-48, 50 |
| DELETE | `/communities/:communityId/reports/:reportId` | `[AUTH] Delete my pending report` | Jwt, Roles | global | 200 | F-REPORTS-5 / BR-50 |
| POST | `/communities/:communityId/reports/:reportId/process` | `[ADMIN] Mark a report as in progress` | Jwt, Roles | global | 200 | F-REPORTS-7 / BR-51, 52 |
| POST | `/communities/:communityId/reports/:reportId/resolve` | `[ADMIN] Resolve a report` | Jwt, Roles | global | 200 | F-REPORTS-7 / BR-51, 52 |
| POST | `/communities/:communityId/reports/:reportId/reject` | `[ADMIN] Reject a report` | Jwt, Roles | global | 200 | F-REPORTS-7 / BR-51, 52 |

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
  - process, resolve: `ReportNoteDto { note?: string @IsOptional() @IsString() @Transform(trim) @MaxLength(1000) }`.
  - reject: `RejectReportDto { note: string @IsString() @Transform(trim) @Length(5, 1000) }`.
- **Response** `MessageResponse(ReportView, 'Report marked as in progress' | 'Report resolved' | 'Report rejected')`.
- **Errors**: `403` (member / admin); `404 | Report not found`; `400 | Invalid status change | not allowed by PRD 6.4 or stale`; `400 | validation`.
- **Rules**: BR-51, BR-52. **Transaction: yes**: allowed-from (`process <- [PENDING]`, `resolve <- [PENDING, IN_PROGRESS]`, `reject <- [PENDING, IN_PROGRESS]`); `updateMany({ id, communityId, status: { in: allowedFrom } })` with the target status, `responseNote` (only when sent), `respondedById`, `respondedAt`; count 0 -> 404/400; `REPORT_STATUS` to the reporter unless the caller is the reporter. One service method `changeStatus(target, ...)`. After commit: `notification:new`.

## 7. Module `sos-alerts` (`src/sos-alerts/`)

"Open" = `SENT`, `ACCEPTED`, `HANDLING`. Every change is a conditional `sosAlert.updateMany` (+ notification) in one `$transaction`; realtime and email after commit. Closing (RESOLVED, CANCELLED, FALSE_ALARM) sets `closedAt`. Notification and email texts: PRD 5.9.1 (`notification-templates.ts`).

| Method | Path | Summary | Guard | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|
| POST | `/communities/:communityId/sos-alerts` | `[AUTH] Send an SOS` | Jwt, Roles | 5/1m | 201 | F-SOS-1 / BR-53, 54, 55, 62, 64, 68, 80 |
| GET | `/communities/:communityId/sos-alerts/me` | `[AUTH] List my SOS alerts` | Jwt, Roles | global | 200 | F-SOS-9 / BR-31 |
| GET | `/communities/:communityId/sos-alerts` | `[ADMIN] List SOS alerts of the community` | Jwt, Roles | global | 200 | F-SOS-8 / BR-32 |
| GET | `/communities/:communityId/sos-alerts/:sosAlertId` | `[AUTH] Get an SOS alert` | Jwt, Roles | global | 200 | F-SOS-2, F-SOS-8 / BR-32, 33 |
| POST | `.../sos-alerts/:sosAlertId/accept` | `[ADMIN] Accept an SOS` | Jwt, Roles | global | 200 | F-SOS-4 / BR-57, 58 |
| POST | `.../sos-alerts/:sosAlertId/handle` | `[ADMIN] Mark an SOS as being handled` | Jwt, Roles | global | 200 | F-SOS-5 / BR-58 |
| POST | `.../sos-alerts/:sosAlertId/resolve` | `[ADMIN] Resolve an SOS` | Jwt, Roles | global | 200 | F-SOS-5 / BR-58 |
| POST | `.../sos-alerts/:sosAlertId/false-alarm` | `[ADMIN] Mark an SOS as a false alarm` | Jwt, Roles | global | 200 | F-SOS-6 / BR-60 |
| POST | `.../sos-alerts/:sosAlertId/cancel` | `[AUTH] Cancel my SOS` | Jwt, Roles | global | 200 | F-SOS-3 / BR-59 |

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
- **Rules**: BR-53, BR-54, BR-55, BR-62, BR-64, BR-68. **Transaction: yes**: `assertMember` (gets `houseBlock`), `findFirst({ communityId, senderId: me, status: { in: open } })` -> 409, list ACTIVE admins except the caller -> `recipientCount`, create, `notification.createMany(SOS_NEW)`. **After commit**: `sos:new` + `notification:new` to the recipients, then **email `SOS_NEW` to each recipient admin via `MailService.sendSosAlert()`, fire-and-log** (a failure is logged without the address and never changes the response). The email contains only name, house block, type, label and the app link: no GPS, no note, no phone (BR-68, PRD 5.9.1). Description: "Any ACTIVE member".

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

### POST .../handle, /resolve
- **Request** body `SosNoteDto { note?: string @IsOptional() @IsString() @Transform(trim) @MaxLength(280) }` (stored in `resolutionNote` on resolve; ignored on handle).
- **Response** `MessageResponse(SosView, 'SOS marked as handling' | 'SOS resolved')`.
- **Errors**: `403` (member / admin); `404`; `403 | Only the handler can do this`; `400 | Invalid SOS state`.
- **Rules**: BR-58. `updateMany({ id, communityId, handlerId: me, status: ACCEPTED | HANDLING })`; resolve sends `SOS_RESOLVED` to the sender and sets `closedAt`.

### POST .../false-alarm
- **Request** body `SosNoteDto` (stored in `resolutionNote`).
- **Response** `MessageResponse(SosView, 'SOS marked as false alarm')`.
- **Errors**: `403` (member / admin); `404`; `403 | You cannot mark your own SOS`; `403 | Only the handler can do this`; `400 | Invalid SOS state`.
- **Rules**: BR-60. `updateMany` where `OR: [{ status: SENT, senderId: { not: me } }, { status: { in: [ACCEPTED, HANDLING] }, handlerId: me }]`; `SOS_RESOLVED` to the sender; `closedAt`.

### POST .../cancel
- **Response** `MessageResponse(SosView, 'SOS cancelled')`.
- **Errors**: `403`; `404 | SOS alert not found | not the caller's`; `400 | Invalid SOS state | already closed`.
- **Rules**: BR-59. `updateMany({ id, communityId, senderId: me, status: { in: open } }, { status: CANCELLED, closedAt })`. No notification row; `sos:updated` to handler + admins. Description: "Sender only".

### [STRETCH] SosEscalationJob (F-SOS-7, BR-63)
`@Interval(15000)`: `findMany({ status: SENT, escalatedAt: null, createdAt: { lte: now - 120 s } }, take: 50)`; per alert `updateMany({ id, status: SENT, escalatedAt: null }, { escalatedAt: now })`; only when count = 1: `notification.createMany(SOS_NEW)` to current recipients, `sos:new`, email (fire-and-log). Not part of the definition of done.

## 8. Module `notifications` (`src/notifications/`)

| Method | Path | Summary | Guard | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|
| GET | `/notifications` | `[AUTH] List my notifications` | Jwt, Roles | global | 200 | F-NOTIFICATIONS-1 / BR-65, 66 |
| GET | `/notifications/unread-count` | `[AUTH] Count my unread notifications` | Jwt, Roles | global | 200 | F-NOTIFICATIONS-1 / BR-65 |
| POST | `/notifications/:notificationId/read` | `[AUTH] Mark a notification as read` | Jwt, Roles | global | 200 | F-NOTIFICATIONS-2 / BR-65 |
| POST | `/notifications/read-all` | `[AUTH] Mark all my notifications as read` | Jwt, Roles | global | 200 | F-NOTIFICATIONS-2 / BR-65 |
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
- **Handshake**: token only from `handshake.auth.token` (never query); `JwtService.verifyAsync`; user exists and `emailVerifiedAt` set; else `disconnect(true)`. Joins room `user:<userId>` only. CORS from `SOCKET_ALLOWED_ORIGINS` via the recipe's adapter (BR-77, BR-81).
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
| GET | `/health` | `[PUBLIC] Check that the API and database are up` | - | global | 200 | F-HEALTH-1 |

- **Response** plain `{ status: 'ok' }`; DB down -> `503 | Service unavailable` (`ServiceUnavailableException`). `SELECT 1` via `$queryRaw`.

## 10. Not in Lite

Endpoints / mechanisms (see archive): change-password, logout-all, account deletion, profile photo; community applications and every review endpoint, `GET /communities` for super admin, duplicate candidates; join tickets, manual join code; promote / demote / transfer-ownership as separate endpoints; notification archive / delete; socket tickets; BFF platform gate (`X-Internal-Key`, `X-Client-IP`); membership expiry job; report photo upload; SOS escalation beyond the Stretch item; events, dashboard, web push.

## 11. Environment variables

Same list as PRD 8.12. Joi in `src/config/env.schema.ts` (project) or nest-common base, and all in `.env.example`.

| Variable | Joi | Read by |
|---|---|---|
| `DATABASE_URL` | base | `PrismaService` |
| `PORT` | base | `main.ts` |
| `NODE_ENV` | base | mail adapter choice, Swagger |
| `JWT_SECRET` | base | `JwtModule`, gateway |
| `JWT_EXPIRES_IN` | base (set `1d` in `.env.example`) | `JwtModule` |
| `FRONTEND_URL` | base | REST CORS |
| `SOCKET_ALLOWED_ORIGINS` | `string().allow('').default('')` | Socket.IO adapter |
| `TRUST_PROXY_HOPS` | base | `main.ts` |
| `JOIN_TOKEN_SECRET` | `string().min(32).required()` | `join-token.ts` |
| `OTP_TTL_MINUTES` | `number().integer().min(1).max(60).default(10)` | `OtpService` |
| `OTP_RESEND_COOLDOWN_SECONDS` | `number().integer().min(0).default(60)` | `OtpService` |
| `MAIL_PROVIDER` | `string().valid('resend', 'console').default(NODE_ENV === 'production' ? 'resend' : 'console')`; boot fails when `console` and `NODE_ENV = production` | `MailService` factory |
| `RESEND_API_KEY` | `when('MAIL_PROVIDER', { is: 'resend', then: string().required(), otherwise: string().allow('').optional() })` | `MailService` (Resend HTTPS API via `fetch`) |
| `RESEND_FROM_EMAIL` | same rule as `RESEND_API_KEY` (e.g. `"WargaKita <no-reply@averil.tech>"`) | `MailService` |
| `THROTTLE_TTL` | `number().integer().min(1).default(60)` (seconds) | `ThrottlerModule.forRootAsync`, throttle constants |
| `THROTTLE_LIMIT` | `number().integer().min(1).default(100)` | global throttler |
| `AUTH_THROTTLE_LIMIT` | `number().integer().min(1).default(10)` | the six pre-login auth handlers |

17 variables (same as PRD 8.12).

Seed only (not in the boot schema): `SEED_DEMO_PASSWORD` (required by the seed script).

## 12. Access matrix

`allow` / `own` (service checks ownership) / `deny` (401 for PUBLIC, 403 otherwise). USER = logged in, no ACTIVE membership in the addressed community.

| Endpoint | PUBLIC | USER | WARGA | ADMIN |
|---|---|---|---|---|
| POST auth/register, verify-otp, resend-otp, login, forgot-password, reset-password | allow | allow | allow | allow |
| GET/PATCH auth/me | deny | allow | allow | allow |
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
| F-NOTIFICATIONS-6 | `OtpService.issue`, SOS send (after commit), approve (optional) |
| F-HEALTH-1 | GET /health |

Orphan endpoints: none. Orphan Lite features: none.

## 14. Test targets (minimum for Lite)

| BR | Target | Assertion |
|---|---|---|
| BR-19, BR-20 | `join-token.ts` (pure), `MembershipsService.previewJoin` | same token for (id, w); valid for w and w-1, invalid for w-2, other community, wrong length; `previewJoin` throws `BadRequestException('Invalid or expired code')` and calls no write |
| BR-12 | `buildRegionKey` (pure) | "Kel. Suka Maju" and "sukamaju" -> same village part; prefixes / punctuation / spaces ignored |
| BR-13 | `formatLabel` (pure) | `RT001/RW006` |
| BR-3, skill rule 11 | `OtpService.consume` / `AuthService.verifyEmail` | `BadRequestException` for wrong / expired / exhausted code; attempt claimed before compare; success sets `emailVerifiedAt` |
| BR-57 | `SosAlertsService.accept` | `ForbiddenException` own SOS; `BadRequestException('SOS already accepted')` when `updateMany` count 0; notification not created then |
| BR-51 | `ReportsService.changeStatus` | `BadRequestException('Invalid status change')` for RESOLVED->*, REJECTED->*, IN_PROGRESS->process; `RejectReportDto` requires a note |
| BR-23 | `MembershipsService.requestJoin`, `previewJoin` | `ConflictException` from PENDING/ACTIVE; allowed from REJECTED/LEFT/REMOVED; `previewJoin` returns the current `myMembershipStatus` (or null) |
| BR-27 | `MembershipsService.changeRole/remove/leave` | `BadRequestException` when the last ADMIN would go |
| BR-31, BR-32 | `community-access.helper` | `ForbiddenException` for no row / PENDING / other community; admin check |
| BR-68 | `SosAlertsService.send` | mail rejection is logged, the method still resolves |
| BR-66, BR-68 (5.9.1) | `notification-templates.ts` (pure) | title / body / entityType for each of the 9 types; `{title}` cut to 100 chars; `SOS_RESOLVED` false-alarm variant; SOS email text contains no latitude, longitude, note or phone; OTP emails contain the TTL |

**e2e (one flow, real database)**: register (admin) -> verify-otp (code read from a capturing fake `OtpSender` in the test, not from logs) -> `POST /communities` -> register + verify (warga) -> admin `GET join-qr` -> warga `POST /memberships/preview` then `POST /memberships` with the token -> admin approve -> warga `POST sos-alerts` -> admin `accept` -> assert statuses. Plus one isolation check: admin of community A gets 403 on `GET /communities/<B>/reports`.

Route-guard meta-test (skill): every handler has `JwtAuthGuard` or a `[PUBLIC]` summary; prefixes limited to `[PUBLIC]`, `[AUTH]`, `[ADMIN]` (L-4).

## 15. Gaps

See `docs/GAPS.md`.

## 16. Questions

None.

## 17. Self-check (Lite rev 5.1)

| # | Check | Result |
|---|---|---|
| 1 | No `SMTP_`, `nodemailer`, `MAIL_FROM`, "Gmail" in active docs (outside `docs/archive/`) | **pass**: grep over `docs/PRD.md`, `API_SPEC.md`, `DATA_MODEL.md`, `GAPS.md` finds only the word "SMTP" in the R-27 / 8.7 rationale ("Railway Hobby blocks outbound SMTP"), which names the reason, not a transport. Earlier Lite checks (BFF gate, socket ticket, super admin, `tokenVersion`, owner, `joinCode`, `ipHash`, AuditLog, SosEvent, Cloudinary) still only appear in Phase 2 / Not in Lite / deviation text. |
| 2 | Env list PRD 8.12 = API_SPEC 11 | **pass**: **17** variables in both tables (`DATABASE_URL`, `PORT`, `NODE_ENV`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `FRONTEND_URL`, `SOCKET_ALLOWED_ORIGINS`, `TRUST_PROXY_HOPS`, `JOIN_TOKEN_SECRET`, `OTP_TTL_MINUTES`, `OTP_RESEND_COOLDOWN_SECONDS`, `MAIL_PROVIDER`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `THROTTLE_TTL`, `THROTTLE_LIMIT`, `AUTH_THROTTLE_LIMIT`) + `SEED_DEMO_PASSWORD` seed-only. |
| 3 | Endpoint count = 49 REST + 1 WS here, in PRD and in the coverage matrix | **pass**: module tables list 49 REST rows (auth 7, users 1, communities 3, memberships 10, announcements 5, reports 9, sos-alerts 9, notifications 4, health 1) + WS `/realtime`; section 13 maps all of them. |
| 4 | Every endpoint has a PRD feature and vice versa; F-MEMBERSHIPS-2 is ✓ in PRD 11 | **pass**: section 13 covers every row; F-MEMBERSHIPS-2 -> `POST /memberships/preview`, ✓ in PRD 11. F-NOTIFICATIONS-6 is a side effect (mail calls). |
| 5 | Every field used here exists in DATA_MODEL (no schema change) | **pass**: preview returns `CommunitySummary` + `Membership.status`; no new columns. |
| 6 | 5.9.1 text table has the same 9 types as BR-66 and `NotificationType` | **pass**: `JOIN_REQUEST`, `JOIN_APPROVED`, `JOIN_REJECTED`, `ANNOUNCEMENT`, `REPORT_NEW`, `REPORT_STATUS`, `SOS_NEW`, `SOS_ACCEPTED`, `SOS_RESOLVED` in all three. |
| 7 | No dead references (section, BR, F-, E-, G-) | **pass**: new references (5.9.1, R-27..R-32, G-L12, G-L13, `POST /memberships/preview`) all resolve; PRD rev 5.1 title updated in DATA_MODEL/API_SPEC sources. |
| 8 | No body DTO accepts `role`, `status`, `communityId` (outside path), `handlerId`, `reporterId` | **pass with documented exceptions**: `communityId` in `POST /memberships` and `POST /memberships/preview` (scanned QR target, G-L6); `role` in `PATCH .../role` (the action itself, G-L7). |

Endpoint count: full v1 63 REST + WS -> Lite rev 5 48 REST + WS -> **Lite rev 5.1: 49 REST + 1 WS** (+ Stretch job).
