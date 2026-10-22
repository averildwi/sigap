# PRD: SIGAP, multi-tenant RT/RW community platform (v1)

Status: APPROVED with revisions (rev 4). Source: `breakdown-fitur-lengkap-multi-tenant.md` + decisions recorded below.
Conventions (envelope, guards, DTOs, Prisma, tests, git) are owned by the skills in `.claude/skills`; this PRD only describes WHAT the product does. Where it knowingly departs from a skill, the departure is listed in 8.13 (D-1..D-5).

**Scope marker:** anything tagged **[PHASE 2]** is specified but NOT built in v1 (see 0.1). The API spec, data model, audit and implementation plan for v1 must skip it.

### Revision 2 (changes from the approved draft)

| # | Change | Where |
|---|---|---|
| R-1 | Deployment fixed: BFF on Vercel, API on Railway, no Cloudflare. REST only from the BFF (internal key + forwarded client IP); sockets direct from the browser | 0, 8.4, 8.6, 8.11, BR-24, BR-78..80, D-1..D-4 |
| R-2 | Throttles keyed by user id (logged-in hotspots) and by IP + email (pre-login) | 8.4, BR-80 |
| R-3 | Socket auth with a signed 30 s socket ticket | F-NOTIFICATIONS-7, BR-77 |
| R-4 | QR payload carries the community id; the 6-character join code is only for manual entry | BR-19, BR-20, F-MEMBERSHIPS-1/2 |
| R-5 | SOS handler losing admin access sends the SOS back to SENT and re-arms escalation; other admins can take over | F-SOS-10/11, BR-63, BR-75, BR-76, 6.5 |
| R-6 | Audit log viewing deferred to M2 | 10.1 |
| R-7 | Applicant notified on review (`APPLICATION_APPROVED` / `APPLICATION_REJECTED`, in-app + email) | F-COMMUNITIES-4/5, BR-66, BR-68 |
| R-8 | ~~Official region codes with cascading lists~~ replaced in rev 3 by R-10 | - |
| R-9 | Owner transfer (KOM-05) pulled into v1, one step by the owner | F-MEMBERSHIPS-13, BR-7, BR-27, BR-74, 2.2, E-19 |

### Revision 3

| # | Change | Where |
|---|---|---|
| R-10 | Region is free text (province, city, district, village); no region reference tables, no seed, no dropdown API. Duplicates are blocked on the normalised text and the super admin sees possible duplicates when reviewing | F-COMMUNITIES-1/3/4, BR-12, BR-73, 7, E-5, E-35 |
| R-11 | The sender may also cancel an SOS that is HANDLING (Q-8) | F-SOS-3, BR-59, 6.5 |
| R-12 | Q-10 dropped (no region codes). Q-11: no key overlap in v1; rotate manually off-peak | 8.11, 10.2 |

### Revision 4 (5-day deadline)

| # | Change | Where |
|---|---|---|
| R-13 | v1 cut to the core (0.1). Events, dashboard, web push, SOS take-over/release, and every upload except the report photo moved to **[PHASE 2]**, specs kept | 0.1, tags in 2.2, 4, 5, 6, 7, 8, 9, 11 |
| R-14 | Without release, a handler of an open SOS cannot be demoted, removed, leave or delete the account until the SOS is closed (BR-82); the sender can still cancel | BR-7, BR-28..30, BR-82, F-MEMBERSHIPS-8/9/11, F-USERS-3, E-21 |
| R-15 | Channels in v1: in-app + realtime (Socket.IO) + email. No web push | F-MEMBERSHIPS-5/6, F-SOS-1/7, BR-63, 6.1, 6.5, 8.6 |

## 0.1 v1 scope

| In v1 | [PHASE 2] (after v1 is done) |
|---|---|
| auth (register, OTP verify, login, reset, change password, logout-all, `/auth/me`) | events + RSVP (F-EVENTS-1..6, BR-40..47, 6.3) |
| users: edit profile (name, phone), delete account | profile photo (F-USERS-2, BR-10) |
| communities: apply, own applications, super-admin review with possible duplicates, approve/reject, community list, community card | application supporting document (part of BR-15) |
| memberships: join QR + manual code, QR check, join request, queue, approve/reject, own memberships, leave, remove, member list, promote/demote, owner transfer, auto-expire | admin dashboard (F-DASHBOARD-1/2, BR-72) |
| announcements: create, edit, delete, list, detail (text only, highlight) | announcement image (part of BR-35, BR-38) |
| reports: create (with optional photo), own list, detail, edit/delete while PENDING, admin list, status change | web push (F-NOTIFICATIONS-5, BR-67, `PushSubscription`, VAPID) |
| SOS: send, follow, cancel, accept, handling, resolve, false alarm, escalation (in-app + realtime + email), admin list/detail, own history | SOS take-over and release (F-SOS-10/11, BR-75/76) |
| notifications: in-app list/read/archive/delete, realtime with socket ticket, email for important events | |
| platform: BFF gate, client IP, throttles, health, audit log writes | |

Only upload in v1: the report photo (Cloudinary, BR-48, BR-70).

## 0. Recorded decisions

| Decision | Value | Source |
|---|---|---|
| ID type | `uuid` | user |
| Database | PostgreSQL | user |
| Login | Email + password; email verification by OTP is required before the account can be used | user |
| Refresh tokens | No (skill default). Revocation via `logout-all` / token version | recommended, see 8.1 |
| Google login | No (M2) | breakdown |
| Deployment | Next.js BFF on Vercel, NestJS API on Railway, no Cloudflare, Railway replicas = 1 | user (Q-1) |
| Reverse proxy hops | `TRUST_PROXY_HOPS=1` (Railway edge); verify after the first deploy (8.11) | user (Q-1) |
| Client IP, REST | `X-Client-IP` set by the BFF, trusted only with a valid `X-Internal-Key` (D-1) | user (Q-1) |
| Client IP, Socket.IO | `X-Forwarded-For` entry N from the right, N = `TRUST_PROXY_HOPS` (D-2) | user (Q-1) |
| Throttle storage | In memory (single instance) | user |
| Soft delete | `User` only (anonymised, see BR-6) | user + recommended |
| Per-resource roles | Yes: app-wide role on the user + community role on the membership | user |
| File upload | Yes, Cloudinary; v1 only for the report photo | user (R-13) |
| Realtime | Yes, Socket.IO; browser connects directly with a signed socket ticket (D-3) | user (Q-2) |
| Payment / webhook | No | breakdown |
| Frontend | Next.js BFF (PWA). The BFF is the only REST client; the browser talks to the API only over Socket.IO | user |
| Regions | Free text (province, city/regency, district, village), normalised for duplicate checks; no reference data | user (R-10) |
| Owner handover | v1, one step by the current owner | user (R-9) |
| Community nickname | Optional `name` field | user |
| Language | UI and notification texts in Indonesian; API messages in English (skill rule) | user |
| v1 scope | Core only, see 0.1 (5-day deadline). Also cut from the breakdown MVP: EVT-02, RPT-07, WRG-02, part of PRV-03 | user (R-13) |

---

## 1. Overview

### Problem
RT/RW neighbourhoods coordinate through WhatsApp groups: official announcements get buried, complaints have no status, events have no headcount, and emergencies depend on someone reading the chat. There is no way to know who in a group really lives in the neighbourhood.

### Target users
- **Residents (warga)** of an RT/RW who want official information, a place to report problems, neighbourhood events and a reliable emergency button.
- **RT/RW officials (ketua, sekretaris)** who run the community: approve who joins, publish announcements, handle reports and respond to SOS.
- **Platform operator (super admin)** who approves new communities and nothing more.

### Product shape
One platform, many communities. One community = one RT/RW pair in one area. An account is global and can be a member of several communities. A resident joins by scanning a rotating QR code shown by an admin, then an admin approves the request. No family card (KK) is collected.

### Success criteria (measurable)

| # | Criterion | Target |
|---|---|---|
| SC-1 | A resident goes from "scan QR" to "request PENDING" | under 2 minutes, median |
| SC-2 | SOS delivered (realtime) to every connected admin of the community | under 5 s, p95 |
| SC-3 | An un-accepted SOS is escalated (in-app + realtime + email) | within 30 s after the escalation deadline |
| SC-4 | Cross-tenant access (admin of A reads data of B) in the automated test suite | 0 passing attempts |
| SC-5 | Routes covered by the route-guard meta-test | 100 % |
| SC-6 | Account-existence leaks (register excepted, see nest-auth-and-security) | 0 endpoints |
| SC-7 | Pilot: communities approved and active with at least 10 ACTIVE members | at least 3 within the pilot period |

---

## 2. Roles and permissions

### 2.1 Two role layers

| Layer | Enum (Prisma) | Values | Lives on | Checked by |
|---|---|---|---|---|
| App-wide | `GlobalRole` | `SUPER_ADMIN`, `USER` | `User.globalRole` | `@Roles` (role-based) |
| Per community | `MembershipRole` | `ADMIN`, `WARGA` | `Membership.role` (+ `isOwner` flag) | service (ownership/membership-based) |

Naming follows `nest-auth-and-security` rule 5 (both layers exist, so `globalRole` / `GlobalRole`). Self-registration always creates `USER`. `SUPER_ADMIN` exists only through the seed. A membership counts only when its status is `ACTIVE`.

Derived actors used in this document:

| Actor | Definition |
|---|---|
| PUBLIC | not logged in |
| USER | logged in, `globalRole = USER`, email verified |
| MEMBER | USER with an `ACTIVE` membership in the community being accessed (any membership role) |
| C-ADMIN | MEMBER whose membership role is `ADMIN` |
| OWNER | C-ADMIN with `isOwner = true` (exactly one per community, BR-27) |
| CREATOR / REPORTER / HANDLER | MEMBER who created the event / report / SOS, or the admin who accepted the SOS |
| SUPER | `globalRole = SUPER_ADMIN` |

### 2.2 Capability matrix

Legend: **R** = role-based (`@Roles`), **O** = ownership/membership check in the service on top of R, `-` = denied.

| Capability | PUBLIC | USER (no membership / PENDING) | MEMBER (WARGA) | C-ADMIN | OWNER | SUPER |
|---|---|---|---|---|---|---|
| Register, verify email, login, reset password | R | - | - | - | - | - (login only) |
| Read own profile (`/auth/me`), change password, logout-all | - | R | R | R | R | R |
| Edit own profile | - | R | R | R | R | - |
| Upload own profile photo **[PHASE 2]** | - | R | R | R | R | - |
| Delete own account | - | R | R | R | O (blocked while owner: transfer first, BR-7) | - |
| Apply to register a community | - | R | R | R | R | - |
| Scan QR / submit join request | - | R (max 3 PENDING) | R (other communities) | R (other communities) | R (other communities) | - |
| See own memberships and their status | - | R | R | R | R | - |
| View current join QR of a community | - | - | - | O | O | - |
| List / approve / reject join requests | - | - | - | O | O | - |
| List members of the community | - | - | - | O | O | - |
| Remove a WARGA | - | - | - | O | O | - |
| Remove an ADMIN | - | - | - | - | O | - |
| Promote WARGA to ADMIN / demote ADMIN | - | - | - | - | O | - |
| Transfer ownership to another ADMIN | - | - | - | - | O | - |
| Leave a community | - | - | O | O | - (transfer first, BR-27) | - |
| Read announcements | - | - | O | O | O | - |
| Create / edit / delete announcements | - | - | - | O | O | - |
| Create event, RSVP, read events **[PHASE 2]** | - | - | O | O | O | - |
| Edit / cancel an event **[PHASE 2]** | - | - | O (CREATOR) | O (any) | O (any) | - |
| Create report, read own reports | - | - | O | O | O | - |
| Edit / delete own report (PENDING only) | - | - | O (REPORTER) | O (REPORTER) | O (REPORTER) | - |
| Read all reports, change report status | - | - | - | O | O | - |
| Send SOS, cancel own SOS, read own SOS history | - | - | O | O | O | - |
| Read all SOS of the community, accept SOS | - | - | - | O (not own SOS) | O (not own SOS) | - |
| Take over an ACCEPTED / HANDLING SOS **[PHASE 2]** | - | - | - | O (not own SOS, not current handler) | O (not own SOS, not current handler) | - |
| Move accepted SOS forward (handling / resolved / false alarm) | - | - | - | O (HANDLER) | O (HANDLER) | - |
| Mark a waiting SOS as false alarm | - | - | - | O (not own SOS) | O (not own SOS) | - |
| Dashboard of the community **[PHASE 2]** | - | - | - | O | O | - |
| Own notifications | - | R | R | R | R | R |
| Push subscriptions **[PHASE 2]** | - | R | R | R | R | - |
| Get a socket ticket and connect to realtime | - | R | R | R | R | - |
| Review (approve / reject) community applications | - | - | - | - | - | R |
| List communities with statistics only | - | - | - | - | - | R |
| Health check | R | R | R | R | R | R |

