# DATA_MODEL: SIGAP v1

Source: `docs/PRD.md` rev 4. Only v1 features (✓ in PRD section 11). **[PHASE 2]** entities (`Event`, `EventRsvp`, `PushSubscription`, photo/image/document columns) are not in this schema.
Conventions: `nest-prisma` (naming, `@@map`, both timestamps, explicit `onDelete`, uuid ids, Prisma 7 `prisma-client` generator) and `nest-auth-and-security` rule 11 / 22 (`User`, `OtpCode`). Not restated.

Decisions taken from the PRD: ID type `uuid` (`@db.Uuid`, `ParseUUIDPipe`), PostgreSQL, soft delete on `User` only, no Google login (`UserIdentity` absent), no refresh tokens (`RefreshToken` absent).

## 1. Design notes (read before the schema)

| # | Note | Why |
|---|---|---|
| N-1 | `User.globalRole` / `GlobalRole` (not `role` / `Role`) | `nest-auth-and-security` rule 5: the project has an app-wide role **and** a per-community role. `MembershipRole` lives on `Membership.role`. See conflict C-1 in API_SPEC for how `AuthUser.role` is filled. |
| N-2 | Owner = `Community.ownerId`, no `Membership.isOwner` column. The API still returns a derived `isOwner` | "Exactly one owner" (BR-27) holds by construction; transfer (BR-74) is one conditional `updateMany` on the community row. PRD section 7 is conceptual; this is the physical form. |
| N-3 | Highlight = `Announcement.highlightCommunityId String? @unique` (set to the community id while highlighted, else null) | "At most one highlight per community" (BR-36) is enforced by the unique index; list order "highlight first" is `orderBy: [{ highlightCommunityId: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }]`. The API returns a derived `isHighlight`. |
| N-4 | "Only one X while PENDING/open" uses a nullable unique **guard column** that is set while the state lasts and nulled when it ends: `CommunityApplication.pendingRegionKey`, `CommunityApplication.pendingApplicantId`, `SosAlert.openKey` | Prisma schemas cannot declare partial unique indexes, and hand-edited migration SQL is avoided. PostgreSQL allows many NULLs in a unique index. A race loses with P2002 -> 409 via `PrismaExceptionFilter`. |
| N-5 | Counting limits (3 PENDING joins BR-22, 3 SOS/hour BR-56) and membership/handler checks (BR-82) take a **row lock first** with a conditional write inside `$transaction` (`tx.user.update({ where: { id }, data: { updatedAt: now } })` or `tx.membership.updateMany({ where: { id, status: 'ACTIVE', role: 'ADMIN' }, data: { updatedAt: now } })`), then count / check | Under READ COMMITTED a plain count-then-insert lets parallel requests pass together. The row lock serialises requests for the same user or membership without raw SQL. Details per endpoint in API_SPEC. |
| N-6 | `Membership.requestedAt` is separate from `createdAt` | The row is reused for every new request (BR-23); expiry (BR-26) counts from the latest request. |
| N-7 | `regionKey` = `${rt}:${rw}:${norm(village)}:${norm(district)}:${norm(city)}:${norm(province)}` computed by a pure helper (`src/common/helpers/region-key.helper.ts`) | BR-12. Stored on both application and community; unique on `Community`. |
| N-8 | Notifications point to their entity with `entityType` + `entityId` (no FK) | PRD A-19. Deletes of announcements/reports remove their notifications explicitly in the same transaction (BR-38, BR-50). |
| N-9 | GPS as `Float` (double precision) | Enough for metres; avoids `Decimal` strings in JSON. |
| N-10 | No job table: SOS escalation state is `SosAlert.escalationLevel` + `nextEscalationAt`; join expiry reads `Membership.requestedAt` | PRD 8.8. |
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

enum GlobalRole {
  SUPER_ADMIN
  USER
}

enum OtpPurpose {
  EMAIL_VERIFICATION
  PASSWORD_RESET
}

enum ApplicationStatus {
  PENDING
  APPROVED
  REJECTED
}

enum MembershipStatus {
  PENDING
  ACTIVE
  REJECTED
  EXPIRED
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
  APPLICATION_APPROVED
  APPLICATION_REJECTED
  OWNERSHIP_TRANSFERRED
  ANNOUNCEMENT
  REPORT_NEW
  REPORT_STATUS
  SOS_NEW
  SOS_ESCALATED
  SOS_ACCEPTED
  SOS_RESOLVED
}

