# PRD: SIGAP, multi-tenant RT/RW community platform

Status: APPROVED, **rev 5.2 (Lite)**, for a web-developer competition build of 1-2 days. Source: `breakdown-fitur-lengkap-multi-tenant.md` + decisions below. Full v1 (rev 4) is archived in `docs/archive/full-v1/PRD.md`; Lite rev 5 in `docs/archive/lite-rev5/PRD.md`; Lite rev 5.1 in `docs/archive/lite-rev5.1/PRD.md`.
Conventions (envelope, guards, DTOs, Prisma, tests, git) are owned by the skills in `.claude/skills`; this PRD only describes WHAT the product does. Where Lite knowingly departs from a skill, the departure is listed in 8.13 (only L-5 remains).

**Scope markers:** **[PHASE 2]** = specified in the archive, not built in Lite. **[DIBUANG di Lite]** = removed, will not come back in this form. **[STRETCH]** = optional, not part of the definition of done. The API spec, data model and implementation plan cover only unmarked items.

### Revisions 2-4
Deployment hardening, regions as free text, scope cut for 5 days. Details in `docs/archive/full-v1/PRD.md`.

### Revision 5 (Lite)

| # | Change | Where |
|---|---|---|
| R-16 | Communities are created directly by any user (no application, no super admin, no review); the creator becomes ACTIVE ADMIN | F-COMMUNITIES-1, BR-14..16, 2, 6.2 |
| R-17 | One app-wide role only; permissions come from `Membership.role` (`ADMIN` \| `WARGA`). No owner, no transfer; "at least one ADMIN" instead | 2, BR-27..29, F-MEMBERSHIPS-11 |
| R-18 | Join = scan dynamic QR -> `POST /memberships { communityId, token, houseBlock }` creates PENDING in one step. No join ticket, no manual code, no join code, no cooldown, no 3-PENDING limit, no IP hash | F-MEMBERSHIPS-1..3, BR-18..24 |
| R-19 | No BFF gate, no client-IP header, no socket ticket. Throttle = standard per-IP `@nestjs/throttler`. Socket.IO uses the JWT in `handshake.auth.token` | 8.4, 8.6, 8.11, 8.13, BR-77..81 |
| R-20 | No `tokenVersion`, no change-password, no logout-all, no account deletion, no privacy consent field | F-AUTH-6/7, F-USERS-3, BR-4..8, 8.13 L-1 |
| R-21 | No uploads (report is JSON only), no audit log, no SOS history, no SOS hourly limit, no expiry job | BR-26, 48, 56, 61, 70, 71 |
| R-22 | Race safety = conditional `updateMany` only | 8.2, [DATA_MODEL](DATA_MODEL.md) N-4 |
| R-23 | Email: OTP (required) and `SOS_NEW` to recipient admins (fire-and-log); `JOIN_APPROVED` email optional. Transport changed to Resend in R-27 | F-NOTIFICATIONS-6, BR-68, 8.7 |
| R-24 | Notifications simplified: list, unread count, read, read-all; 9 types | F-NOTIFICATIONS-1..3, BR-65, BR-66 |
| R-25 | SOS escalation reduced to one level and moved to **[STRETCH]** | F-SOS-7, BR-63 |
| R-26 | Seed with verified demo accounts and content; no super admin | 8.14, A-32 |

### Revision 5.1 (Lite)

| # | Change | Where |
|---|---|---|
| R-27 | Mail via the Resend HTTPS API (`fetch`, no SDK) behind the `OtpSender` port; Railway Hobby blocks outbound SMTP. Env `MAIL_PROVIDER`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | 0, 8.7, 8.12, L-3, BR-68, A-33, E-38 |
| R-28 | Throttle values from env: `THROTTLE_TTL`, `THROTTLE_LIMIT`, `AUTH_THROTTLE_LIMIT` (shared venue Wi-Fi) | BR-80, 8.4, 8.12 |
| R-29 | F-MEMBERSHIPS-2 back in Lite as "Preview a scanned QR" (`POST /memberships/preview`, read-only); join stays one step, no join ticket | 0.1, 2.2, 4.4, 11, BR-20, BR-80, E-11 |
| R-30 | Manual fallback is the full `qrContent` string with a copy button, pasted into the join screen | F-MEMBERSHIPS-1, A-3 |
| R-31 | Notification and email texts defined (5.9.1); SOS email carries no GPS, note or phone | 5.9.1, BR-68, 8.7 |
| R-32 | [GAPS](GAPS.md) G-L12, G-L13 added; G-L6, G-L9 updated | `docs/GAPS.md` |

### Revision 5.2 (Lite, after SPEC_AUDIT)

| # | Change | Where |
|---|---|---|
| R-33 | Skill auth restored: `User.globalRole`, `isActive`, `tokenVersion`; JWT `{ sub, email, tv }`; change-password and logout-all back in Lite; reset/change/logout-all end every session. L-1, L-2 removed | 0, 0.1, F-AUTH-6/7, BR-5, 2.1, 8.1, 8.13, E-39 |
| R-34 | Community-admin routes are labelled `[AUTH]` (no `@Roles`), the admin check is named in the Swagger `description`; the route-guard meta-test is used unchanged. L-4 removed | 2.2, 8.13, [API_SPEC](API_SPEC.md) 0.1 |
| R-35 | Mail follows the skill: `OTP_SENDER` port + adapters, env `OTP_SENDER` (default `resend`), `RESEND_API_KEY`, `MAIL_FROM`; SOS email through a separate `SosMailer` in `src/common/mail/`. L-3 removed. `JOIN_APPROVED` email dropped (in-app + realtime only) | 8.7, 8.12, BR-68, F-NOTIFICATIONS-6, F-MEMBERSHIPS-5 |
| R-36 | Throttle defaults = skill rule 10 (auth 5, send-code 3), plus env-tunable join (10) and SOS (5) tiers; `THROTTLE_TTL` seconds converted to ms. Deviation L-5 (tiers instead of literal `@Throttle` numbers) | BR-80, 8.4, 8.12 |
| R-37 | SOS: `handle` only from ACCEPTED, `resolve` only from HANDLING (HANDLING stays mandatory); re-read order 404 -> 403 -> 400 | 6.5, BR-58, [API_SPEC](API_SPEC.md) 7 |
| R-38 | Socket.IO reuses `JwtStrategy.validate` and takes CORS from `FRONTEND_URL` (skill recipe); `SOCKET_ALLOWED_ORIGINS` removed. New `APP_URL` for links in emails | BR-77, BR-81, 8.6, 8.12 |
| R-39 | BR-12 normalisation per field and per leading word (no more "Kelapa Gading" -> "apagading"; "Kota X" and "Kab. X" stay different) | BR-12, [DATA_MODEL](DATA_MODEL.md) N-7 |
| R-40 | The last ADMIN cannot leave and the community cannot be deleted (decision, [GAPS](GAPS.md) G-L14) | BR-27, E-19 |
| R-41 | Smaller fixes: BR-9 digit count, BR-11 exceptions, BR-23 conditional reuse (E-8), BR-51 note rule, BR-83/BR-84 added, verified badge dropped, SC-2 measured manually, seed admin email from env | 1, 4, 5, 8.14 |

## 0. Recorded decisions

| Decision | Value | Source |
|---|---|---|
| ID type | `uuid` | user |
| Database | PostgreSQL | user |
| Login | Email + password; email verification by OTP is required before login | user |
| Refresh tokens | No | rev 2 |
| Token revocation | `User.tokenVersion` as in `nest-auth-and-security` rules 1-2: +1 on password reset, password change, logout-all and deactivation | rev 5.2 (R-33) |
| App-wide role | `User.globalRole` (`GlobalRole`: `ADMIN`, `USER`, default `USER`); every self-registered account is `USER`; `ADMIN` is reserved, no Lite endpoint uses `@Roles` | rev 5.2 (R-33) |
| Account disabling | `User.isActive` (default `true`); no admin endpoint in Lite, a developer sets it in the database together with `tokenVersion + 1` | rev 5.2 (R-33) |
| Google login | No | breakdown |
| Deployment | Frontend (Next.js) on Vercel, NestJS API on Railway, no Cloudflare, one replica. Browser calls the API directly with the bearer token | rev 5 |
| Reverse proxy hops | `TRUST_PROXY_HOPS=1` (Railway edge), verify after deploy | rev 2 |
| Throttle | `@nestjs/throttler`, in memory, per IP (`req.ip` with `trust proxy`); defaults = skill rule 10, every limit tunable from env for the venue (R-28, R-36) | rev 5.2 |
| Soft delete | None (no account deletion in Lite) | rev 5 |
| Roles | `User.globalRole` (always `USER` in Lite) + per-community `Membership.role` (`references/per-resource-roles.md` naming) | rev 5.2 |
| File upload | None | rev 5 |
| Realtime | Socket.IO, namespace `/realtime`, JWT in `handshake.auth.token`, same `JwtStrategy.validate` as HTTP, CORS from `FRONTEND_URL` (R-38) | rev 5.2 |
| Email | Skill `OTP_SENDER` port (Resend HTTP API via `fetch`, console adapter only when chosen explicitly and never in production) + `SosMailer` for the SOS email (R-35) | rev 5.2 |
| Payment / webhook | No | breakdown |
| Regions | Free text (province, city/regency, district, village), normalised for duplicate checks | rev 3 |
| Community nickname | Optional `name` field | user |
| Language | UI and notification texts in Indonesian; API messages in English (skill rule) | user |
| Lite scope | See 0.1 | rev 5 |

## 0.1 Lite scope