Rules behind the matrix:
- Every community endpoint is gated by `@Roles('USER')` (so SUPER is denied by the guard) and then by an ACTIVE-membership check in the service. A membership in another community never grants access (BR-31).
- SUPER never sees announcements, reports, events, SOS or member lists, and there is no impersonation.
- Independent of the JWT, every REST call except the health check must come from the BFF with a valid internal key (BR-78); that gate is not a role and does not change the Swagger prefix (D-1).

---

## 3. Glossary

| Term | Meaning |
|---|---|
| Community (komunitas) | One RT + RW pair in one village (kelurahan/desa). The tenant. |
| Region | Four free-text fields: province, city/regency, district (kecamatan), village (kelurahan/desa). |
| Normalised region text | The region text lowercased, trimmed, inner whitespace collapsed, punctuation removed and common prefixes dropped (BR-12). Used only for duplicate checks; the original text is what users see. |
| Region key | `rt` + `rw` + normalised village + district + city + province; at most one community per key. |
| Possible duplicate | An existing community or PENDING application with the same RT and RW and a similar village or district name (BR-73), shown to the super admin. |
| Label | Display name `RT001/RW006`, followed by the village name; the optional `name` is shown next to it. |
| Membership (keanggotaan) | Link between a user and a community: status, community role, owner flag, house block/number. |
| Blok rumah | House block/number of the member in that community (`Blok C2 No. 14`). Stored on the membership, not the user. |
| Owner | The one admin who can manage other admins. Exactly one per community; can hand the role to another admin. |
| Join QR | QR code shown on an admin screen; it encodes the community id and a token that changes every 60 s. |
| Token window | 60-second time slot number used to compute the join token. |
| Join code | Fixed 6-character code of a community, used only for manual entry together with the 8-digit rotating code. |
| Manual code | Fallback for the QR: join code + 8-digit rotating code. |
| Join ticket | Short-lived proof (10 min) that the user scanned a valid QR, used to submit the join form. |
| Socket ticket | Signed proof (30 s) issued over REST and sent in the Socket.IO handshake; bound to the user and token version. |
| Internal key | Shared secret between BFF and API (`INTERNAL_API_KEY`); proves a REST call came from the BFF. |
| Client IP | The end user's IP: from `X-Client-IP` on REST (after the internal key passed), from `X-Forwarded-For` on sockets. |
| Join request | A membership in status `PENDING`. |
| Cooldown | Waiting time before a new join request after a rejection or removal (3 days). |
| Announcement (pengumuman) | Official post by an admin. One can be highlighted. |
| Event (acara) **[PHASE 2]** | Activity created by any member, with optional capacity and RSVP. |
| RSVP **[PHASE 2]** | A member's answer to an event: `GOING`, `MAYBE`, `NOT_GOING`. |
| Report (laporan) | Complaint by a member, visible to the reporter and the community admins. |
| SOS | Emergency alert from a member to all admins of the community. |
| Handler (penanggung jawab) | The admin currently responsible for an SOS: whoever accepted it (or, in Phase 2, took it over). |
| Take over (ambil alih) **[PHASE 2]** | Another admin becomes the handler of an ACCEPTED or HANDLING SOS. |
| Release **[PHASE 2]** | The SOS goes back to SENT because the handler lost admin access (demoted, removed, left, account deleted). |
| Escalation | Repeated alarm (in-app + realtime + email) when nobody accepted an SOS in time. |
| Audit log | Append-only record of sensitive admin and super-admin actions. |
| Former resident (Mantan warga) | Display name of content whose author deleted their account. |

Status enum values are English UPPER_SNAKE in code; the UI shows Indonesian labels:

| Entity | Enum value -> UI label |
|---|---|
| Membership | `PENDING` menunggu, `ACTIVE` aktif, `REJECTED` ditolak, `EXPIRED` kedaluwarsa, `LEFT` keluar, `REMOVED` dikeluarkan |
| Report | `PENDING` menunggu, `IN_PROGRESS` diproses, `RESOLVED` selesai, `REJECTED` ditolak |
| SOS | `SENT` dikirim, `ACCEPTED` diterima, `HANDLING` ditangani, `RESOLVED` selesai, `CANCELLED` dibatalkan, `FALSE_ALARM` salah alarm |

---

## 4. Features

Format: **ID** (breakdown ref) - goal. *Actor.* Acceptance criteria (Given / When / Then). Business rules are in section 5.

### 4.1 Module `auth`

**F-AUTH-1** (AUT-01) Register an account. *PUBLIC.*
- Given a new email, a password that meets the policy and `acceptPrivacyPolicy = true`, when I register, then an unverified `USER` account is created, the consent time is stored and a verification code is emailed.
- Given an email that is already registered, when I register, then I get 409 and the existing account is unchanged.
- Given `acceptPrivacyPolicy` missing or false, when I register, then I get 400 and no account is created.

**F-AUTH-2** (AUT-01) Verify my email with the OTP and resend it. *PUBLIC.*
- Given a valid unused code, when I submit it, then the account becomes verified and I receive an access token.
- Given a wrong, expired or used code, or more than 5 attempts, when I submit it, then I get 400 and the account stays unverified.
- Given any email, when I ask to resend, then the answer is always the same 200 message, whether the email exists, is verified, or is inside the cooldown.

**F-AUTH-3** (AUT-02, adapted to password) Log in. *PUBLIC.*
- Given a verified active account and the right password, when I log in, then I get an access token.
- Given an unknown email or a wrong password, then I get 401 with the same message in both cases.
- Given the right password on an unverified account, then I get 403 telling me to verify my email.

**F-AUTH-4** Forgot and reset password. *PUBLIC.*
- Given any email, when I ask for a reset, then the answer is the same 200 message; a code is emailed only if a verified account exists.
- Given a valid reset code and a new password, when I reset, then the password changes, every existing token stops working, and I am not logged in.

**F-AUTH-5** See my own account. *USER, SUPER.*
- Given I am logged in, when I open my account, then I see id, name, email, phone, global role, verification time and creation time (photo in Phase 2), and never hashes or token version.

**F-AUTH-6** Change password. *USER, SUPER.*
- Given the right current password and a valid new one, then the password changes, all old tokens stop working and I get a new token.
- Given a wrong current password, then I get 400 and nothing changes.

**F-AUTH-7** (AUT-03, AUT-07) Log out of all devices. *USER, SUPER.*
- Given I am logged in, when I log out everywhere, then every token issued before, including the current one, gets 401 on its next use.

### 4.2 Module `users`

**F-USERS-1** (AUT-04) Edit my profile. *USER.*
- Given a name of 2-100 characters and an optional phone number, when I save, then the profile is updated and the phone is stored in `+62` form.
- Given a body with `globalRole`, `isActive`, `email` or any unknown field, then I get 400 and nothing changes.

**F-USERS-2** (AUT-04) **[PHASE 2]** Upload or remove my profile photo. *USER.*
- Given a jpg/png/webp up to 2 MB, when I upload, then it becomes my photo and the previous file is deleted from storage.
- Given another file type or a larger file, then I get 400.
- When I remove my photo, then the file is deleted and the profile has no photo.

**F-USERS-3** (AUT-05) Delete my account. *USER.*
- Given the right current password, no owner role in any community, no open SOS that I sent and no open SOS that I am handling, when I delete my account, then my personal data is anonymised, my memberships end, my tokens stop working, and my old content shows the author as "Mantan warga".
- Given I am the owner of a community, or I sent or am handling an SOS that is still open, then I get 400 and nothing changes.
- Given a wrong password, then I get 400 and nothing changes.

### 4.3 Module `communities`

**F-COMMUNITIES-1** (KOM-01, KOM-02) Apply to register an RT/RW. *USER.*
- Given RT, RW, province, city/regency, district and village as free text (2-100 characters each), optional name, my position (e.g. "Ketua RT") and my house block, when I apply, then a PENDING application is created with the text as typed and its normalised region key. (Supporting document upload is **[PHASE 2]**.)
- Given a community already exists with the same region key (after normalisation, so "Kel. Suka Maju" equals "sukamaju"), then I get 409 with a message telling me to join with its QR code.
- Given a PENDING application already exists for the same region key, or I already have a PENDING application, then I get 409.
- Given a region that is only similar (not equal) to an existing one, then the application is accepted; the super admin decides (F-COMMUNITIES-3).

**F-COMMUNITIES-2** See my own applications and their review result. *USER.*
- Given I applied, when I open my applications, then I see each one with status, review time and the rejection reason if rejected.

**F-COMMUNITIES-3** (SUP-01) List and open community applications. *SUPER.*
- Given applications exist, when I list them, then I can filter by status and search by province, city, village or label text, paginated.
- When I open one, then I see the region text, the applicant's name, email, phone, position, and a list of possible duplicates: existing communities and other PENDING applications with the same RT and RW and a similar village or district (BR-73), each with label, region text and creation date.

**F-COMMUNITIES-4** (SUP-01) Approve an application. *SUPER.*
- Given a PENDING application, when I approve it, then in one step the community is created, the applicant becomes its ACTIVE ADMIN and owner, the application becomes APPROVED, the action is audited, and the applicant gets `APPLICATION_APPROVED` in-app and by email.
- Given the application is not PENDING, or two super admins approve at the same time, then only one succeeds and the other gets 400.
- Given a community with the same region key appeared meanwhile, then I get 409 and nothing is created.

**F-COMMUNITIES-5** (SUP-01) Reject an application. *SUPER.*
- Given a PENDING application and a reason of 5-500 characters, when I reject it, then it becomes REJECTED with the reason, the action is audited, and the applicant gets `APPLICATION_REJECTED` with the reason in-app and by email.
- Given no reason, then I get 400.

**F-COMMUNITIES-6** (SUP-02) List communities with statistics. *SUPER.*
- When I list communities, then I see label, name, region text, number of ACTIVE members and creation date, and no personal data of any member.

**F-COMMUNITIES-7** (KOM-03) See the community card. *MEMBER.*
- Given I am an ACTIVE member, when I open the community, then I see its label (`RT001/RW006`), name, village, district, city, province and my own membership (role, owner flag, house block).
- Given I am not an ACTIVE member, then I get 403.

### 4.4 Module `memberships`

**F-MEMBERSHIPS-1** (JON-01) Show the join QR. *C-ADMIN.*
- Given I am an admin of the community, when I open the join screen, then I get the QR payload (community id + current token), the community join code, the 8-digit manual code and the seconds left in the current 60 s window.
- Given I am a WARGA or not a member, then I get 403.

**F-MEMBERSHIPS-2** (JON-02, JON-03) Check a scanned QR or a typed code. *USER.*
- Given a QR payload (community id + token) or a manual entry (join code + 8-digit code) valid for the current or previous window, when I submit it, then I see the community label and region and get a join ticket valid for 10 minutes.
- Given an unknown community, an unknown join code, a wrong or older token/code, then I get the same 400 'Invalid or expired code'.
- Given more attempts than my per-user throttle allows, then I get 429.

**F-MEMBERSHIPS-3** (JON-03, JON-04) Submit a join request. *USER.*
- Given a valid join ticket of mine and a house block of 1-50 characters, when I submit, then my membership becomes PENDING with the scan time, token window and the hash of my client IP stored, and every admin of the community gets a `JOIN_REQUEST` notification.
- Given I already have 3 PENDING requests, or I am already PENDING/ACTIVE in that community, or I am in the 3-day cooldown, then I get the matching error and nothing is created.

**F-MEMBERSHIPS-4** (JON-05) Join request queue. *C-ADMIN.*
- Given PENDING requests exist, when I open the queue, then I see name, email with a verified badge, house block, scan time, token window and request time, oldest first, paginated.

