# DESIGN.md — SIGAP UI/UX System Specification
**Product:** SIGAP (Multi-tenant RT/RW Community Platform)  
**Status:** Approved for Implementation (Competition Build 1–2 Days)  
**Target Audience:** Indonesian Residents (*Warga*) and Neighborhood Administrators (*Pengurus RT/RW*)  
**Primary Language:** Bahasa Indonesia  
**Tech Stack:** Next.js (Frontend on Vercel), NestJS API & PostgreSQL (Railway), Socket.IO  

---

## 1. Design Principles & Brand Direction

### A. Core Philosophy
1. **Civic Trust & Reassurance (*Ketenteraman Warga*):** Mengedepankan rasa aman, transparan, dan inklusif. Antarmuka dirancang untuk warga dengan rentang literasi digital yang beragam.
2. **Keterbacaan & Kecepatan Respons:** Informasi genting (SOS) dan pengumuman resmi harus langsung terbaca dalam 2 detik pertama tanpa gangguan dekorasi visual berlebihan.
3. **Pemisahan Jelas Antara Aksi Biasa & Darurat:** Fitur harian menggunakan palet emerald/hijau yang menenangkan, sementara aksi SOS menggunakan warna merah crimson kontras tinggi yang terisolasi secara visual.
4. **Fidelitas Ketat Terhadap [PRD](PRD.md) Lite:** Tidak ada fitur yang diada-adakan di luar scope (tidak ada upload foto/berkas, tidak ada family card/KK, tidak ada payment/chat langsung).

---

## 2. Color Palette & Semantic Tokens

### Primary Palette (Civic Emerald - Ketenangan Komunitas)
- `primary-900`: `#052e16` — Text gelap, aksen deep brand
- `primary-800`: `#166534` — Hover header, batas tegas
- `primary-700`: `#15803d` — **Primary Brand Accent & CTA Utama**
- `primary-600`: `#16a34a` — Tombol interaktif, indikator aktif
- `primary-100`: `#dcfce7` — Background badge status aktif, badge Lite
- `primary-50`: `#f0fdf4` — Background seleksi, card highlight pengurus

### Emergency Palette (SOS Crimson & Warning)
- `emergency-900`: `#7f1d1d` — Header banner SOS aktif
- `emergency-700`: `#b91c1c` — Border alert dan aksi pembatalan
- `emergency-600`: `#dc2626` — **Tombol Kirim SOS Darurat & Status Sent**
- `emergency-100`: `#fee2e2` — Background alert, kartu darurat
- `emergency-50`: `#fef2f2` — Card background panggilan darurat

### Semantic Status Badges (Sesuai State Machine PRD Bab 6)
| Status Enum | Label UI (Bahasa) | Text Color | Background | Border |
|---|---|---|---|---|
| `ACTIVE` | **Aktif** / **Pengurus** | `#15803d` | `#dcfce7` | `#86efac` |
| `PENDING` | **Menunggu** | `#b45309` | `#fef3c7` | `#fde68a` |
| `IN_PROGRESS` / `HANDLING` | **Diproses** / **Ditangani** | `#1d4ed8` | `#dbeafe` | `#93c5fd` |
| `RESOLVED` | **Selesai** | `#15803d` | `#dcfce7` | `#86efac` |
| `REJECTED` / `REMOVED` | **Ditolak** / **Dikeluarkan** | `#b91c1c` | `#fee2e2` | `#fca5a5` |
| `SENT` (SOS) | **Dikirim** | `#dc2626` | `#fee2e2` | `#f87171` |
| `ACCEPTED` (SOS) | **Diterima** | `#0284c7` | `#e0f2fe` | `#7dd3fc` |
| `FALSE_ALARM` | **Salah Alarm** | `#64748b` | `#f1f5f9` | `#cbd5e1` |
| `CANCELLED` | **Dibatalkan** | `#475569` | `#f1f5f9` | `#cbd5e1` |

### Neutral & Surface Hierarchy
- `surface-canvas`: `#f8fafc` (Slate 50) — Latar belakang aplikasi
- `surface-card`: `#ffffff` (White) — Kartu konten, formulir, modal
- `surface-subtle`: `#f1f5f9` (Slate 100) — Container input, table header
- `border-default`: `#e2e8f0` (Slate 200) — Garis pemisah komponen
- `text-primary`: `#0f172a` (Slate 900) — Judul dan teks utama (kontras tinggi)
- `text-secondary`: `#475569` (Slate 600) — Subteks, label informasi
- `text-muted`: `#94a3b8` (Slate 400) — Timestamp, metadata

---

## 3. Typography Scale (Plus Jakarta Sans / Inter)

- **Display Heading (`text-2xl` / 24px - 28px, Bold 800):** Judul halaman utama, Nama RT/RW (`RT 001 / RW 006`).
- **Section Heading (`text-lg` / 18px - 20px, Bold 700):** Judul pengumuman, section laporan, header kartu SOS.
- **Card Title (`text-base` / 16px, SemiBold 600):** Judul item list, nama warga, kategori laporan.
- **Body Regular (`text-sm` / 14px, Regular 400 & Medium 500):** Paragraf isi laporan, teks instruksi, isi pengumuman.
- **Caption / Meta (`text-xs` / 12px, Medium 500 & SemiBold 600):** Tanggal, blok rumah, badge peran, waktu token QR.

---

## 4. Navigation Architecture & Role-Based Layout

