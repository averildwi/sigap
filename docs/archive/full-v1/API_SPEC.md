# API_SPEC: SIGAP v1

Source: `docs/PRD.md` rev 4 (v1 features only, ✓ in [PRD](PRD.md) section 11) and `docs/DATA_MODEL.md`. **[PHASE 2]** features have no endpoints here.

## 0. Conventions (pointers only)

| Topic | Source of truth |
|---|---|
| Envelope, markers (`MessageResponse`, `Paginated`), error body, status codes | `nest-response-and-errors` |
| Route naming, `[PREFIX]` derivation, Swagger, `main.ts` order | `nest-architecture` rules 9-12 |
| Auth endpoints, JWT, OTP, throttle table, `:id` pipes, no account leaks | `nest-auth-and-security` (rules 10, 12, 14, 21) |
| DTO rules, `PaginationDto`, `ToBoolean`, env schema | `nest-validation-and-config` |
| Prisma usage (select, transactions, no N+1) | `nest-prisma` |
| Known deviations D-1..D-5 (BFF gate, client IP, socket ticket, extra throttle keys) | [PRD](PRD.md) 8.13 |

All paths are under `/api`. All ids are uuid -> every `:xxxId` uses `ParseUUIDPipe`. Every list query DTO extends `PaginationDto` (`page`, `limit`).

### 0.1 Guards and prefixes used in this spec

| Prefix | Guards | Who passes the guard |
|---|---|---|
| `[PUBLIC]` | none (JWT) | anyone that passed the BFF gate |
| `[AUTH]` | `JwtAuthGuard`, `RolesGuard`, no `@Roles` | any verified, active user incl. SUPER_ADMIN |
| `[USER]` | `JwtAuthGuard`, `RolesGuard`, `@Roles('USER')` | normal accounts; SUPER_ADMIN gets 403 |
| `[SUPER_ADMIN]` | `JwtAuthGuard`, `RolesGuard`, `@Roles('SUPER_ADMIN')` | the platform operator only |

Infrastructure gates on every route (not roles, do not change the prefix, D-5):
- `InternalKeyGuard` (global `APP_GUARD`, registered **before** `ThrottlerGuard`): `X-Internal-Key` timing-safe check, `X-Client-IP` validated and stored on the request (BR-78, BR-79). Only `GET /health` is exempt (`@SkipInternalKey()`).
- `ThrottlerGuard` (global): named throttlers `ip` (tracker = stored client IP) and `email` (tracker = normalised `body.email`, skipped when absent).
- `UserThrottleGuard` (route-level, placed **after** `JwtAuthGuard`, D-4): tracker = `req.user.id`.

Community membership checks ("member", "admin", "owner") are done in the service through one helper (`src/common/helpers/community-access.helper.ts`, takes `tx`) and are named in each endpoint's **Rules** (BR-31, BR-32). On every `/communities/:communityId/...` route, an unknown community and a community the caller is not an ACTIVE member of give the **same** `403 'You are not a member of this community'` (no community enumeration). Resources of another community give `404` (BR-33).

### 0.2 Throttle notation

`ip 5/1m` = 5 requests per minute per client IP; `email 10/15m` = per normalised email; `user 3/1m` = per user id. `global` = default `ip 100/1m`. Values in the **Throttle** column replace the default for that key on that handler only (handler level, never class level).

### 0.3 Shared response shapes

| Name | Fields |
|---|---|
| `UserRef` | `id`, `name` (already `"Mantan warga"` for deleted users) |
| `CommunitySummary` | `id`, `label` (`RT001/RW006`, BR-13), `name`, `rt`, `rw`, `village`, `district`, `city`, `province` |
| `MembershipView` | `id`, `status`, `role`, `isOwner` (derived: `community.ownerId === userId`), `houseBlock`, `requestedAt`, `joinedAt`, `decidedAt` |
| `AnnouncementView` | `id`, `communityId`, `title`, `body`, `isHighlight` (derived), `author: UserRef`, `createdAt`, `updatedAt` |
| `ReportView` | `id`, `communityId`, `title`, `description`, `category`, `status`, `photoUrl`, `responseNote`, `respondedAt`, `respondedBy: UserRef \| null`, `reporter: UserRef & { houseBlock }`, `createdAt`, `updatedAt` |
| `SosHistoryItem` | `fromStatus`, `toStatus`, `actor: UserRef`, `note`, `createdAt` |
| `SosView` | `id`, `communityId`, `type`, `note`, `latitude`, `longitude`, `houseBlock` (snapshot), `status`, `recipientCount`, `sender: UserRef & { phone }`, `handler: UserRef \| null`, `acceptedAt`, `handlingAt`, `closedAt`, `createdAt`, `history: SosHistoryItem[]` (oldest first) |
| `NotificationView` | `id`, `type`, `title`, `body`, `communityId`, `entityType`, `entityId`, `readAt`, `archivedAt`, `createdAt` |

Never returned anywhere: `passwordHash`, `codeHash`, `tokenVersion`, `ipHash`, `regionKey`, `pendingRegionKey`, `pendingApplicantId`, `openKey`, `highlightCommunityId`, `photoPublicId`, `joinCode` (except to admins in the join QR endpoint), `deletedAt`, `isActive`.

### 0.4 Conflicts between the PRD/prompt and the skills (skill wins unless noted)

| # | Conflict | Resolution |
|---|---|---|
| C-1 | Skill rule 5 wants `globalRole` / `GlobalRole` when two role layers exist, but nest-common's `RolesGuard` reads `AuthUser.role` and rule 24 only allows editing `RoleName`, `UserId`, `JwtPayload` | `RoleName = GlobalRole` in `auth-user.ts`; `JwtStrategy.validate()` maps `User.globalRole` -> `AuthUser.role`. `@Roles('USER')` / `@Roles('SUPER_ADMIN')`. No guard change. |
| C-2 | Skill rule 21: `GET /auth/me` returns `id, email, role, emailVerifiedAt, createdAt` | Returns those plus `name`, `phone` ([PRD](PRD.md) F-AUTH-5); the role field is named `globalRole` to avoid confusion with the membership role. **Needs your OK** (Q-A). |
| C-3 | Skill `RegisterDto` is `{ email, password }` | Extended with `name` and `acceptPrivacyPolicy` ([PRD](PRD.md) BR-4). Same decorators for email/password. |
| C-4 | Skill rule 21: current user is `/auth/me`, not `/users/me`; profile edit and account deletion are not in the skill table | `PATCH /auth/me` and `POST /auth/me/delete`, implemented in `src/users/` (`@Controller('auth/me')`). |
| C-5 | Skill rule 7: built-in exceptions only; there is no `TooManyRequestsException` | BR-56 uses `new HttpException('Too many SOS alerts', HttpStatus.TOO_MANY_REQUESTS)` (built-in base class, no custom class). |
| C-6 | Skill rule 16 / rule 10 / websocket recipe vs. the BFF-gate design | Documented deviations D-1..D-5 ([PRD](PRD.md) 8.13); not repeated as violations below. |
| C-7 | Prompt says every `:id` pipe "uuid / int / cuid"; skill rule 14 | All `ParseUUIDPipe`. |

## 1. Module `auth` (`src/auth/`)

Copied from `nest-auth-and-security/references/reference-implementation.md`; only the deltas below are new (C-1..C-3).

| Method | Path | Summary | Guard | Roles | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|---|
| POST | `/auth/register` | `[PUBLIC] Register and send a verification code` | - | - | ip 5/1m, email 3/1h | 201 | F-AUTH-1 / BR-1, 2, 4, 11, 80 |
| POST | `/auth/verify-otp` | `[PUBLIC] Verify the email with a code` | - | - | ip 5/1m, email 10/15m | 200 | F-AUTH-2 / BR-3, 80 |
| POST | `/auth/resend-otp` | `[PUBLIC] Send a new verification code` | - | - | ip 3/1m, email 3/15m | 200 | F-AUTH-2 / BR-80 |
| POST | `/auth/login` | `[PUBLIC] Log in with email and password` | - | - | ip 5/1m, email 10/15m | 200 | F-AUTH-3 / BR-3, 80 |
| POST | `/auth/forgot-password` | `[PUBLIC] Send a password reset code` | - | - | ip 5/1m, email 3/15m | 200 | F-AUTH-4 / BR-80 |
| POST | `/auth/reset-password` | `[PUBLIC] Reset the password with a code` | - | - | ip 5/1m, email 10/15m | 200 | F-AUTH-4 / BR-2, 5, 80 |
| GET | `/auth/me` | `[AUTH] Get my profile` | Jwt, Roles | - | global | 200 | F-AUTH-5 |
| POST | `/auth/change-password` | `[AUTH] Change my password, end other sessions` | Jwt, Roles | - | ip 5/1m | 200 | F-AUTH-6 / BR-2, 5 |
| POST | `/auth/logout-all` | `[AUTH] Log out on every device` | Jwt, Roles | - | global | 200 | F-AUTH-7 / BR-5, 77 |

### POST /auth/register
- **Request** body `RegisterDto`:

  | Field | Type | Validators | Example |
  |---|---|---|---|
  | `email` | string | `@IsAccountEmail()` (skill) | `"siti@example.com"` |
  | `password` | string | `@IsNewPassword()` (skill) | `"correct horse battery staple"` |
  | `name` | string | `@IsString() @Transform(trim) @Length(2, 100)` | `"Siti Aminah"` |
  | `acceptPrivacyPolicy` | boolean | `@IsBoolean() @Equals(true)` | `true` |
- **Response** `MessageResponse(null, 'Registered, check your email for the code')`.
- **Errors**: `409 | Email is already registered | email exists (skill rule 12 exception)`; `400 | validation messages | acceptPrivacyPolicy false/missing, bad fields`.
- **Rules**: BR-1, BR-4 (`privacyConsentAt = now`, `privacyPolicyVersion = PRIVACY_POLICY_VERSION`), BR-11 (`globalRole` always `USER`, not in DTO). Transaction: no (single create, then `OtpService.issue`). Concurrency: two registers with the same email -> one P2002 -> 409 via filter.

### POST /auth/verify-otp, /auth/resend-otp, /auth/login, /auth/forgot-password, /auth/reset-password
As in the skill reference (DTOs `VerifyOtpDto`, `RequestCodeDto`, `LoginDto`, `ResetPasswordDto`; responses `{ accessToken } | null`, `null`, `{ accessToken }`, `null`, `null`). Errors exactly as the reference:

| Endpoint | Errors |
|---|---|
| verify-otp | `400 | Code is invalid or expired | unknown email, wrong/expired/used code, attempts exhausted` |
| resend-otp | none (always `200 'If the account can receive a code, it has been sent'`) |
| login | `401 | Invalid credentials | unknown email or wrong password`; `403 | Account is disabled | isActive false (also deleted accounts, checked after the password)`; `403 | Email is not verified | after the password` |
| forgot-password | none (same 200 message) |
| reset-password | `400 | Code is invalid or expired | as verify-otp` |

Rules: BR-3, BR-5 (reset bumps `tokenVersion`); OTP atomic claim per skill rule 11 (transaction inside `OtpService.consume`). The extra `email` throttle (BR-80, D-4) answers 429 identically for every email. A deleted account has `passwordHash = null`, so login already fails with 401 before the status check.