**F-MEMBERSHIPS-5** (JON-06) Approve a join request. *C-ADMIN.*
- Given a PENDING request in my community, when I approve it, then it becomes ACTIVE as WARGA, the user gets `JOIN_APPROVED` (in-app, realtime, email), and it is audited.
- Given it is no longer PENDING (another admin decided first), then I get 400.

**F-MEMBERSHIPS-6** (JON-06) Reject a join request. *C-ADMIN.*
- Given a PENDING request and an optional reason up to 500 characters, when I reject it, then it becomes REJECTED, the user gets `JOIN_REJECTED` (in-app, realtime, email) with the reason, the 3-day cooldown starts, and it is audited.

**F-MEMBERSHIPS-7** (JON-07) See my memberships. *USER.*
- When I list my memberships, then I see each community label with my status, role, owner flag, house block and, when relevant, the rejection reason and the date I may try again.
- Given a membership is PENDING, then community features for it stay locked (403) until it is ACTIVE.

**F-MEMBERSHIPS-8** (JON-08) Leave a community. *MEMBER.*
- Given I am ACTIVE, not the owner and not handling an open SOS there, when I leave, then my membership becomes LEFT, my role is reset to WARGA, and I lose access immediately.
- Given I am the owner, then I get 400 telling me to transfer ownership first. Given I am handling an open SOS there, then I get 400 telling me to close it first (BR-82).

**F-MEMBERSHIPS-9** (JON-09) Remove a member. *C-ADMIN (WARGA targets), OWNER (ADMIN targets).*
- Given an ACTIVE WARGA and a reason of 5-500 characters, when an admin removes them, then the membership becomes REMOVED and the action is audited.
- Given the owner removes an ACTIVE ADMIN who is not handling an open SOS, then the same happens; if that admin is handling an open SOS, then I get 400 (BR-82).
- Given the target is an ADMIN and I am not the owner, or the target is the owner, then I get 403. Given I target myself, then I get 400.

**F-MEMBERSHIPS-10** (WRG-01) List members. *C-ADMIN.*
- When I list members, then I see name, house block, phone, role, owner flag and join date, with search by name or block and a filter by status and role, paginated.

**F-MEMBERSHIPS-11** (KOM-04) Promote or demote an admin. *OWNER.*
- Given an ACTIVE WARGA, when the owner promotes them, then their role becomes ADMIN and it is audited.
- Given an ACTIVE non-owner ADMIN who is not handling an open SOS, when the owner demotes them, then their role becomes WARGA and it is audited; if they are handling one, then I get 400 (BR-82).
- Given I am not the owner, then I get 403. Given the target is myself, not ACTIVE, or already in that role, then I get 400.

**F-MEMBERSHIPS-12** (JON-10, pulled into v1, see A-5) Expire stale join requests. *System.*
- Given a request PENDING for more than 7 days, when the scheduler runs, then it becomes EXPIRED and no longer counts toward the 3-PENDING limit.

**F-MEMBERSHIPS-13** (KOM-05, pulled into v1) Transfer ownership. *OWNER.*
- Given an ACTIVE ADMIN of my community who is not me, and my current password, when I transfer ownership, then in one step they become the owner, I stay an ADMIN without the owner flag, it is audited, and both of us get an in-app notification.
- Given the target is a WARGA, not ACTIVE, or myself, then I get 400. Given a wrong password, then I get 400. Given I am not the owner, then I get 403.
- Given two transfers are sent at the same time, then exactly one succeeds and the community still has exactly one owner.

### 4.5 Module `announcements`

**F-ANNOUNCEMENTS-1** (ANN-01, ANN-04) Publish an announcement. *C-ADMIN.*
- Given a valid title and body (image is **[PHASE 2]**), when I publish, then it is visible to members and every ACTIVE member except me gets an `ANNOUNCEMENT` notification.
- Given I mark it as highlight, then it becomes the only highlighted announcement of the community.

**F-ANNOUNCEMENTS-2** (ANN-02) Edit an announcement. *C-ADMIN.*
- Given an announcement of my community, when I edit title, body or highlight, then it is updated with the same highlight rule.
- Given an announcement of another community, then I get 404.

**F-ANNOUNCEMENTS-3** (ANN-02) Delete an announcement. *C-ADMIN.*
- When I delete it, then it and its notifications are removed.

**F-ANNOUNCEMENTS-4** (ANN-03) List announcements. *MEMBER.*
- When I list, then the highlighted one comes first, then newest first, paginated, with search by title.

**F-ANNOUNCEMENTS-5** (ANN-03) Read an announcement. *MEMBER.*
- When I open one of my community, then I see title, body, highlight flag, author display name and dates.

### 4.6 Module `events` **[PHASE 2]**

Whole module deferred (R-13). Kept as the spec for Phase 2; not built in v1.

**F-EVENTS-1** (EVT-01) Create an event. *MEMBER.*
- Given title, description, start in the future, end after start, location and optional capacity and image, when I create it, then it is SCHEDULED, visible at once (no moderation in v1), and every other ACTIVE member gets `EVENT_NEW`.

**F-EVENTS-2** (EVT-04) Edit an event. *CREATOR or C-ADMIN.*
- Given a SCHEDULED event that has not ended, when I edit it, then it is updated and members with RSVP GOING or MAYBE get `EVENT_UPDATED`.
- Given I am neither the creator nor an admin, then I get 403. Given a capacity below the current GOING count, then I get 400.

**F-EVENTS-3** (EVT-04) Cancel an event. *CREATOR or C-ADMIN.*
- Given a SCHEDULED event that has not ended and an optional reason, when I cancel it, then it becomes CANCELLED and GOING/MAYBE members get `EVENT_CANCELLED`.

**F-EVENTS-4** (EVT-03) RSVP. *MEMBER.*
- Given a SCHEDULED event that has not started, when I answer GOING, MAYBE or NOT_GOING, then my single RSVP is stored or replaced and the counts update.
- Given the event is full, when I answer GOING, then I get 400; MAYBE and NOT_GOING are still allowed.

**F-EVENTS-5** (EVT-05) List events. *MEMBER.*
- When I list with `when=upcoming` (default) or `when=past`, then I see title, times, location, status, capacity, GOING count and my own RSVP, paginated.

**F-EVENTS-6** (EVT-05) Event detail with participants. *MEMBER.*
- When I open an event, then I see its data, counts per RSVP value and the names of GOING and MAYBE participants (no house block, no contact data).

### 4.7 Module `reports`

**F-REPORTS-1** (RPT-01, RPT-05) Submit a report. *MEMBER.*
- Given title, description, category and an optional photo, when I submit, then a PENDING report is created, visible only to me and the community admins, and every ACTIVE admin except me gets `REPORT_NEW`.

**F-REPORTS-2** (RPT-02) See my reports. *MEMBER.*
- When I list my reports, then I see each with status, the latest admin response and dates, filterable by status, paginated.

**F-REPORTS-3** (RPT-02, RPT-03) Report detail. *REPORTER or C-ADMIN.*
- Given I am the reporter or an admin of the community, when I open it, then I see all its data. Admins also see the reporter's name and house block.
- Given I am another member, then I get 404.

**F-REPORTS-4** (RPT-06) Edit my report. *REPORTER.*
- Given my report is PENDING, when I edit title, description, category or photo, then it is updated. Given it is not PENDING, then I get 400.

**F-REPORTS-5** (RPT-06) Delete my report. *REPORTER.*
- Given my report is PENDING, when I delete it, then it, its photo and its notifications are removed. Given it is not PENDING, then I get 400.

**F-REPORTS-6** (RPT-03) All reports of the community. *C-ADMIN.*
- When I list, then I can filter by category and status and search by title, paginated, newest first.

**F-REPORTS-7** (RPT-04, RPT-05) Change report status. *C-ADMIN.*
- Given an allowed transition and, for REJECTED, a response note, when I change the status, then it is stored with my note and the reporter gets `REPORT_STATUS`.
- Given a transition not in the table of section 6.4, then I get 400.

### 4.8 Module `sos-alerts`

**F-SOS-1** (SOS-01, SOS-02) Send an SOS. *MEMBER (admins included).*
- Given type, optional note and optional GPS, when I send, then an SOS is created as SENT with my house block copied in, and every ACTIVE admin of the community except me gets `SOS_NEW` in-app and realtime (web push is **[PHASE 2]**).
- Given I already have an open SOS in this community, then I get 409. Given I sent 3 SOS in the last 60 minutes, then I get 429.

**F-SOS-2** (SOS-05) Follow my SOS. *Sender.*
- When my SOS changes status, then I get it in realtime with the handler's display name, and I can open it to see the status history.

**F-SOS-3** Cancel my SOS. *Sender.*
- Given my SOS is SENT, ACCEPTED or HANDLING, when I cancel it, then it becomes CANCELLED and the handler (if any) and the admins see that in realtime. Otherwise I get 400.

**F-SOS-4** (SOS-04) Accept an SOS. *C-ADMIN, not the sender.*
- Given a SENT SOS, when I accept it, then I become the handler, it becomes ACCEPTED, the sender gets `SOS_ACCEPTED` and other admins see who accepted.
- Given another admin accepted first, then I get 400. Given I am the sender, then I get 403.

**F-SOS-5** (SOS-04) Mark as handling and resolve. *HANDLER.*
- Given I am the handler, when I move ACCEPTED -> HANDLING or HANDLING -> RESOLVED with an optional note, then it is stored; on RESOLVED the sender gets `SOS_RESOLVED`.
- Given I am not the handler, then I get 403. Given the wrong current state, then I get 400.

**F-SOS-6** (SOS-04, SOS-08) Mark as false alarm. *C-ADMIN (SENT, not own) or HANDLER (ACCEPTED/HANDLING).*
- Given an allowed state, when I mark it, then it becomes FALSE_ALARM with my note and the sender is notified with `SOS_RESOLVED`.

**F-SOS-7** (SOS-06) Escalate an unanswered SOS. *System.*
- Given an SOS still SENT 120 s after it was sent, then all admins get `SOS_ESCALATED` (in-app, realtime, email); this repeats every 120 s up to 3 times while it stays SENT, and each step happens once even after a restart.
- **[PHASE 2]** Given a released SOS (back to SENT, F-SOS-11), then escalation starts again from level 0, counted from the release time.

**F-SOS-8** (SOS-03, SOS-09) SOS screen and history for admins. *C-ADMIN.*
- When I open an SOS of my community, then I see sender name, phone, house block, type, note, time, GPS, handler and the status history.
- When I list, then I can filter by status, type and date range, paginated, newest first; open ones first.

**F-SOS-9** (SOS-09) My SOS history. *MEMBER.*
- When I list my SOS, then I see my own alerts in this community, paginated.

**F-SOS-10** (R-5) **[PHASE 2]** Take over an SOS. *C-ADMIN, not the sender, not the current handler.*
- Given an ACCEPTED or HANDLING SOS of my community and an optional note, when I take it over, then I become the handler, the status stays the same, the previous handler, the sender and the other admins see the change in realtime, a history entry is written, it is audited, and the sender gets `SOS_ACCEPTED` with my name.
- Given the SOS is SENT or closed, then I get 400. Given I am the sender, then I get 403. Given I am already the handler, then I get 400.
- Given two admins take over at the same time, then exactly one becomes the handler; the other gets 400.

**F-SOS-11** (R-5) **[PHASE 2]** Release an SOS when the handler loses admin access. *System.*
- In v1 this situation is prevented instead: see BR-82.
- Given the handler of an ACCEPTED or HANDLING SOS is demoted, removed, leaves the community or deletes the account, then in the same step the SOS goes back to SENT, the handler is cleared, a history entry is written with the reason, all remaining ACTIVE admins (minus the sender) get `SOS_ESCALATED` at once, and escalation restarts.
- Given the SOS is already closed, then nothing changes.

SOS-07 (112 call button + disclaimer) and the alarm sound of SOS-02 are frontend-only; no backend work.

### 4.9 Module `notifications`

**F-NOTIFICATIONS-1** (NTF-01) List my notifications. *USER, SUPER.*
- When I list, then I see my own notifications newest first, filterable by unread and archived, paginated, plus the unread count.

