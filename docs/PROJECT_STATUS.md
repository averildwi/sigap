# PROJECT_STATUS: WargaKita Lite (per 20 Oktober 2026)

Ringkasan kondisi repo **sebelum mulai mengerjakan halaman frontend**. Dasar
dokumen: `docs/PRD.md` rev 5.2, `docs/API_SPEC.md`, `docs/DATA_MODEL.md`,
`docs/IMPLEMENTATION_PLAN.md`, `docs/GAPS.md`, dan kondisi kode di `apps/backend`
per git history terakhir (`feat/notifications` sudah di-merge).

## 0. Gambaran umum

| Aspek | Nilai |
|---|---|
| Produk | WargaKita Lite — platform multi-tenant RT/RW (komunitas, keanggotaan QR, pengumuman, laporan, SOS, notifikasi) |
| Monorepo | npm workspaces + Turborepo (`apps/backend`, `apps/web`, `packages/*`) |
| Backend | NestJS 11 + Prisma 7 (adapter `pg`) + PostgreSQL, semua route di prefix `/api` |
| Frontend | Next.js 16 + React 19 (`apps/web`) — **masih scaffold bawaan create-turbo, belum disentuh** |
| Deploy plan | Backend ke Railway (Root Directory `apps/backend`), frontend ke Vercel (`apps/web`) |
| Bahasa | Teks UI & notifikasi Indonesia, pesan API Inggris |
| Swagger | Dari server berjalan: `http://localhost:<PORT>/docs` (bearer auth `access-token`) |
| ID | Semua id `uuid` → semua `:xxxId` memakai `ParseUUIDPipe` |

Kondisi verifikasi terakhir (dijalankan dari `apps/backend`):
`npm test` → **15 suite, 115 test, semua pass** (2026-10-20). Lint & build hijau
pada commit `feat/notifications`.

## 1. Progres terhadap IMPLEMENTATION_PLAN

| Step | Isi | Status |
|---|---|---|
| 0 | Turborepo root + docs | ✅ |
| 1 | Scaffolds (nest, prisma, common, skills) | ✅ |
| 2 | Config, env schema, throttle tiers, health | ✅ |
| 3 | Prisma schema + migration + seed | ✅ |
| 4 | Auth (OTP, JWT, reset, change-password, logout-all, meta-test, e2e) | ✅ |
| 5 | Communities (+ helper region & akses) | ✅ |
| 6 | Notifications (templates, service, gateway realtime, endpoint) | ✅ |
| 7 | Memberships (join QR, antrean, approve/reject, admin ops) | ❌ belum |
| 8 | Announcements (endpoint) | ❌ belum |
| 9 | Reports (endpoint) | ❌ belum |
| 10 | SOS alerts (endpoint + mailer) | ❌ belum |
| 11 | Final pass (e2e demo flow, README) | ❌ belum |

> **Pola penting:** schema Prisma untuk **semua** entitas (Announcement, Report,
> SosAlert, Notification) sudah ada sejak Step 3, dan `prisma/seed.ts` sudah
> mengisi sample data untuk semuanya — yang belum ada adalah **endpoint**
> (service + controller) untuk memberships/announcements/reports/SOS.

## 2. Struktur backend yang sudah ada

```
apps/backend/src
├─ app.module.ts          # AppConfigModule, Hashing, Mail, RealtimeSessions,
│                         # ThrottlerModule (5 tier), Prisma, Auth, Communities,
│                         # Health, Notifications; APP_GUARD = ThrottlerGuard
├─ main.ts                # trust proxy, prefix /api, CORS (FRONTEND_URL),
│                         # ws adapter, pipe, interceptors, filters, Swagger /docs
├─ config/                # env.schema.ts (Joi), throttle.config.ts (5 tier L-5)
├─ prisma/                # PrismaService (nest-prisma scaffold)
├─ health/                # GET /api/health (BR-84, SELECT 1)
├─ auth/                  # 9 endpoint + otp/ + strategies/jwt.strategy.ts
├─ communities/           # 3 endpoint
├─ notifications/         # templates, service, controller, real-time gateway
├─ recipes/               # FrontendCorsIoAdapter (CORS Socket.IO dari FRONTEND_URL)
└─ common/                # scaffold @averildwi/nest-common + helpers milik fitur
   ├─ guards/             # JwtAuthGuard, RolesGuard  (tidak ada @Roles di Lite)
   ├─ filters/            # GlobalExceptionFilter, PrismaExceptionFilter
   ├─ interceptors/       # LoggerInterceptor, TransformInterceptor (envelope)
   ├─ hashing/            # HashingService (scrypt async)
   ├─ mail/               # port OTP_SENDER: resend-otp-sender / console-otp-sender
   ├─ realtime/           # registry sesi socket, drop socket saat tokenVersion naik
   ├─ helpers/            # community-access (assertMember/assertAdmin),
   │                      # region-normalise, region-key, format-label, paginate,
   │                      # community-view (bentuk respons bersama), error-response
   ├─ dto/                # PaginationDto (page 1.., limit 1..100, default 20)
   └─ types/auth-user.ts  # AuthUser, JwtPayload { sub, email, tv }
```