### GET /auth/me
- **Response** plain: `{ id, email, name, phone, globalRole, emailVerifiedAt, createdAt }` (C-2).
- **Errors**: `401 | Unauthorized | missing/invalid/revoked token`.

### POST /auth/change-password
- **Request** `ChangePasswordDto { currentPassword @IsCurrentPassword(), newPassword @IsNewPassword() }`.
- **Response** `MessageResponse({ accessToken }, 'Password changed')`.
- **Errors**: `400 | Current password is incorrect | wrong current password`; `401`.
- **Rules**: BR-5 (`tokenVersion` +1 in the same update); also disconnects the user's sockets (BR-77).

### POST /auth/logout-all
- **Response** `MessageResponse(null, 'Logged out on every device')`.
- **Errors**: `401`.
- **Rules**: BR-5 `tokenVersion` +1; BR-77 the user's open sockets get `session:revoked` and are disconnected.

## 2. Module `users` (`src/users/`, `@Controller('auth/me')`, C-4)

| Method | Path | Summary | Guard | Roles | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|---|
| PATCH | `/auth/me` | `[USER] Update my profile` | Jwt, Roles | USER | global | 200 | F-USERS-1 / BR-9, 11 |
| POST | `/auth/me/delete` | `[USER] Delete my account` | Jwt, Roles, UserThrottle | USER | user 3/1m | 200 | F-USERS-3 / BR-5, 6, 7, 8, 82 |

### PATCH /auth/me
- **Request** `UpdateProfileDto`:

  | Field | Type | Validators | Example |
  |---|---|---|---|
  | `name?` | string | `@IsOptional() @IsString() @Transform(trim) @Length(2, 100)` | `"Siti A."` |
  | `phone?` | string \| null | `@IsOptional() @IsString() @Matches(/^(\+62\|62\|0)8\d{8,12}$/)`; `null` clears it | `"081234567890"` |
- **Response** `MessageResponse({ id, email, name, phone, globalRole, emailVerifiedAt, createdAt }, 'Profile updated')`; phone stored and returned as `+628...` (BR-9, normalised by a pure helper).
- **Errors**: `400 | validation messages | bad name/phone, or any unknown field such as globalRole, isActive, email (forbidNonWhitelisted)`.
- **Rules**: BR-11 (the DTO has only `name`, `phone`; never spread into `data`). Transaction: no.

### POST /auth/me/delete
- **Request** `DeleteAccountDto { currentPassword @IsCurrentPassword() }`.
- **Response** `MessageResponse(null, 'Account deleted')`.
- **Errors**:

  | Status | Message | When |
  |---|---|---|
  | 400 | `Invalid password` | wrong password (BR-8) |
  | 400 | `Transfer ownership first` | user owns a community (BR-7) |
  | 400 | `Close your active SOS first` | user is sender or handler of an open SOS (BR-7, BR-82) |
- **Rules**: BR-6, BR-7, BR-8, BR-82. **Transaction: yes** (interactive): (1) `membership.updateMany({ userId, status in [PENDING, ACTIVE] } -> LEFT, role WARGA)` (takes the row locks first, N-5), (2) `community.count({ ownerId })` > 0 -> 400, (3) `sosAlert.count({ OR: [{ senderId }, { handlerId }], status in open })` > 0 -> 400, (4) anonymise user (`name 'Mantan warga'`, `email deleted+<id>@invalid.local`, `phone null`, `passwordHash null`, `isActive false`, `deletedAt now`, `tokenVersion +1`), (5) `notification.deleteMany({ userId })`. Any throw rolls back (1). Concurrency: a parallel SOS accept by this user waits on the membership lock and then fails (membership LEFT), or commits first and makes step (3) fail. After commit: disconnect sockets (BR-77). PENDING community applications of the user stay PENDING (G-1).

## 3. Module `communities` (`src/communities/`)

| Method | Path | Summary | Guard | Roles | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|---|
| POST | `/community-applications` | `[USER] Apply to register an RT/RW` | Jwt, Roles, UserThrottle | USER | user 3/1m | 201 | F-COMMUNITIES-1 / BR-12, 14, 15 |
| GET | `/community-applications/me` | `[USER] List my community applications` | Jwt, Roles | USER | global | 200 | F-COMMUNITIES-2 / BR-15 |
| GET | `/community-applications` | `[SUPER_ADMIN] List community applications` | Jwt, Roles | SUPER_ADMIN | global | 200 | F-COMMUNITIES-3 / BR-34 |
| GET | `/community-applications/:applicationId` | `[SUPER_ADMIN] Get an application with possible duplicates` | Jwt, Roles | SUPER_ADMIN | global | 200 | F-COMMUNITIES-3 / BR-73 |
| POST | `/community-applications/:applicationId/approve` | `[SUPER_ADMIN] Approve an application` | Jwt, Roles, UserThrottle | SUPER_ADMIN | user 30/1m (sends mail) | 200 | F-COMMUNITIES-4 / BR-16, 18, 66, 68, 71 |
| POST | `/community-applications/:applicationId/reject` | `[SUPER_ADMIN] Reject an application` | Jwt, Roles, UserThrottle | SUPER_ADMIN | user 30/1m (sends mail) | 200 | F-COMMUNITIES-5 / BR-17, 66, 68, 71 |
| GET | `/communities` | `[SUPER_ADMIN] List communities with statistics` | Jwt, Roles | SUPER_ADMIN | global | 200 | F-COMMUNITIES-6 / BR-34 |
| GET | `/communities/:communityId` | `[USER] Get a community card` | Jwt, Roles | USER | global | 200 | F-COMMUNITIES-7 / BR-13, 31 |

Route order: `me` is declared before `:applicationId`.

### POST /community-applications
- **Request** `CreateCommunityApplicationDto`:

  | Field | Type | Validators | Example |
  |---|---|---|---|
  | `rt` | int | `@Type(() => Number) @IsInt() @Min(1) @Max(999)` | `1` |
  | `rw` | int | same | `6` |
  | `province` | string | `@IsString() @Transform(trim) @Length(2, 100)` | `"Jawa Barat"` |
  | `city` | string | same | `"Kota Cimahi"` |
  | `district` | string | same | `"Cimahi Tengah"` |
  | `village` | string | same | `"Kel. Suka Maju"` |
  | `name?` | string | `@IsOptional() @IsString() @Transform(trim) @Length(3, 100)` | `"Griya Asri"` |
  | `position` | string | `@IsString() @Transform(trim) @Length(2, 50)` | `"Ketua RT"` |
  | `houseBlock` | string | `@IsString() @Transform(trim) @Length(1, 50)` | `"Blok C2 No. 14"` |
- **Response** `MessageResponse(ApplicationView, 'Application submitted')`; `ApplicationView = { id, rt, rw, label, province, city, district, village, name, position, houseBlock, status, rejectReason, reviewedAt, createdAt }`.
- **Errors**:

  | Status | Message | When |
  |---|---|---|
  | 409 | `You already have a pending application` | applicant has a PENDING one (BR-14) |
  | 409 | `Community already registered, join with its QR code` | community with the same region key (BR-14) |
  | 409 | `This RT/RW already has a pending application` | other PENDING application with the same region key (BR-14) |
  | 400 | validation messages | bad fields |
- **Rules**: BR-12 (`regionKey` by `region-key.helper.ts`), BR-14. **Transaction: yes**: lock the applicant's user row (N-5), run the three checks in the order above, create with `pendingRegionKey = regionKey`, `pendingApplicantId = applicantId`. Concurrency: different applicants racing for one region -> unique `pendingRegionKey` P2002 -> 409 (filter message `Data already exists`; the service catches P2002 on this create and rethrows `ConflictException('This RT/RW already has a pending application')`).

### GET /community-applications/me
- **Request** query `QueryMyApplicationsDto extends PaginationDto { status?: ApplicationStatus @IsOptional() @IsEnum }`.
- **Response** `Paginated<ApplicationView>`, newest first.
- **Errors**: `401`, `403 | Forbidden resource | SUPER_ADMIN`.
- **Rules**: only `applicantId = me`.

### GET /community-applications
- **Request** query `QueryApplicationsDto extends PaginationDto`: `status?` (`@IsEnum(ApplicationStatus)`, default none), `search?` (`@IsString() @MaxLength(100)`, `contains` + `mode: 'insensitive'` on `village`, `district`, `city`, `province`; a value like `RT001/RW006` is parsed into `rt` + `rw`).
- **Response** `Paginated<ApplicationView & { applicant: UserRef }>`, PENDING oldest first, others newest first (`orderBy: [{ status: 'asc' }, { createdAt: 'asc' }]` when `status = PENDING`, else `createdAt desc`).
- **Errors**: `401`, `403`.

### GET /community-applications/:applicationId
- **Request** path `applicationId` (`ParseUUIDPipe`).
- **Response** plain: `ApplicationView & { applicant: { id, name, email, phone, deleted: boolean }, reviewer: UserRef | null, possibleDuplicates: Array<{ kind: 'COMMUNITY' | 'APPLICATION', id, label, name, province, city, district, village, createdAt }> }`.
- **Errors**: `404 | Application not found`, `401`, `403`, `400 | Validation failed (uuid is expected)`.
- **Rules**: BR-73: load communities and PENDING applications (excluding this one) with the same `rt` + `rw` (`take: 200`, indexed), parse the normalised parts from `regionKey`, keep those with the same district + city, or a village that contains / is contained in this one; max 10, newest first. Pure function `findPossibleDuplicates()` in the service file, unit-tested.

### POST /community-applications/:applicationId/approve
- **Request** path `applicationId` (`ParseUUIDPipe`), no body.
- **Response** `MessageResponse({ application: ApplicationView, community: CommunitySummary }, 'Application approved')`.
- **Errors**:

  | Status | Message | When |
  |---|---|---|
  | 404 | `Application not found` | missing id |
  | 400 | `Application is no longer pending` | not PENDING, or lost the race |
  | 400 | `Applicant account no longer exists` | applicant `deletedAt` set (BR-16) |
  | 409 | `Community already registered, join with its QR code` | region key taken meanwhile |
- **Rules**: BR-16, BR-18, BR-66, BR-68, BR-71. **Transaction: yes**: `findUnique` (404), applicant check (400), `communityApplication.updateMany({ id, status: PENDING } -> APPROVED, reviewedById, reviewedAt, pendingRegionKey null, pendingApplicantId null })` (count 0 -> 400), `community.findUnique({ regionKey })` (409), `community.create` (joinCode from `randomInt` alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, re-drawn up to 3 times on collision), `membership.create` (ACTIVE, ADMIN, houseBlock from the application, `requestedAt = joinedAt = now`, `decidedById = super`), `notification.create(APPLICATION_APPROVED)`, `auditLog.create(APPLICATION_APPROVED)`. After commit: realtime + email (BR-68, failure logged only). Concurrency: two approvals -> conditional update lets one win (E-4).