**F-NOTIFICATIONS-2** (NTF-01) Mark read. *Owner of the notification.*
- When I mark one as read, then its read time is set. When I mark all as read, then all of mine are set and nobody else's.

**F-NOTIFICATIONS-3** (NTF-01) Archive or delete. *Owner of the notification.*
- When I archive one, then it leaves the default list. When I delete one, then it is gone. Another user's id gives 404.

**F-NOTIFICATIONS-4** (NTF-02) Realtime connection. *USER.*
- Given a valid socket ticket (F-NOTIFICATIONS-7) in the handshake auth payload and an allowed `Origin`, when I connect, then I receive my notifications and the realtime events of my ACTIVE communities.
- Given a missing, expired, already-used or revoked ticket, a ticket in the URL, or an `Origin` not on the allowlist, then the socket is disconnected.

**F-NOTIFICATIONS-5** (NTF-03) **[PHASE 2]** Web push subscription. *USER.*
- When I register a device subscription, then pushes are delivered to it. When I remove it, or the push service reports it as gone, then it is deleted.

**F-NOTIFICATIONS-6** (NTF-04) Email for important events. *System.*
- Given `JOIN_APPROVED`, `JOIN_REJECTED`, `SOS_ESCALATED`, `APPLICATION_APPROVED` or `APPLICATION_REJECTED`, then an email is sent to the recipient as well; a failed send does not undo the action.

**F-NOTIFICATIONS-7** (Q-2) Socket ticket. *USER.*
- Given I am logged in (through the BFF), when I ask for a socket ticket, then I get a signed ticket valid for 30 seconds, bound to my user id and current token version, with purpose `socket`.
- Given the ticket is used to connect, then it works once; a second connection with the same ticket is refused.
- Given my token version changes (logout-all, password change, account deletion) before I connect, then the ticket is refused; and my already-open sockets are disconnected.
- Given an access token, an OTP or any other signed value is sent as a socket ticket, then it is refused (purpose check).

### 4.10 Module `dashboard` **[PHASE 2]**

Whole module deferred (R-13).

**F-DASHBOARD-1** (DSH-01) Summary cards. *C-ADMIN.*
- When I open the dashboard, then I see: ACTIVE members, PENDING join requests, open reports (PENDING + IN_PROGRESS), open SOS (SENT + ACCEPTED + HANDLING) and upcoming events.

**F-DASHBOARD-2** (DSH-02) Recent activity feed. *C-ADMIN.*
- When I open the feed, then I see the latest 20 items of the last 30 days across reports, SOS, join requests and events, each with type, id, title or name, status and time only.

### 4.11 Module `health`