enum EntityType {
  COMMUNITY_APPLICATION
  COMMUNITY
  MEMBERSHIP
  ANNOUNCEMENT
  REPORT
  SOS_ALERT
}

enum AuditAction {
  APPLICATION_APPROVED
  APPLICATION_REJECTED
  JOIN_APPROVED
  JOIN_REJECTED
  MEMBER_REMOVED
  MEMBER_PROMOTED
  MEMBER_DEMOTED
  OWNERSHIP_TRANSFERRED
  SOS_ACCEPTED
  SOS_HANDLING
  SOS_RESOLVED
  SOS_FALSE_ALARM
}

// ───────────── Accounts ─────────────

model User {
  id                   String     @id @default(uuid()) @db.Uuid
  email                String     @unique // lowercased + trimmed by the DTO; replaced on deletion (BR-6)
  passwordHash         String? // null after deletion (BR-6)
  name                 String
  phone                String? // normalised +628... (BR-9)
  globalRole           GlobalRole @default(USER)
  isActive             Boolean    @default(true) // false after deletion
  emailVerifiedAt      DateTime?
  tokenVersion         Int        @default(0)
  privacyConsentAt     DateTime? // null only for the seeded super admin
  privacyPolicyVersion String?
  deletedAt            DateTime? // soft delete + anonymised (BR-6)
  createdAt            DateTime   @default(now())
  updatedAt            DateTime   @updatedAt

  otpCodes             OtpCode[]
  applications         CommunityApplication[] @relation("ApplicationApplicant")
  reviewedApplications CommunityApplication[] @relation("ApplicationReviewer")
  ownedCommunities     Community[]            @relation("CommunityOwner")
  memberships          Membership[]           @relation("MembershipUser")
  decidedMemberships   Membership[]           @relation("MembershipDecider")
  announcements        Announcement[]
  reports              Report[]               @relation("ReportReporter")
  respondedReports     Report[]               @relation("ReportResponder")
  sentSosAlerts        SosAlert[]             @relation("SosSender")
  handledSosAlerts     SosAlert[]             @relation("SosHandler")
  sosEvents            SosEvent[]
  notifications        Notification[]
  auditLogs            AuditLog[]

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

model CommunityApplication {
  id                 String            @id @default(uuid()) @db.Uuid
  applicantId        String            @db.Uuid
  rt                 Int
  rw                 Int
  province           String
  city               String
  district           String
  village            String
  regionKey          String // N-7
  pendingRegionKey   String?           @unique // = regionKey while PENDING, else null (N-4, BR-14)
  pendingApplicantId String?           @unique @db.Uuid // = applicantId while PENDING, else null (N-4, BR-14)
  name               String?
  position           String
  houseBlock         String
  status             ApplicationStatus @default(PENDING)
  rejectReason       String?
  reviewedById       String?           @db.Uuid
  reviewedAt         DateTime?
  createdAt          DateTime          @default(now())
  updatedAt          DateTime          @updatedAt

  applicant User       @relation("ApplicationApplicant", fields: [applicantId], references: [id], onDelete: Restrict)
  reviewer  User?      @relation("ApplicationReviewer", fields: [reviewedById], references: [id], onDelete: Restrict)
  community Community?

  @@index([status, createdAt])
  @@index([rt, rw])
  @@index([applicantId, createdAt])
  @@map("community_applications")
}

model Community {
  id            String   @id @default(uuid()) @db.Uuid
  rt            Int
  rw            Int
  province      String
  city          String
  district      String
  village       String
  regionKey     String   @unique // BR-12
  name          String?
  joinCode      String   @unique // 6 chars, BR-18
  ownerId       String   @db.Uuid // the one owner (N-2, BR-27)
  applicationId String   @unique @db.Uuid
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  owner         User                 @relation("CommunityOwner", fields: [ownerId], references: [id], onDelete: Restrict)
  application   CommunityApplication @relation(fields: [applicationId], references: [id], onDelete: Restrict)
  memberships   Membership[]
  announcements Announcement[]
  reports       Report[]
  sosAlerts     SosAlert[]
  notifications Notification[]
  auditLogs     AuditLog[]

  @@index([rt, rw])
  @@map("communities")
}

model Membership {
  id             String           @id @default(uuid()) @db.Uuid
  userId         String           @db.Uuid
  communityId    String           @db.Uuid
  status         MembershipStatus @default(PENDING)
  role           MembershipRole   @default(WARGA)
  houseBlock     String
  requestedAt    DateTime // latest join request (N-6)
  scannedAt      DateTime?
  tokenWindow    Int? // w = floor(unix / 60) of the scanned QR (BR-19)
  ipHash         String? // HMAC of the client IP (BR-24)
  decidedById    String?          @db.Uuid
  decidedAt      DateTime?
  decisionReason String? // reject / remove reason
  joinedAt       DateTime?
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt

  user      User      @relation("MembershipUser", fields: [userId], references: [id], onDelete: Restrict)
  community Community @relation(fields: [communityId], references: [id], onDelete: Cascade)
  decidedBy User?     @relation("MembershipDecider", fields: [decidedById], references: [id], onDelete: Restrict)

  @@unique([userId, communityId])
  @@index([communityId, status, requestedAt])
  @@index([communityId, status, role])
  @@index([userId, status])
  @@index([status, requestedAt]) // expiry job (BR-26)
  @@map("memberships")
}

// ───────────── Content ─────────────

model Announcement {
  id                   String   @id @default(uuid()) @db.Uuid
  communityId          String   @db.Uuid
  authorId             String   @db.Uuid
  title                String
  body                 String
  highlightCommunityId String?  @unique @db.Uuid // = communityId while highlighted (N-3, BR-36)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  community Community @relation(fields: [communityId], references: [id], onDelete: Cascade)
  author    User      @relation(fields: [authorId], references: [id], onDelete: Restrict)

  @@index([communityId, createdAt])
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
  photoUrl      String?
  photoPublicId String? // Cloudinary public id, needed to delete the file (BR-70)
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
  openKey            String?   @unique // = "<communityId>:<senderId>" while open, else null (N-4, BR-55)
  recipientCount     Int // BR-62
  escalationLevel    Int       @default(0) // 0..3 (BR-63)
  nextEscalationAt   DateTime? // null when not SENT or level 3 reached
  acceptedAt         DateTime?
  handlingAt         DateTime?
  closedAt           DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  community Community  @relation(fields: [communityId], references: [id], onDelete: Cascade)
  sender    User       @relation("SosSender", fields: [senderId], references: [id], onDelete: Restrict)
  handler   User?      @relation("SosHandler", fields: [handlerId], references: [id], onDelete: Restrict)
  events    SosEvent[]

  @@index([communityId, status, createdAt])
  @@index([communityId, senderId, createdAt])
  @@index([senderId, createdAt]) // BR-56 rolling hour
  @@index([status, nextEscalationAt]) // escalation job
  @@index([handlerId, status]) // BR-82
  @@map("sos_alerts")
}

model SosEvent {
  id         String     @id @default(uuid()) @db.Uuid
  sosAlertId String     @db.Uuid
  fromStatus SosStatus? // null for the creation entry
  toStatus   SosStatus
  actorId    String     @db.Uuid
  note       String?
  createdAt  DateTime   @default(now())
  updatedAt  DateTime   @updatedAt

  sosAlert SosAlert @relation(fields: [sosAlertId], references: [id], onDelete: Cascade)
  actor    User     @relation(fields: [actorId], references: [id], onDelete: Restrict)

  @@index([sosAlertId, createdAt])
  @@map("sos_events")
}

// ───────────── Notifications and audit ─────────────

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
  archivedAt  DateTime?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  community Community? @relation(fields: [communityId], references: [id], onDelete: Cascade)

  @@index([userId, archivedAt, createdAt])
  @@index([userId, readAt])
  @@index([entityType, entityId])
  @@map("notifications")
}