### POST /community-applications/:applicationId/reject
- **Request** path `applicationId` (`ParseUUIDPipe`); body `RejectApplicationDto { reason: string @IsString() @Transform(trim) @Length(5, 500) }`, example `"RT ini sudah terdaftar, minta QR ke ketua RT"`.
- **Response** `MessageResponse(ApplicationView, 'Application rejected')`.
- **Errors**: `404 | Application not found`; `400 | Application is no longer pending`; `400 | validation`.
- **Rules**: BR-17, BR-66, BR-68, BR-71. **Transaction: yes**: conditional `updateMany` PENDING -> REJECTED (+ clear guard columns, `rejectReason`, reviewer), notification `APPLICATION_REJECTED`, audit. Email after commit.

### GET /communities
- **Request** query `QueryCommunitiesDto extends PaginationDto { search?: string @IsOptional() @IsString() @MaxLength(100) }` (same matching as applications).
- **Response** `Paginated<CommunitySummary & { activeMemberCount: number, createdAt }>`; `activeMemberCount` via `_count: { select: { memberships: { where: { status: 'ACTIVE' } } } }`. No owner, no member data (BR-34).
- **Errors**: `401`, `403`.

### GET /communities/:communityId
- **Request** path `communityId` (`ParseUUIDPipe`).
- **Response** plain: `CommunitySummary & { myMembership: MembershipView }`.
- **Errors**: `403 | You are not a member of this community | unknown community or not ACTIVE member (BR-31)`; `400 | Validation failed (uuid is expected)`.

## 4. Module `memberships` (`src/memberships/`)

Join tokens and codes (BR-19), computed in `src/memberships/join-token.ts` (pure, unit-tested):
- `w = floor(nowSeconds / 60)`.
- QR token = base64url(HMAC-SHA256(`JOIN_TOKEN_SECRET`, `"qr:" + communityId + ":" + w`)), first 22 chars.
- Manual code = (first 6 bytes of HMAC-SHA256(`JOIN_TOKEN_SECRET`, `"code:" + communityId + ":" + w`) as an integer) mod 10^8, zero-padded to 8 digits.
- Valid for `w` and `w - 1`; compared with `timingSafeEqual` on equal-length buffers.
- The QR **content** is the string `sigap:join:<communityId>:<token>`, read by the in-app scanner (never a URL, so the token does not land in browser history or Vercel logs).
- Join ticket = JWT signed with `JOIN_TICKET_SECRET` (separate `JwtService.signAsync(..., { secret })` call), payload `{ purpose: 'join', sub, communityId, w, scannedAt }`, expiry 10 minutes (BR-21).

| Method | Path | Summary | Guard | Roles | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|---|
| GET | `/communities/:communityId/join-qr` | `[USER] Get the current join QR and manual code` | Jwt, Roles | USER | global | 200 | F-MEMBERSHIPS-1 / BR-19, 32 |
| POST | `/join-tickets` | `[USER] Check a scanned QR or a typed code` | Jwt, Roles, UserThrottle | USER | user 10/1m, ip 30/1m | 201 | F-MEMBERSHIPS-2 / BR-19, 20, 21, 80 |
| POST | `/memberships` | `[USER] Submit a join request` | Jwt, Roles, UserThrottle | USER | user 5/1m | 201 | F-MEMBERSHIPS-3 / BR-21..24, 79, 80 |
| GET | `/memberships/me` | `[USER] List my memberships` | Jwt, Roles | USER | global | 200 | F-MEMBERSHIPS-7 / BR-23 |
| GET | `/communities/:communityId/join-requests` | `[USER] List pending join requests` | Jwt, Roles | USER | global | 200 | F-MEMBERSHIPS-4 / BR-32 |
| POST | `/communities/:communityId/memberships/:membershipId/approve` | `[USER] Approve a join request` | Jwt, Roles, UserThrottle | USER | user 30/1m (sends mail) | 200 | F-MEMBERSHIPS-5 / BR-25, 68, 71 |
| POST | `/communities/:communityId/memberships/:membershipId/reject` | `[USER] Reject a join request` | Jwt, Roles, UserThrottle | USER | user 30/1m (sends mail) | 200 | F-MEMBERSHIPS-6 / BR-23, 25, 68, 71 |
| GET | `/communities/:communityId/memberships` | `[USER] List members` | Jwt, Roles | USER | global | 200 | F-MEMBERSHIPS-10 / BR-32 |
| POST | `/communities/:communityId/memberships/:membershipId/remove` | `[USER] Remove a member` | Jwt, Roles | USER | global | 200 | F-MEMBERSHIPS-9 / BR-27, 28, 30, 71, 82 |
| POST | `/communities/:communityId/memberships/:membershipId/promote` | `[USER] Promote a member to admin` | Jwt, Roles | USER | global | 200 | F-MEMBERSHIPS-11 / BR-29, 71 |
| POST | `/communities/:communityId/memberships/:membershipId/demote` | `[USER] Demote an admin to member` | Jwt, Roles | USER | global | 200 | F-MEMBERSHIPS-11 / BR-27, 29, 71, 82 |
| POST | `/communities/:communityId/leave` | `[USER] Leave a community` | Jwt, Roles | USER | global | 200 | F-MEMBERSHIPS-8 / BR-27, 30, 82 |
| POST | `/communities/:communityId/transfer-ownership` | `[USER] Transfer ownership to another admin` | Jwt, Roles, UserThrottle | USER | user 5/1m | 200 | F-MEMBERSHIPS-13 / BR-27, 66, 71, 74 |
| (job) | `MembershipExpiryJob` hourly | - | - | - | - | - | F-MEMBERSHIPS-12 / BR-26 |

Route order: `memberships/me` before any `:membershipId` route.

### GET /communities/:communityId/join-qr
- **Request** path `communityId` (`ParseUUIDPipe`).
- **Response** plain: `{ communityId, label, qrContent, token, joinCode, manualCode, window, expiresInSeconds }` (`expiresInSeconds` = seconds until the window changes; the frontend refreshes then).
- **Errors**: `403 | You are not a member of this community`; `403 | Admin access required | WARGA (BR-32)`.
- **Rules**: description "Caller must be an ACTIVE ADMIN of the community (service check)". Transaction: no.

### POST /join-tickets
- **Request** body `CreateJoinTicketDto` (exactly one of the two pairs; `@ValidateIf` per pair, a custom class-level check rejects both or none with 400 'Send either a QR or a manual code'):

  | Field | Type | Validators | Example |
  |---|---|---|---|
  | `communityId?` | uuid | `@ValidateIf(o => !o.joinCode) @IsUUID('4')` | `"3f0c..."` |
  | `token?` | string | `@ValidateIf(o => !o.joinCode) @IsString() @Length(22, 22)` | `"pX2...Q"` |
  | `joinCode?` | string | `@ValidateIf(o => !o.communityId) @Transform(upper+trim) @Matches(/^[A-HJ-NP-Z2-9]{6}$/)` | `"K7QX2M"` |
  | `code?` | string | `@ValidateIf(o => !o.communityId) @Matches(/^\d{8}$/)` | `"04718253"` |
- **Response** `MessageResponse({ community: CommunitySummary, joinTicket, expiresAt }, 'Code accepted')`.
- **Errors**: `400 | Invalid or expired code | unknown community / join code, wrong or old token/code (one message for all, BR-20)`; `400 | Send either a QR or a manual code`; `429 | ThrottlerException: Too Many Requests`.
- **Rules**: BR-19, BR-20, BR-21. No write, no transaction. `scannedAt = now`.

### POST /memberships
- **Request** body `CreateMembershipDto { joinTicket: string @IsJWT(), houseBlock: string @IsString() @Transform(trim) @Length(1, 50) }`, example `{ "joinTicket": "eyJ...", "houseBlock": "Blok C2 No. 14" }`.
- **Response** `MessageResponse({ membership: MembershipView, community: CommunitySummary }, 'Join request sent')`.
- **Errors**:

  | Status | Message | When |
  |---|---|---|
  | 400 | `Invalid or expired join ticket` | bad signature, expired, wrong purpose, `sub` != caller (BR-21) |
  | 409 | `You already have a request or membership in this community` | row is PENDING or ACTIVE (BR-23) |
  | 400 | `You can request again after <ISO date>` | REJECTED / REMOVED less than 3 days ago (BR-23) |
  | 409 | `Too many pending join requests` | 3 PENDING already (BR-22) |
- **Rules**: BR-21..24, BR-79. **Transaction: yes**: (1) lock the caller's user row (N-5), (2) read the existing row for (user, community), (3) checks in the table order, (4) `upsert` to PENDING, `role WARGA`, `houseBlock`, `requestedAt now`, `scannedAt`/`tokenWindow` from the ticket, `ipHash = HMAC(IP_HASH_SECRET, req.clientIp)`, clear `decidedById/decidedAt/decisionReason/joinedAt`, (5) `notification.createMany(JOIN_REQUEST)` for ACTIVE admins. After commit: realtime `join-request:new` to those admins. Concurrency: the user-row lock serialises a user's parallel requests (E-8, E-10).

### GET /memberships/me
- **Request** query `QueryMyMembershipsDto extends PaginationDto { status?: MembershipStatus @IsOptional() @IsEnum }`.
- **Response** `Paginated<MembershipView & { community: CommunitySummary, rejectReason: string | null, canRequestAgainAt: string | null }>`; `rejectReason` only when REJECTED; `canRequestAgainAt` = `decidedAt + 3 days` for REJECTED / REMOVED when in the future. Order: ACTIVE, PENDING first, then `updatedAt desc`.
- **Errors**: `401`, `403 | Forbidden resource | SUPER_ADMIN`.

### GET /communities/:communityId/join-requests
- **Request** path `communityId` (`ParseUUIDPipe`); query `QueryJoinRequestsDto extends PaginationDto { search?: string @IsOptional() @MaxLength(100) }` (name or house block, insensitive).
- **Response** `Paginated<{ id, user: { id, name, email, emailVerifiedAt }, houseBlock, scannedAt, tokenWindow, scanWindowStartedAt, requestedAt }>`, oldest `requestedAt` first.
- **Errors**: `403 | You are not a member of this community`; `403 | Admin access required`.

### POST /communities/:communityId/memberships/:membershipId/approve
- **Request** path `communityId`, `membershipId` (`ParseUUIDPipe` both), no body.
- **Response** `MessageResponse(MembershipView & { user: UserRef }, 'Join request approved')`.
- **Errors**: `403 | You are not a member of this community`; `403 | Admin access required`; `404 | Join request not found | id missing or in another community (BR-33)`; `400 | Join request is no longer pending | decided, expired, withdrawn, or lost race (E-1)`.
- **Rules**: BR-25, BR-68, BR-71. **Transaction: yes**: `updateMany({ id, communityId, status: PENDING })` -> ACTIVE, WARGA, `joinedAt`, `decidedById`, `decidedAt`, `decisionReason null`; count 0 -> 400; notification `JOIN_APPROVED`; audit `JOIN_APPROVED`. After commit: realtime + email.