**F-HEALTH-1** (PLT-09) Health check. *PUBLIC.*
- Given the database answers, then the check returns 200 `ok`. Given it does not, then it returns 503.
- Given no internal key, then the check still answers (Railway's health probe calls it directly); it reveals nothing beyond `ok` / down.

### 4.12 Cross-cutting: BFF gate

**F-PLATFORM-1** (R-1) Only the BFF may call REST. *System.*
- Given a REST request without `X-Internal-Key`, or with a wrong one, to any path except the health check, then the API answers 403 before any guard, throttle or body validation that could reveal more.
- Given a valid key, then the client IP of the request is the value of `X-Client-IP`; given a valid key but a missing or malformed `X-Client-IP`, then the API answers 400.
- Given a browser sends `X-Client-IP` itself without the key, then it gets 403 and the header is never used.

---

## 5. Business rules

Each rule is one unit-test target. "Open SOS" = status `SENT`, `ACCEPTED` or `HANDLING`.

### 5.1 Accounts (auth, users)

| ID | Rule |
|---|---|
| BR-1 | Email is trimmed and lowercased and is unique across all users, deleted users included (BR-6 frees it by replacing it). |
| BR-2 | One password policy for register, reset and change, as defined by `nest-auth-and-security`. Not restated here. |
| BR-3 | An account without a verified email cannot log in or use any `[AUTH]` endpoint. Login checks the password first, then the verification state (403 'Email is not verified'). |
| BR-4 | Register requires `acceptPrivacyPolicy = true`; the consent time and the policy version (`PRIVACY_POLICY_VERSION`) are stored on the user. |
| BR-5 | Password reset, password change, logout-all and account deletion invalidate every token issued before them. |
| BR-6 | Deleting an account, in one transaction: name becomes `Mantan warga`, email becomes `deleted+<id>@invalid.local`, phone and password hash are cleared, `isActive = false`, `deletedAt = now`; every PENDING or ACTIVE membership becomes LEFT; own notifications are deleted. Content rows (announcements, reports, SOS) stay. (Phase 2 adds: photo file removed, push subscriptions deleted.) |
| BR-7 | Account deletion is refused (400) while the user is the owner of a community ('Transfer ownership first'), or is the sender or the handler of an open SOS ('Close your active SOS first', BR-82). |
| BR-8 | Account deletion requires the current password (400 'Invalid password' when wrong). |
| BR-9 | Name is 2-100 characters. Phone is optional; Indonesian formats (`08...`, `628...`, `+628...`) are normalised to `+628...`, 10-15 digits; anything else is 400. |
| BR-10 | **[PHASE 2]** Profile photo: `image/jpeg`, `image/png` or `image/webp`, at most 2 MB. A new photo replaces the old one, and the old file is deleted from storage after the database write succeeds. |
| BR-11 | Self-registration always creates `globalRole = USER`. No endpoint accepts `globalRole`, `isActive`, `email` (profile), `emailVerifiedAt`, `deletedAt` or any membership `role`/`isOwner`/`status` from a body. |

### 5.2 Communities and applications

| ID | Rule |
|---|---|
| BR-12 | RT and RW are integers 1-999. Province, city/regency, district and village are free text, 2-100 characters each, stored as typed (trimmed). Each is also normalised for comparison: lowercased, punctuation removed, inner whitespace removed, and a leading administrative prefix dropped (`provinsi`, `prov`, `kota`, `kabupaten`, `kab`, `kecamatan`, `kec`, `kelurahan`, `kel`, `desa`, `ds`). Region key = (`rt`, `rw`, normalised village, normalised district, normalised city, normalised province); at most one community per region key. Example: "Kel. Suka Maju" and "sukamaju" give the same village part. |
| BR-13 | Label = `RT` + rt padded to 3 digits + `/RW` + rw padded to 3 digits (`RT001/RW006`). Computed, never sent by a client. |
| BR-14 | An application is refused with 409 when a community with the same region key exists ('Community already registered, join with its QR code'), when another PENDING application has the same region key, or when the applicant already has a PENDING application. |
| BR-15 | Application fields: optional name 3-100, position 2-50, house block 1-50. **[PHASE 2]** supporting document: optional, `application/pdf`, `image/jpeg` or `image/png`, at most 5 MB, stored privately; only the applicant and SUPER get its link, which expires after 10 minutes. |
| BR-16 | Approval is atomic: the application moves PENDING -> APPROVED only if still PENDING (else 400); in the same transaction the community is created and the applicant becomes an ACTIVE `ADMIN` with `isOwner = true`, using the house block from the application, and the `APPLICATION_APPROVED` notification is inserted. A region key collision at that moment is 409 and nothing is written. An applicant whose account was deleted cannot be approved (400). |
| BR-17 | Rejection needs a reason of 5-500 characters; only from PENDING; inserts `APPLICATION_REJECTED` with the reason in the same transaction. A rejected applicant may apply again at once. |
| BR-18 | Each community gets a random 6-character join code (A-Z, 2-9, no look-alikes) at creation, unique across communities. It never changes in v1 and is useless without the rotating 8-digit code. |

### 5.3 Joining and memberships

| ID | Rule |
|---|---|
| BR-19 | Time window `w = floor(unixSeconds / 60)`. The QR token and the 8-digit manual code are both derived from an HMAC of (`communityId`, `w`) with the server secret `JOIN_TOKEN_SECRET`. The QR payload carries `communityId` + token; the manual path carries join code + 8-digit code and the server finds the community by join code. No table stores tokens or codes. |
| BR-20 | A token or code is valid only for window `w` or `w - 1` of the community named by the payload (QR) or found by join code (manual). An unknown community id, an unknown join code and a wrong or older token/code all give the same 400 'Invalid or expired code'. |
| BR-21 | A successful check returns a join ticket bound to (`userId`, `communityId`, window, `scannedAt`), valid 10 minutes. Submitting a join request needs a ticket of the same user. |
| BR-22 | A user has at most 3 PENDING memberships at a time (409 'Too many pending join requests'). |
| BR-23 | One membership row per (user, community). A new request reuses the row: allowed from no row, LEFT or EXPIRED at once; from REJECTED or REMOVED only 3 days after `decidedAt` (400 'You can request again after <date>'); refused from PENDING or ACTIVE (409). |
| BR-24 | The join request stores house block (1-50 characters, required), `scannedAt`, the token window and `ipHash` = HMAC-SHA256(`IP_HASH_SECRET`, client IP), where the client IP is the REST client IP of BR-79 (from `X-Client-IP`, never `X-Forwarded-For` or the socket address). The raw IP is never stored or logged. |
| BR-25 | Approve and reject work only on PENDING (atomic conditional update; a lost race is 400 'Join request is no longer pending'), set `decidedById` and `decidedAt`, and are audited. Approve sets ACTIVE, role `WARGA`, `isOwner = false`, `joinedAt = now`. Reject stores the optional reason (max 500). |
| BR-26 | A PENDING membership older than 7 days becomes EXPIRED by the scheduler; EXPIRED does not count toward BR-22. |
| BR-27 | Every community has exactly one owner at all times. The owner cannot leave, be removed, or be demoted (400 'Transfer ownership first' / 403); ownership changes only through transfer (BR-74). |
| BR-28 | An admin may remove an ACTIVE `WARGA`; only the owner may remove an ACTIVE `ADMIN`; nobody removes themselves (400, use leave). The reason is 5-500 characters. Audited. An ADMIN who handles an open SOS cannot be removed (BR-82). |
| BR-29 | Only the owner promotes (`WARGA` -> `ADMIN`) and demotes (`ADMIN` -> `WARGA`). The target is ACTIVE, not the owner, and not already in the target role (400). Audited. An ADMIN who handles an open SOS cannot be demoted (BR-82). |
| BR-30 | LEFT and REMOVED reset role to `WARGA` and `isOwner` to false. A member who handles an open SOS cannot leave (BR-82). Access stops on the next request because every community call re-reads the membership. |

### 5.4 Tenant isolation

| ID | Rule |
|---|---|
| BR-31 | Every community-scoped call requires an ACTIVE membership of the caller in that community; otherwise 403 'You are not a member of this community'. A membership in another community, or a PENDING/REJECTED/EXPIRED/LEFT/REMOVED membership, never counts. |
| BR-32 | Admin-only community calls additionally require role `ADMIN` on that membership (403 'Admin access required'). Owner-only calls require `isOwner` (403 'Owner access required'). |
| BR-33 | A resource id that exists in another community is answered as 404, exactly like a missing id. |
| BR-34 | SUPER cannot reach any community-scoped endpoint (denied by role) and super-admin endpoints never return announcements, reports, SOS or member personal data. |

### 5.5 Announcements

| ID | Rule |
|---|---|
| BR-35 | Title 3-150, body 1-5000 characters. **[PHASE 2]** optional image (jpeg/png/webp, at most 5 MB). |
| BR-36 | At most one highlighted announcement per community: setting `isHighlight = true` clears it on all others of the same community in the same transaction. |
| BR-37 | Publishing creates one `ANNOUNCEMENT` notification per ACTIVE member except the author, with one bulk insert in the same transaction as the announcement. Editing does not notify again. |
| BR-38 | Deleting an announcement deletes its notifications in the same transaction. (Phase 2: then its image file.) |
| BR-39 | List order: highlighted first, then `createdAt` descending. |

### 5.6 Events **[PHASE 2]**

| ID | Rule |
|---|---|
| BR-40 | Title 3-150, description up to 5000, location 1-200, `startsAt` in the future at creation, `endsAt` after `startsAt`, optional capacity 1-1000, optional image (as BR-35). |
| BR-41 | Only the creator or an admin of the community may edit or cancel (403); only while SCHEDULED and `endsAt` is in the future (400). |
| BR-42 | Capacity cannot be set below the current GOING count (400). |
| BR-43 | One RSVP per (event, user); a new answer replaces the old one. |
| BR-44 | RSVP is allowed only while the event is SCHEDULED and `startsAt` is in the future (400). |
| BR-45 | The GOING count never exceeds capacity, also under parallel requests; a GOING that would exceed it is 400 'Event is full'. MAYBE and NOT_GOING are never limited. |
| BR-46 | "Upcoming" = `endsAt` > now, ordered by `startsAt` ascending; "past" = `endsAt` <= now, ordered by `startsAt` descending. |
| BR-47 | Creating notifies every other ACTIVE member (`EVENT_NEW`); editing and cancelling notify members with GOING or MAYBE except the actor (`EVENT_UPDATED`, `EVENT_CANCELLED`). |

### 5.7 Reports

| ID | Rule |
|---|---|
| BR-48 | Title 3-150, description 10-5000, category one of `INFRASTRUCTURE`, `SECURITY`, `CLEANLINESS`, `SOCIAL`, `OTHER`, optional photo (`image/jpeg`, `image/png`, `image/webp`, at most 5 MB). The report photo is the only upload in v1. |
| BR-49 | In v1 every report is private: visible only to its reporter and the ADMINs of its community. Any other member gets 404. |
| BR-50 | The reporter may edit or delete only while PENDING (400 otherwise). Deleting removes its notifications in the same transaction, then the photo file. |
| BR-51 | Status changes follow the table in 6.4 only, as an atomic update conditioned on the current status (a stale transition is 400). REJECTED needs a response note of 5-1000 characters; other notes are optional (max 1000). The latest note and `respondedById` are stored. |
| BR-52 | A new report notifies every ACTIVE admin except the reporter (`REPORT_NEW`); a status change notifies the reporter (`REPORT_STATUS`) unless the reporter made the change. |

### 5.8 SOS

| ID | Rule |
|---|---|
| BR-53 | Type is `MEDICAL`, `FIRE`, `CRIME` or `OTHER`; note up to 280 characters; GPS optional, latitude -90..90 and longitude -180..180, both or neither. |
| BR-54 | The sender's house block is copied from the membership at creation and never changes afterwards. |
| BR-55 | At most one open SOS per (sender, community) (409 'You already have an active SOS'). |
| BR-56 | At most 3 SOS per account in any rolling 60 minutes, counted in the database across communities (429 'Too many SOS alerts'). |
| BR-57 | Accept works only from SENT, as an atomic update conditioned on `status = SENT`; exactly one admin wins and becomes the handler; the others get 400 'SOS already accepted'. The sender can never accept their own SOS (403). |
| BR-58 | Only the current handler moves ACCEPTED -> HANDLING and HANDLING -> RESOLVED (403 otherwise). Being handler also requires an ACTIVE ADMIN membership at the time of the call (BR-32). |
| BR-59 | Only the sender cancels, and only from SENT, ACCEPTED or HANDLING (400 from a closed status). Cancelling stops escalation and is shown in realtime to the handler and the admins. |
| BR-60 | FALSE_ALARM: from SENT by any admin who is not the sender; from ACCEPTED or HANDLING by the handler only. |
| BR-61 | Every status change writes an SOS history entry (from, to, actor, note, time) in the same transaction as the change. (Phase 2 adds handler changes from take-over and release.) |
| BR-62 | Recipients are the ACTIVE admins of the community at send time, minus the sender. The response states how many admins were alerted; 0 is allowed (the frontend then highlights the 112 button). |
| BR-63 | Escalation: while SENT, at 120 s, 240 s and 360 s after the SOS was sent, all current ACTIVE admins (minus the sender) get `SOS_ESCALATED` by in-app, realtime and email. Each level is claimed atomically, so it is sent once even after a restart, and it stops as soon as the status leaves SENT. (Phase 2: web push too, and a release resets the level to 0.) |
| BR-64 | SOS notifications ignore any mute or preference setting. |

### 5.9 Notifications, files, audit

| ID | Rule |
|---|---|
| BR-65 | A user only lists, reads, archives or deletes their own notifications; any other id is 404. Mark-all-read touches only the caller's rows. |
| BR-66 | Notification types in v1: `JOIN_REQUEST`, `JOIN_APPROVED`, `JOIN_REJECTED`, `APPLICATION_APPROVED`, `APPLICATION_REJECTED`, `OWNERSHIP_TRANSFERRED`, `ANNOUNCEMENT`, `REPORT_NEW`, `REPORT_STATUS`, `SOS_NEW`, `SOS_ESCALATED`, `SOS_ACCEPTED`, `SOS_RESOLVED`. **[PHASE 2]**: `EVENT_NEW`, `EVENT_UPDATED`, `EVENT_CANCELLED` (and `EVENT_REMINDER` with EVT-07). |
| BR-67 | **[PHASE 2]** A push subscription is unique by its endpoint URL; registering a known endpoint moves it to the current user. A subscription the push service answers with 404/410 is deleted. |
| BR-68 | Email is sent for `JOIN_APPROVED`, `JOIN_REJECTED`, `SOS_ESCALATED`, `APPLICATION_APPROVED` and `APPLICATION_REJECTED`. A failed email is logged (without address or content) and never rolls back the business action. |
| BR-69 | Realtime events go only to users computed from the database at send time (recipient list of BR-37/52/62/63), never to a room joined earlier, so a removed member stops receiving community events. |
| BR-70 | Uploads (v1: report photo only) are checked by MIME type and size before storage (BR-48). Every stored file keeps its provider id so it can be deleted; a failed delete is logged, not ignored. |
| BR-71 | Audit entries are written in the same transaction as the action for: join approve/reject, member removal, promote/demote, ownership transfer, SOS accept/handling/resolve/false alarm, application approve/reject. Each entry stores actor id, community id (if any), action, target type, target id, time, and no personal data beyond ids. There is no API to read (M2), edit or delete them. |
| BR-72 | **[PHASE 2]** Dashboard counts: ACTIVE members; PENDING join requests; reports PENDING or IN_PROGRESS; open SOS; SCHEDULED events with `endsAt` > now. Feed: latest 20 items of the last 30 days. |

### 5.10 Duplicate check, ownership, SOS handler protection, realtime, BFF gate (rev 2-4)

| ID | Rule |
|---|---|
| BR-73 | Possible duplicates of an application (shown to SUPER only, never blocking): existing communities and other PENDING applications with the same `rt` and `rw` and either (a) the same normalised district and city, or (b) a normalised village that contains, or is contained in, the application's normalised village. At most 10, newest first. Exact region key matches never reach this list because BR-14 already refused them. |
| BR-74 | Ownership transfer: only the owner; the target is an ACTIVE `ADMIN` of the same community and not the owner (400 otherwise); requires the owner's current password (400 'Invalid password'). In one transaction, conditioned on the caller still being owner: the old owner keeps `ADMIN` with `isOwner = false`, the target gets `isOwner = true`; a lost race is 400 'You are no longer the owner'. Both get `OWNERSHIP_TRANSFERRED`. Audited. |
| BR-75 | **[PHASE 2]** Release: when the handler of an ACCEPTED or HANDLING SOS stops being an ACTIVE ADMIN of its community (demoted, removed, left, account deleted), in the same transaction as that change the SOS goes to SENT, `handlerId` is cleared, a history entry with reason `HANDLER_LOST_ACCESS` is written, the escalation level is reset to 0 with the next escalation 120 s later, and `SOS_ESCALATED` goes to all remaining ACTIVE admins (minus the sender) at once. Closed SOS are untouched. Replaces BR-82 when built. |
| BR-76 | **[PHASE 2]** Take-over: an ACTIVE ADMIN who is neither the sender nor the current handler may become the handler of an ACCEPTED or HANDLING SOS. Atomic update conditioned on (`status`, `handlerId` as read); a lost race is 400 'SOS handler changed'. Status is unchanged. Optional note up to 280 characters. Audited; the sender gets `SOS_ACCEPTED` with the new handler's name. |
| BR-77 | Socket ticket: signed with `SOCKET_TICKET_SECRET` (separate from `JWT_SECRET`), payload (`purpose = 'socket'`, `sub`, `tv`, `jti`), expiry 30 s (`SOCKET_TICKET_TTL_SECONDS`). On handshake the server checks signature, purpose, expiry, that `jti` was not used before (single use, kept in memory until expiry, valid with one instance), and re-runs the same user checks as REST (exists, active, verified, `tv` matches). A token-version bump disconnects the user's open sockets. The ticket is accepted only from the handshake `auth` payload, never from the query string or headers. |
| BR-78 | Every REST request except the health check must carry `X-Internal-Key` equal to `INTERNAL_API_KEY` (compared timing-safe, length-safe); otherwise 403 'Forbidden' and nothing else runs. The key is at least 32 characters and required at boot. Socket.IO does not use the key. |
| BR-79 | REST client IP = `X-Client-IP` after BR-78 passed; it must be a valid IPv4/IPv6 address (400 otherwise). It is the only IP source for REST throttling and `ipHash` (BR-24). `X-Forwarded-For` and `req.ip` are not used for REST decisions. |
| BR-80 | Throttle keys: (a) logged-in hotspots (QR/code check, join request, SOS send, report photo upload, socket ticket) are keyed by user id; (b) pre-login auth endpoints (register, login, verify-otp, resend-otp, forgot-password, reset-password) are keyed by client IP (BR-79) **and** by normalised email, each with its own limit; the per-email limit for login is looser than the per-IP limit (lock-out protection) and the 429 answer is identical for existing and unknown emails; (c) everything else keeps the global per-IP limit. Values are fixed in the API spec. |
| BR-81 | Socket.IO connections: the handshake `Origin` must be in `SOCKET_ALLOWED_ORIGINS` (exact match, comma-separated, trimmed; empty = refuse all); the client IP for connection-rate limiting is the `X-Forwarded-For` entry at position `TRUST_PROXY_HOPS` from the right (never the left-most). |
| BR-82 | (v1, until release BR-75 exists) A member who is the handler of an open SOS (ACCEPTED or HANDLING) in a community cannot be demoted, removed or leave that community, and cannot delete the account: 400 'Close your active SOS first' / 'This admin is handling an active SOS'. The check and the change run in one transaction conditioned on no open SOS with that handler, so a parallel accept cannot slip in. The sender may still cancel the SOS at any time (BR-59). |

---

## 6. State machines

### 6.1 Membership

```
 (no row) ──request──► PENDING ──approve──► ACTIVE ──leave──► LEFT
     ▲                  │  │                  │
     │                  │  └─7 days─► EXPIRED └──remove──► REMOVED
     │                  └─reject──► REJECTED
     │
     └── LEFT / EXPIRED: request again at once
         REJECTED / REMOVED: request again after 3 days  (same row goes back to PENDING)
```

| From | To | Trigger | Who | Side effects |
|---|---|---|---|---|
| none / LEFT / EXPIRED | PENDING | submit join request | USER with valid ticket | store block, scan data, ipHash; `JOIN_REQUEST` to admins (BR-22..24) |
| REJECTED / REMOVED (after 3 days) | PENDING | submit join request | USER with valid ticket | as above (BR-23) |
| PENDING | ACTIVE | approve | C-ADMIN | role WARGA, `joinedAt`; `JOIN_APPROVED` in-app + realtime + email; audit |
| PENDING | REJECTED | reject | C-ADMIN | reason, cooldown starts; `JOIN_REJECTED` in-app + realtime + email; audit |
| PENDING | EXPIRED | 7 days without decision | scheduler | none |
| ACTIVE | LEFT | leave | the member (not owner, not handling an open SOS) | role reset (BR-30, BR-82) |
| ACTIVE | REMOVED | remove | C-ADMIN (WARGA target) / OWNER (ADMIN target, not handling an open SOS) | reason, role reset; audit |
| ACTIVE | ACTIVE (role change) | promote / demote | OWNER | demote blocked while handling an open SOS; audit (BR-29, BR-82) |
| ACTIVE (owner) | ACTIVE (admin) + target ACTIVE (admin) -> owner | transfer ownership | OWNER | `OWNERSHIP_TRANSFERRED` to both; audit (BR-74) |
| PENDING / ACTIVE | LEFT | account deletion | the user (not owner, no open SOS as sender or handler) | BR-6, BR-7 |

Invalid transitions answer 400 (409 for a second request while PENDING/ACTIVE, BR-23).

### 6.2 Community application

```
PENDING ──approve──► APPROVED   (community + owner membership created)
   └─────reject────► REJECTED
```

| From | To | Who | Side effects |
|---|---|---|---|
| PENDING | APPROVED | SUPER | BR-16; `APPLICATION_APPROVED` in-app + email; audit |
| PENDING | REJECTED | SUPER | reason; `APPLICATION_REJECTED` in-app + email; audit |

Anything else is 400 'Application is no longer pending'. The applicant also sees the result in F-COMMUNITIES-2.

### 6.3 Event **[PHASE 2]**

```
SCHEDULED ──cancel──► CANCELLED
    └── (endsAt passes) shown as "past"; not a stored status
```

| From | To | Who | Side effects |
|---|---|---|---|
| SCHEDULED (`endsAt` > now) | CANCELLED | CREATOR or C-ADMIN | optional reason; `EVENT_CANCELLED` to GOING/MAYBE |

Edit and RSVP on CANCELLED or ended events are 400.

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

v1 (no take-over, no release):

```
SENT ──accept──► ACCEPTED ──handle──► HANDLING ──resolve──► RESOLVED
 │                 │                     │
 ├─ false alarm ───┼─ false alarm ───────┼─ false alarm ──► FALSE_ALARM
 │  (admin)        │  (handler)          │  (handler)
 │                 │                     │
 └─ cancel ────────┴─ cancel ────────────┴─ cancel ──► CANCELLED
    (sender)          (sender)              (sender)
```

**[PHASE 2]** adds: take-over (ACCEPTED/HANDLING, new handler, status unchanged) and release (ACCEPTED/HANDLING -> SENT when the handler loses admin access, escalation restarts):

```
     release (system: handler lost admin access)
          ┌────────────────┬───────────────────┐
          ▼                │                   │
SENT ──accept──► ACCEPTED ─┴─handle──► HANDLING ┴─resolve──► RESOLVED
                   ⟲ take over          ⟲ take over
```

| From | To | Who | Side effects |
|---|---|---|---|
| (new) | SENT | MEMBER | `SOS_NEW` realtime + in-app to admins; first escalation scheduled (BR-62, BR-63) |
| SENT | ACCEPTED | C-ADMIN, not sender, first wins | handler set; `SOS_ACCEPTED` to sender; realtime to admins; escalation stops; audit |
| SENT | CANCELLED | sender | realtime to admins; escalation stops |
| SENT | FALSE_ALARM | C-ADMIN, not sender | `SOS_RESOLVED` to sender; escalation stops; audit |
| ACCEPTED | HANDLING | handler | realtime to sender and admins; audit |
| ACCEPTED | CANCELLED | sender | realtime to handler and admins |
| ACCEPTED | FALSE_ALARM | handler | `SOS_RESOLVED` to sender; audit |
| HANDLING | RESOLVED | handler | `SOS_RESOLVED` to sender; realtime; audit |
| HANDLING | CANCELLED | sender | realtime to handler and admins (R-11) |
| HANDLING | FALSE_ALARM | handler | `SOS_RESOLVED` to sender; audit |
| ACCEPTED / HANDLING | same (new handler) | **[PHASE 2]** C-ADMIN, not sender, not handler | take-over (BR-76); `SOS_ACCEPTED` to sender; realtime; audit |
| ACCEPTED / HANDLING | SENT | **[PHASE 2]** system, caused by the handler's membership change | release (BR-75); `SOS_ESCALATED` at once; escalation restarts; audit |

Every row writes a history entry (BR-61). RESOLVED, CANCELLED and FALSE_ALARM are final. Any other transition is 400. In v1 the handler's membership cannot change while the SOS is open (BR-82).

---

## 7. Entities (conceptual)

| Entity | Purpose | Key attributes | Relations | Delete behaviour |
|---|---|---|---|---|
| User | Global account | email (unique), passwordHash, name, phone?, globalRole, isActive, emailVerifiedAt?, tokenVersion, privacyConsentAt, privacyPolicyVersion, deletedAt? (Phase 2: photo url + provider id) | 1-N OtpCode, Membership, CommunityApplication, content, Notification | **Soft delete + anonymise** (BR-6): history (reports, SOS, audit) still points to the user |
| OtpCode | Email verification and password reset codes | purpose, codeHash, attempts, expiresAt, usedAt? | N-1 User | Cascade with User (never needed while users are only soft deleted) |
| CommunityApplication | Request to register an RT/RW | rt, rw, province, city, district, village (text as typed), regionKey (normalised), name?, position, houseBlock, status, rejectReason?, reviewedById?, reviewedAt? (Phase 2: document provider id) | N-1 User (applicant), N-1 User (reviewer), 0..1 Community (created from it) | Restrict on applicant (users not hard deleted); kept as history |
| Community | Tenant = one RT/RW | rt, rw, province, city, district, village (text), regionKey (unique), name?, joinCode (unique), createdFromApplicationId | 1-N Membership and all tenant content | Not deletable in v1; children Cascade so a future delete removes the tenant completely (audit entries: Set null) |
| Membership | User in a community | status, role, isOwner, houseBlock, scannedAt?, tokenWindow?, ipHash?, decidedById?, decidedAt?, decisionReason?, joinedAt?; unique (user, community) | N-1 User, N-1 Community, N-1 User (decider) | Status changes, never deleted (rows are reused, BR-23); Cascade with Community, Restrict on User |
| Announcement | Official post | title, body, isHighlight, authorId (Phase 2: image) | N-1 Community, N-1 User | **Hard delete** (ANN-02, with its notifications); Restrict on author |
| Event **[PHASE 2]** | Neighbourhood activity | title, description, startsAt, endsAt, location, capacity?, image?, status, cancelReason?, creatorId | N-1 Community, N-1 User, 1-N EventRsvp | Never deleted (cancel = status); Restrict on creator |
| EventRsvp **[PHASE 2]** | Answer of a member | status (GOING/MAYBE/NOT_GOING); unique (event, user) | N-1 Event, N-1 User | Cascade with Event; Restrict on user |
| Report | Complaint | title, description, category, photo (url + provider id)?, status, responseNote?, respondedById?, respondedAt?, reporterId | N-1 Community, N-1 User (reporter), N-1 User (responder) | **Hard delete** by the reporter while PENDING; Restrict on reporter |
| SosAlert | Emergency | type, note?, latitude?, longitude?, houseBlockSnapshot, status, senderId, handlerId?, acceptedAt?, sentAt, closedAt?, escalationLevel, nextEscalationAt?, recipientCount | N-1 Community, N-1 User (sender), N-1 User (handler), 1-N SosEvent | Never deleted (safety record); Restrict on users |
| SosEvent | SOS history line | fromStatus?, toStatus, actorId, note?, createdAt (Phase 2: previousHandlerId?, newHandlerId?, reason?) | N-1 SosAlert, N-1 User | Cascade with SosAlert; Restrict on actor |
| Notification | In-app inbox item | type, title, body, communityId?, entity type + entity id (no FK), readAt?, archivedAt? | N-1 User, N-1 Community (optional) | Hard delete (user action, BR-38, BR-50, BR-6); Cascade with User and Community |
| PushSubscription **[PHASE 2]** | Web push device | endpoint (unique), p256dh, auth, userAgent? | N-1 User | Hard delete; Cascade with User |
| AuditLog | Append-only trail | action, actorId, communityId?, targetType, targetId, metadata (ids only) | N-1 User (actor), N-1 Community (optional) | Never deleted in v1 (retention is M2); Restrict on actor, Set null on community |

The SOS escalation and join-expiry schedulers keep their state in `SosAlert` and `Membership`; there is no separate job table. Socket tickets and their used `jti` values are not stored in the database (BR-77).

---

## 8. Non-functional

### 8.1 Auth
- As defined by `nest-auth-and-security` (JWT bearer, token version, OTP rules, throttle table, no account-existence leaks). Not restated.
- **No refresh tokens in v1.** Why: the Next.js BFF keeps the access token in its own httpOnly cookie, so browser scripts never see it; every request re-reads the user, so logout-all, password change and account deletion revoke at once; refresh rotation would add a table, cookie handling and a CORS credential setup for little gain. Per-device logout comes with AUT-08 in M2 and would be the moment to add the refresh recipe.
- App-wide role on the user, community role on the membership, checked in the service (`references/per-resource-roles.md` pattern).

### 8.2 Tenant isolation (PRV-01)
- Every community call carries the community id in the path and is checked per BR-31..33.
- An automated e2e suite proves: admin of A gets 403/404 on every community endpoint of B; a WARGA gets 403 on every admin endpoint; a PENDING member gets 403 on every member endpoint.

### 8.3 Pagination
- Every list is paginated with the shared pagination contract (default 20, max 100).

### 8.4 Rate limiting (values are settled in the API spec)

| Surface | Key | Notes |
|---|---|---|
| register, login, verify-otp, resend-otp, forgot-password, reset-password | client IP (BR-79) **and** normalised email, two separate limits | IP limits per the skill table (rule 10). Per-email: login looser than per-IP (e.g. 10 / 15 min) so a stranger cannot easily lock out an admin; OTP endpoints also keep the database cooldown and attempt limits of the skill. 429 identical for every email (BR-80) |
| QR / code check (F-MEMBERSHIPS-2) | user id | strict: code-guessing surface |
| Join request submit | user id | moderate; plus BR-22 |
| SOS send | user id | throttle plus database rule BR-56 |
| Report photo upload (only upload in v1) | user id | moderate |
| Socket ticket | user id | moderate (one per connect/reconnect) |
| Socket.IO connection | socket client IP (BR-81) | connection-rate only; the ticket is the real gate |
| Everything else | client IP (BR-79) | global default limit |

- Counters are in memory, valid because Railway runs **one** replica (8.11). Scaling out needs a shared store first.
- The global throttle runs before authentication, so per-user limits are a second throttle applied on the route after the JWT guard (D-4).

### 8.5 Files
- Cloudinary, one upload path, provider id stored for every file. v1: report photo only, 5 MB (BR-48). Phase 2 adds avatar 2 MB, announcement/event images 5 MB, private application documents 5 MB with expiring links.

### 8.6 Realtime (push in Phase 2)
- Socket.IO; the browser connects **directly** to the Railway API (Vercel functions cannot hold sockets).
- Authentication with the socket ticket of F-NOTIFICATIONS-7 / BR-77 in the handshake `auth` payload; never an access token and never anything in the URL. The rest follows the websocket recipe of `nest-auth-and-security` (same user checks as REST, CORS from an allowlist).
- `Origin` checked against `SOCKET_ALLOWED_ORIGINS` (BR-81). Socket CORS uses the same list.
- **v1 limitation (no web push):** an admin whose app is closed only learns about an SOS from the escalation **email** (first one after 120 s). The frontend must tell admins to keep the PWA open, and the SOS screen for the sender shows the 112 button prominently. **[PHASE 2]** Web Push with VAPID (BR-67).

### 8.7 Email
- Resend in production; a console adapter only outside production that never prints codes. Templates in Indonesian.

### 8.8 Scheduler
- Database-backed polling (SOS escalation every 15 s, join expiry every hour) with atomic claims (BR-26, BR-63), so a restart never loses or repeats a step. No in-memory timers.

### 8.9 Audit, logging, privacy
- Audit per BR-71. Logs contain no personal data, codes, tokens or SQL in production.
- Consent with policy version at registration (BR-4), data minimisation (no KK, no NIK), anonymised deletion (BR-6), reference UU PDP 27/2022.
- Timestamps stored in UTC; shown in Asia/Jakarta.

### 8.10 Health
- `GET` health endpoint checks the database (F-HEALTH-1). It is the only REST path without the internal key (BR-78).

### 8.11 Deployment and traffic paths

```
Browser ──HTTPS──► Vercel (Next.js BFF) ──HTTPS + X-Internal-Key + X-Client-IP──► Railway edge ──► NestJS API (1 replica)
Browser ──WSS (Socket.IO, socket ticket)─────────────────────────────────────────► Railway edge ──► NestJS API
Railway health probe ─────────────────────────────────────────────────────────────► GET health (no key)
```

| Path | Client IP source | Trust anchor |
|---|---|---|
| REST | `X-Client-IP`, written by the BFF from Vercel's own `x-forwarded-for` (the BFF overwrites, never copies the browser's header) | `X-Internal-Key` (BR-78) |
| Socket.IO | `X-Forwarded-For` entry `TRUST_PROXY_HOPS` from the right (BR-81) | socket ticket + `Origin` allowlist |

