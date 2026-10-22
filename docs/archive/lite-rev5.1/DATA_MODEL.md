# DATA_MODEL: SIGAP

Source: `docs/PRD.md` rev 5.1 (Lite); no schema change from rev 5. Full v1 model archived in `docs/archive/full-v1/DATA_MODEL.md`.
Conventions: `nest-prisma` (naming, `@@map`, both timestamps, explicit `onDelete`, uuid ids, Prisma 7 `prisma-client` generator) and `nest-auth-and-security` rule 11 (`OtpCode`). Not restated.

Decisions taken from the PRD: ID type `uuid` (`@db.Uuid`, `ParseUUIDPipe`), PostgreSQL, **no soft delete** (no account deletion in Lite), no app-wide role, no `tokenVersion` (deviation L-1, PRD 8.13), no Google login, no refresh tokens.

## 1. Design notes

| # | Note | Why |
|---|---|---|
| N-1 | No app-wide role column. Every account is a normal user; community permissions come only from `Membership.role` (`ADMIN` \| `WARGA`) | PRD rev 5: one global role. `AuthUser.role` is filled with the literal `'USER'` (PRD 8.13 L-2). |
| N-2 | No owner. "At least one ACTIVE ADMIN per community" (BR-27) is checked in the service before demote / remove / leave | PRD rev 5 dropped owner and transfer. |
| N-3 | Highlight = `Announcement.isHighlight Boolean`. Setting it runs `updateMany({ communityId, isHighlight: true } -> false)` then the create/update, in one `$transaction` | BR-36 Lite. Two parallel highlights can both end up true (GAPS G-L4); accepted. |
| N-4 | Race safety = **conditional `updateMany`**: the `where` contains the expected current status (and the actor where relevant); `count === 0` means another request won or the state is wrong -> re-read for 404 vs 400 | Replaces the full-v1 guard columns and row locks. Used for join approve/reject, SOS accept/handle/resolve/false-alarm/cancel, report status changes, report edit/delete. |
| N-5 | "One open SOS per sender per community" (BR-55) = `findFirst` before `create`; a double tap racing in the same millisecond may create two (GAPS G-L3) | Lite simplification. |
| N-6 | `Membership.requestedAt` is separate from `createdAt` | The row is reused for every new join request (BR-23). |
| N-7 | `regionKey` = `${rt}:${rw}:${norm(village)}:${norm(district)}:${norm(city)}:${norm(province)}` from a pure helper (`src/common/helpers/region-key.helper.ts`); unique on `Community` | BR-12. A collision on create is P2002, rethrown as 409 with the BR-14 message. |
| N-8 | Notifications point to their entity with `entityType` + `entityId` (no FK) | Deletes of announcements/reports remove their notifications in the same transaction (BR-38, BR-50). |
| N-9 | GPS as `Float` | Enough precision, no `Decimal` strings. |
| N-10 | `SosAlert.escalatedAt` exists only for the **Stretch** escalation (F-SOS-7); unused by the definition of done | Nullable, harmless if the stretch is not built. |
| N-11 | No `@map` on columns; table names via `@@map` only | `nest-prisma` rule 2. |

## 2. Schema (`prisma/schema.prisma`)