### Desktop Layout Structure
- **Persistent Left Sidebar (Width: 260px):**
  - **Brand Header:** Logo resmi SIGAP + indikator badge 'LITE'.
  - **Community Switcher Card:** Dropdown interaktif menampilkan komunitas terpilih (`RT 001 / RW 006`), wilayah (`Kel. Suka Maju`), dan badge peran user (`Pengurus (ADMIN)` atau `Warga (WARGA)`).
  - **Menu List:**
    1. *Beranda Komunitas* (Dashboard ringkas RT/RW)
    2. *Pengumuman* (Official broadcasts)
    3. *Laporan Warga* (Pengaduan & penanganan)
    4. *Anggota & Pendaftaran* (Admin-only: QR dinamis + antrean persetujuan)
    5. *Tombol SOS Darurat* (Akses cepat keadaan gawat darurat)
    6. *Notifikasi* (Inbox pesan dengan unread badge)
    7. *Akun Saya* (Profil & keamanan sesi)
  - **Footer Sidebar:** Profil ringkas penanggung jawab & tombol pengaturan cepat.
- **Top Bar Utility:**
  - Status konektivitas WebSocket realtime (`Terhubung / Realtime`).
  - Emergency SOS Fast-Action button (`Kirim SOS Darurat` - Red button).
  - Bell notifikasi dengan jumlah belum dibaca.
  - Avatar pengguna dan identitas peran.

### Role Adaptations
- **Warga (WARGA):**
  - Menu terfokus pada: Beranda Komunitas, Pengumuman, Laporan Saya (buat & pantau laporan pribadi), Tombol SOS, Notifikasi, Akun.
  - Akses fitur administratif dinonaktifkan (403 guard di backend).
- **Pengurus (ADMIN):**
  - Akses penuh ke antrean pendaftaran warga (`PENDING`), daftar warga aktif, ubah peran anggota, seluruh laporan komunitas (status update), serta monitor dan respon pusat SOS.

---

## 5. Key Modules & Screen Implementation Details

### A. Beranda Komunitas (Community Hub)
- **Kartu Identitas Wilayah:** Format label resmi `RT001/RW006`, kelurahan, kecamatan, kota/kabupaten, dan total warga aktif.
- **Banner Pengumuman Utama (Disematkan):** Tepat 1 pengumuman ter-highlight dengan latar kontras lembut, status pin, dan link detail.
- **Aksi Cepat Warga & Pengurus:** Pintasan lapor masalah, buka QR pendaftaran, dan tombol SOS darurat.
- **Feed Pengumuman & Ringkasan Laporan:** List ringkas pengumuman terbaru dan status terkini pengaduan warga.

### B. Keanggotaan & Dynamic QR Hub (F-MEMBERSHIPS-1 .. 11)
- **Dynamic QR Window (F-MEMBERSHIPS-1):**
  - Menampilkan QR dinamis dengan rotasi token per 60 detik (`HMAC-SHA256`).
  - Timer visual countdown (*"Berlaku 42 detik lagi"*).
  - Fallback manual string penuh: `sigap:join:<communityId>:<token>` lengkap dengan tombol "Salin Teks QR".
- **Antrean Pendaftaran (F-MEMBERSHIPS-4, 5, 6):**
  - Kartu pemohon menampilkan nama, email, blok rumah, dan waktu submit.
  - Aksi cepat satu klik: *Setujui (Warga)* (hijau) & *Tolak* (merah).
- **Direktori Warga & Pengelolaan Peran (F-MEMBERSHIPS-10, 11):**
  - Tabel responsif dengan pencarian nama & filter blok rumah.
  - Validasi aturan [PRD](PRD.md): Pengurus terakhir tidak dapat dikeluarkan atau demote dirinya sendiri.

### C. Laporan Warga Komunitas (F-REPORTS-1 .. 7)
- **Tampilan Split-View (Daftar & Detail Respons):**
  - Panel kiri: Daftar laporan dengan badge kategori (`Infrastruktur`, `Keamanan`, `Kebersihan`, `Sosial`, `Lainnya`) dan status.
  - Panel kanan: Detail pengaduan, nama pelapor, blok rumah, serta widget perubahan status untuk pengurus (`Diproses`, `Selesai`, `Ditolak`).
  - Catatan tanggapan pengurus wajib diisi (minimal 5 karakter) jika status ditolak.
  - Notice privasi: Laporan privat, hanya dilihat pelapor dan pengurus RT.

### D. Pusat Tanggap Darurat SOS (F-SOS-1 .. 9)
- **Siklus Status Respon Berjenjang:**
  - `Dikirim` (Sent) ➔ `Diterima` (Accepted oleh Pengurus) ➔ `Ditangani` (Handling aktif) ➔ `Selesai` (Resolved).
- **Incoming Emergency Dispatch Card:**
  - Penanda jenis SOS: `Medis`, `Kebakaran`, `Kriminal`, `Lainnya`.
  - Snapshot blok rumah pengirim yang tidak dapat diubah setelah dikirim.
  - Koordinat GPS (opsional) dengan peta visual radius lingkungan RT.
  - Tombol aksi handler: *Tandai Selesai*, *Tandai Salah Alarm*, dan *Hubungi Warga*.
- **Integrasi Fallback Nasional 112 (SOS-07):**
  - Banner peringatan darurat terintegrasi untuk menghubungi Layanan Darurat 112 / Ambulans 118 jika pengurus offline atau keadaan mengancam jiwa.

---

## 6. Edge Cases & Form Handling Standard
1. **Double Submit SOS / Join:** Proteksi tombol disable seketika saat diklik dengan indikator proses.
2. **Token QR Kedaluwarsa:** Error toast deskriptif mengarahkan warga memindai ulang layar pengurus.
3. **Komunitas Duplikat (BR-12, BR-14):** Form pembuatan komunitas memvalidasi key normalisasi wilayah dan menampilkan link bergabung via QR jika wilayah sudah terdaftar.
4. **Pengurus Terakhir Keluar (BR-27):** Tombol keluar/demote dinonaktifkan dengan tooltip peringatan *"Promosikan pengurus lain terlebih dahulu"*.