- `TRUST_PROXY_HOPS=1` (Railway edge). Verify after the first deploy: connect a socket from a known IP while sending a forged `X-Forwarded-For`; the logged socket IP must be the real one. Adjust the hop count if not.
- Swagger docs are disabled in production, or served behind the same internal key; they are not reachable through the BFF.
- Railway replicas = 1 (8.4, BR-77). A second replica needs a shared throttle store and a shared used-ticket store first.
- Secrets live in Railway and Vercel env settings; `INTERNAL_API_KEY` is identical on both sides and rotated by deploying both.

### 8.12 Environment variables implied by this PRD
Base variables from nest-common (`DATABASE_URL`, `JWT_*`, `FRONTEND_URL`, `TRUST_PROXY_HOPS`, `PORT`, `NODE_ENV`) and the auth/mail variables of `nest-auth-and-security` rule 25 apply. Project-specific:

| Variable | Purpose | Rule |
|---|---|---|
| `INTERNAL_API_KEY` | BFF -> API shared secret, min 32 chars, required | BR-78 |
| `SOCKET_ALLOWED_ORIGINS` | comma-separated frontend origins allowed to open a socket; empty = none | BR-81 |
| `SOCKET_TICKET_SECRET` | signing secret for socket tickets, min 32 chars, distinct from `JWT_SECRET` | BR-77 |
| `SOCKET_TICKET_TTL_SECONDS` | ticket lifetime, default 30 | BR-77 |
| `JOIN_TOKEN_SECRET` | HMAC secret for QR tokens and 8-digit codes | BR-19 |
| `JOIN_TICKET_SECRET` | signing secret for join tickets | BR-21 |
| `IP_HASH_SECRET` | HMAC secret for `ipHash` | BR-24 |
| `PRIVACY_POLICY_VERSION` | consent version stored at registration | BR-4 |
| `CLOUDINARY_URL` | file storage (report photo) | BR-70 |
| `SOS_ESCALATION_SECONDS` | escalation interval, default 120 | BR-63 |