```prisma
generator client {
  provider     = "prisma-client"
  output       = "../generated/prisma"
  moduleFormat = "cjs"
}

datasource db {
  provider = "postgresql" // url comes from prisma.config.ts (Prisma 7)
}

// ───────────── Enums ─────────────

enum OtpPurpose {
  EMAIL_VERIFICATION
  PASSWORD_RESET
}

enum MembershipStatus {
  PENDING
  ACTIVE
  REJECTED
  LEFT
  REMOVED
}

enum MembershipRole {
  ADMIN
  WARGA
}

enum ReportCategory {
  INFRASTRUCTURE
  SECURITY
  CLEANLINESS
  SOCIAL
  OTHER
}

enum ReportStatus {
  PENDING
  IN_PROGRESS
  RESOLVED
  REJECTED
}

enum SosType {
  MEDICAL
  FIRE
  CRIME
  OTHER
}

enum SosStatus {
  SENT
  ACCEPTED
  HANDLING
  RESOLVED
  CANCELLED
  FALSE_ALARM
}

enum NotificationType {
  JOIN_REQUEST
  JOIN_APPROVED
  JOIN_REJECTED
  ANNOUNCEMENT
  REPORT_NEW
  REPORT_STATUS
  SOS_NEW
  SOS_ACCEPTED
  SOS_RESOLVED
}

enum EntityType {
  MEMBERSHIP
  ANNOUNCEMENT
  REPORT
  SOS_ALERT
}

// ───────────── Accounts ─────────────

model User {
  id              String    @id @default(uuid()) @db.Uuid
  email           String    @unique // lowercased + trimmed by the DTO
  passwordHash    String
  name            String
  phone           String? // normalised +628... (BR-9)
  emailVerifiedAt DateTime? // null = not verified yet (BR-3)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  otpCodes         OtpCode[]
  memberships      Membership[]   @relation("MembershipUser")
  announcements    Announcement[]
  reports          Report[]       @relation("ReportReporter")
  respondedReports Report[]       @relation("ReportResponder")
  sentSosAlerts    SosAlert[]     @relation("SosSender")
  handledSosAlerts SosAlert[]     @relation("SosHandler")
  notifications    Notification[]

  @@map("users")
}

model OtpCode {
  id        String     @id @default(uuid()) @db.Uuid
  userId    String     @db.Uuid
  purpose   OtpPurpose
  codeHash  String
  attempts  Int        @default(0)
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, purpose, createdAt])
  @@map("otp_codes")
}

// ───────────── Communities ─────────────

model Community {
  id        String   @id @default(uuid()) @db.Uuid
  rt        Int
  rw        Int
  province  String
  city      String
  district  String
  village   String
  name      String?
  regionKey String   @unique // BR-12
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  memberships   Membership[]
  announcements Announcement[]
  reports       Report[]
  sosAlerts     SosAlert[]
  notifications Notification[]

  @@index([rt, rw])
  @@map("communities")
}

model Membership {
  id          String           @id @default(uuid()) @db.Uuid
  userId      String           @db.Uuid
  communityId String           @db.Uuid
  status      MembershipStatus @default(PENDING)
  role        MembershipRole   @default(WARGA)
  houseBlock  String
  requestedAt DateTime // latest join request (N-6)
  decidedAt   DateTime?
  joinedAt    DateTime?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  user      User      @relation("MembershipUser", fields: [userId], references: [id], onDelete: Restrict)
  community Community @relation(fields: [communityId], references: [id], onDelete: Cascade)

  @@unique([userId, communityId])
  @@index([communityId, status, requestedAt])
  @@index([communityId, status, role])
  @@index([userId, status])
  @@map("memberships")
}

// ───────────── Content ─────────────

model Announcement {
  id          String   @id @default(uuid()) @db.Uuid
  communityId String   @db.Uuid
  authorId    String   @db.Uuid
  title       String
  body        String
  isHighlight Boolean  @default(false) // at most one true per community (BR-36, N-3)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  community Community @relation(fields: [communityId], references: [id], onDelete: Cascade)
  author    User      @relation(fields: [authorId], references: [id], onDelete: Restrict)

  @@index([communityId, isHighlight, createdAt])
  @@map("announcements")
}

model Report {
  id            String         @id @default(uuid()) @db.Uuid
  communityId   String         @db.Uuid
  reporterId    String         @db.Uuid
  title         String
  description   String
  category      ReportCategory
  status        ReportStatus   @default(PENDING)
  responseNote  String?
  respondedById String?        @db.Uuid
  respondedAt   DateTime?
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  community   Community @relation(fields: [communityId], references: [id], onDelete: Cascade)
  reporter    User      @relation("ReportReporter", fields: [reporterId], references: [id], onDelete: Restrict)
  respondedBy User?     @relation("ReportResponder", fields: [respondedById], references: [id], onDelete: Restrict)

  @@index([communityId, status, createdAt])
  @@index([communityId, reporterId, createdAt])
  @@map("reports")
}

// ───────────── SOS ─────────────

model SosAlert {
  id                 String    @id @default(uuid()) @db.Uuid
  communityId        String    @db.Uuid
  senderId           String    @db.Uuid
  handlerId          String?   @db.Uuid
  type               SosType
  note               String?
  latitude           Float?
  longitude          Float?
  houseBlockSnapshot String // BR-54
  status             SosStatus @default(SENT)
  recipientCount     Int // BR-62
  resolutionNote     String? // optional note on resolve / false alarm
  acceptedAt         DateTime?
  handlingAt         DateTime?
  closedAt           DateTime?
  escalatedAt        DateTime? // Stretch only (F-SOS-7, N-10)
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  community Community @relation(fields: [communityId], references: [id], onDelete: Cascade)
  sender    User      @relation("SosSender", fields: [senderId], references: [id], onDelete: Restrict)
  handler   User?     @relation("SosHandler", fields: [handlerId], references: [id], onDelete: Restrict)

  @@index([communityId, status, createdAt])
  @@index([communityId, senderId, status])
  @@index([status, createdAt]) // stretch escalation scan
  @@map("sos_alerts")
}

// ───────────── Notifications ─────────────

model Notification {
  id          String           @id @default(uuid()) @db.Uuid
  userId      String           @db.Uuid
  communityId String?          @db.Uuid
  type        NotificationType
  title       String
  body        String
  entityType  EntityType?
  entityId    String?          @db.Uuid // no FK (N-8)
  readAt      DateTime?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  community Community? @relation(fields: [communityId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@index([userId, readAt])
  @@index([entityType, entityId])
  @@map("notifications")
}
```