| In Lite | [PHASE 2] / [DIBUANG di Lite] |
|---|---|
| auth: register, verify-otp, resend-otp, login, forgot/reset password, change-password, logout-all, token revocation (`tokenVersion`), `GET /auth/me`, `PATCH /auth/me` | admin deactivation endpoint, account deletion, profile photo (P2); privacy consent (dibuang) |
| communities: create directly (creator = ADMIN), my communities, community card | community applications, super-admin review, duplicate candidates, community list for super admin, super admin itself (P2) |
| memberships: join QR, preview a scanned QR, join request via QR token, queue, approve/reject, member list, change role, remove, leave | join ticket, join code + manual code, cooldown, 3-PENDING limit, IP hash, expiry job, owner + transfer, community deletion (P2) |
| announcements: create, edit, delete, list, detail, one highlight | images (P2) |
| reports: create (JSON), own list, admin list, detail, edit/delete while PENDING, process/resolve/reject | photo upload (P2) |
| SOS: send, own list, admin list, detail, accept, handle, resolve, false alarm, cancel, realtime, email to admins | SOS history, hourly limit, take-over/release (P2); escalation = **[STRETCH]** |
| notifications: list, unread count, read, read-all, realtime | archive/delete, web push, socket ticket (P2) |
| health | BFF gate, audit log, dashboard, events (P2) |

---

## 1. Overview

### Problem
RT/RW neighbourhoods coordinate through WhatsApp groups: official announcements get buried, complaints have no status, and emergencies depend on someone reading the chat. There is no way to know who in a group really lives in the neighbourhood.

### Target users
- **Residents (warga)** of an RT/RW who want official information, a place to report problems and a reliable emergency button.
- **RT/RW officials (ketua, sekretaris)** who run the community: approve who joins, publish announcements, handle reports and respond to SOS.

### Product shape
One platform, many communities. One community = one RT/RW pair in one village. An account is global and can be a member of several communities. Any user can create a community and becomes its first admin. A resident joins by scanning a rotating QR code shown by an admin, then an admin approves the request. No family card (KK) is collected.

### Success criteria (measurable)

| # | Criterion | Target |
|---|---|---|
| SC-2 | SOS delivered (realtime) to every connected admin of the community | under 5 s, checked manually in the demo rehearsal (2 browsers, stopwatch on `sos:new`); not an automated test |
| SC-4 | Cross-tenant access (admin of A reads data of B) in the automated test suite | 0 passing attempts |

---

## 2. Roles and permissions

### 2.1 Role layers

| Layer | Enum (Prisma) | Values | Lives on | Checked by |
|---|---|---|---|---|
| App-wide | `GlobalRole` | `ADMIN`, `USER` (every Lite account is `USER`) | `User.globalRole` | `JwtAuthGuard` + `RolesGuard`; no Lite route uses `@Roles` |
| Per community | `MembershipRole` | `ADMIN`, `WARGA` | `Membership.role` | service (`community-access.helper.ts`: `assertMember`, `assertAdmin`) |

Naming follows `nest-auth-and-security` rule 5 for a project with both an app-wide and a per-resource role (`globalRole` / `GlobalRole`, `references/per-resource-roles.md`). A disabled account (`isActive = false`) or an old token (`tokenVersion` changed) gets 401 on the next request.

A membership counts only when its status is `ACTIVE`.

| Actor | Definition |
|---|---|
| PUBLIC | not logged in |
| USER | logged in, email verified |
| MEMBER | USER with an `ACTIVE` membership in the community being accessed (any role) |
| C-ADMIN | MEMBER whose membership role is `ADMIN` |
| REPORTER / HANDLER | MEMBER who created the report / SOS, or the admin who accepted the SOS |

### 2.2 Capability matrix

Legend: **A** = any logged-in user (`JwtAuthGuard`), **O** = membership / ownership check in the service, `-` = denied. Every route is labelled `[PUBLIC]` or `[AUTH]` (no `@Roles` in Lite); the community-admin check is named in the Swagger `description` (R-34).

| Capability | PUBLIC | USER (no / PENDING membership) | MEMBER (WARGA) | C-ADMIN |
|---|---|---|---|---|
| Register, verify email, login, forgot / reset password | yes | yes (public routes) | yes (public routes) | yes (public routes) |
| Read / edit own profile (`/auth/me`), change password, log out everywhere | - | A | A | A |
| Create a community | - | A | A | A |
| List my communities and membership status | - | A | A | A |
| Preview a scanned QR and join via QR token | - | A | A (other communities) | A (other communities) |
| View community card | - | - | O | O |
| View current join QR | - | - | - | O |
| List / approve / reject join requests | - | - | - | O |
| List members | - | - | - | O |
| Change a member's role | - | - | - | O (not the last ADMIN) |
| Remove a member | - | - | - | O (not self, not the last ADMIN) |
| Leave a community | - | - | O | O (not the last ADMIN, G-L14) |
| Read announcements | - | - | O | O |
| Create / edit / delete announcements | - | - | - | O |
| Create report, read own reports | - | - | O | O |
| Edit / delete own report (PENDING only) | - | - | O (REPORTER) | O (REPORTER) |
| Read all reports, change report status | - | - | - | O |
| Send SOS, cancel own SOS, read own SOS | - | - | O | O |
| Read all SOS of the community, accept SOS | - | - | - | O (not own SOS) |
| Move accepted SOS forward (handling / resolved / false alarm) | - | - | - | O (HANDLER) |
| Mark a waiting SOS as false alarm | - | - | - | O (not own SOS) |
| Own notifications, realtime connection | - | A | A | A |
| Health check | yes | yes | yes | yes |

A membership in another community never grants access (BR-31).

---

## 3. Glossary

| Term | Meaning |
|---|---|
| Community (komunitas) | One RT + RW pair in one village (kelurahan/desa). The tenant. |
| Region | Four free-text fields: province, city/regency, district (kecamatan), village (kelurahan/desa). |
| Normalised region text | The region text lowercased, punctuation and whitespace removed and common prefixes dropped (BR-12). Used only for duplicate checks. |
| Region key | `rt` + `rw` + normalised village + district + city + province; at most one community per key. |
| Label | Display name `RT001/RW006`, followed by the village name; the optional `name` is shown next to it. |
| Membership (keanggotaan) | Link between a user and a community: status, community role, house block/number. |
| Blok rumah | House block/number of the member in that community (`Blok C2 No. 14`). Stored on the membership. |
| Join QR | QR code shown on an admin screen; it encodes the community id and a token that changes every 60 s. |
| Token window | 60-second time slot number `w` used to compute the join token. |
| Join request | A membership in status `PENDING`. |
| Announcement (pengumuman) | Official post by an admin. One can be highlighted. |
| Report (laporan) | Complaint by a member, visible to the reporter and the community admins. |
| SOS | Emergency alert from a member to all admins of the community. |
| Handler (penanggung jawab) | The admin who accepted an SOS. |

Status enum values are English UPPER_SNAKE in code; the UI shows Indonesian labels:

| Entity | Enum value -> UI label |
|---|---|
| Membership | `PENDING` menunggu, `ACTIVE` aktif, `REJECTED` ditolak, `LEFT` keluar, `REMOVED` dikeluarkan |
| Report | `PENDING` menunggu, `IN_PROGRESS` diproses, `RESOLVED` selesai, `REJECTED` ditolak |
| SOS | `SENT` dikirim, `ACCEPTED` diterima, `HANDLING` ditangani, `RESOLVED` selesai, `CANCELLED` dibatalkan, `FALSE_ALARM` salah alarm |

---

## 4. Features

Format: **ID** (breakdown ref) - goal. *Actor.* Acceptance criteria (Given / When / Then). Business rules are in section 5. IDs are kept from the full v1 so cross-references stay stable; removed ones are listed with their marker only.

### 4.1 Module `auth`

**F-AUTH-1** (AUT-01) Register an account. *PUBLIC.*
- Given a new email, a name and a password of at least 8 characters, when I register, then an unverified account is created and a 6-digit verification code is emailed.
- Given an email that is already registered, when I register, then I get 409 and the existing account is unchanged.

**F-AUTH-2** (AUT-01) Verify my email with the OTP and resend it. *PUBLIC.*
- Given a valid unused code, when I submit it, then the account becomes verified and I receive an access token.
- Given a wrong, expired or used code, or more than 5 attempts, when I submit it, then I get 400 and the account stays unverified.
- Given any email, when I ask to resend, then the answer is always the same 200 message, whether the email exists, is verified, or is inside the 60 s cooldown.

**F-AUTH-3** (AUT-02, adapted to password) Log in. *PUBLIC.*
- Given a verified, active account and the right password, when I log in, then I get an access token.
- Given an unknown email or a wrong password, then I get 401 with the same message in both cases.
- Given the right password on a disabled account, then I get 403 'Account is disabled'; on an unverified account, 403 'Email is not verified' (status only after the password, BR-3).

**F-AUTH-4** Forgot and reset password. *PUBLIC.*
- Given any email, when I ask for a reset, then the answer is the same 200 message; a code is emailed only if an active account exists.
- Given a valid reset code and a new password, when I reset, then the password changes, every existing session ends (old tokens get 401, BR-5) and I am not logged in.

**F-AUTH-5** See my own account. *USER.*
- Given I am logged in, when I open my account, then I see id, email, name, phone, global role, verification time and creation time, and never the password hash or token version (BR-83).

**F-AUTH-6** (R-33) Change password. *USER.*
- Given my current password and a new password that meets the policy, when I change it, then it is stored, every other session ends and I receive a fresh access token.
- Given a wrong current password, then I get 400 'Current password is incorrect' and nothing changes.

**F-AUTH-7** (R-33) Log out of all devices. *USER.*
- When I log out everywhere, then every access token of my account (including the one I used) gets 401 from the next request on, and open sockets are disconnected (BR-77).

### 4.2 Module `users`

**F-USERS-1** (AUT-04) Edit my profile. *USER.*
- Given a name of 2-100 characters and an optional phone number, when I save, then the profile is updated and the phone is stored in `+62` form.
- Given a body with `email`, `globalRole`, `isActive` or any unknown field, then I get 400 and nothing changes.

**F-USERS-2** **[PHASE 2]** Profile photo.

**F-USERS-3** **[PHASE 2]** Delete my account.

### 4.3 Module `communities`

**F-COMMUNITIES-1** (KOM-01, KOM-02, R-16) Create a community. *USER.*
- Given RT and RW as whole numbers 1-999, province, city/regency, district and village as free text (2-100 characters each), an optional name and my house block, when I create the community, then it exists at once and I am its ACTIVE ADMIN.
- Given a community already exists with the same region key (after normalisation, so "Kel. Suka Maju" equals "sukamaju"), then I get 409 with a message telling me to join with its QR code, and nothing is created.