model AuditLog {
  id          String      @id @default(uuid()) @db.Uuid
  actorId     String      @db.Uuid
  communityId String?     @db.Uuid
  action      AuditAction
  targetType  EntityType
  targetId    String      @db.Uuid
  metadata    Json? // ids and enum values only, never personal data (BR-71)
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  actor     User       @relation(fields: [actorId], references: [id], onDelete: Restrict)
  community Community? @relation(fields: [communityId], references: [id], onDelete: SetNull)

  @@index([communityId, createdAt])
  @@index([actorId, createdAt])
  @@map("audit_logs")
}
```

## 3. ER diagram

```
                          ┌──────────────┐
                          │    users     │
                          └──────┬───────┘
     ┌──────────────┬──────────┬─┴────────┬─────────────┬──────────────┬─────────────┐
     │1:N           │1:N       │1:N (own) │1:N          │1:N           │1:N          │1:N
     ▼              ▼          ▼          ▼             ▼              ▼             ▼
 otp_codes  community_      communities memberships  announcements  reports      notifications
            applications ──1:0..1──►  ▲  (user,comm)   (author)    (reporter)   (user)
            (applicant,               │      ▲                                       
             reviewer)                │      │N:1
                                      ├──────┘
                                      │1:N
          ┌───────────────┬───────────┼──────────────┬───────────────┬──────────────┐
          ▼               ▼           ▼              ▼               ▼              ▼
     memberships    announcements   reports      sos_alerts     notifications   audit_logs
                                                 │ (sender,         (optional)   (optional,
                                                 │  handler → users)              actor → users)
                                                 │1:N
                                                 ▼
                                             sos_events (actor → users)