8 models: `User`, `OtpCode`, `Community`, `Membership`, `Announcement`, `Report`, `SosAlert`, `Notification`.

## 3. ER diagram

```
                              ┌──────────┐
                              │  users   │
                              └────┬─────┘
       ┌────────────┬─────────────┼──────────────┬──────────────┬───────────────┐
       │1:N         │1:N          │1:N (author)  │1:N (reporter,│1:N (sender,   │1:N
       ▼            ▼             ▼              │   responder) │   handler)    ▼
   otp_codes   memberships   announcements       ▼              ▼          notifications
                    ▲N:1           ▲N:1        reports       sos_alerts         ▲N:1 (optional)
                    │              │              ▲N:1           ▲N:1            │
                    └──────────────┴──────────────┴──────────────┴───────────────┘
                                          1 communities

  users 1──N memberships N──1 communities         unique (userId, communityId)
  communities 1──N announcements / reports / sos_alerts / notifications
```

## 4. `onDelete` choices

| Relation (child -> parent) | onDelete | Reason |
|---|---|---|
| OtpCode.user -> User | Cascade | Codes have no meaning without the user (skill reference). |
| Membership.user -> User | Restrict | Users are never deleted in Lite; memberships end by status. |
| Membership.community -> Community | Cascade | Tenant content. |
| Announcement.community -> Community | Cascade | Tenant content. |
| Announcement.author -> User | Restrict | Keep the author. |
| Report.community -> Community | Cascade | Tenant content. |
| Report.reporter / respondedBy -> User | Restrict | History. |
| SosAlert.community -> Community | Cascade | Tenant content. |
| SosAlert.sender / handler -> User | Restrict | Safety record. |
| Notification.user -> User | Cascade | Personal inbox. |
| Notification.community -> Community | Cascade | Tenant content. |

No pure pivot tables: `Membership` carries its own data, so it has both timestamps (`nest-prisma` rule 3).

## 5. Seed (`prisma/seed.ts`)

Per `nest-auth-and-security` rule 15 (no default password, idempotent, not in `src/`):
- Reads `SEED_DEMO_PASSWORD` from env and **fails when missing**. Seed-only, not in the boot schema.
- Creates (only if the email does not exist yet), all with `emailVerifiedAt = now`:
  - `admin@sigap.test` "Pak Budi (Ketua RT)": creates community **RT 001/RW 006**, Kel. Sukamaju, Kec. Cimahi Tengah, Kota Cimahi, Jawa Barat, name "Griya Asri"; ACTIVE ADMIN, houseBlock "Blok A1 No. 1".
  - `warga1@sigap.test`, `warga2@sigap.test`: ACTIVE WARGA with house blocks.
  - `tamu@sigap.test`: no membership (for the scan demo).
- Content: 3 announcements (1 highlighted), 4 reports by the WARGA accounts covering `PENDING`, `IN_PROGRESS`, `RESOLVED`, `REJECTED` (with response notes).
- Uses `HashingService`-compatible scrypt hashing (same `salt:hash` format) so seeded users can log in.
- No super admin (PRD rev 5).

## 6. Not in Lite

Models: `CommunityApplication`, `SosEvent`, `AuditLog`, `Event`, `EventRsvp`, `PushSubscription`.
Columns: `User.globalRole`, `isActive`, `tokenVersion`, `privacyConsentAt`, `privacyPolicyVersion`, `deletedAt`, photo columns; `Community.joinCode`, `ownerId`, `applicationId`; `Membership.scannedAt`, `tokenWindow`, `ipHash`, `decidedById`, `decisionReason`; `Announcement.highlightCommunityId`, image columns; `Report.photoUrl`, `photoPublicId`; `SosAlert.openKey`, `escalationLevel`, `nextEscalationAt`.
Enums / values: `GlobalRole`, `ApplicationStatus`, `AuditAction`, `MembershipStatus.EXPIRED`, notification types `APPLICATION_*`, `OWNERSHIP_TRANSFERRED`, `SOS_ESCALATED`, `EVENT_*`; `EntityType.COMMUNITY_APPLICATION`, `COMMUNITY`.