**F-COMMUNITIES-2** (R-16) List my communities. *USER.*
- When I list my communities, then I see every community where I have a membership with its label, region, my status, role and house block, ACTIVE and PENDING first, optionally filtered by my membership status.

**F-COMMUNITIES-3** **[PHASE 2]** List and open community applications (super admin).

**F-COMMUNITIES-4** **[PHASE 2]** Approve an application.

**F-COMMUNITIES-5** **[PHASE 2]** Reject an application.

**F-COMMUNITIES-6** **[PHASE 2]** List communities with statistics (super admin).

**F-COMMUNITIES-7** (KOM-03) See the community card. *MEMBER.*
- Given I am an ACTIVE member, when I open the community, then I see its label (`RT001/RW006`), name, village, district, city, province, the number of ACTIVE members and my own membership (role, house block).
- Given I am not an ACTIVE member, then I get 403.

### 4.4 Module `memberships`

**F-MEMBERSHIPS-1** (JON-01) Show the join QR. *C-ADMIN.*
- Given I am an admin of the community, when I open the join screen, then I get the QR content (`sigap:join:<communityId>:<token>`), the token and window on their own, and the seconds left in the current 60 s window.
- The manual fallback is the full `qrContent` string shown under the QR with a copy button; the join screen accepts that pasted string, the frontend parses the community id and token and calls the preview (F-MEMBERSHIPS-2). A token alone is not enough.
- Given I am a WARGA or not a member, then I get 403.

**F-MEMBERSHIPS-2** (JON-02, JON-03, R-29) Preview a scanned QR. *USER.*
- Given a community id and token valid for the current or previous window, when I preview, then I see the community card (label, name, region) and my current membership status in it (or none), and nothing is written.
- Given an unknown community or a wrong or older token, then I get 400 'Invalid or expired code' (BR-20).
- The join itself stays one step (F-MEMBERSHIPS-3); there is no join ticket (BR-21 stays **[DIBUANG di Lite]**).

**F-MEMBERSHIPS-3** (JON-03, JON-04, R-18) Submit a join request from a scanned QR. *USER.*
- Given a community id and token valid for the current or previous window, and a house block of 1-50 characters, when I submit, then my membership becomes PENDING and every ACTIVE admin of the community gets a `JOIN_REQUEST` notification.
- Given an unknown community or a wrong or older token, then I get the same 400 'Invalid or expired code'.
- Given I am already PENDING or ACTIVE in that community, then I get 409 and nothing changes (also for a double submit: exactly one request wins, the other gets 409, BR-23).
- Given I was REJECTED, LEFT or REMOVED before, then the same membership row goes back to PENDING.

**F-MEMBERSHIPS-4** (JON-05) Join request queue. *C-ADMIN.*
- Given PENDING requests exist, when I open the queue, then I see name, email, house block and request time, oldest first, searchable by name or house block, paginated. (Every requester is verified, BR-3, so no verified badge is shown.)

**F-MEMBERSHIPS-5** (JON-06) Approve a join request. *C-ADMIN.*
- Given a PENDING request in my community, when I approve it, then it becomes ACTIVE as WARGA and the user gets `JOIN_APPROVED` (in-app and realtime; no email, R-35).
- Given it is no longer PENDING (another admin decided first), then I get 400.

**F-MEMBERSHIPS-6** (JON-06) Reject a join request. *C-ADMIN.*
- Given a PENDING request, when I reject it, then it becomes REJECTED and the user gets `JOIN_REJECTED` (in-app, realtime). The user may request again at any time.

**F-MEMBERSHIPS-7** (JON-07) See my memberships: served by F-COMMUNITIES-2 (one list). A PENDING membership keeps community features locked (403) until it is ACTIVE.

**F-MEMBERSHIPS-8** (JON-08) Leave a community. *MEMBER.*
- Given I am ACTIVE and not the last ADMIN, when I leave, then my membership becomes LEFT, my role is reset to WARGA and I lose access immediately.
- Given I am the last ACTIVE ADMIN, then I get 400 'Promote another admin first'. This also holds when I am the only member: the community cannot be left without an admin and cannot be deleted in Lite ([GAPS](GAPS.md) G-L14). I can still create or join other communities.

**F-MEMBERSHIPS-9** (JON-09) Remove a member. *C-ADMIN.*
- Given an ACTIVE member who is not me and not the last ACTIVE ADMIN, when I remove them, then the membership becomes REMOVED with role WARGA.
- Given I target myself, the last ADMIN, or a member who is not ACTIVE, then I get 400.

**F-MEMBERSHIPS-10** (WRG-01) List members. *C-ADMIN.*
- When I list members, then I see name, house block, phone, role and join date, with search by name or block and a filter by status and role, paginated.

**F-MEMBERSHIPS-11** (KOM-04, R-17) Change a member's role. *C-ADMIN.*
- Given an ACTIVE member, when I set their role to ADMIN or WARGA, then it is stored.
- Given the change would leave the community without an ACTIVE ADMIN, then I get 400. Given the member is not ACTIVE, then I get 400.

**F-MEMBERSHIPS-12** **[PHASE 2]** Expire stale join requests.

**F-MEMBERSHIPS-13** **[PHASE 2]** Transfer ownership (owner concept removed in Lite).

### 4.5 Module `announcements`

**F-ANNOUNCEMENTS-1** (ANN-01, ANN-04) Publish an announcement. *C-ADMIN.*
- Given a valid title and body, when I publish, then it is visible to members and every ACTIVE member except me gets an `ANNOUNCEMENT` notification.
- Given I mark it as highlight, then it becomes the only highlighted announcement of the community.

**F-ANNOUNCEMENTS-2** (ANN-02) Edit an announcement. *C-ADMIN.*
- Given an announcement of my community, when I edit title, body or highlight, then it is updated with the same highlight rule.
- Given an announcement of another community, then I get 404.

**F-ANNOUNCEMENTS-3** (ANN-02) Delete an announcement. *C-ADMIN.*
- When I delete it, then it and its notifications are removed.

**F-ANNOUNCEMENTS-4** (ANN-03) List announcements. *MEMBER.*
- When I list, then the highlighted one comes first, then newest first, paginated, with search by title.

**F-ANNOUNCEMENTS-5** (ANN-03) Read an announcement. *MEMBER.*
- When I open one of my community, then I see title, body, highlight flag, author name and dates.

### 4.6 Module `events` **[PHASE 2]**

### 4.7 Module `reports`

**F-REPORTS-1** (RPT-01, RPT-05) Submit a report. *MEMBER.*
- Given title, description and category, when I submit, then a PENDING report is created, visible only to me and the community admins, and every ACTIVE admin except me gets `REPORT_NEW`.

**F-REPORTS-2** (RPT-02) See my reports. *MEMBER.*
- When I list my reports, then I see each with status, the latest admin response (BR-51) and dates, filterable by status, paginated.

**F-REPORTS-3** (RPT-02, RPT-03) Report detail. *REPORTER or C-ADMIN.*
- Given I am the reporter or an admin of the community, when I open it, then I see all its data. Admins also see the reporter's name and house block.
- Given I am another member, then I get 404.

**F-REPORTS-4** (RPT-06) Edit my report. *REPORTER.*
- Given my report is PENDING, when I edit title, description or category, then it is updated. Given it is not PENDING, then I get 400.

**F-REPORTS-5** (RPT-06) Delete my report. *REPORTER.*
- Given my report is PENDING, when I delete it, then it and its notifications are removed. Given it is not PENDING, then I get 400.

**F-REPORTS-6** (RPT-03) All reports of the community. *C-ADMIN.*
- When I list, then I can filter by category and status and search by title, paginated, newest first.

**F-REPORTS-7** (RPT-04, RPT-05) Change report status. *C-ADMIN.*
- Given an allowed transition and, for REJECTED, a response note, when I change the status, then it is stored with my note and the reporter gets `REPORT_STATUS`.
- Given a transition not in the table of section 6.4, then I get 400.

### 4.8 Module `sos-alerts`

**F-SOS-1** (SOS-01, SOS-02) Send an SOS. *MEMBER (admins included).*
- Given type, optional note and optional GPS, when I send, then an SOS is created as SENT with my house block copied in, and every ACTIVE admin of the community except me gets `SOS_NEW` in-app, in realtime and by email (email failures do not affect the SOS).
- Given I already have an open SOS in this community, then I get 409.

**F-SOS-2** (SOS-05) Follow my SOS. *Sender.*
- When my SOS changes status, then I get it in realtime with the handler's name, and I can open it to see its current state and timestamps.

**F-SOS-3** Cancel my SOS. *Sender.*
- Given my SOS is SENT, ACCEPTED or HANDLING, when I cancel it, then it becomes CANCELLED and the handler (if any) and the admins see that in realtime. Otherwise I get 400.

**F-SOS-4** (SOS-04) Accept an SOS. *C-ADMIN, not the sender.*
- Given a SENT SOS, when I accept it, then I become the handler, it becomes ACCEPTED, the sender gets `SOS_ACCEPTED` and other admins see who accepted.
- Given another admin accepted first, then I get 400. Given I am the sender, then I get 403.

**F-SOS-5** (SOS-04) Mark as handling and resolve. *HANDLER.*
- Given I am the handler, when I move ACCEPTED -> HANDLING (`handle`) or HANDLING -> RESOLVED (`resolve`) with an optional note, then it is stored; on RESOLVED the sender gets `SOS_RESOLVED`. HANDLING is mandatory: `resolve` on an ACCEPTED alert is 400.
- Given the alert does not exist in this community, then 404; given I am not the handler, then 403; given the wrong current state, then 400 (checked in that order, BR-58).

**F-SOS-6** (SOS-04, SOS-08) Mark as false alarm. *C-ADMIN (SENT, not own) or HANDLER (ACCEPTED/HANDLING).*
- Given an allowed state, when I mark it, then it becomes FALSE_ALARM with my note and the sender gets `SOS_RESOLVED`.