### POST /communities/:communityId/memberships/:membershipId/reject
- **Request** paths as approve; body `RejectJoinRequestDto { reason?: string @IsOptional() @IsString() @Transform(trim) @MaxLength(500) }`.
- **Response** `MessageResponse(MembershipView & { user: UserRef }, 'Join request rejected')`.
- **Errors**: same as approve.
- **Rules**: BR-23 (cooldown from `decidedAt`), BR-25, BR-68, BR-71. Transaction: yes (same shape, -> REJECTED with `decisionReason`).

### GET /communities/:communityId/memberships
- **Request** path `communityId`; query `QueryMembersDto extends PaginationDto`:

  | Field | Validators | Default |
  |---|---|---|
  | `status?` | `@IsOptional() @IsEnum(MembershipStatus)` | `ACTIVE` |
  | `role?` | `@IsOptional() @IsEnum(MembershipRole)` | none |
  | `search?` | `@IsOptional() @IsString() @MaxLength(100)` | none (name or house block, insensitive) |
- **Response** `Paginated<{ id, user: { id, name, phone }, houseBlock, role, isOwner, status, joinedAt }>`; order: role (ADMIN first), then name.
- **Errors**: `403 | You are not a member of this community`; `403 | Admin access required`.

### POST /communities/:communityId/memberships/:membershipId/remove
- **Request** paths (`ParseUUIDPipe`); body `RemoveMemberDto { reason: string @IsString() @Transform(trim) @Length(5, 500) }`.
- **Response** `MessageResponse(MembershipView & { user: UserRef }, 'Member removed')`.
- **Errors**:

  | Status | Message | When |
  |---|---|---|
  | 403 | `You are not a member of this community` / `Admin access required` | caller |
  | 404 | `Member not found` | missing or other community |
  | 400 | `You cannot remove yourself, leave instead` | target is caller |
  | 400 | `Member is not active` | target not ACTIVE |
  | 403 | `The owner cannot be removed` | target is the owner (BR-27) |
  | 403 | `Owner access required` | target is ADMIN, caller not owner (BR-28) |
  | 400 | `This admin is handling an active SOS` | BR-82 |
- **Rules**: BR-27, BR-28, BR-30, BR-71, BR-82. **Transaction: yes**: (1) `updateMany({ id, communityId, status: ACTIVE, role: <read role> })` -> REMOVED, WARGA, `decisionReason`, `decidedById`, `decidedAt` (count 0 -> 400 'Member is not active'), (2) open SOS count with `handlerId = target.userId` in this community > 0 -> throw 400 (rolls back 1), (3) audit `MEMBER_REMOVED`. Concurrency: an SOS accept by the target locks the same membership row (see SOS accept) so either the accept or the removal fails cleanly (E-36). After commit: the removed user stops getting community realtime events (BR-69, no rooms).

### POST /communities/:communityId/memberships/:membershipId/promote
- **Request** paths, no body.
- **Response** `MessageResponse(MembershipView & { user: UserRef }, 'Member promoted to admin')`.
- **Errors**: `403 | Owner access required | caller not owner`; `404 | Member not found`; `400 | Member is not active`; `400 | Member is already an admin`.
- **Rules**: BR-29, BR-71. Transaction: yes (conditional `updateMany({ id, communityId, status: ACTIVE, role: WARGA })` -> ADMIN; count 0 -> re-read to pick the 400 message; audit).

### POST /communities/:communityId/memberships/:membershipId/demote
- **Request** paths, no body.
- **Response** `MessageResponse(MembershipView & { user: UserRef }, 'Admin demoted to member')`.
- **Errors**: `403 | Owner access required`; `404 | Member not found`; `400 | The owner cannot be demoted, transfer ownership first`; `400 | Member is not active`; `400 | Member is not an admin`; `400 | This admin is handling an active SOS` (BR-82).
- **Rules**: BR-27, BR-29, BR-71, BR-82. Transaction: yes (conditional update ADMIN -> WARGA first, then open-SOS check, then audit; same pattern as remove).

### POST /communities/:communityId/leave
- **Request** path `communityId`, no body.
- **Response** `MessageResponse(null, 'You left the community')`.
- **Errors**: `403 | You are not a member of this community`; `400 | Transfer ownership first | caller is owner (BR-27)`; `400 | Close your active SOS first | caller handles an open SOS here (BR-82)`.
- **Rules**: BR-27, BR-30, BR-82. Transaction: yes (conditional update ACTIVE -> LEFT + WARGA, then owner check and open-SOS check, throw rolls back). Description: "Sender of an open SOS may leave; the SOS stays with the admins (G-3)".

### POST /communities/:communityId/transfer-ownership
- **Request** path `communityId`; body `TransferOwnershipDto { membershipId: string @IsUUID('4'), currentPassword: string @IsCurrentPassword() }`.
- **Response** `MessageResponse({ communityId, ownerId: newOwnerUserId }, 'Ownership transferred')`.
- **Errors**:

  | Status | Message | When |
  |---|---|---|
  | 403 | `You are not a member of this community` | caller |
  | 403 | `Owner access required` | caller is not the owner |
  | 400 | `Invalid password` | wrong password (checked before any write) |
  | 404 | `Member not found` | membershipId missing / other community |
  | 400 | `You are already the owner` | target is the caller |
  | 400 | `New owner must be an active admin` | target not ACTIVE ADMIN |
  | 400 | `You are no longer the owner` | lost a race (E-26) |
- **Rules**: BR-27, BR-66, BR-71, BR-74. **Transaction: yes**: (1) lock target via `membership.updateMany({ id, communityId, status: ACTIVE, role: ADMIN }, { updatedAt })` (count 0 -> 400, so a parallel demote cannot slip in), (2) `community.updateMany({ id, ownerId: caller }, { ownerId: target.userId })` (count 0 -> 400), (3) two `OWNERSHIP_TRANSFERRED` notifications (`createMany`), (4) audit. Password verified with `HashingService` (awaited) before the transaction.

### MembershipExpiryJob (no endpoint)
- Every hour (`@nestjs/schedule` `@Cron`): `membership.updateMany({ status: PENDING, requestedAt: { lt: now - 7 days } }, { status: EXPIRED })`. One statement, safe to repeat. Concurrency with approve: both are conditional on PENDING; whichever commits first wins.

## 5. Module `announcements` (`src/announcements/`)

| Method | Path | Summary | Guard | Roles | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|---|
| POST | `/communities/:communityId/announcements` | `[USER] Publish an announcement` | Jwt, Roles | USER | global | 201 | F-ANNOUNCEMENTS-1 / BR-35, 36, 37 |
| PATCH | `/communities/:communityId/announcements/:announcementId` | `[USER] Edit an announcement` | Jwt, Roles | USER | global | 200 | F-ANNOUNCEMENTS-2 / BR-33, 35, 36 |
| DELETE | `/communities/:communityId/announcements/:announcementId` | `[USER] Delete an announcement` | Jwt, Roles | USER | global | 200 | F-ANNOUNCEMENTS-3 / BR-38 |
| GET | `/communities/:communityId/announcements` | `[USER] List announcements` | Jwt, Roles | USER | global | 200 | F-ANNOUNCEMENTS-4 / BR-31, 39 |
| GET | `/communities/:communityId/announcements/:announcementId` | `[USER] Get an announcement` | Jwt, Roles | USER | global | 200 | F-ANNOUNCEMENTS-5 / BR-31, 33 |

### POST /communities/:communityId/announcements
- **Request** path `communityId`; body `CreateAnnouncementDto`:

  | Field | Type | Validators | Example |
  |---|---|---|---|
  | `title` | string | `@IsString() @Transform(trim) @Length(3, 150)` | `"Kerja bakti Minggu"` |
  | `body` | string | `@IsString() @Length(1, 5000)` | `"Kumpul jam 07.00 di pos ronda."` |
  | `isHighlight?` | boolean | `@IsOptional() @IsBoolean()` (JSON body, not query) | `true` |
- **Response** `MessageResponse(AnnouncementView, 'Announcement published')`.
- **Errors**: `403 | You are not a member of this community`; `403 | Admin access required`; `400 | validation`.
- **Rules**: BR-35, BR-36, BR-37. **Transaction: yes**: if `isHighlight`, `announcement.updateMany({ highlightCommunityId: communityId }, { highlightCommunityId: null })` first; create with `highlightCommunityId = isHighlight ? communityId : null`; `notification.createMany` for ACTIVE members except the author (one statement). Concurrency: two highlights at once -> unique `highlightCommunityId`: one P2002 -> 409 `Data already exists` (E-6; acceptable, client retries). After commit: realtime `announcement:new` to the same recipients.

### PATCH /communities/:communityId/announcements/:announcementId
- **Request** paths (`ParseUUIDPipe`); body `UpdateAnnouncementDto extends PartialType(CreateAnnouncementDto)` (`isHighlight: false` removes the highlight).
- **Response** `MessageResponse(AnnouncementView, 'Announcement updated')`.
- **Errors**: `403` (member / admin); `404 | Announcement not found | missing or other community (BR-33)`; `400 | validation`.
- **Rules**: BR-35, BR-36. Transaction: yes when `isHighlight` changes (clear others, then update). No notification (A-13). Any ADMIN of the community may edit, not only the author ([PRD](PRD.md) F-ANNOUNCEMENTS-2).

### DELETE /communities/:communityId/announcements/:announcementId
- **Response** `MessageResponse(null, 'Announcement deleted')`.
- **Errors**: `403` (member / admin); `404 | Announcement not found`.
- **Rules**: BR-38. **Transaction: yes**: `notification.deleteMany({ entityType: ANNOUNCEMENT, entityId })`, then `announcement.delete`.

### GET /communities/:communityId/announcements
- **Request** query `QueryAnnouncementsDto extends PaginationDto { search?: string @IsOptional() @IsString() @MaxLength(100) }` (title, insensitive).
- **Response** `Paginated<AnnouncementView & { isTruncated: boolean }>`; in lists `body` is cut to 300 characters and `isTruncated` says so. Order BR-39 (N-3).
- **Errors**: `403 | You are not a member of this community`.
- **Rules**: BR-31 (any ACTIVE member, WARGA or ADMIN).

### GET /communities/:communityId/announcements/:announcementId
- **Response** plain `AnnouncementView` (full body).
- **Errors**: `403 | You are not a member of this community`; `404 | Announcement not found`.

## 6. Module `reports` (`src/reports/`)

Report photo upload: `multipart/form-data`, field `photo`, `FileInterceptor('photo', { limits: { fileSize: 5 * 1024 * 1024, files: 1 }, fileFilter })` accepting `image/jpeg`, `image/png`, `image/webp` (BR-48, BR-70). Text fields arrive as strings and use `@Type`/`@Transform` as needed. Upload goes to Cloudinary folder `reports/<communityId>` **before** the DB write; if the DB write fails, the uploaded file is deleted (logged on failure). Old photos are deleted **after** a successful DB write.