Cardinalities
  users 1──N memberships N──1 communities        unique (userId, communityId)
  users 1──N communities (as owner)               exactly one owner per community
  community_applications 1──0..1 communities      community created on approval
  communities 1──N announcements / reports / sos_alerts / notifications / audit_logs
  sos_alerts 1──N sos_events
```

## 4. `onDelete` choices

| Relation (child -> parent) | onDelete | Reason |
|---|---|---|
| OtpCode.user -> User | Cascade | Codes have no meaning without the user (skill reference). Users are only soft deleted, so it never fires in practice. |
| CommunityApplication.applicant -> User | Restrict | History of who applied; users are soft deleted, never removed. |
| CommunityApplication.reviewer -> User | Restrict | Same; reviewer is a seeded super admin. |
| Community.owner -> User | Restrict | A community must always have an owner (BR-27). |
| Community.application -> CommunityApplication | Restrict | The application is the origin record of the tenant; deleting it must not orphan or drop the community. |
| Membership.user -> User | Restrict | Memberships end by status change, never by delete (PRD 7). |
| Membership.community -> Community | Cascade | Tenant delete (not in v1) removes everything of the tenant. |
| Membership.decidedBy -> User | Restrict | Decision history. |
| Announcement.community -> Community | Cascade | Tenant content. |
| Announcement.author -> User | Restrict | Author shown as "Mantan warga" after soft delete. |
| Report.community -> Community | Cascade | Tenant content. |
| Report.reporter / respondedBy -> User | Restrict | History. |
| SosAlert.community -> Community | Cascade | Tenant content. |
| SosAlert.sender / handler -> User | Restrict | Safety record, never lost. |
| SosEvent.sosAlert -> SosAlert | Cascade | History lines belong to the alert. |
| SosEvent.actor -> User | Restrict | History. |
| Notification.user -> User | Cascade | Personal inbox; also deleted explicitly on account deletion (BR-6). |
| Notification.community -> Community | Cascade | Tenant content. |
| AuditLog.actor -> User | Restrict | Audit must keep the actor. |
| AuditLog.community -> Community | SetNull | Audit outlives a deleted tenant (PRD 7). |

No pure pivot tables: `Membership` carries its own data, so it has both timestamps (`nest-prisma` rule 3).

## 5. Seed (`prisma/seed.ts`)

Per `nest-auth-and-security` rule 15: reads `SEED_SUPER_ADMIN_EMAIL`, `SEED_SUPER_ADMIN_PASSWORD`, `SEED_SUPER_ADMIN_NAME` from env, fails when missing, creates the super admin only if absent (verified, `globalRole = SUPER_ADMIN`, `privacyConsentAt = null`). Optional demo data (PRD PLT-02) only when `SEED_DEMO=true`: one approved application + community with an owner admin and one WARGA, using `SEED_DEMO_PASSWORD` (required when `SEED_DEMO=true`, no default). Seed-only vars are not in the boot schema.

## 6. Not in this schema (Phase 2)

`Event`, `EventRsvp`, `PushSubscription`; `User.photoUrl/photoPublicId`; `Announcement.imageUrl/imagePublicId`; `CommunityApplication.documentPublicId`; `SosEvent.previousHandlerId/newHandlerId/reason`; `EVENT_*` notification types; `SOS_TAKEN_OVER` / `SOS_RELEASED` audit actions.