**F-SOS-7** (SOS-06) **[STRETCH]** Escalate an unanswered SOS once.
- Given an SOS still SENT 120 s after it was sent and not escalated yet, then the job claims it once and all ACTIVE admins (minus the sender) get `SOS_NEW` again in-app, in realtime and by email.

**F-SOS-8** (SOS-03, SOS-09) SOS screen and list for admins. *C-ADMIN.*
- When I open an SOS of my community, then I see sender name, phone, house block, type, note, time, GPS, handler and the state timestamps.
- When I list, then I can filter by status and type, or show only open alerts, paginated; open ones first, then newest first.

**F-SOS-9** (SOS-09) My SOS list. *MEMBER.*
- When I list my SOS, then I see my own alerts in this community, paginated.

**F-SOS-10** **[PHASE 2]** Take over an SOS. **F-SOS-11** **[PHASE 2]** Release an SOS.

SOS-07 (112 call button + disclaimer) and the alarm sound are frontend-only.

### 4.9 Module `notifications`

**F-NOTIFICATIONS-1** (NTF-01) List my notifications. *USER.*
- When I list, then I see my own notifications newest first, filterable by unread and by community, paginated; a separate call gives the unread count.

**F-NOTIFICATIONS-2** (NTF-01) Mark read. *Owner of the notification.*
- When I mark one as read, then its read time is set. When I mark all as read, then all of mine are set and nobody else's. Another user's id gives 404.

**F-NOTIFICATIONS-3** **[PHASE 2]** Archive or delete.

**F-NOTIFICATIONS-4** (NTF-02) Realtime connection. *USER.*
- Given a valid access token in the handshake `auth.token` and an allowed origin, when I connect, then I receive my notifications and the SOS / join events meant for me.
- Given a missing, invalid or expired token, a token whose `tokenVersion` is old, a disabled or unverified account, or a token in the URL, then the socket is disconnected.

**F-NOTIFICATIONS-5** **[PHASE 2]** Web push. **F-NOTIFICATIONS-7** **[PHASE 2]** Socket ticket.

**F-NOTIFICATIONS-6** (NTF-04) Email for important events. *System.*
- Given an OTP is issued, then it is emailed. Given an SOS is sent, then every recipient admin gets an email. No other email exists in Lite (`JOIN_APPROVED` is in-app and realtime only, R-35). A failed send never undoes the action.

### 4.10 Module `dashboard` **[PHASE 2]**

### 4.11 Module `health`

**F-HEALTH-1** (PLT-09) Health check. *PUBLIC.*
- Given the database answers, then the check returns 200 `ok`. Given it does not, then it returns 503 (BR-84).

### 4.12 **[PHASE 2]** BFF gate (F-PLATFORM-1)

---

## 5. Business rules

Each rule is one unit-test target. "Open SOS" = status `SENT`, `ACCEPTED` or `HANDLING`.

### 5.1 Accounts (auth, users)

| ID | Rule |
|---|---|
| BR-1 | Email is trimmed and lowercased and is unique across all users. |
| BR-2 | One password policy for register, reset and change, as defined by `nest-auth-and-security` rule 20 (`IsNewPassword`: 8-128 characters). Login and "current password" use `IsCurrentPassword` (no minimum). |
| BR-3 | An account without a verified email, or with `isActive = false`, cannot log in or use any authenticated endpoint. Login checks the password first, then the status (403 'Account is disabled', then 403 'Email is not verified'). |
| BR-4 | **[DIBUANG di Lite]** Privacy consent stored at registration. |
| BR-5 | Token revocation (`nest-auth-and-security` rules 1-2): the JWT carries `tv = User.tokenVersion`; `JwtStrategy.validate` rejects a token whose `tv` differs (401). `tokenVersion` +1 in the same write as a password reset, a password change, logout-all and deactivation. Change-password returns a fresh token for the caller. |
| BR-6 | **[PHASE 2]** Account deletion and anonymisation. |
| BR-7 | **[PHASE 2]** Deletion refused while owner / SOS open. |
| BR-8 | **[PHASE 2]** Deletion needs the current password. |
| BR-9 | Name is 2-100 characters. Phone is optional; Indonesian mobile formats (`08...`, `628...`, `+628...`) are normalised to `+628...`. After normalisation the number has 11-14 digits after the `+` (`+62` + `8` + 8-11 more digits): `081234567` (9 digits) is 400, `0812345678` -> `+62812345678` (11) is valid, `081234567890123` (15 digits) is 400. Anything else is 400. |
| BR-10 | **[PHASE 2]** Profile photo. |
| BR-11 | No endpoint accepts `email` (profile), `emailVerifiedAt`, `globalRole`, `isActive`, `tokenVersion`, membership `status`, `handlerId`, `reporterId` or any other privileged field from a body; unknown fields give 400. Two named exceptions: membership `role` in `PATCH .../memberships/:membershipId/role` (it is the action, admin-only, G-L7) and `communityId` in `POST /memberships/preview` and `POST /memberships` (the scanned QR target, validated against the token, G-L6). |

### 5.2 Communities

| ID | Rule |
|---|---|
| BR-12 | RT and RW are integers 1-999. Province, city/regency, district and village are free text, 2-100 characters each, stored as typed (trimmed). The city must start with the word `Kota`, `Kabupaten` or `Kab` followed by a name ("Kota Cimahi", "Kab. Bandung"); otherwise 400 'City must start with Kota or Kabupaten' (the frontend offers a Kota / Kabupaten select). Each field is normalised for comparison by the pure helper `normaliseRegionPart(field, text)`, in this order: (1) lowercase; (2) replace every character that is not a letter, digit or space with a space ("Kel." -> "kel "); (3) collapse spaces and trim; (4) if the **first whole word** is in that field's prefix list **and** more words follow, handle it: province `provinsi`, `prov` -> dropped; district `kecamatan`, `kec` -> dropped; village `kelurahan`, `kel`, `desa`, `ds` -> dropped; city `kota` -> marker `kota:`, `kabupaten` / `kab` -> marker `kab:` (kept, so Kota Bogor and Kabupaten Bogor are different communities); (5) remove the remaining spaces. Examples: "Kel. Suka Maju" = "sukamaju" -> `sukamaju`; "Kelapa Gading" -> `kelapagading` ("kelapa" is not a prefix); "Kotabaru" -> `kotabaru`; "Kec. Cimahi Tengah" -> `cimahitengah`; "Kota Bogor" -> `kota:bogor`; "Kab. Bogor" = "Kabupaten Bogor" -> `kab:bogor`. Region key = (`rt`, `rw`, normalised village, district, city, province); at most one community per region key. |
| BR-13 | Label = `RT` + rt padded to 3 digits + `/RW` + rw padded to 3 digits (`RT001/RW006`). Computed, never sent by a client. |
| BR-14 | Creating a community with an existing region key is refused with 409 'Community already registered, join with its QR code' (also when two creates race: unique index). |
| BR-15 | Community fields: optional name 3-100, creator house block 1-50. |
| BR-16 | Creating a community is one transaction: the community and the creator's membership (ACTIVE, ADMIN, `requestedAt = joinedAt = decidedAt = now`) are created together. |
| BR-17 | **[PHASE 2]** Application rejection. |
| BR-18 | **[PHASE 2]** Community join code. |

### 5.3 Joining and memberships

| ID | Rule |
|---|---|
| BR-19 | Time window `w = floor(unixSeconds / 60)`. QR token = base64url(HMAC-SHA256(`JOIN_TOKEN_SECRET`, `"qr:" + communityId + ":" + w`)), first 22 characters. The QR content is `sigap:join:<communityId>:<token>`. No table stores tokens. (Manual 8-digit code: **[PHASE 2]**.) |
| BR-20 | A token is valid only for window `w` or `w - 1` of the community named in the request, compared with `timingSafeEqual`. An unknown community id and a wrong or older token give the same 400 'Invalid or expired code'. The same helper validates both the preview (F-MEMBERSHIPS-2) and the join request (F-MEMBERSHIPS-3). |
| BR-21 | **[DIBUANG di Lite]** Join ticket. |
| BR-22 | **[PHASE 2]** Limit of 3 PENDING requests. |
| BR-23 | One membership row per (user, community). A new request reuses the row: allowed from no row, REJECTED, LEFT or REMOVED (no cooldown in Lite); refused from PENDING or ACTIVE (409). The request sets PENDING, role WARGA, the new house block, `requestedAt = now`, clears `decidedAt` and `joinedAt`. Reuse is a conditional `updateMany({ userId, communityId, status: { in: [REJECTED, LEFT, REMOVED] } })`; a new row is a `create` (unique index). Count 0 or P2002 -> 409, and only the winner inserts `JOIN_REQUEST` notifications, so a double submit gives exactly one PENDING row and one set of notifications (E-8). |
| BR-24 | The join request stores the house block (1-50 characters, required) and `requestedAt`. (IP hash: **[PHASE 2]**.) |
| BR-25 | Approve and reject work only on PENDING (conditional update; a lost race is 400 'Join request is no longer pending') and set `decidedAt`. Approve sets ACTIVE, role `WARGA`, `joinedAt = now`. |
| BR-26 | **[PHASE 2]** Expiry of PENDING requests after 7 days. |
| BR-27 | Every community keeps at least one ACTIVE ADMIN. Demoting, removing or leaving that would leave none is refused with 400 ('Promote another admin first' for leave, 'A community needs at least one admin' for role change / remove). This applies even when the last admin is the only member; Lite has no community deletion (decision rev 5.2, [GAPS](GAPS.md) G-L14). |
| BR-28 | An admin may remove any ACTIVE member except themselves (400, use leave) and except the last ADMIN (BR-27). Removal sets REMOVED, role WARGA, `decidedAt = now`. |
| BR-29 | An admin may set the role of an ACTIVE member to ADMIN or WARGA, including their own, subject to BR-27. A non-ACTIVE member is 400. |
| BR-30 | LEFT and REMOVED reset role to `WARGA`. Access stops on the next request because every community call re-reads the membership. |