## 3. Endpoint yang sudah hidup (17 route REST + 1 gateway WS)

Semua di bawah `/api`. Semua respons dibungkus envelope
`{ statusCode, message, data, timestamp }` (+ `meta` untuk list terpaginasi).

### 3.1 auth — `src/auth/auth.controller.ts`

| Route | Guard/tier | Catatan |
|---|---|---|
| `POST /auth/register` | PUBLIC, tier `auth` | buat akun + OTP pertama dalam 1 transaksi |
| `POST /auth/verify-otp` | PUBLIC, tier `auth` | email_verify → akses token |
| `POST /auth/resend-otp` | PUBLIC, tier `sendCode` | 200 selalu sama (F-AUTH-2) |
| `POST /auth/login` | PUBLIC, tier `auth` | password dulu, lalu 403 disabled / unverified; 401 identik untuk email/salah |
| `POST /auth/forgot-password` | PUBLIC | balasan 200 selalu sama |
| `POST /auth/reset-password` | PUBLIC, tier `auth` | bump `tokenVersion` → semua sesi mati |
| `GET /auth/me` | AUTH | `profileSelect`: id, email, name, phone, globalRole, emailVerifiedAt, createdAt (BR-83) |
| `POST /auth/change-password` | AUTH, tier `auth` | bump tv + token baru dikembalikan |
| `POST /auth/logout-all` | AUTH | bump tv + drop socket user |

### 3.2 communities — `src/communities/communities.controller.ts`

| Route | Catatan |
|---|---|
| `POST /communities` | AUTH. Normalisasi region (BR-12, kota wajib awalan `Kota`/`Kabupaten`/`Kab`), duplikat regionKey → 409 (BR-14), buat community + membership ADMIN aktif dalam 1 transaksi |
| `GET /communities/mine` | AUTH. Semua komunitas saya, filter opsional `status` (`QueryMyCommunitiesDto`), terpaginasi |
| `GET /communities/:communityId` | AUTH kartu komunitas. Menghasilkan `CommunitySummary` + `MembershipView` (lihat `community-view.helper.ts`). HARUS anggota ACTIVE → selain itu 403 (BR-31) |

### 3.3 notifications — `src/notifications/notifications.controller.ts`

| Route | Catatan |
|---|---|
| `GET /notifications` | AUTH; daftar sendiri, filter (mis. unread), terpaginasi |
| `GET /notifications/unread-count` | AUTH |
| `POST /notifications/read-all` | AUTH; `updateMany` `where userId = saya` |
| `POST /notifications/:notificationId/read` | AUTH; id milik orang lain → 404 (BR-65) |

### 3.4 health

`GET /api/health` → 200 `{ status: 'ok' }` atau 503 saat DB mati.

### 3.5 Realtime (BR-77, BR-69, BR-81)

- Namespace **`/realtime`** (Socket.IO), origin dari `FRONTEND_URL` (`FrontendCorsIoAdapter`).
- Token akses **hanya** di handshake `auth.token` (bukan query string); validasi
  identik dengan HTTP (`JwtStrategy.validate`: user ada, `isActive`, verified,
  `tokenVersion` cocok). Gagal → `disconnect(true)`.
- Setiap socket join room `user:<userId>` saja.
- Event server → client: `notification:new`, `sos:new`, `sos:updated`,
  `join-request:new` (di-emit **setelah** commit DB, hanya ke penerima hasil query
  DB saat itu — member yang di-remove berhenti menerima event).
- Ketika `tokenVersion` naik (reset/change-password/logout-all), semua socket
  user terputus otomatis.

## 4. Kontrak API yang perlu dikonsumsi frontend

| Topik | Konvensi |
|---|---|
| Auth header | `Authorization: Bearer <accessToken>` (dari login / verify-otp / change-password) |
| Error body | `{ statusCode, message: string \| string[], data: null, error, timestamp }` — `message` bisa array saat validation pipe gagal |
| Pagination | Query `page` (default 1), `limit` (default 20, max 100); list memakai `meta` di envelope |
| Label komunitas | `RT001/RW006` dihitung server (`formatLabel`) |
| Region | Kota **wajib** mulai dengan `Kota`/`Kabupaten`/`Kab` → frontend sebaiknya pakai select Kota/Kabupaten (G-L15) |
| Status enum (di code) | Membership `PENDING/ACTIVE/REJECTED/LEFT/REMOVED`; Report `PENDING/IN_PROGRESS/RESOLVED/REJECTED`; SOS `SENT/ACCEPTED/HANDLING/RESOLVED/CANCELLED/FALSE_ALARM`; label Indonesia ada di PRD §3 |
| Notifikasi | 9 tipe (`JOIN_REQUEST`, `JOIN_APPROVED`, `JOIN_REJECTED`, `ANNOUNCEMENT`, `REPORT_NEW`, `REPORT_STATUS`, `SOS_NEW`, `SOS_ACCEPTED`, `SOS_RESOLVED`), teks sudah Indonesia via `notification-templates.ts` |
| Thumbnail/foto | Tidak ada upload apa pun di Lite (report JSON-only) |
| Admin check | Di sisi service (`assertMember`/`assertAdmin`); semua route hanya `[PUBLIC]`/`[AUTH]` — frontend tidak bisa mengandalkan 401 vs 403 untuk membedakan admin/warga (403 'Admin access required') |