| Method | Path | Summary | Guard | Roles | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|---|
| POST | `/communities/:communityId/reports` | `[USER] Submit a report` | Jwt, Roles, UserThrottle | USER | user 5/1m | 201 | F-REPORTS-1 / BR-48, 52, 70, 80 |
| GET | `/communities/:communityId/reports/me` | `[USER] List my reports` | Jwt, Roles | USER | global | 200 | F-REPORTS-2 / BR-49 |
| GET | `/communities/:communityId/reports` | `[USER] List all reports of the community` | Jwt, Roles | USER | global | 200 | F-REPORTS-6 / BR-32 |
| GET | `/communities/:communityId/reports/:reportId` | `[USER] Get a report` | Jwt, Roles | USER | global | 200 | F-REPORTS-3 / BR-49 |
| PATCH | `/communities/:communityId/reports/:reportId` | `[USER] Edit my pending report` | Jwt, Roles, UserThrottle | USER | user 10/1m | 200 | F-REPORTS-4 / BR-48, 50, 70 |
| DELETE | `/communities/:communityId/reports/:reportId` | `[USER] Delete my pending report` | Jwt, Roles | USER | global | 200 | F-REPORTS-5 / BR-50 |
| POST | `/communities/:communityId/reports/:reportId/process` | `[USER] Mark a report as in progress` | Jwt, Roles | USER | global | 200 | F-REPORTS-7 / BR-51, 52 |
| POST | `/communities/:communityId/reports/:reportId/resolve` | `[USER] Resolve a report` | Jwt, Roles | USER | global | 200 | F-REPORTS-7 / BR-51, 52 |
| POST | `/communities/:communityId/reports/:reportId/reject` | `[USER] Reject a report` | Jwt, Roles | USER | global | 200 | F-REPORTS-7 / BR-51, 52 |

Route order: `reports/me` before `reports/:reportId`.

### POST /communities/:communityId/reports
- **Request** path `communityId`; multipart body `CreateReportDto` + optional file `photo`:

  | Field | Type | Validators | Example |
  |---|---|---|---|
  | `title` | string | `@IsString() @Transform(trim) @Length(3, 150)` | `"Lampu jalan mati"` |
  | `description` | string | `@IsString() @Length(10, 5000)` | `"Lampu di depan blok C mati sejak Senin."` |
  | `category` | enum | `@IsEnum(ReportCategory)` | `"INFRASTRUCTURE"` |
- **Response** `MessageResponse(ReportView, 'Report submitted')`.
- **Errors**: `403 | You are not a member of this community`; `400 | validation`; `400 | Photo must be a JPEG, PNG or WebP image` (fileFilter); `413 | File too large` (multer limit, mapped by Nest to `PayloadTooLargeException`); `429`.
- **Rules**: BR-48, BR-52, BR-70. **Transaction: yes** (create + `notification.createMany(REPORT_NEW)` for ACTIVE admins except the reporter). After commit: realtime `report:new` to admins.

### GET /communities/:communityId/reports/me
- **Request** query `QueryMyReportsDto extends PaginationDto { status?: ReportStatus @IsOptional() @IsEnum }`.
- **Response** `Paginated<ReportView>` (`reporterId = me`), newest first.
- **Errors**: `403 | You are not a member of this community`.

### GET /communities/:communityId/reports
- **Request** query `QueryReportsDto extends PaginationDto`: `status?` (`@IsEnum(ReportStatus)`), `category?` (`@IsEnum(ReportCategory)`), `search?` (`@MaxLength(100)`, title insensitive).
- **Response** `Paginated<ReportView>`, newest first.
- **Errors**: `403 | You are not a member of this community`; `403 | Admin access required`.