### 5.4 Tenant isolation

| ID | Rule |
|---|---|
| BR-31 | Every community-scoped call requires an ACTIVE membership of the caller in that community; otherwise 403 'You are not a member of this community'. An unknown community gives the same 403. |
| BR-32 | Admin-only community calls additionally require role `ADMIN` on that membership (403 'Admin access required'). |
| BR-33 | A resource id that exists in another community is answered as 404, exactly like a missing id. |
| BR-34 | **[PHASE 2]** Super admin data limits. |

### 5.5 Announcements

| ID | Rule |
|---|---|
| BR-35 | Title 3-150, body 1-5000 characters. |
| BR-36 | At most one highlighted announcement per community: setting `isHighlight = true` first clears it on all others of the same community, in the same `$transaction`. |
| BR-37 | Publishing creates one `ANNOUNCEMENT` notification per ACTIVE member except the author, with one bulk insert in the same transaction as the announcement. Editing does not notify again. |
| BR-38 | Deleting an announcement deletes its notifications in the same transaction. |
| BR-39 | List order: highlighted first, then `createdAt` descending. |

### 5.6 Events **[PHASE 2]** (BR-40..47)

### 5.7 Reports

| ID | Rule |
|---|---|
| BR-48 | Title 3-150, description 10-5000, category one of `INFRASTRUCTURE`, `SECURITY`, `CLEANLINESS`, `SOCIAL`, `OTHER`. JSON only, no photo in Lite. |
| BR-49 | Every report is private: visible only to its reporter and the ADMINs of its community. Any other member gets 404. |
| BR-50 | The reporter may edit or delete only while PENDING (conditional write; 400 otherwise). Deleting removes its notifications in the same transaction. |
| BR-51 | Status changes follow the table in 6.4 only, as a conditional update on the current status (a stale transition is 400). REJECTED needs a response note of 5-1000 characters; other notes are optional (max 1000). Every status change overwrites `responseNote` with the note sent, or sets it to `null` when none is sent, and sets `respondedById` and `respondedAt`; so "latest admin response" = the note of the latest status change (possibly empty). |
| BR-52 | A new report notifies every ACTIVE admin except the reporter (`REPORT_NEW`); a status change notifies the reporter (`REPORT_STATUS`) unless the reporter made the change. |

### 5.8 SOS

| ID | Rule |
|---|---|
| BR-53 | Type is `MEDICAL`, `FIRE`, `CRIME` or `OTHER`; note up to 280 characters; GPS optional, latitude -90..90 and longitude -180..180, both or neither. |
| BR-54 | The sender's house block is copied from the membership at creation and never changes afterwards. |
| BR-55 | At most one open SOS per (sender, community): checked with `findFirst` before create (409 'You already have an active SOS'). |
| BR-56 | **[PHASE 2]** 3 SOS per hour limit (Lite relies on the throttle, 8.4). |
| BR-57 | Accept works only from SENT, as a conditional update on `status = SENT`; exactly one admin wins and becomes the handler; the others get 400 'SOS already accepted'. The sender can never accept their own SOS (403). |
| BR-58 | Only the current handler moves an SOS forward, each action from exactly one state: `handle` ACCEPTED -> HANDLING, `resolve` HANDLING -> RESOLVED (HANDLING is mandatory; ACCEPTED -> RESOLVED is 400). The handler must still be an ACTIVE ADMIN (BR-32). On a refused update the alert is re-read and the error is chosen in this order: not found in this community -> 404; caller is not the handler -> 403 'Only the handler can do this'; wrong current state -> 400 'Invalid SOS state'. |
| BR-59 | Only the sender cancels, from SENT, ACCEPTED or HANDLING (400 from a closed status). |
| BR-60 | FALSE_ALARM: from SENT by any admin who is not the sender; from ACCEPTED or HANDLING by the handler only. |
| BR-61 | **[PHASE 2]** SOS history entries. Lite keeps state timestamps (`acceptedAt`, `handlingAt`, `closedAt`) on the alert. |
| BR-62 | Recipients are the ACTIVE admins of the community at send time, minus the sender. The response states how many admins were alerted; 0 is allowed (the frontend then highlights the 112 button). |
| BR-63 | **[STRETCH]** One-level escalation: an SOS still SENT 120 s after creation with `escalatedAt` null is claimed by `updateMany({ id, status: SENT, escalatedAt: null })`; only when the count is 1, the recipients of BR-62 (recomputed) get `SOS_NEW` again in-app, in realtime and by email. |
| BR-64 | SOS notifications ignore any mute or preference setting (none exist in Lite). |

### 5.9 Notifications and email

| ID | Rule |
|---|---|
| BR-65 | A user only lists or marks their own notifications; any other id is 404. Mark-all-read touches only the caller's rows. |
| BR-66 | Notification types: `JOIN_REQUEST`, `JOIN_APPROVED`, `JOIN_REJECTED`, `ANNOUNCEMENT`, `REPORT_NEW`, `REPORT_STATUS`, `SOS_NEW`, `SOS_ACCEPTED`, `SOS_RESOLVED`. |
| BR-67 | **[PHASE 2]** Push subscriptions. |
| BR-68 | Email is sent for OTP codes (required) and `SOS_NEW` (every recipient admin); no other email exists in Lite (`JOIN_APPROVED` is in-app + realtime only). OTP mail goes through the skill's `OTP_SENDER` port; a failed OTP send is logged without code or address and the endpoint answers as usual (skill rule 23). The SOS mail goes through `SosMailer` after the commit, fire-and-log: a failure is logged without the address or content and never rolls back or fails the request. The SOS email contains only the sender's name, house block, SOS type, community label and the app link (`APP_URL`): **no GPS, no free-text note, no phone number** (5.9.1). |
| BR-69 | Realtime events go only to users computed from the database at send time, emitted to `user:<id>` rooms after the commit, so a removed member stops receiving community events. |
| BR-70 | **[PHASE 2]** Uploads. |
| BR-71 | **[PHASE 2]** Audit log. |
| BR-72 | **[PHASE 2]** Dashboard. |

### 5.9.1 Texts (R-31)

All texts are Indonesian and built by one pure function in `src/notifications/notification-templates.ts` (unit-tested). Placeholders: `{userName}`, `{houseBlock}`, `{label}` (`RT001/RW006`), `{title}` (cut to 100 characters), `{typeLabel}`, `{handlerName}`, `{statusLabel}`.

| Type | Recipient | Title | Body | entityType |
|---|---|---|---|---|
| `JOIN_REQUEST` | ACTIVE ADMINs | Permintaan bergabung baru | {userName} ({houseBlock}) ingin bergabung ke {label}. | MEMBERSHIP |
| `JOIN_APPROVED` | requester | Permintaan disetujui | Kamu sekarang menjadi anggota {label}. | MEMBERSHIP |
| `JOIN_REJECTED` | requester | Permintaan ditolak | Permintaan bergabung ke {label} ditolak oleh pengurus. | MEMBERSHIP |
| `ANNOUNCEMENT` | ACTIVE members except the author | Pengumuman baru | {title} | ANNOUNCEMENT |
| `REPORT_NEW` | ACTIVE ADMINs except the reporter | Laporan warga baru | {userName}: {title} | REPORT |
| `REPORT_STATUS` | reporter | Status laporan diperbarui | Laporan "{title}" kini {statusLabel}. | REPORT |
| `SOS_NEW` | ACTIVE ADMINs except the sender | SOS {typeLabel}! | {userName} ({houseBlock}) membutuhkan bantuan di {label}. | SOS_ALERT |
| `SOS_ACCEPTED` | sender | SOS diterima | {handlerName} menerima SOS kamu dan akan membantu. | SOS_ALERT |
| `SOS_RESOLVED` | sender | SOS ditutup | "SOS kamu telah diselesaikan." or, for a false alarm, "SOS kamu ditandai sebagai salah alarm." | SOS_ALERT |

Labels: `{typeLabel}`: MEDICAL Medis, FIRE Kebakaran, CRIME Kriminal, OTHER Lainnya. `{statusLabel}`: IN_PROGRESS diproses, RESOLVED selesai, REJECTED ditolak.

Emails (plain text + minimal HTML, no images, built by pure functions with the same pattern):

| Email | Subject | Content |
|---|---|---|
| OTP verification | Kode verifikasi SIGAP | the code, valid for {OTP_TTL_MINUTES} minutes, warning not to share it |
| OTP reset | Kode reset password SIGAP | same |
| `SOS_NEW` | [SOS {typeLabel}] {label} | "{userName} ({houseBlock}) mengirim SOS {typeLabel} di {label}. Buka SIGAP untuk menanggapi: {APP_URL}". No GPS, no note, no phone number (BR-68) |

No `JOIN_APPROVED` email in Lite (R-35).

### 5.10 Other rules