## 5. Basis data & seed

- 8 model: `User`, `OtpCode`, `Community`, `Membership`, `Announcement`,
  `Report`, `SosAlert`, `Notification` (+ enum `GlobalRole`,
  `MembershipStatus/Role`, `ReportCategory/Status`, `SosType/Status`,
  `NotificationType`, `EntityType`, `OtpPurpose`).
- 1 migration: `20261019012026_init`.
- `prisma/seed.ts` (idempoten) butuh env `SEED_ADMIN_EMAIL` & `SEED_DEMO_PASSWORD`,
  lalu membuat:
  - 4 akun terverifikasi: admin seed + `warga1@wargakita.test`,
    `warga2@wargakita.test`, `tamu@wargakita.test` (password sama, demo).
  - Komunitas demo **RT001/RW006 "Griya Asri"** (Kel. Sukamaju, Kec. Cimahi
    Tengah, Kota Cimahi, Jawa Barat) + 3 membership ACTIVE (1 admin, 2 warga).
  - 3 pengumuman (1 highlight) dan 4 laporan contoh (semua status: PENDING,
    IN_PROGRESS, RESOLVED, REJECTED dengan `responseNote`).

## 6. Konfigurasi & env (sudah lengkap di `.env.example`)

`DATABASE_URL, PORT, NODE_ENV, FRONTEND_URL, JWT_SECRET, JWT_EXPIRES_IN,
TRUST_PROXY_HOPS, APP_URL, JOIN_TOKEN_SECRET, OTP_TTL_MINUTES,
OTP_RESEND_COOLDOWN_SECONDS, OTP_SENDER, RESEND_API_KEY, MAIL_FROM,
THROTTLE_TTL, THROTTLE_LIMIT, AUTH_THROTTLE_LIMIT, SEND_CODE_THROTTLE_LIMIT,
JOIN_THROTTLE_LIMIT, SOS_THROTTLE_LIMIT, SEED_ADMIN_EMAIL, SEED_DEMO_PASSWORD`.

Untuk frontend yang penting: `FRONTEND_URL` (CORS REST + Socket), `APP_URL`
(link di email), dan semua var lain dibaca lewat `ConfigService` — frontend
hanya perlu tahu base URL API + `JOIN_TOKEN_SECRET` tetap rahasia.

## 7. Yang BELUM ada di backend (frontend jangan bangun dulu)

| Fitur/Endpoint | Kondisi |
|---|---|
| Seluruh modul `memberships` (QR join, preview, antrean, approve/reject, member list, role, remove/leave) | ❌ belum ada endpoint; helper token w/ HMAC (BR-19/20) juga belum |
| Endpoint `announcements` (list/detail/create/edit/delete + highlight) | ❌ belum |
| Endpoint `reports` (submit/list/detail/status) | ❌ belum |
| Endpoint `sos-alerts` + mailer SOS | ❌ belum |
| `PATCH /auth/me` (edit profil, F-USERS-1) | ❌ belum — read profile (`GET /auth/me`) sudah ada |
| Logout per-device, refresh token, upload, audit log, dashboard, events | ✅ memang dibuang di Lite |

Implikasi: halaman frontend untuk join QR, pengumuman, laporan, dan SOS
**akan 404** sampai backend mengirim Step 7–10. Bisa dibangun dengan mock/kontrak
dari `docs/API_SPEC.md`, atau backend melanjutkan Step 7 dulu.

## 8. Cara menjalankan & verifikasi (backend)

```bash
# dari root repo
npm install                 # HANYA di root (monorepo npm workspaces)
npx turbo run test --filter=backend

# dari apps/backend
npm run test                # 115 unit test (dummy DB/in-memory)
node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config ./test/jest-e2e.json --runInBand   # e2e: butuh DATABASE_URL + JWT_SECRET nyata
npm run build
```

E2e yang sudah ada: `test/auth.e2e-spec.ts` (register→verify→login→reset→
token lama 401, dst.) dan `test/route-guards.e2e-spec.ts` (meta-test guard).
Skenario e2e demo flow lengkap menunggu Step 11.

## 9. Kondisi frontend saat ini

- `apps/web` masih persis hasil `create-next-app`: satu homepage demo
  (`app/page.tsx`), `layout.tsx`, `globals.css`, Tailwind belum dipasang
  eksplisit, `@repo/ui` (Button) tersedia dari `packages/ui`.
- Belum ada: client API (fetch wrapper), socket.io-client, state/auth store,
  router pages, guard halaman, integrasi CORS env `NEXT_PUBLIC_*`.
- Kesepakatan monorepo: `npm install <pkg> -w apps/web` dari ROOT, jangan di
  dalam `apps/web`.