**[PHASE 2]**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (web push, BR-67). Not in the v1 schema.

`FRONTEND_URL` (REST CORS) may be empty in production because browsers never call REST directly; `SOCKET_ALLOWED_ORIGINS` must not be.

### 8.13 Deliberate deviations from the skills

These are approved product decisions that the API spec, the implementation plan and the audit must treat as known, not as violations. Each needs a matching update of the skill or the route-guard meta-test.

| # | Deviation | Skill rule affected | Why it is acceptable | Required guard-rail |
|---|---|---|---|---|
| D-1 | REST client IP comes from `X-Client-IP`, not `req.ip`; throttler tracker reads it | `nest-auth-and-security` rule 16 ("never read X-Forwarded-For / X-Real-IP ... in getTracker") | The rule exists because clients can forge these headers. Here every REST request without the timing-safe internal key is refused before the tracker runs, so only the BFF can set the header | Global internal-key guard registered **before** the throttler guard; tracker reads only the value stored by that guard; e2e test: forged `X-Client-IP` without key = 403, with key = honoured |
| D-2 | Socket client IP taken from `X-Forwarded-For` by hop count, outside Express `trust proxy` | rule 16 | Same semantics as `trust proxy = TRUST_PROXY_HOPS` (right-most minus hops), never the left-most | Unit test with appended forged entries; verify after deploy (8.11) |
| D-3 | Socket ticket instead of the access token in the socket handshake | websocket recipe (token in `handshake.auth.token`) | The access token lives in the BFF's httpOnly cookie; the browser never holds it. The ticket keeps the recipe's checks (`tv`, active, verified) and adds purpose, 30 s expiry and single use | Same `validate()` path as REST; tests for wrong purpose, expired, replayed, old `tv` |
| D-4 | Per-user throttles as a second route-level guard after `JwtAuthGuard`, plus per-email throttles on pre-login routes | rule 10 (throttle table, IP-based global guard) | The skill's limits stay; these are additional keys, not replacements | Meta-test or e2e covering each hotspot in 8.4 |
| D-5 | Every REST route except health needs the internal key (a second gate besides JWT) | `nest-architecture` rule 12 / auth rule 4 prefix derivation | The key is infrastructure, not a role; prefixes (`[PUBLIC]`, `[AUTH]`, roles) stay as defined | Meta-test asserts the internal-key guard is global and that only the health route is exempt |

---

## 9. Edge cases and abuse cases

| # | Case | Expected behaviour | Rule |
|---|---|---|---|
| E-1 | Two admins approve/reject the same join request at once | one succeeds, the other gets 400; one audit entry | BR-25 |
| E-2 | Two admins accept the same SOS at once | exactly one handler; the other gets 400 | BR-57 |
| E-3 | **[PHASE 2]** Two members RSVP GOING for the last seat | one gets the seat, the other 400 'Event is full' | BR-45 |
| E-4 | Two super admins approve the same application | one community created; the other 400 | BR-16 |
| E-5 | Two applications for the same RT/RW at once, or the same RT/RW typed with a different spelling ("Kel. Suka Maju" vs "sukamaju") | one PENDING, the other 409 (same region key after normalisation) | BR-12, BR-14 |
| E-6 | Two highlights set at once | at most one highlighted afterwards | BR-36 |
| E-7 | Double-tap on "send SOS" | second request 409 (one open SOS) | BR-55 |
| E-8 | Double submit of join request | second request 409 (already PENDING) | BR-23 |
| E-9 | Escalation job runs on two instances | each level sent once | BR-63 |
| E-10 | Join request submitted while the user already has 3 PENDING (parallel) | never more than 3 PENDING | BR-22 |
| E-11 | Brute-forcing 8-digit manual codes | per-user throttle + 2-window validity + join code; same error for every failure | BR-19, BR-20, BR-80 |
| E-12 | Photo of the QR shared on WhatsApp | expires within 2 minutes; ticket bound to the scanning user; admin still approves and sees scan time and window | BR-20, BR-21, BR-24 |
| E-13 | Account enumeration via register/resend/forgot/login | handled as in `nest-auth-and-security` (register 409 is the documented exception) | BR-3 |
| E-14 | Enumeration of other communities' ids | 404 identical to missing (BR-33); uuid ids | BR-33 |
| E-15 | Mass assignment (`globalRole`, `isOwner`, `status`, `communityId`, `handlerId` in a body) | rejected by validation (400) | BR-11 |
| E-16 | Member opens another member's report by id | 404 | BR-49 |
| E-17 | Removed member keeps an open socket | stops receiving community events at once | BR-69 |
| E-18 | Removed member reuses an old token | token still valid for the account, but every community call is 403 | BR-30, BR-31 |
| E-19 | Owner tries to delete their account or leave | 400 'Transfer ownership first'; after F-MEMBERSHIPS-13 it works | BR-7, BR-27, BR-74 |
| E-20 | Sender is the only admin of the community and sends SOS | SOS created with `recipientCount = 0`; frontend shows 112 | BR-62 |
| E-21 | Owner wants to demote/remove an admin who is handling an SOS, or that admin wants to leave or delete the account | 400 until the SOS is closed (resolve / false alarm by the handler, or cancel by the sender). Phase 2: release instead | BR-82 (Phase 2: BR-75) |
| E-22 | **[PHASE 2]** Event capacity lowered below GOING count | 400 | BR-42 |
| E-23 | Member of A uploads a report photo and tries to attach it to a report in B | files are uploaded as part of the create/edit call, never referenced by a client-provided id | BR-70 |
| E-24 | SOS spam | 3 per rolling hour per account; admins mark FALSE_ALARM | BR-56, BR-60 |
| E-25 | User deletes the account with a PENDING request | membership becomes LEFT, admins no longer see it in the queue | BR-6 |
| E-26 | Two owner transfers (or a transfer and a demote of the target) at once | exactly one owner afterwards; the loser gets 400 | BR-74 |
| E-27 | **[PHASE 2]** Two admins take over the same SOS at once, or a take-over races with a release | one consistent handler; the loser gets 400 | BR-75, BR-76 |
| E-28 | Browser calls the Railway API directly with a forged `X-Client-IP` | 403 (no internal key); the header is never read | BR-78, BR-79 |
| E-29 | Internal key leaks | attacker could spoof client IPs and reach REST without the BFF; JWT and roles still apply. Response: rotate on both platforms (8.11) | BR-78 |
| E-30 | Socket handshake with a forged left-most `X-Forwarded-For` | ignored; hop-count position used | BR-81 |
| E-31 | Socket ticket stolen and replayed | refused after first use or after 30 s; bound to the user's token version | BR-77 |
| E-32 | Socket from a page on another origin | refused by the `Origin` check | BR-81 |
| E-33 | Attacker hammers login for an admin's email to lock them out during an SOS | per-email login limit is looser than per-IP; the attacker hits the per-IP limit first; existing sessions are not affected | BR-80 |
| E-34 | Many users behind one carrier-grade NAT IP (mobile network) | logged-in hotspots are keyed by user id, so they do not share a bucket; only pre-login and the global limit are per IP | BR-80 |
| E-35 | Same RT/RW with a spelling that normalisation does not catch ("Sukamaju" vs "Sukamaj", or a different district spelling) | application accepted; it appears with the existing community in the possible-duplicates list; SUPER rejects it with a reason pointing to the QR join | BR-73 |
| E-36 | An admin accepts an SOS at the same moment the owner demotes them | either the accept wins (then the demote gets 400) or the demote wins (then the accept gets 403); never a non-admin handler | BR-58, BR-82 |
| E-37 | SOS sent while every admin has the app closed | in-app + realtime are missed; escalation email after 120 s, 240 s, 360 s; sender sees `recipientCount` and the 112 button | BR-62, BR-63, 8.6 |

---

## 10. Out of scope and open questions

### 10.1 Out of scope (v1)
- **[PHASE 2] (next, after v1 ships; specs kept in this PRD):** events + RSVP; admin dashboard; web push; SOS take-over and release; profile photo; announcement image; application supporting document.
- Everything marked M2/M3 in the breakdown, except JON-10 (pulled in, A-5) and KOM-05 owner transfer (pulled in, R-9).
- Cut from MVP: EVT-02 (event moderation), RPT-07 (public reports, so no visibility choice in RPT-01), WRG-02 (member detail view and its audit), part of PRV-03.
- Reading the audit log (any role): M2 (Q-5). Entries are still written in v1.
- Google login, refresh tokens, per-device logout, login history, email change.
- Security guards, cash, bills, dues, any payment.
- Notification preferences, digests; event reminders; SOS strikes and neighbourhood broadcast.
- Community suspension, admin recovery (SUP-04), platform metrics. Two-party confirmation of owner handover (the v1 transfer is one step by the owner).
- More than one API replica; shared throttle/ticket store (Redis).
- Official region codes, region reference data and cascading region lists (free text in v1, R-10).
- Impersonation of any kind (never planned).

### 10.2 Resolved questions (rev 2-3)

| # | Answer | Applied in |
|---|---|---|
| Q-1 | BFF on Vercel, API on Railway, no Cloudflare. REST: `X-Client-IP` + `X-Internal-Key`; sockets: `X-Forwarded-For` by hop count; `TRUST_PROXY_HOPS=1`, verify after deploy; per-user and per-email throttles | 0, 8.4, 8.11, 8.13, BR-24, BR-78..81 |
| Q-2 | Signed socket ticket, ~30 s, purpose `socket`, bound to user id + token version, sent in the handshake auth payload | F-NOTIFICATIONS-7, BR-77, D-3 |
| Q-3 | A-3 accepted; QR carries the community id; join code only for manual entry | BR-19, BR-20 |
| Q-4 | Handler loses admin access -> SOS back to SENT, escalation restarts; other admins can take over | F-SOS-10/11, BR-75, BR-76 |
| Q-5 | Audit log viewing deferred to M2 | 10.1 |
| Q-6 | Yes: `APPLICATION_APPROVED` / `APPLICATION_REJECTED`, in-app + email | BR-16, BR-17, BR-66, BR-68 |
| Q-7 | Super admin stays a separate account (A-18) | A-18 |
| Q-8 | Yes, the sender may cancel a HANDLING SOS | F-SOS-3, BR-59, 6.5 |
| Q-9 | No region data source: region is free text, duplicates handled by normalisation + super-admin review | R-10, BR-12, BR-73 |
| Q-10 | Not applicable any more (no region codes to retire) | R-12 |
| Q-11 | No overlap in v1. Rotation = set the new key on Railway and Vercel and redeploy both off-peak; expect up to a few minutes of 403 in between. A second accepted key is M2 | 8.11 |