### GET /communities/:communityId/reports/:reportId
- **Response** plain `ReportView`; `reporter.houseBlock` only for admins (null for the reporter's own view).
- **Errors**: `403 | You are not a member of this community`; `404 | Report not found | missing, other community, or caller is neither the reporter nor an admin (BR-49, E-16)`.

### PATCH /communities/:communityId/reports/:reportId
- **Request** multipart `UpdateReportDto extends PartialType(CreateReportDto)` + `removePhoto?: boolean` (`@IsOptional() @ToBoolean() @IsBoolean()`, multipart sends strings) + optional file `photo` (replaces; `photo` and `removePhoto=true` together -> 400).
- **Response** `MessageResponse(ReportView, 'Report updated')`.
- **Errors**: `403 | You are not a member of this community`; `404 | Report not found | not the reporter's`; `400 | Only pending reports can be changed`; `400 | Send either a new photo or removePhoto`; file errors as create.
- **Rules**: BR-48, BR-50, BR-70. Write: `report.updateMany({ id, communityId, reporterId: me, status: PENDING })` (count 0 -> re-read for 404 vs 400). Concurrency: an admin status change in between makes the conditional update fail (400), and the freshly uploaded file is deleted.

### DELETE /communities/:communityId/reports/:reportId
- **Response** `MessageResponse(null, 'Report deleted')`.
- **Errors**: `403 | You are not a member of this community`; `404 | Report not found`; `400 | Only pending reports can be changed`.
- **Rules**: BR-50. **Transaction: yes**: `report.deleteMany({ id, communityId, reporterId: me, status: PENDING })` (count 0 -> 404/400), `notification.deleteMany({ entityType: REPORT, entityId })`. After commit: delete the photo file.

### POST .../reports/:reportId/process, /resolve, /reject
- **Request** paths (`ParseUUIDPipe`); body:
  - process, resolve: `ReportNoteDto { note?: string @IsOptional() @IsString() @Transform(trim) @MaxLength(1000) }`, example `{ "note": "Sudah dilaporkan ke PLN" }`.
  - reject: `RejectReportDto { note: string @IsString() @Transform(trim) @Length(5, 1000) }` (required, BR-51).
- **Response** `MessageResponse(ReportView, 'Report marked as in progress' | 'Report resolved' | 'Report rejected')`.
- **Errors**: `403` (member / admin); `404 | Report not found`; `400 | Invalid status change | transition not in PRD 6.4 or stale (BR-51)`; `400 | validation`.
- **Rules**: BR-51, BR-52. **Transaction: yes**: allowed-from per action (`process <- [PENDING]`, `resolve <- [PENDING, IN_PROGRESS]`, `reject <- [PENDING, IN_PROGRESS]`), `updateMany({ id, communityId, status: { in: allowedFrom } })` with target status, `responseNote` (only overwritten when a note is sent), `respondedById`, `respondedAt`; count 0 -> re-read for 404 vs 400; `REPORT_STATUS` notification to the reporter unless the reporter is the caller. One service method `changeStatus(target, ...)`. After commit: realtime to the reporter.

## 7. Module `sos-alerts` (`src/sos-alerts/`)

"Open" = `SENT`, `ACCEPTED`, `HANDLING`. Every state change below runs in one interactive transaction: conditional `sosAlert.updateMany` (the atomic guard) + `sosEvent.create` (BR-61) + notification (+ audit where listed); realtime and email after commit. Closing a SOS (RESOLVED, CANCELLED, FALSE_ALARM) sets `openKey = null`, `nextEscalationAt = null`, `closedAt = now`. Leaving SENT sets `nextEscalationAt = null` (escalation stops).

| Method | Path | Summary | Guard | Roles | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|---|
| POST | `/communities/:communityId/sos-alerts` | `[USER] Send an SOS` | Jwt, Roles, UserThrottle | USER | user 3/1m | 201 | F-SOS-1 / BR-53..56, 62, 64, 80 |
| GET | `/communities/:communityId/sos-alerts/me` | `[USER] List my SOS alerts` | Jwt, Roles | USER | global | 200 | F-SOS-9 / BR-31 |
| GET | `/communities/:communityId/sos-alerts` | `[USER] List SOS alerts of the community` | Jwt, Roles | USER | global | 200 | F-SOS-8 / BR-32 |
| GET | `/communities/:communityId/sos-alerts/:sosAlertId` | `[USER] Get an SOS alert with its history` | Jwt, Roles | USER | global | 200 | F-SOS-2, F-SOS-8 / BR-32, 33 |
| POST | `/communities/:communityId/sos-alerts/:sosAlertId/accept` | `[USER] Accept an SOS` | Jwt, Roles | USER | global | 200 | F-SOS-4 / BR-57, 58, 61, 71 |
| POST | `/communities/:communityId/sos-alerts/:sosAlertId/handle` | `[USER] Mark an SOS as being handled` | Jwt, Roles | USER | global | 200 | F-SOS-5 / BR-58, 61, 71 |
| POST | `/communities/:communityId/sos-alerts/:sosAlertId/resolve` | `[USER] Resolve an SOS` | Jwt, Roles | USER | global | 200 | F-SOS-5 / BR-58, 61, 71 |
| POST | `/communities/:communityId/sos-alerts/:sosAlertId/false-alarm` | `[USER] Mark an SOS as a false alarm` | Jwt, Roles | USER | global | 200 | F-SOS-6 / BR-60, 61, 71 |
| POST | `/communities/:communityId/sos-alerts/:sosAlertId/cancel` | `[USER] Cancel my SOS` | Jwt, Roles | USER | global | 200 | F-SOS-3 / BR-59, 61, 63 |
| (job) | `SosEscalationJob` every 15 s | - | - | - | - | - | F-SOS-7 / BR-63, 68 |

Route order: `sos-alerts/me` before `sos-alerts/:sosAlertId`.

### POST /communities/:communityId/sos-alerts
- **Request** body `CreateSosAlertDto`:

  | Field | Type | Validators | Example |
  |---|---|---|---|
  | `type` | enum | `@IsEnum(SosType)` | `"MEDICAL"` |
  | `note?` | string | `@IsOptional() @IsString() @Transform(trim) @MaxLength(280)` | `"Bapak pingsan"` |
  | `latitude?` | number | `@ValidateIf(o => o.longitude !== undefined) @IsLatitude()` | `-6.8722` |
  | `longitude?` | number | `@ValidateIf(o => o.latitude !== undefined) @IsLongitude()` | `107.5425` |
- **Response** `MessageResponse(SosView, 'SOS sent')`; `recipientCount` tells the frontend whether to highlight the 112 button (BR-62).
- **Errors**:

  | Status | Message | When |
  |---|---|---|
  | 403 | `You are not a member of this community` | BR-31 |
  | 409 | `You already have an active SOS` | open SOS by the caller here (BR-55, E-7) |
  | 429 | `Too many SOS alerts` | 3 SOS in the last 60 minutes, all communities (BR-56, C-5) |
  | 429 | `ThrottlerException: Too Many Requests` | per-user throttle |
  | 400 | validation | type / note / only one coordinate |
- **Rules**: BR-53..56, BR-62, BR-64. **Transaction: yes**: (1) lock the caller's user row (N-5), (2) count `sosAlert` with `senderId = me`, `createdAt >= now - 60 min` (>= 3 -> 429), (3) read membership `houseBlock`, (4) list ACTIVE admins except the caller -> `recipientCount`, (5) create with `openKey = communityId:senderId`, `nextEscalationAt = now + SOS_ESCALATION_SECONDS`; P2002 on `openKey` -> rethrow `ConflictException('You already have an active SOS')`, (6) `sosEvent.create(null -> SENT)`, (7) `notification.createMany(SOS_NEW)`. After commit: realtime `sos:new` to the recipients.

### GET /communities/:communityId/sos-alerts/me
- **Request** query `QueryMySosDto extends PaginationDto { status?: SosStatus @IsOptional() @IsEnum }`.
- **Response** `Paginated<SosView without history>` (`senderId = me`), newest first.
- **Errors**: `403 | You are not a member of this community`.

### GET /communities/:communityId/sos-alerts
- **Request** query `QuerySosDto extends PaginationDto`: `status?` (`@IsEnum(SosStatus)`), `type?` (`@IsEnum(SosType)`), `openOnly?` (`@IsOptional() @ToBoolean() @IsBoolean()`), `from?` / `to?` (`@IsOptional() @IsISO8601()`, `createdAt` range, `from <= to` else 400).
- **Response** `Paginated<SosView without history>`; open ones first, then newest first (`orderBy: [{ closedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }]`).
- **Errors**: `403` (member / admin); `400 | validation`.

### GET /communities/:communityId/sos-alerts/:sosAlertId
- **Response** plain `SosView` (with history).
- **Errors**: `403 | You are not a member of this community`; `404 | SOS alert not found | missing, other community, or caller is neither the sender nor an admin (BR-33)`.
- **Rules**: description "Sender or any ADMIN of the community (service check)". `sender.phone` is shown to admins only (null for the sender's own view).

### POST /communities/:communityId/sos-alerts/:sosAlertId/accept
- **Request** paths (`ParseUUIDPipe`), no body.
- **Response** `MessageResponse(SosView, 'SOS accepted')`.
- **Errors**: `403 | You are not a member of this community`; `403 | Admin access required`; `404 | SOS alert not found`; `403 | You cannot accept your own SOS` (BR-57); `400 | SOS already accepted` (not SENT, lost race E-2).
- **Rules**: BR-57, BR-58, BR-61, BR-71. **Transaction: yes**: (1) lock caller's membership: `membership.updateMany({ userId: me, communityId, status: ACTIVE, role: ADMIN }, { updatedAt })` (count 0 -> 403 'Admin access required'; this is what makes BR-82 race-safe, E-36), (2) `sosAlert.updateMany({ id, communityId, status: SENT, senderId: { not: me } }, { status: ACCEPTED, handlerId: me, acceptedAt, nextEscalationAt: null })` (count 0 -> re-read for 404 / 403 / 400), (3) event, (4) `SOS_ACCEPTED` to the sender, (5) audit `SOS_ACCEPTED`. After commit: realtime `sos:updated` to sender + admins.

### POST .../handle, POST .../resolve
- **Request** paths; body `SosNoteDto { note?: string @IsOptional() @IsString() @Transform(trim) @MaxLength(280) }`.
- **Response** `MessageResponse(SosView, 'SOS marked as handling' | 'SOS resolved')`.
- **Errors**: `403` (member / admin); `404 | SOS alert not found`; `403 | Only the handler can do this` (BR-58); `400 | Invalid SOS state` (handle needs ACCEPTED, resolve needs HANDLING).
- **Rules**: BR-58, BR-61, BR-71. Transaction: yes (lock caller membership as in accept, `updateMany({ id, communityId, handlerId: me, status: <from> })`, event, audit; resolve also sends `SOS_RESOLVED` to the sender and closes the SOS).

### POST .../false-alarm
- **Request** paths; body `SosNoteDto`.
- **Response** `MessageResponse(SosView, 'SOS marked as false alarm')`.
- **Errors**: `403` (member / admin); `404 | SOS alert not found`; `403 | You cannot mark your own SOS`; `403 | Only the handler can do this | ACCEPTED/HANDLING and caller not handler`; `400 | Invalid SOS state | closed`.
- **Rules**: BR-60, BR-61, BR-71. Transaction: yes; `updateMany` where `OR: [{ status: SENT, senderId: { not: me } }, { status: { in: [ACCEPTED, HANDLING] }, handlerId: me }]`; `SOS_RESOLVED` to the sender; audit `SOS_FALSE_ALARM`; closes the SOS.

### POST .../cancel
- **Request** paths, no body.
- **Response** `MessageResponse(SosView, 'SOS cancelled')`.
- **Errors**: `403 | You are not a member of this community`; `404 | SOS alert not found | missing, other community, or not the caller's SOS`; `400 | Invalid SOS state | already closed`.
- **Rules**: BR-59 (sender only, from SENT / ACCEPTED / HANDLING), BR-61, BR-63 (escalation stops). Transaction: yes; `updateMany({ id, communityId, senderId: me, status: { in: open } })`. No notification row (sender is the actor); realtime `sos:updated` to the handler + admins. Not audited (sender action, [PRD](PRD.md) BR-71 list). Description: "Only the sender (service check)".

### SosEscalationJob (no endpoint)
- Every 15 s (`@Interval`), batch of up to 50: `findMany({ status: SENT, nextEscalationAt: { lte: now }, escalationLevel: { lt: 3 } })`; per alert, claim with `updateMany({ id, status: SENT, escalationLevel: L }, { escalationLevel: L + 1, nextEscalationAt: L + 1 < 3 ? now + 120 s : null })`; only when count = 1: `notification.createMany(SOS_ESCALATED)` to current ACTIVE admins minus the sender, then realtime + email (BR-68). The loop over alerts is bounded (≤ 50) and each iteration is one claim + one `createMany`; email sending is fire-and-log. Restart-safe (BR-63, E-9).

## 8. Module `notifications` (`src/notifications/`)

| Method | Path | Summary | Guard | Roles | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|---|
| GET | `/notifications` | `[AUTH] List my notifications` | Jwt, Roles | - | global | 200 | F-NOTIFICATIONS-1 / BR-65, 66 |
| GET | `/notifications/unread-count` | `[AUTH] Count my unread notifications` | Jwt, Roles | - | global | 200 | F-NOTIFICATIONS-1 / BR-65 |
| POST | `/notifications/:notificationId/read` | `[AUTH] Mark a notification as read` | Jwt, Roles | - | global | 200 | F-NOTIFICATIONS-2 / BR-65 |
| POST | `/notifications/read-all` | `[AUTH] Mark all my notifications as read` | Jwt, Roles | - | global | 200 | F-NOTIFICATIONS-2 / BR-65 |
| POST | `/notifications/:notificationId/archive` | `[AUTH] Archive a notification` | Jwt, Roles | - | global | 200 | F-NOTIFICATIONS-3 / BR-65 |
| DELETE | `/notifications/:notificationId` | `[AUTH] Delete a notification` | Jwt, Roles | - | global | 200 | F-NOTIFICATIONS-3 / BR-65 |
| POST | `/socket-tickets` | `[USER] Get a short-lived socket ticket` | Jwt, Roles, UserThrottle | USER | user 10/1m | 201 | F-NOTIFICATIONS-7 / BR-77, 80 |
| WS | Socket.IO namespace `/realtime` | handshake `auth: { ticket }` | ticket (D-3) | - | ip 20/1m connects | - | F-NOTIFICATIONS-4 / BR-69, 77, 81 |

Route order: `read-all` and `unread-count` before `:notificationId`.

### GET /notifications
- **Request** query `QueryNotificationsDto extends PaginationDto`: `unread?` (`@IsOptional() @ToBoolean() @IsBoolean()`), `archived?` (`@IsOptional() @ToBoolean() @IsBoolean()`, default `false` = only not archived), `communityId?` (`@IsOptional() @IsUUID('4')`).
- **Response** `Paginated<NotificationView>`, newest first.
- **Errors**: `401`.

### GET /notifications/unread-count
- **Response** plain `{ count }` (not archived, `readAt` null).

### POST /notifications/:notificationId/read, /archive
- **Response** `MessageResponse(NotificationView, 'Notification marked as read' | 'Notification archived')`.
- **Errors**: `404 | Notification not found | missing or another user's (BR-65)`; `400 | Validation failed (uuid is expected)`.
- **Rules**: `updateMany({ id, userId: me }, { readAt: now })` (archive: `archivedAt: now`); count 0 -> 404. Idempotent: repeating keeps the first timestamp (`readAt: null` added to the where for read; on count 0 a second `findFirst({ id, userId })` decides 404 vs return).

### POST /notifications/read-all
- **Response** `MessageResponse({ updated: number }, 'All notifications marked as read')`.
- **Rules**: `updateMany({ userId: me, readAt: null }, { readAt: now })` only (BR-65).

### DELETE /notifications/:notificationId
- **Response** `MessageResponse(null, 'Notification deleted')`.
- **Errors**: `404 | Notification not found`.
- **Rules**: `deleteMany({ id, userId: me })`, count 0 -> 404.

### POST /socket-tickets
- **Response** `MessageResponse({ ticket, expiresAt }, 'Socket ticket issued')`.
- **Errors**: `401`; `403 | Forbidden resource | SUPER_ADMIN (no realtime for the operator in v1)`; `429`.
- **Rules**: BR-77: JWT signed with `SOCKET_TICKET_SECRET`, payload `{ purpose: 'socket', sub, tv, jti: randomUUID() }`, `expiresIn: SOCKET_TICKET_TTL_SECONDS`. No DB write.

### Socket.IO `/realtime` (F-NOTIFICATIONS-4)
- **Handshake** (`handleConnection`): reject unless `handshake.headers.origin` ∈ `SOCKET_ALLOWED_ORIGINS` (BR-81); IP = `X-Forwarded-For` entry `TRUST_PROXY_HOPS` from the right (D-2) for an in-memory connection limiter (20/min/IP); ticket only from `handshake.auth.ticket` (never query); verify signature + `purpose === 'socket'` + expiry; `jti` not in the in-memory used set (then add it until `exp`); then `JwtStrategy.validate({ sub, email: '', tv })` path, i.e. the same user checks as REST. Any failure: `client.disconnect(true)`. On success the socket joins room `user:<userId>` only (no community rooms, BR-69).
- **Server -> client events** (payloads are ids + the same views as REST, nothing else):

  | Event | Payload | Sent to |
  |---|---|---|
  | `notification:new` | `NotificationView` | the notification's user |
  | `sos:new` | `SosView` (no history) | recipients of BR-62 |
  | `sos:updated` | `SosView` (no history) | sender + current ACTIVE admins |
  | `sos:escalated` | `{ sosAlertId, communityId, escalationLevel }` | current ACTIVE admins minus sender |
  | `join-request:new` | `{ communityId, membershipId }` | current ACTIVE admins |
  | `session:revoked` | `{}` | all sockets of the user, then disconnect (BR-77) |
- **Client -> server events**: none in v1 (all actions are REST through the BFF).
- Recipient lists are computed from the database at send time and emitted to `user:<id>` rooms (BR-69).

## 9. Module `health` (`src/health/`)

| Method | Path | Summary | Guard | Roles | Throttle | Success | Feature / BR |
|---|---|---|---|---|---|---|---|
| GET | `/health` | `[PUBLIC] Check that the API and database are up` | - (`@SkipInternalKey()`) | - | ip 60/1m | 200 | F-HEALTH-1 / BR-78 |

- **Response** plain `{ status: 'ok' }`; on DB failure `503 | Service unavailable` (`ServiceUnavailableException`). Description: "No internal key required; used by the Railway health probe".
- **Rules**: `SELECT 1` via `$queryRaw`. Throttle tracker falls back to `req.ip` here because there is no trusted `X-Client-IP` (D-1 note).

## 10. Platform gate (F-PLATFORM-1, no own routes)

| Behaviour | Status / message | Rule |
|---|---|---|
| `X-Internal-Key` missing or wrong on any route except `/health` | `403 | Forbidden` | BR-78 |
| key valid, `X-Client-IP` missing or not an IP (`net.isIP`) | `400 | Invalid client IP` | BR-79 |
| key valid | `req.clientIp = X-Client-IP`, used by the `ip` throttler and `ipHash` | BR-79 |

Swagger `/docs` is registered only when `NODE_ENV !== 'production'` ([PRD](PRD.md) A-28).

## 11. Environment variables implied by this spec

Base (nest-common): `DATABASE_URL`, `PORT`, `NODE_ENV`, `FRONTEND_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `TRUST_PROXY_HOPS`. Auth/mail (skill rule 25): `OTP_SENDER`, `RESEND_API_KEY`, `MAIL_FROM`, `OTP_TTL_MINUTES`, `OTP_RESEND_COOLDOWN_SECONDS`. Project (`src/config/env.schema.ts` + `.env.example`):

| Variable | Joi | Read by |
|---|---|---|
| `INTERNAL_API_KEY` | `string().min(32).required()` | `InternalKeyGuard` |
| `SOCKET_ALLOWED_ORIGINS` | `string().allow('').default('')` | realtime gateway / Socket.IO adapter |
| `SOCKET_TICKET_SECRET` | `string().min(32).required()`, must differ from `JWT_SECRET` (checked at boot) | `SocketTicketService` |
| `SOCKET_TICKET_TTL_SECONDS` | `number().integer().min(5).max(120).default(30)` | `SocketTicketService` |
| `JOIN_TOKEN_SECRET` | `string().min(32).required()` | `join-token.ts` |
| `JOIN_TICKET_SECRET` | `string().min(32).required()` | `MembershipsService` |
| `IP_HASH_SECRET` | `string().min(32).required()` | `MembershipsService` |
| `PRIVACY_POLICY_VERSION` | `string().required()` | `AuthService.register` |
| `CLOUDINARY_URL` | `string().uri({ scheme: ['cloudinary'] }).required()` | upload service |
| `SOS_ESCALATION_SECONDS` | `number().integer().min(30).max(600).default(120)` | `SosAlertsService`, `SosEscalationJob` |

Seed-only (not in the boot schema): `SEED_SUPER_ADMIN_EMAIL`, `SEED_SUPER_ADMIN_PASSWORD`, `SEED_SUPER_ADMIN_NAME`, `SEED_DEMO`, `SEED_DEMO_PASSWORD`.

## 12. Access matrix

`allow` = guard and service let it through; `own` = only on own resource / as handler (service check); `deny` = 401 (PUBLIC) or 403. "USER" = logged in, `globalRole USER`, without an ACTIVE membership in the addressed community. All rows also require the BFF gate except `/health`.

| Endpoint | PUBLIC | SUPER | USER | WARGA | ADMIN | OWNER |
|---|---|---|---|---|---|---|
| POST auth/register, verify-otp, resend-otp, login, forgot-password, reset-password | allow | allow | allow | allow | allow | allow |
| GET auth/me, POST change-password, logout-all | deny | allow | allow | allow | allow | allow |
| PATCH auth/me, POST auth/me/delete | deny | deny | allow | allow | allow | own (delete blocked while owner) |
| POST community-applications, GET community-applications/me | deny | deny | allow | allow | allow | allow |
| GET community-applications, GET :applicationId, POST approve/reject, GET communities | deny | allow | deny | deny | deny | deny |
| GET communities/:communityId | deny | deny | deny | allow | allow | allow |
| GET join-qr | deny | deny | deny | deny | allow | allow |
| POST join-tickets, POST memberships, GET memberships/me | deny | deny | allow | allow | allow | allow |
| GET join-requests, POST approve/reject join | deny | deny | deny | deny | allow | allow |
| GET memberships (list members) | deny | deny | deny | deny | allow | allow |
| POST remove (WARGA target) | deny | deny | deny | deny | allow | allow |
| POST remove (ADMIN target) | deny | deny | deny | deny | deny | allow |
| POST promote, demote, transfer-ownership | deny | deny | deny | deny | deny | allow |
| POST leave | deny | deny | deny | allow | allow | deny (transfer first) |
| GET announcements, GET :announcementId | deny | deny | deny | allow | allow | allow |
| POST/PATCH/DELETE announcements | deny | deny | deny | deny | allow | allow |
| POST reports, GET reports/me | deny | deny | deny | allow | allow | allow |
| GET reports/:reportId | deny | deny | deny | own | allow | allow |
| PATCH/DELETE reports/:reportId | deny | deny | deny | own (PENDING) | own (PENDING) | own (PENDING) |
| GET reports (all), POST process / resolve / reject | deny | deny | deny | deny | allow | allow |
| POST sos-alerts, GET sos-alerts/me, POST cancel | deny | deny | deny | allow / own | allow / own | allow / own |
| GET sos-alerts/:sosAlertId | deny | deny | deny | own | allow | allow |
| GET sos-alerts (all), POST accept | deny | deny | deny | deny | allow (not own SOS) | allow (not own SOS) |
| POST handle, resolve | deny | deny | deny | deny | own (handler) | own (handler) |
| POST false-alarm | deny | deny | deny | deny | allow (SENT, not own) / own (handler) | same as ADMIN |
| notifications (list, count, read, read-all, archive, delete) | deny | own | own | own | own | own |
| POST socket-tickets, WS /realtime | deny | deny | allow | allow | allow | allow |
| GET health | allow | allow | allow | allow | allow | allow |

## 13. Coverage matrix

### 13.1 PRD feature -> endpoints (v1 only)

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
| F-USERS-3 | POST /auth/me/delete |
| F-COMMUNITIES-1 | POST /community-applications |
| F-COMMUNITIES-2 | GET /community-applications/me |
| F-COMMUNITIES-3 | GET /community-applications, GET /community-applications/:applicationId |
| F-COMMUNITIES-4 | POST /community-applications/:applicationId/approve |
| F-COMMUNITIES-5 | POST /community-applications/:applicationId/reject |
| F-COMMUNITIES-6 | GET /communities |
| F-COMMUNITIES-7 | GET /communities/:communityId |
| F-MEMBERSHIPS-1 | GET /communities/:communityId/join-qr |
| F-MEMBERSHIPS-2 | POST /join-tickets |
| F-MEMBERSHIPS-3 | POST /memberships |
| F-MEMBERSHIPS-4 | GET /communities/:communityId/join-requests |
| F-MEMBERSHIPS-5 | POST .../memberships/:membershipId/approve |
| F-MEMBERSHIPS-6 | POST .../memberships/:membershipId/reject |
| F-MEMBERSHIPS-7 | GET /memberships/me |
| F-MEMBERSHIPS-8 | POST /communities/:communityId/leave |
| F-MEMBERSHIPS-9 | POST .../memberships/:membershipId/remove |
| F-MEMBERSHIPS-10 | GET /communities/:communityId/memberships |
| F-MEMBERSHIPS-11 | POST .../promote, POST .../demote |
| F-MEMBERSHIPS-12 | MembershipExpiryJob |
| F-MEMBERSHIPS-13 | POST /communities/:communityId/transfer-ownership |
| F-ANNOUNCEMENTS-1..5 | POST, PATCH, DELETE, GET list, GET one under /communities/:communityId/announcements |
| F-REPORTS-1 | POST /communities/:communityId/reports |
| F-REPORTS-2 | GET .../reports/me |
| F-REPORTS-3 | GET .../reports/:reportId |
| F-REPORTS-4 | PATCH .../reports/:reportId |
| F-REPORTS-5 | DELETE .../reports/:reportId |
| F-REPORTS-6 | GET .../reports |
| F-REPORTS-7 | POST .../reports/:reportId/process, /resolve, /reject |
| F-SOS-1 | POST .../sos-alerts |
| F-SOS-2 | GET .../sos-alerts/:sosAlertId + realtime `sos:updated` |
| F-SOS-3 | POST .../cancel |
| F-SOS-4 | POST .../accept |
| F-SOS-5 | POST .../handle, POST .../resolve |
| F-SOS-6 | POST .../false-alarm |
| F-SOS-7 | SosEscalationJob |
| F-SOS-8 | GET .../sos-alerts, GET .../sos-alerts/:sosAlertId |
| F-SOS-9 | GET .../sos-alerts/me |
| F-NOTIFICATIONS-1 | GET /notifications, GET /notifications/unread-count |
| F-NOTIFICATIONS-2 | POST /notifications/:notificationId/read, POST /notifications/read-all |
| F-NOTIFICATIONS-3 | POST /notifications/:notificationId/archive, DELETE /notifications/:notificationId |
| F-NOTIFICATIONS-4 | WS /realtime |
| F-NOTIFICATIONS-6 | mail calls after commit in approve/reject (applications, joins) and SosEscalationJob |
| F-NOTIFICATIONS-7 | POST /socket-tickets |
| F-HEALTH-1 | GET /health |
| F-PLATFORM-1 | InternalKeyGuard on every route (section 10) |

Phase 2 features (F-USERS-2, F-EVENTS-*, F-SOS-10/11, F-NOTIFICATIONS-5, F-DASHBOARD-*) have no endpoints by design.

### 13.2 Endpoint -> feature

Every endpoint in sections 1-9 carries its feature id in the module table. **Orphan endpoints: none.** Orphan v1 features: none.

## 14. Test targets (feeds `nest-testing`)

Exception types per `nest-response-and-errors` rule 7. "no write" = assert the guarded write / create mock was not called.

| BR | Service method | Exception / assertion |
|---|---|---|
| BR-1 | `AuthService.register` | `ConflictException` on existing email; DTO trims + lowercases |
| BR-2 | DTO decorators | one `IsNewPassword` used by register, reset, change |
| BR-3 | `AuthService.login`, `JwtStrategy.validate` | `ForbiddenException('Email is not verified')` only after a correct password; `UnauthorizedException` from validate when unverified |
| BR-4 | `AuthService.register` | `create` data has `privacyConsentAt`, `privacyPolicyVersion`; DTO rejects `acceptPrivacyPolicy: false` |
| BR-5 | `AuthService.resetPassword/changePassword/logoutAll`, `UsersService.deleteAccount` | `tokenVersion: { increment: 1 }` in the same update |
| BR-6 | `UsersService.deleteAccount` | anonymised `data` exact; memberships `updateMany` -> LEFT; notifications `deleteMany` |
| BR-7 | `UsersService.deleteAccount` | `BadRequestException` when owner / open SOS; user update not called |
| BR-8 | `UsersService.deleteAccount` | `BadRequestException('Invalid password')`; `$transaction` not called |
| BR-9 | `normalisePhone` helper; `UsersService.updateProfile` | `08…`, `628…`, `+628…` -> `+628…`; invalid rejected by DTO |
| BR-11 | e2e + DTO | 400 for `globalRole`, `isActive`, `email` in PATCH /auth/me; register ignores nothing, rejects unknown |
| BR-12 | `buildRegionKey` helper | prefix/punctuation/space variants give the same key |
| BR-13 | `formatLabel` helper | `RT001/RW006` |
| BR-14 | `CommunitiesService.apply` | `ConflictException` ×3 cases; P2002 on `pendingRegionKey` mapped to `ConflictException`; create not called on the first two |
| BR-15 | DTO | length limits |
| BR-16 | `CommunitiesService.approve` | `NotFoundException`; `BadRequestException` (not pending / count 0, deleted applicant); `ConflictException` on region key; community/membership create not called on failures |
| BR-17 | `CommunitiesService.reject` | `BadRequestException` when not pending; notification created with reason |
| BR-18 | `generateJoinCode` helper | alphabet, length 6; retry on collision |
| BR-19 | `join-token.ts` | deterministic token/code for (communityId, w) |
| BR-20 | `MembershipsService.createJoinTicket` | `BadRequestException('Invalid or expired code')` for w-2, unknown community, unknown join code; accepts w and w-1 |
| BR-21 | `MembershipsService.requestJoin` | `BadRequestException('Invalid or expired join ticket')` for other `sub`, wrong purpose, expired |
| BR-22 | `MembershipsService.requestJoin` | `ConflictException('Too many pending join requests')`; upsert not called |
| BR-23 | `MembershipsService.requestJoin` | `ConflictException` from PENDING/ACTIVE; `BadRequestException` inside 3-day cooldown; allowed from LEFT/EXPIRED and after cooldown |
| BR-24 | `MembershipsService.requestJoin` | `ipHash` = HMAC of `req.clientIp`; raw IP never in `data` |
| BR-25 | `MembershipsService.approve/reject` | `BadRequestException` when `updateMany` count 0; notification + audit not called then |
| BR-26 | `MembershipsService.expireStale` | `updateMany` where `status PENDING`, `requestedAt < now-7d` |
| BR-27 | `leave`, `remove`, `demote`, `UsersService.deleteAccount` | owner: `BadRequestException` / `ForbiddenException`; no write |
| BR-28 | `MembershipsService.remove` | `ForbiddenException('Owner access required')` for ADMIN target by non-owner; `BadRequestException` for self |
| BR-29 | `MembershipsService.promote/demote` | `ForbiddenException` non-owner; `BadRequestException` wrong state |
| BR-30 | `leave`, `remove` | `data` sets `role: WARGA` |
| BR-31 | `community-access.helper.assertMember` | `ForbiddenException('You are not a member of this community')` for no row, PENDING, LEFT, other community |
| BR-32 | `assertAdmin`, `assertOwner` | `ForbiddenException('Admin access required' / 'Owner access required')` |
| BR-33 | every `findOne` / action with `communityId` in `where` | `NotFoundException` for an id of another community |
| BR-34 | e2e | SUPER_ADMIN gets 403 on every `[USER]` community route; super endpoints' selects contain no personal fields of members |
| BR-35 | DTO | lengths |
| BR-36 | `AnnouncementsService.create/update` | clears other highlight before setting; P2002 mapped to 409 |
| BR-37 | `AnnouncementsService.create` | `notification.createMany` once, author excluded |
| BR-38 | `AnnouncementsService.remove` | `notification.deleteMany` with entity filter in the same tx; `NotFoundException` |
| BR-39 | `AnnouncementsService.findAll` | `orderBy` highlight first |
| BR-48 | `ReportsService.create`, file filter | `BadRequestException` for wrong MIME; size limit 5 MB |
| BR-49 | `ReportsService.findOne` | `NotFoundException` for another member's report |
| BR-50 | `ReportsService.update/remove` | `BadRequestException('Only pending reports can be changed')`; new upload deleted on failure |
| BR-51 | `ReportsService.changeStatus` | `BadRequestException('Invalid status change')` for RESOLVED->*, REJECTED->*, IN_PROGRESS->IN_PROGRESS; `RejectReportDto` requires a note |
| BR-52 | `ReportsService.create/changeStatus` | notifications to admins minus reporter / to reporter unless self |
| BR-53 | DTO | one coordinate only -> 400 |
| BR-54 | `SosAlertsService.send` | `houseBlockSnapshot` from membership |
| BR-55 | `SosAlertsService.send` | P2002 on `openKey` -> `ConflictException('You already have an active SOS')` |
| BR-56 | `SosAlertsService.send` | `HttpException` 429 when count ≥ 3; create not called |
| BR-57 | `SosAlertsService.accept` | `ForbiddenException` own SOS; `BadRequestException('SOS already accepted')` when count 0 |
| BR-58 | `handle`, `resolve` | `ForbiddenException('Only the handler can do this')`; `ForbiddenException('Admin access required')` when membership lock count 0 |
| BR-59 | `SosAlertsService.cancel` | `NotFoundException` not own; `BadRequestException` closed; allowed from HANDLING |
| BR-60 | `SosAlertsService.markFalseAlarm` | SENT by non-sender admin ok; ACCEPTED by non-handler -> `ForbiddenException` |
| BR-61 | every SOS transition | `sosEvent.create` with from/to/actor in the same tx |
| BR-62 | `SosAlertsService.send` | `recipientCount` excludes sender; 0 allowed |
| BR-63 | `SosEscalationJob.run` | claim `updateMany` with `escalationLevel: L`; notifications only when count 1; stops at 3; no claim when status not SENT |
| BR-64 | - | no preference check exists in v1 (assert nothing filters SOS recipients) |
| BR-65 | `NotificationsService.*` | `NotFoundException` for another user's id; `markAllRead` where has `userId` |
| BR-66 | enum | v1 types only |
| BR-68 | approve/reject/escalation | mail called after commit; mail rejection logged, no throw |
| BR-69 | `RealtimeService.emitToUsers` | emits only to `user:<id>` rooms from a DB-computed list |
| BR-70 | upload service | `publicId` stored; failed delete logged |
| BR-71 | each audited method | `auditLog.create` in the same tx with actor, community, action, target |
| BR-73 | `findPossibleDuplicates` (pure) | same district+city or village containment; max 10; excludes self |
| BR-74 | `MembershipsService.transferOwnership` | `BadRequestException` wrong password / target not ACTIVE ADMIN / self / lost race (count 0); `ForbiddenException` non-owner; community update not called on failures |
| BR-77 | `SocketTicketService.verify`, gateway | reject wrong purpose, expired, reused `jti`, old `tv`, ticket in query |
| BR-78 | `InternalKeyGuard` | `ForbiddenException` missing / wrong / different-length key; `/health` exempt |
| BR-79 | `InternalKeyGuard` | `BadRequestException('Invalid client IP')`; `req.clientIp` set |
| BR-80 | throttler trackers | `ip` uses `req.clientIp`; `email` uses normalised body email; `UserThrottleGuard` uses `req.user.id` |
| BR-81 | `clientIpFromXff` helper, gateway | picks entry `hops` from the right; forged left entries ignored; bad Origin disconnected |
| BR-82 | `remove`, `demote`, `leave`, `deleteAccount` | `BadRequestException` when the target handles an open SOS; status update rolled back (tx throws) |

e2e (required, [PRD](PRD.md) 8.2): route-guard meta-test (skill), tenant isolation (admin of A on every community route of B -> 403/404), WARGA on every admin route -> 403, PENDING member on every member route -> 403, BFF gate (no key -> 403, forged `X-Client-IP` without key -> 403).

## 15. Gaps in PRD

| # | Gap | Proposed handling (not implemented until you decide) |
|---|---|---|
| G-1 | Account deletion while the user has a PENDING community application: [PRD](PRD.md) BR-6 does not say what happens to it | Leave it PENDING; approve then fails with 400 'Applicant account no longer exists' (BR-16), super admin rejects it. Or auto-reject in BR-6. |
| G-2 | No way to withdraw a PENDING join request or community application | Not specified; users wait for decision / 7-day expiry. Add `POST /memberships/:id/withdraw` later if wanted. |
| G-3 | The **sender** of an open SOS may leave the community (BR-82 only blocks the handler) and then cannot cancel it (BR-31) | Spec allows it (description on `leave`). Alternative: also block leave for the sender. |
| G-4 | Super admin is not notified of new community applications (no notification type) | Super admin polls the list. |
| G-5 | Notification `title` / `body` texts (Indonesian) are not defined | Implementation writes them per type in one template map; review in the plan. |
| G-6 | [PRD](PRD.md) BR-36 "clears others in the same transaction" still allows a P2002 race between two parallel highlights | Spec answers 409 to the loser (E-6). |

## 16. Questions for you

| # | Question |
|---|---|
| Q-A | `GET /auth/me` returns `name`, `phone` and names the role `globalRole` (C-2), beyond the skill's field list. OK? |
| Q-B | G-3: may the sender of an open SOS leave the community? (spec: yes) |
| Q-C | G-1: auto-reject a PENDING community application when the applicant deletes the account? (spec: no) |

## 17. Self-check

| # | Constraint | Result |
|---|---|---|
| 1 | Every route has a guard decision; prefix derived (`[PUBLIC]` / `[AUTH]` / exact `@Roles`) | **pass**: 9 public-or-auth auth routes, `[AUTH]` for me/change-password/logout-all/notifications, `[USER]` for every `@Roles('USER')`, `[SUPER_ADMIN]` for super routes, `/health` `[PUBLIC]`. Membership/owner/handler checks are in descriptions, not prefixes. WS gateway uses the socket ticket (D-3) and is not a REST handler. |
| 2 | kebab-case plural under `/api`, nested, `POST :id/<verb>` 200, `/auth/me` | **pass** with one documented exception: `POST /communities/:communityId/transfer-ownership` and `/leave` are actions on the community (verb on the parent `:communityId`), `POST /join-tickets` and `/socket-tickets` create short-lived resources (201). Profile under `/auth/me` (C-4). |
| 3 | Every list has pagination + declared filters; every `:id` has a pipe | **pass**: all list DTOs extend `PaginationDto`; all path ids `ParseUUIDPipe`; query booleans use `ToBoolean`. |
| 4 | Throttles per skill rule 10, plus mail/code/login-like endpoints | **pass**: auth table values (5 / 3) on ip, extra email keys (D-4); join-tickets, memberships, sos-alerts, socket-tickets, report upload, account delete, transfer-ownership, and every mail-sending approve/reject have handler-level throttles; none at class level. |
| 5 | Auth endpoints from the skill table, only what the [PRD](PRD.md) enables | **pass**: register, verify-otp, resend-otp, login, forgot/reset, me, change-password, logout-all. No refresh, no Google. |
| 6 | No body accepts `role`, `isActive`, `tokenVersion` or privileged fields | **pass**: no DTO has `globalRole`, `role`, `isOwner`, `status`, `isActive`, `tokenVersion`, `communityId` (path only), `handlerId`, `reporterId`, `ownerId`. Status changes are separate verb endpoints. Transfer takes a `membershipId` and checks it server side. |
| 7 | No endpoint reveals whether an account exists | **pass**: auth per skill (register 409 is the skill's documented exception); join-ticket errors identical for unknown community / code; community routes answer 403 for unknown and non-member alike; notifications 404 for others' ids. |