| ID | Rule |
|---|---|
| BR-73 | **[PHASE 2]** Duplicate candidates for super admin. |
| BR-74 | **[PHASE 2]** Ownership transfer. |
| BR-75 | **[PHASE 2]** SOS release. |
| BR-76 | **[PHASE 2]** SOS take-over. |
| BR-77 | Socket.IO (`references/websocket-auth.md`): the access token is read only from `handshake.auth.token`, verified with `JwtService.verifyAsync`, then passed to the same `JwtStrategy.validate` as HTTP (user exists, `isActive`, `emailVerifiedAt`, `tokenVersion`); any failure -> `disconnect(true)`. Each socket joins only `user:<userId>`. When `tokenVersion` is bumped (reset, change-password, logout-all), the user's open sockets are disconnected. (Socket ticket: **[PHASE 2]**.) |
| BR-78 | **[PHASE 2]** BFF internal key. |
| BR-79 | **[PHASE 2]** Client IP header. |
| BR-80 | Throttle per IP (`req.ip` with `trust proxy = TRUST_PROXY_HOPS`), handler level, never class level. Window `THROTTLE_TTL` seconds (default 60), passed to the throttler as `THROTTLE_TTL * 1000` ms. Named throttlers, each limit from env with the skill rule 10 value as default: `default` = `THROTTLE_LIMIT` (100) for every route; `auth` = `AUTH_THROTTLE_LIMIT` (5) on register, login, verify-otp, forgot-password, reset-password, change-password; `sendCode` = `SEND_CODE_THROTTLE_LIMIT` (3) on resend-otp; `join` = `JOIN_THROTTLE_LIMIT` (10) on `POST /memberships/preview` and `POST /memberships`; `sos` = `SOS_THROTTLE_LIMIT` (5) on SOS send. The venue raises them in `.env` only (deviation L-5). |
| BR-81 | Socket.IO CORS allows only the origins in `FRONTEND_URL` (same list as REST, through the recipe's `FrontendCorsIoAdapter`; empty = refuse all). |
| BR-82 | **[DIBUANG di Lite]** Handler protection (no owner / release in Lite; a demoted handler simply loses the right to move the SOS, BR-58, [GAPS](GAPS.md) G-L1). |
| BR-83 | Profile responses (`GET /auth/me`, `PATCH /auth/me`) use one explicit `profileSelect`: `id, email, name, phone, globalRole, emailVerifiedAt, createdAt`. `passwordHash`, `tokenVersion`, `isActive` and OTP hashes never leave the service (skill rule 17). |
| BR-84 | `GET /health` runs `SELECT 1`; success -> 200 `{ status: 'ok' }`; any database error -> 503 'Service unavailable', with the error logged and not returned. |

---

## 6. State machines

### 6.1 Membership

```
 (no row) ──request──► PENDING ──approve──► ACTIVE ──leave──► LEFT
     ▲                    │                   │
     │                    └─reject──► REJECTED └──remove──► REMOVED
     │
     └── REJECTED / LEFT / REMOVED: request again at once (same row back to PENDING)
```

| From | To | Trigger | Who | Side effects |
|---|---|---|---|---|
| none / REJECTED / LEFT / REMOVED | PENDING | join request with valid token | USER | house block, `requestedAt`; `JOIN_REQUEST` to admins (BR-23, BR-24) |
| PENDING | ACTIVE | approve | C-ADMIN | role WARGA, `joinedAt`, `decidedAt`; `JOIN_APPROVED` in-app + realtime (no email) |
| PENDING | REJECTED | reject | C-ADMIN | `decidedAt`; `JOIN_REJECTED` in-app + realtime |
| ACTIVE | LEFT | leave | the member (not the last ADMIN, even when alone, G-L14) | role reset (BR-27, BR-30) |
| ACTIVE | REMOVED | remove | C-ADMIN (not self, not last ADMIN) | role reset, `decidedAt` (BR-28) |
| ACTIVE | ACTIVE (role change) | change role | C-ADMIN | BR-27, BR-29 |
| (none) | ACTIVE ADMIN | create community | USER | BR-16 |

Invalid transitions answer 400 (409 for a request while PENDING/ACTIVE, BR-23).

### 6.2 Community application **[PHASE 2]**

### 6.3 Event **[PHASE 2]**

### 6.4 Report

```
PENDING ──► IN_PROGRESS ──► RESOLVED
   │             └────────► REJECTED
   ├────────────────────────► RESOLVED
   └────────────────────────► REJECTED
```

| From | To | Who | Side effects |
|---|---|---|---|
| PENDING | IN_PROGRESS | C-ADMIN | optional note; `REPORT_STATUS` |
| PENDING | RESOLVED | C-ADMIN | optional note; `REPORT_STATUS` |
| PENDING | REJECTED | C-ADMIN | note required; `REPORT_STATUS` |
| IN_PROGRESS | RESOLVED | C-ADMIN | optional note; `REPORT_STATUS` |
| IN_PROGRESS | REJECTED | C-ADMIN | note required; `REPORT_STATUS` |

RESOLVED and REJECTED are final (400 on any change). The reporter edits/deletes only in PENDING.

### 6.5 SOS alert

```
SENT ──accept──► ACCEPTED ──handle──► HANDLING ──resolve──► RESOLVED
 │                 │                     │
 ├─ false alarm ───┼─ false alarm ───────┼─ false alarm ──► FALSE_ALARM
 │  (admin)        │  (handler)          │  (handler)
 │                 │                     │
 └─ cancel ────────┴─ cancel ────────────┴─ cancel ──► CANCELLED
    (sender)          (sender)              (sender)
```

| From | To | Who | Side effects |
|---|---|---|---|
| (new) | SENT | MEMBER | `SOS_NEW` in-app + realtime + email to admins (BR-62, BR-68) |
| SENT | ACCEPTED | C-ADMIN, not sender, first wins | handler set, `acceptedAt`; `SOS_ACCEPTED` to sender; realtime |
| SENT | CANCELLED | sender | realtime to admins |
| SENT | FALSE_ALARM | C-ADMIN, not sender | `SOS_RESOLVED` to sender; realtime |
| ACCEPTED | HANDLING | handler (`handle`, only from ACCEPTED) | `handlingAt`; realtime |
| ACCEPTED | CANCELLED | sender | realtime |
| ACCEPTED | FALSE_ALARM | handler | `SOS_RESOLVED` to sender |
| HANDLING | RESOLVED | handler (`resolve`, only from HANDLING) | `SOS_RESOLVED` to sender; realtime |
| HANDLING | CANCELLED | sender | realtime |
| HANDLING | FALSE_ALARM | handler | `SOS_RESOLVED` to sender |

Closed states (RESOLVED, CANCELLED, FALSE_ALARM) set `closedAt` and are final. Any other transition is 400, including ACCEPTED -> RESOLVED (HANDLING is mandatory). Error order on a refused change: 404 (not in this community) -> 403 (wrong actor) -> 400 (wrong state), BR-58.

---

## 7. Entities (conceptual)

| Entity | Purpose | Key attributes | Relations | Delete behaviour |
|---|---|---|---|---|
| User | Global account | email (unique), passwordHash, name, phone?, globalRole, isActive, emailVerifiedAt?, tokenVersion | 1-N OtpCode, Membership, content, Notification | Never deleted in Lite |
| OtpCode | Email verification and password reset codes | purpose, codeHash, attempts, expiresAt, usedAt? | N-1 User | Cascade with User |
| Community | Tenant = one RT/RW | rt, rw, province, city, district, village (text), regionKey (unique), name? | 1-N Membership and all tenant content | Not deletable in Lite; children Cascade |
| Membership | User in a community | status, role, houseBlock, requestedAt, decidedAt?, joinedAt?; unique (user, community) | N-1 User, N-1 Community | Status changes, rows reused (BR-23) |
| Announcement | Official post | title, body, isHighlight, authorId | N-1 Community, N-1 User | Hard delete (with notifications) |
| Report | Complaint | title, description, category, status, responseNote?, respondedById?, respondedAt?, reporterId | N-1 Community, N-1 User ×2 | Hard delete by the reporter while PENDING |
| SosAlert | Emergency | type, note?, latitude?, longitude?, houseBlockSnapshot, status, senderId, handlerId?, recipientCount, resolutionNote?, acceptedAt?, handlingAt?, closedAt? (stretch: escalatedAt?) | N-1 Community, N-1 User ×2 | Never deleted |
| Notification | In-app inbox item | type, title, body, communityId?, entityType + entityId (no FK), readAt? | N-1 User, N-1 Community (optional) | Hard delete with its entity (BR-38, BR-50) |

**[PHASE 2]** entities: CommunityApplication, SosEvent, AuditLog, Event, EventRsvp, PushSubscription.

---

## 8. Non-functional

### 8.1 Auth
- As defined by `nest-auth-and-security`, copied from `references/reference-implementation.md`: JWT bearer with payload `{ sub, email, tv }`, `JwtStrategy.validate` re-loads `id, email, globalRole, isActive, emailVerifiedAt, tokenVersion`, OTP rules, no account-existence leaks except the register 409 (skill rule 12 exception), change-password and logout-all.
- OTP: 6 digits, hashed, TTL 10 minutes (`OTP_TTL_MINUTES`), max 5 attempts, resend cooldown 60 s (`OTP_RESEND_COOLDOWN_SECONDS`), atomic attempt claim.
- No refresh tokens. `JWT_EXPIRES_IN=1d` for the demo (shorter than the skill default `7d`; revocation works either way).
- Community permissions via `Membership.role`, checked in the service (`references/per-resource-roles.md` pattern).

### 8.2 Tenant isolation and race safety
- Every community call carries the community id in the path and is checked per BR-31..33.
- Race safety by conditional `updateMany` ([DATA_MODEL](DATA_MODEL.md) N-4).
- One e2e flow proves the happy path and one cross-tenant check ([API_SPEC](API_SPEC.md) 14).

### 8.3 Pagination
- Every list is paginated with the shared pagination contract (default 20, max 100).

### 8.4 Rate limiting
- BR-80. In-memory counters, valid with one replica. Keyed on `req.ip`; behind Railway set `TRUST_PROXY_HOPS=1`.
- Defaults are the skill values (rule 10: 5 for login-like, 3 for send-code). Because many demo users share one venue Wi-Fi IP, every limit is an env var and the venue raises them in `.env` only, without code changes.
- How (L-5): `ThrottlerModule.forRootAsync({ inject: [ConfigService], useFactory })` registers named throttlers `default`, `auth`, `sendCode`, `join`, `sos`, each `{ name, ttl: THROTTLE_TTL * 1000, limit: <env> }`. The four strict ones carry `skipIf: (ctx) => throttleTierOf(ctx) !== '<name>'`, where `throttleTierOf` reads metadata set by a project decorator `@ThrottleTier('<name>')` (`SetMetadata`) from `ctx.getHandler()` only, so a tier is switched on per handler, never per class. `default` applies to every route. Reason: `@Throttle` values are fixed at class load and cannot read `ConfigService`, so the skill's literal `@Throttle({ default: { limit: 5, ttl: 60_000 } })` cannot be tuned per venue.

### 8.5 Files
- None in Lite.

### 8.6 Realtime
- Socket.IO namespace `/realtime`, token in `handshake.auth.token`, `JwtStrategy.validate` reused and CORS from `FRONTEND_URL` through `FrontendCorsIoAdapter` (`references/websocket-auth.md`, BR-77, BR-81).
- Events: `notification:new`, `sos:new`, `sos:updated`, `join-request:new`; emitted after commit to DB-computed recipients (BR-69).
- No web push: admins with the app closed rely on the SOS email (BR-68).

### 8.7 Email
- OTP mail exactly as the skill (rule 23, reference "Mail port"): `@Global()` `MailModule` in `src/common/mail/` with the `OTP_SENDER` token, `OtpSender.send(OtpMessage)`, adapters `ResendOtpSender` (Resend HTTP API with `fetch`, no SDK) and `ConsoleOtpSender` (throws at startup when `NODE_ENV=production`). Subjects and body texts of the OTP mails are replaced by the Indonesian texts of 5.9.1 (texts only; same port and adapters).
- SOS mail: a second port in the same module, `SOS_MAILER` token, `SosMailer.sendSosAlert(SosAlertMail)`, with `ResendSosMailer` (same `fetch` call, same `RESEND_API_KEY` / `MAIL_FROM`) and `ConsoleSosMailer` (logs only "SOS mail skipped", never address or content), chosen by the same `OTP_SENDER` value. Railway Hobby blocks outbound SMTP, hence HTTP only.
- `OTP_SENDER` = `resend` | `console`, default `resend` (skill reference); local `.env` sets `console` explicitly. `RESEND_API_KEY` and `MAIL_FROM` (e.g. `"SIGAP <no-reply@averil.tech>"`, verified domain) are required when it is `resend`.
- The only place a code is ever printed is the skill's `ConsoleOtpSender` (stdout, local only, chosen explicitly, refuses production). No logger line ever contains a code, an address or mail content. SOS mail is fire-and-log (BR-68).
- Texts and subjects: 5.9.1. The SOS email never contains GPS, the note or a phone number.

### 8.8 Scheduler
- None in the definition of done. **[STRETCH]** one `@Interval(15000)` for BR-63.

### 8.9 Logging and privacy
- Logs contain no personal data, codes, tokens, email addresses or SQL in production. Data minimisation: no KK, no NIK.
- Timestamps stored in UTC; shown in Asia/Jakarta.

### 8.10 Health
- `GET /health` checks the database (F-HEALTH-1).

### 8.11 Deployment
- Frontend on Vercel, API on Railway (one replica), PostgreSQL on Railway. The browser calls the API directly and opens the socket directly; both use the `FRONTEND_URL` CORS allowlist.
- Swagger at `/docs` only when `NODE_ENV !== 'production'`.

### 8.12 Environment variables

| Variable | Purpose | Rule |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | - |
| `PORT` | HTTP port | - |
| `NODE_ENV` | environment | 8.7, 8.11 |
| `JWT_SECRET` | access token signing | 8.1 |
| `JWT_EXPIRES_IN` | access token lifetime (`1d`) | 8.1 |
| `FRONTEND_URL` | REST and Socket.IO CORS allowlist (comma-separated) | 8.11, BR-81 |
| `APP_URL` | single public frontend URL used as the link in emails | BR-68, 5.9.1 |
| `TRUST_PROXY_HOPS` | proxies in front of the API | BR-80 |
| `JOIN_TOKEN_SECRET` | HMAC for QR tokens | BR-19 |
| `OTP_TTL_MINUTES` | OTP lifetime (10) | 8.1 |
| `OTP_RESEND_COOLDOWN_SECONDS` | resend cooldown (60) | 8.1 |
| `OTP_SENDER` | `resend` (default) \| `console` (refused in production); also selects the SOS mailer | 8.7 |
| `RESEND_API_KEY` | Resend API key, required when `OTP_SENDER=resend` | 8.7 |
| `MAIL_FROM` | sender, e.g. `"SIGAP <no-reply@averil.tech>"`, required when `OTP_SENDER=resend` | 8.7 |
| `THROTTLE_TTL` | throttle window in seconds (60) | BR-80 |
| `THROTTLE_LIMIT` | `default` limit per IP per window (100) | BR-80 |
| `AUTH_THROTTLE_LIMIT` | `auth` tier (5) | BR-80 |
| `SEND_CODE_THROTTLE_LIMIT` | `sendCode` tier (3) | BR-80 |
| `JOIN_THROTTLE_LIMIT` | `join` tier (10) | BR-80 |
| `SOS_THROTTLE_LIMIT` | `sos` tier (5) | BR-80 |

20 variables. Seed only: `SEED_ADMIN_EMAIL`, `SEED_DEMO_PASSWORD`.

### 8.13 Deliberate deviations from the skills (Lite)

| # | Deviation | Skill rule affected | Why acceptable |
|---|---|---|---|
| L-5 | Throttle limits are named throttlers built in `ThrottlerModule.forRootAsync` from env and switched on per handler with `@ThrottleTier(...)`, instead of literal `@Throttle({ default: { limit, ttl: 60_000 } })` values. Defaults equal the skill values (5 / 3) | `nest-auth-and-security` rule 10 (form only; values, handler level and global `ThrottlerGuard` unchanged) | The venue shares one Wi-Fi IP; limits must be raised in `.env` without a rebuild. A unit test pins the defaults to the skill values. |

L-1..L-4 of rev 5.1 are removed (R-33..R-35). The full-v1 deviations D-1..D-5 (BFF gate, client IP, socket ticket) are **[PHASE 2]**.

### 8.14 Seed
- `prisma/seed.ts`, idempotent (`nest-auth-and-security` rule 15): reads `SEED_ADMIN_EMAIL` and `SEED_DEMO_PASSWORD` from env and fails when either is missing; creates a user only when its email does not exist and never overwrites a password; hashes with the project's `HashingService` (imported from `src/common/hashing/`, not re-implemented). Verified accounts: the admin (`SEED_ADMIN_EMAIL`) who created community "RT 001/RW 006", 2 ACTIVE WARGA, 1 user without membership (scan demo); demo accounts use fixed `@sigap.test` emails, which are not credentials. A few announcements (1 highlighted) and reports in every status. All `globalRole = USER`.

---

## 9. Edge cases and abuse cases

| # | Case | Expected behaviour | Rule |
|---|---|---|---|
| E-1 | Two admins approve/reject the same join request at once | one succeeds, the other gets 400 | BR-25 |
| E-2 | Two admins accept the same SOS at once | exactly one handler; the other gets 400 | BR-57 |
| E-3 | **[PHASE 2]** RSVP race | - | - |
| E-4 | **[PHASE 2]** Application approval race | - | - |
| E-5 | Two creates for the same RT/RW, or the same RT/RW with a different spelling ("Kel. Suka Maju" vs "sukamaju") | one created, the other 409 | BR-12, BR-14 |
| E-6 | Two highlights set at once | may briefly leave two highlighted; next highlight fixes it ([GAPS](GAPS.md) G-L4) | BR-36 |
| E-7 | Double-tap on "send SOS" | second request 409 (open SOS exists); an exact-same-millisecond race may create two ([GAPS](GAPS.md) G-L3) | BR-55 |
| E-8 | Double submit of a join request | exactly one PENDING row and one set of `JOIN_REQUEST` notifications; the other request gets 409 (conditional reuse / unique index) | BR-23 |
| E-9 | **[STRETCH]** Escalation job on restart | claim with `escalatedAt: null` sends once | BR-63 |
| E-10 | **[PHASE 2]** 3-PENDING race | - | - |
| E-11 | Guessing QR tokens | 22-char HMAC, 2-minute validity, `join` throttle (`JOIN_THROTTLE_LIMIT`, default 10/min per IP) on `POST /memberships/preview` and `POST /memberships`, one error message | BR-19, BR-20, BR-80 |
| E-12 | Photo of the QR shared on WhatsApp | works for up to 2 minutes; admin still approves and sees the house block and request time | BR-20, BR-25 |
| E-13 | Account enumeration via register/resend/forgot/login | as in `nest-auth-and-security` rule 12; register 409 is the skill's own documented exception (rule 12 last bullet, rule 19), throttled by the `auth` tier | BR-3 |
| E-14 | Enumeration of other communities' ids | 403 identical to non-member; uuid ids | BR-31 |
| E-15 | Mass assignment (`globalRole`, `isActive`, `status`, `handlerId`, `reporterId` in a body) | rejected by validation (400) | BR-11 |
| E-16 | Member opens another member's report by id | 404 | BR-49 |
| E-17 | Removed member keeps an open socket | stops receiving community events at once | BR-69 |
| E-18 | Removed member reuses an old token | token still valid for the account, but every community call is 403 | BR-30, BR-31 |
| E-19 | Last admin (also when they are the only member) tries to leave or demote themselves | 400 'Promote another admin first' / 'A community needs at least one admin'; no community deletion in Lite (G-L14) | BR-27 |
| E-20 | Sender is the only admin and sends SOS | SOS created with `recipientCount = 0`; frontend highlights 112 | BR-62 |
| E-21 | Handler is demoted or removed while handling an SOS | they can no longer move it (403); the sender can cancel and resend; another admin can mark it false alarm only while SENT ([GAPS](GAPS.md) G-L1) | BR-58, BR-60 |
| E-22..E-35 | **[PHASE 2]** (events, uploads, owner, take-over, BFF gate, socket ticket, per-email throttle, duplicates) | - | - |
| E-36 | **[DIBUANG di Lite]** accept vs demote race | - | - |
| E-37 | SOS sent while every admin has the app closed | in-app + realtime are missed; email reaches the admins; sender sees `recipientCount` and the 112 button | BR-62, BR-68 |
| E-38 | Resend fails or the free daily quota is used up | SOS and join actions still succeed; OTP endpoints answer as usual (the user resends); failure logged without address or code | BR-68 |
| E-39 | Leaked access token after password reset, password change or logout-all | 401 on the next request (`tokenVersion` changed); open sockets are disconnected | BR-5, BR-77 |
| E-40 | Handler calls `resolve` on an ACCEPTED SOS (skipping HANDLING) | 400 'Invalid SOS state', nothing written | BR-58 |
| E-41 | Account disabled in the database (`isActive = false` + `tokenVersion + 1`) | every request 401; login with the right password 403 'Account is disabled' | BR-3, BR-5 |

---

## 10. Out of scope and open questions

### 10.1 Out of scope (Lite)
- **[PHASE 2]** (specified in `docs/archive/full-v1/`): community applications + super admin; join ticket, join code + manual code, cooldown, 3-PENDING limit, IP hash, expiry job; owner + transfer; community deletion; admin deactivation endpoint, account deletion, profile photo; uploads (report photo, images, documents); audit log; SOS history, hourly limit, multi-level escalation, take-over/release; notification archive/delete, web push; BFF gate, client-IP header, socket ticket, per-user / per-email throttles; events; dashboard.
- **[DIBUANG di Lite]**: privacy consent field, join ticket, BR-82, `JOIN_APPROVED` email.
- Everything marked M2/M3 in the breakdown.
- Impersonation of any kind (never planned).

### 10.2 Resolved questions
All earlier questions (Q-1..Q-11, Q-A..Q-C) are resolved or no longer apply in Lite; see the archive. [SPEC_AUDIT](SPEC_AUDIT.md) rev 5.1 questions, answered by the product owner: (1) restore `tokenVersion`, change-password, logout-all, `globalRole` / `isActive` -> yes (R-33); (2) throttle -> skill defaults, tuned in the venue `.env` (R-36); (3) last admin may not leave, even when alone -> yes, accepted gap (G-L14); (4) HANDLING is mandatory, fix the API (R-37); (5) `JOIN_APPROVED` email dropped (R-35).

### 10.3 Open questions
None. Simplifications that leave small gaps are listed in `docs/GAPS.md`.

---

## 11. Traceability

Column "Lite": ✓ = built, P2 = **[PHASE 2]**, D = **[DIBUANG di Lite]**, S = **[STRETCH]**.

| Feature | Lite | Business rules | Module |
|---|---|---|---|
| F-AUTH-1 | ✓ | BR-1, BR-2, BR-11, BR-80 | `src/auth/` |
| F-AUTH-2 | ✓ | BR-3, BR-80 | `src/auth/` |
| F-AUTH-3 | ✓ | BR-3, BR-80 | `src/auth/` |
| F-AUTH-4 | ✓ | BR-2, BR-5, BR-80 | `src/auth/` |
| F-AUTH-5 | ✓ | BR-83 | `src/auth/` |
| F-AUTH-6, F-AUTH-7 | ✓ (R-33) | BR-2, BR-5, BR-77, BR-80 | `src/auth/` |
| F-USERS-1 | ✓ | BR-9, BR-11, BR-83 | `src/users/` |
| F-USERS-2, F-USERS-3 | P2 | BR-6..8, BR-10 | `src/users/` |
| F-COMMUNITIES-1 | ✓ | BR-12, BR-13, BR-14, BR-15, BR-16 | `src/communities/` |
| F-COMMUNITIES-2 | ✓ | BR-13 | `src/communities/` |
| F-COMMUNITIES-3..6 | P2 | BR-17, BR-34, BR-73 | - |
| F-COMMUNITIES-7 | ✓ | BR-13, BR-31 | `src/communities/` |
| F-MEMBERSHIPS-1 | ✓ | BR-19, BR-32 | `src/memberships/` |
| F-MEMBERSHIPS-2 | ✓ | BR-19, BR-20, BR-80 | `src/memberships/` |
| F-MEMBERSHIPS-3 | ✓ | BR-19, BR-20, BR-23, BR-24, BR-80 | `src/memberships/` |
| F-MEMBERSHIPS-4 | ✓ | BR-32 | `src/memberships/` |
| F-MEMBERSHIPS-5 | ✓ | BR-25, BR-66 | `src/memberships/` |
| F-MEMBERSHIPS-6 | ✓ | BR-23, BR-25 | `src/memberships/` |
| F-MEMBERSHIPS-7 | ✓ (via F-COMMUNITIES-2) | BR-23, BR-31 | `src/communities/` |
| F-MEMBERSHIPS-8 | ✓ | BR-27, BR-30 | `src/memberships/` |
| F-MEMBERSHIPS-9 | ✓ | BR-27, BR-28, BR-30 | `src/memberships/` |
| F-MEMBERSHIPS-10 | ✓ | BR-32 | `src/memberships/` |
| F-MEMBERSHIPS-11 | ✓ | BR-27, BR-29 | `src/memberships/` |
| F-MEMBERSHIPS-12, -13 | P2 | BR-26, BR-74 | - |
| F-ANNOUNCEMENTS-1 | ✓ | BR-35, BR-36, BR-37 | `src/announcements/` |
| F-ANNOUNCEMENTS-2 | ✓ | BR-33, BR-35, BR-36 | `src/announcements/` |
| F-ANNOUNCEMENTS-3 | ✓ | BR-38 | `src/announcements/` |
| F-ANNOUNCEMENTS-4 | ✓ | BR-31, BR-39 | `src/announcements/` |
| F-ANNOUNCEMENTS-5 | ✓ | BR-31, BR-33 | `src/announcements/` |
| F-EVENTS-1..6 | P2 | BR-40..47 | - |
| F-REPORTS-1 | ✓ | BR-48, BR-52 | `src/reports/` |
| F-REPORTS-2 | ✓ | BR-49 | `src/reports/` |
| F-REPORTS-3 | ✓ | BR-49 | `src/reports/` |
| F-REPORTS-4 | ✓ | BR-48, BR-50 | `src/reports/` |
| F-REPORTS-5 | ✓ | BR-50 | `src/reports/` |
| F-REPORTS-6 | ✓ | BR-32 | `src/reports/` |
| F-REPORTS-7 | ✓ | BR-51, BR-52 | `src/reports/` |
| F-SOS-1 | ✓ | BR-53, BR-54, BR-55, BR-62, BR-64, BR-68, BR-80 | `src/sos-alerts/` |
| F-SOS-2 | ✓ | BR-69 | `src/sos-alerts/` |
| F-SOS-3 | ✓ | BR-59 | `src/sos-alerts/` |
| F-SOS-4 | ✓ | BR-57, BR-58 | `src/sos-alerts/` |
| F-SOS-5 | ✓ | BR-58 | `src/sos-alerts/` |
| F-SOS-6 | ✓ | BR-60 | `src/sos-alerts/` |
| F-SOS-7 | S | BR-63, BR-68 | `src/sos-alerts/` |
| F-SOS-8 | ✓ | BR-32, BR-33 | `src/sos-alerts/` |
| F-SOS-9 | ✓ | BR-31 | `src/sos-alerts/` |
| F-SOS-10, -11 | P2 | BR-75, BR-76 | - |
| F-NOTIFICATIONS-1 | ✓ | BR-65, BR-66 | `src/notifications/` |
| F-NOTIFICATIONS-2 | ✓ | BR-65 | `src/notifications/` |
| F-NOTIFICATIONS-3 | P2 | - | - |
| F-NOTIFICATIONS-4 | ✓ | BR-69, BR-77, BR-81 | `src/notifications/` (gateway) |
| F-NOTIFICATIONS-5, -7 | P2 | BR-67 | - |
| F-NOTIFICATIONS-6 | ✓ | BR-68 | `src/common/mail/` |
| F-DASHBOARD-1, -2 | P2 | BR-72 | - |
| F-HEALTH-1 | ✓ | BR-84 | `src/health/` |
| F-PLATFORM-1 | P2 | BR-78, BR-79 | - |

Lite modules: `auth`, `users`, `communities`, `memberships`, `announcements`, `reports`, `sos-alerts`, `notifications`, `health` (51 REST endpoints + 1 WS namespace, [API_SPEC](API_SPEC.md) 17).
Cross-cutting: BR-31..33 (`community-access.helper.ts`, every community module), BR-80 (throttler), BR-68 (mail port).

---

## Assumptions made

| # | Assumption |
|---|---|
| A-1 | Login is email + password; OTP is used for email verification and password reset only. |
| A-2 | No refresh tokens. |
| A-3 | **[PHASE 2]** Manual join code. In Lite the manual fallback is the full `qrContent` string (copy button under the QR, pasted into the join screen), R-30. |
| A-4 | **[PHASE 2]** Community application entity. |
| A-5 | **[PHASE 2]** Join expiry. |
| A-6 | All reports are private. |
| A-7 | **[PHASE 2]** Events. |
| A-8 | **[PHASE 2]** Audit coverage. |
| A-9 | **[DIBUANG di Lite]** Cooldown after REMOVED. |
| A-10 | **[STRETCH]** Escalation once at 120 s. |
| A-11 | Admins may send SOS and reports; they cannot accept their own SOS. |
| A-12 | Status enum values are English; the UI maps them to Indonesian labels. |
| A-13 | Editing an announcement does not notify again. |
| A-14 | Report categories: INFRASTRUCTURE, SECURITY, CLEANLINESS, SOCIAL, OTHER. |
| A-15 | The creator's house block is given when creating the community. |
| A-16 | No uploads in Lite. |
| A-17 | Community switching is a frontend concern; every community call names the community in the path. |
| A-18 | **[PHASE 2]** Super admin. |
| A-19 | Notifications reference their entity by type + id (no foreign key); deletes clean them up explicitly. |
| A-20..A-31 | **[PHASE 2]** / not applicable in Lite (owner, take-over, socket ticket, per-email throttle, BFF). |
| A-32 | The demo uses verified seed accounts (8.14), so judges can log in without waiting for OTP email. |
| A-33 | The SOS email (via Resend) is a demo feature; an email failure never cancels or fails the action. |
| A-34 | Any user may create a community; abuse control is out of scope for the competition. |
| A-35 | `User.globalRole` exists to satisfy the skill standard (rule 5, rule 22) but stays `USER` in every Lite flow; no `@Roles` is used, so disabling an account is a database-only operation (E-41). |
| A-36 | The venue raises throttle limits in `.env` only; the defaults (5/3/10/5) are assumed sufficient per the product owner. |