### 10.3 Open questions

None blocking. Prompt 03 may list new ones under "Gaps in PRD".

---

## 11. Traceability

Column "v1": ✓ = built in v1, P2 = **[PHASE 2]** (skip in API spec / plan for v1).

| Feature | v1 | Business rules | Module |
|---|---|---|---|
| F-AUTH-1 | ✓ | BR-1, BR-2, BR-4, BR-11, BR-80 | `src/auth/` |
| F-AUTH-2 | ✓ | BR-3, BR-80 | `src/auth/` |
| F-AUTH-3 | ✓ | BR-3, BR-80 | `src/auth/` |
| F-AUTH-4 | ✓ | BR-2, BR-5, BR-80 | `src/auth/` |
| F-AUTH-5 | ✓ | - (skill-defined) | `src/auth/` |
| F-AUTH-6 | ✓ | BR-2, BR-5 | `src/auth/` |
| F-AUTH-7 | ✓ | BR-5, BR-77 | `src/auth/` |
| F-USERS-1 | ✓ | BR-9, BR-11 | `src/users/` |
| F-USERS-2 | P2 | BR-10, BR-70, BR-80 | `src/users/` |
| F-USERS-3 | ✓ | BR-5, BR-6, BR-7, BR-8, BR-82 | `src/users/` |
| F-COMMUNITIES-1 | ✓ | BR-12, BR-14, BR-15 | `src/communities/` |
| F-COMMUNITIES-2 | ✓ | BR-15 | `src/communities/` |
| F-COMMUNITIES-3 | ✓ | BR-34, BR-73 | `src/communities/` |
| F-COMMUNITIES-4 | ✓ | BR-16, BR-18, BR-66, BR-68, BR-71 | `src/communities/` |
| F-COMMUNITIES-5 | ✓ | BR-17, BR-66, BR-68, BR-71 | `src/communities/` |
| F-COMMUNITIES-6 | ✓ | BR-34 | `src/communities/` |
| F-COMMUNITIES-7 | ✓ | BR-13, BR-31 | `src/communities/` |
| F-MEMBERSHIPS-1 | ✓ | BR-19, BR-32 | `src/memberships/` |
| F-MEMBERSHIPS-2 | ✓ | BR-19, BR-20, BR-21, BR-80 | `src/memberships/` |
| F-MEMBERSHIPS-3 | ✓ | BR-21, BR-22, BR-23, BR-24, BR-79, BR-80 | `src/memberships/` |
| F-MEMBERSHIPS-4 | ✓ | BR-32 | `src/memberships/` |
| F-MEMBERSHIPS-5 | ✓ | BR-25, BR-68, BR-71 | `src/memberships/` |
| F-MEMBERSHIPS-6 | ✓ | BR-23, BR-25, BR-68, BR-71 | `src/memberships/` |
| F-MEMBERSHIPS-7 | ✓ | BR-23, BR-31 | `src/memberships/` |
| F-MEMBERSHIPS-8 | ✓ | BR-27, BR-30, BR-82 | `src/memberships/` |
| F-MEMBERSHIPS-9 | ✓ | BR-27, BR-28, BR-30, BR-71, BR-82 | `src/memberships/` |
| F-MEMBERSHIPS-10 | ✓ | BR-32 | `src/memberships/` |
| F-MEMBERSHIPS-11 | ✓ | BR-27, BR-29, BR-71, BR-82 | `src/memberships/` |
| F-MEMBERSHIPS-12 | ✓ | BR-26 | `src/memberships/` |
| F-MEMBERSHIPS-13 | ✓ | BR-27, BR-66, BR-71, BR-74 | `src/memberships/` |
| F-ANNOUNCEMENTS-1 | ✓ | BR-35, BR-36, BR-37 | `src/announcements/` |
| F-ANNOUNCEMENTS-2 | ✓ | BR-33, BR-35, BR-36 | `src/announcements/` |
| F-ANNOUNCEMENTS-3 | ✓ | BR-38 | `src/announcements/` |
| F-ANNOUNCEMENTS-4 | ✓ | BR-31, BR-39 | `src/announcements/` |
| F-ANNOUNCEMENTS-5 | ✓ | BR-31, BR-33 | `src/announcements/` |
| F-EVENTS-1 | P2 | BR-40, BR-47 | `src/events/` |
| F-EVENTS-2 | P2 | BR-41, BR-42, BR-47 | `src/events/` |
| F-EVENTS-3 | P2 | BR-41, BR-47 | `src/events/` |
| F-EVENTS-4 | P2 | BR-43, BR-44, BR-45 | `src/events/` |
| F-EVENTS-5 | P2 | BR-46 | `src/events/` |
| F-EVENTS-6 | P2 | BR-31, BR-33 | `src/events/` |
| F-REPORTS-1 | ✓ | BR-48, BR-52, BR-70, BR-80 | `src/reports/` |
| F-REPORTS-2 | ✓ | BR-49 | `src/reports/` |
| F-REPORTS-3 | ✓ | BR-49 | `src/reports/` |
| F-REPORTS-4 | ✓ | BR-48, BR-50, BR-70 | `src/reports/` |
| F-REPORTS-5 | ✓ | BR-50 | `src/reports/` |
| F-REPORTS-6 | ✓ | BR-32 | `src/reports/` |
| F-REPORTS-7 | ✓ | BR-51, BR-52 | `src/reports/` |
| F-SOS-1 | ✓ | BR-53, BR-54, BR-55, BR-56, BR-62, BR-64, BR-80 | `src/sos-alerts/` |
| F-SOS-2 | ✓ | BR-61, BR-69 | `src/sos-alerts/` |
| F-SOS-3 | ✓ | BR-59, BR-61, BR-63 | `src/sos-alerts/` |
| F-SOS-4 | ✓ | BR-57, BR-58, BR-61, BR-71 | `src/sos-alerts/` |
| F-SOS-5 | ✓ | BR-58, BR-61, BR-71 | `src/sos-alerts/` |
| F-SOS-6 | ✓ | BR-60, BR-61, BR-71 | `src/sos-alerts/` |
| F-SOS-7 | ✓ | BR-63, BR-68 | `src/sos-alerts/` |
| F-SOS-8 | ✓ | BR-32, BR-33 | `src/sos-alerts/` |
| F-SOS-9 | ✓ | BR-31 | `src/sos-alerts/` |
| F-SOS-10 | P2 | BR-57, BR-61, BR-71, BR-76 | `src/sos-alerts/` |
| F-SOS-11 | P2 | BR-61, BR-63, BR-71, BR-75 | `src/sos-alerts/` (called from `memberships`, `users`) |
| F-NOTIFICATIONS-1 | ✓ | BR-65, BR-66 | `src/notifications/` |
| F-NOTIFICATIONS-2 | ✓ | BR-65 | `src/notifications/` |
| F-NOTIFICATIONS-3 | ✓ | BR-65 | `src/notifications/` |
| F-NOTIFICATIONS-4 | ✓ | BR-69, BR-77, BR-81 | `src/notifications/` (gateway) |
| F-NOTIFICATIONS-5 | P2 | BR-67 | `src/push-subscriptions/` |
| F-NOTIFICATIONS-6 | ✓ | BR-68 | `src/notifications/` |
| F-NOTIFICATIONS-7 | ✓ | BR-77, BR-80 | `src/notifications/` (socket ticket) |
| F-DASHBOARD-1 | P2 | BR-32, BR-72 | `src/dashboard/` |
| F-DASHBOARD-2 | P2 | BR-32, BR-72 | `src/dashboard/` |
| F-HEALTH-1 | ✓ | BR-78 (exemption) | `src/health/` |
| F-PLATFORM-1 | ✓ | BR-78, BR-79 | `src/common/` project guard (D-1, D-5) |

v1 modules: `auth`, `users`, `communities`, `memberships`, `announcements`, `reports`, `sos-alerts`, `notifications`, `health`. Phase 2 modules: `events`, `dashboard`, `push-subscriptions`.

Cross-cutting rules without a single feature: BR-31..34 (every community module), BR-70 (report photo upload), BR-71 (audit-log helper), BR-78..80 (internal-key guard and throttle trackers on every route), BR-82 (SOS handler check, used by `memberships` and `users`).

---

## Assumptions made

| # | Assumption |
|---|---|
| A-1 | Login is email + password (your choice); OTP is used for email verification and password reset only. Breakdown AUT-02 (passwordless) is replaced. |
| A-2 | No refresh tokens in v1 (section 8.1). |
| A-3 | Manual join entry = 6-character community join code + 8-digit rotating code; the QR carries the community id (confirmed, Q-3). |
| A-4 | A community application is its own entity; a community exists only after approval, so `Community` has no status in v1 (SUSPENDED arrives with SUP-03). |
| A-5 | JON-10 (auto-expire after 7 days) is pulled into v1: without it the 3-PENDING limit can lock a user out forever. |
| A-6 | All reports are private in v1 because RPT-07 is cut; the visibility choice of RPT-01 comes back with RPT-07. |
| A-7 | Events publish immediately (EVT-02 cut). |
| A-8 | PRV-03 in v1 audits join decisions, removals, role changes, SOS handling and super-admin decisions; member-detail audit leaves with WRG-02. |
| A-9 | The 3-day cooldown also applies after REMOVED. |
| A-10 | SOS escalation at 120 / 240 / 360 s; SOS limit 3 per rolling hour per account. |
| A-11 | Admins may send SOS and reports (breakdown open question 1); they cannot accept their own SOS. |
| A-12 | Status enum values are English; the UI maps them to Indonesian labels. |
| A-13 | Editing an announcement does not notify again. |
| A-14 | Report categories: INFRASTRUCTURE, SECURITY, CLEANLINESS, SOCIAL, OTHER. |
| A-15 | The applicant's house block comes from the application and is used for the owner membership. |
| A-16 | Upload limits: report photo 5 MB in v1. Phase 2: avatar 2 MB, content images 5 MB, documents 5 MB. |
| A-17 | Community switching is a frontend concern; every community call names the community in the path. |
| A-18 | SUPER_ADMIN is created only by the seed and cannot join communities with that account. |
| A-19 | Notifications reference their entity by type + id (no foreign key); deletes clean them up explicitly. |
| A-20 | Event "finished" is derived from `endsAt`, not stored. |
| A-21 | Owner transfer is one step (owner + password); the target is not asked to confirm. Two-party confirmation stays M2. |
| A-22 | Owner transfer notifies both parties with a new type `OWNERSHIP_TRANSFERRED` (in-app only). |
| A-23 | **[PHASE 2]** A released SOS raises an immediate `SOS_ESCALATED` instead of waiting 120 s, because an admin was already involved and time has passed. |
| A-24 | **[PHASE 2]** Take-over needs no consent from the current handler; the change is visible and audited. |
| A-25 | Region is free text with the normalisation of BR-12; the prefix list is fixed in code. Similar-but-different spellings are a super-admin decision, not a system block. |
| A-26 | Used socket ticket ids are kept in memory (valid with one replica, 8.11). |
| A-27 | Per-email login limit ≈ 10 attempts / 15 min; per-IP follows the skill table. Exact values in the API spec. |
| A-28 | Swagger is off in production (or behind the internal key). |
| A-29 | v1 blocks membership changes of a member handling an open SOS (BR-82) instead of releasing it; acceptable because SOS are short-lived and the sender can always cancel. |
| A-30 | v1 has no web push: admins with the app closed rely on the escalation email (first one after 120 s). Accepted for the 5-day deadline. |
| A-31 | Phase 2 items stay specified here so that adding them later needs no new PRD, only a new API spec section and plan. |

