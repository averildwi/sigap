import 'reflect-metadata';
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { HashingService } from '../src/common/hashing/hashing.service';

// Seed-only env (PRD 8.14, nest-auth-and-security rule 15): no defaults, ever.
function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set. Add it to your .env file.`);
  return value;
}

const DATABASE_URL = requireEnv('DATABASE_URL');
const SEED_ADMIN_EMAIL = requireEnv('SEED_ADMIN_EMAIL').toLowerCase();
const SEED_DEMO_PASSWORD = requireEnv('SEED_DEMO_PASSWORD');

const WARGA1_EMAIL = 'warga1@wargakita.test';
const WARGA2_EMAIL = 'warga2@wargakita.test';
const GUEST_EMAIL = 'tamu@wargakita.test';

const COMMUNITY = {
  rt: 1,
  rw: 6,
  village: 'Kel. Sukamaju',
  district: 'Kec. Cimahi Tengah',
  city: 'Kota Cimahi',
  province: 'Jawa Barat',
  name: 'Griya Asri',
  // BR-12 / DATA_MODEL N-7 key of the fields above.
  regionKey: '1:6:sukamaju:cimahitengah:kota:cimahi:jawabarat',
};

const prisma = new PrismaClient({ adapter: new PrismaPg(DATABASE_URL) });
const hashing = new HashingService();

async function main(): Promise<void> {
  const now = new Date();
  const accounts = [
    { email: SEED_ADMIN_EMAIL, name: 'Pak Budi (Ketua RT)' },
    { email: WARGA1_EMAIL, name: 'Siti Aminah' },
    { email: WARGA2_EMAIL, name: 'Andi Pratama' },
    { email: GUEST_EMAIL, name: 'Tamu Demo' },
  ];

  // Only missing users are created; existing rows and passwords stay untouched.
  const existing = await prisma.user.findMany({
    where: { email: { in: accounts.map((a) => a.email) } },
    select: { email: true },
  });
  const existingEmails = new Set(existing.map((u) => u.email));
  const missing = accounts.filter((a) => !existingEmails.has(a.email));
  if (missing.length > 0) {
    const passwordHash = await hashing.hash(SEED_DEMO_PASSWORD);
    await prisma.user.createMany({
      data: missing.map((a) => ({
        email: a.email,
        name: a.name,
        passwordHash,
        emailVerifiedAt: now,
        globalRole: 'USER' as const,
      })),
      skipDuplicates: true,
    });
  }

  const users = await prisma.user.findMany({
    where: { email: { in: [SEED_ADMIN_EMAIL, WARGA1_EMAIL, WARGA2_EMAIL] } },
    select: { id: true, email: true },
  });
  const idOf = (email: string): string => {
    const user = users.find((u) => u.email === email);
    if (!user) throw new Error(`Seed user ${email} not found`);
    return user.id;
  };
  const adminId = idOf(SEED_ADMIN_EMAIL);
  const warga1Id = idOf(WARGA1_EMAIL);
  const warga2Id = idOf(WARGA2_EMAIL);

  const found = await prisma.community.findUnique({
    where: { regionKey: COMMUNITY.regionKey },
    select: { id: true },
  });
  if (found) {
    console.log('Seed community already exists, content not re-created.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    const community = await tx.community.create({
      data: COMMUNITY,
      select: { id: true },
    });
    const communityId = community.id;

    await tx.membership.createMany({
      data: [
        {
          userId: adminId,
          role: 'ADMIN' as const,
          houseBlock: 'Blok A1 No. 1',
        },
        {
          userId: warga1Id,
          role: 'WARGA' as const,
          houseBlock: 'Blok B2 No. 5',
        },
        {
          userId: warga2Id,
          role: 'WARGA' as const,
          houseBlock: 'Blok C3 No. 12',
        },
      ].map((m) => ({
        ...m,
        communityId,
        status: 'ACTIVE' as const,
        requestedAt: now,
        decidedAt: now,
        joinedAt: now,
      })),
      skipDuplicates: true,
    });

    await tx.announcement.createMany({
      data: [
        {
          title: 'Kerja bakti hari Minggu',
          body: 'Kerja bakti membersihkan selokan, Minggu pukul 07.00 di pos ronda.',
          isHighlight: true,
        },
        {
          title: 'Jadwal ronda bulan ini',
          body: 'Jadwal ronda malam sudah ditempel di pos ronda. Mohon hadir tepat waktu.',
          isHighlight: false,
        },
        {
          title: 'Iuran kebersihan',
          body: 'Iuran kebersihan bulan ini dapat dibayarkan ke bendahara RT.',
          isHighlight: false,
        },
      ].map((a) => ({ ...a, communityId, authorId: adminId })),
    });

    await tx.report.createMany({
      data: [
        {
          reporterId: warga1Id,
          title: 'Lampu jalan mati',
          description:
            'Lampu jalan di depan Blok B2 mati sejak tiga hari lalu.',
          category: 'INFRASTRUCTURE' as const,
          status: 'PENDING' as const,
        },
        {
          reporterId: warga2Id,
          title: 'Sampah menumpuk',
          description: 'Sampah di TPS ujung jalan belum diangkut seminggu.',
          category: 'CLEANLINESS' as const,
          status: 'IN_PROGRESS' as const,
          responseNote: 'Sudah dihubungi petugas kebersihan kelurahan.',
          respondedById: adminId,
          respondedAt: now,
        },
        {
          reporterId: warga1Id,
          title: 'Jalan berlubang',
          description: 'Ada lubang besar di jalan masuk Blok C.',
          category: 'INFRASTRUCTURE' as const,
          status: 'RESOLVED' as const,
          responseNote: 'Lubang sudah ditambal bersama warga.',
          respondedById: adminId,
          respondedAt: now,
        },
        {
          reporterId: warga2Id,
          title: 'Suara bising malam hari',
          description: 'Ada suara musik keras setiap malam.',
          category: 'SOCIAL' as const,
          status: 'REJECTED' as const,
          responseNote:
            'Bukan di wilayah RT 001, sudah diteruskan ke RT tetangga.',
          respondedById: adminId,
          respondedAt: now,
        },
      ].map((r) => ({ ...r, communityId })),
    });
  });

  console.log('Seed completed.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
