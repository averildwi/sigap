import type {
  EntityType,
  NotificationType,
  ReportStatus,
  SosType,
} from '../../generated/prisma/client.js';

/**
 * Values a service passes to buildNotificationText. Only the placeholders
 * of the caller's type are read (PRD 5.9.1).
 */
export interface NotificationTextContext {
  userName?: string;
  houseBlock?: string;
  label?: string;
  title?: string;
  sosType?: SosType;
  handlerName?: string;
  reportStatus?: ReportStatus;
  falseAlarm?: boolean;
}

/** What every notification row carries (BR-66 / PRD 5.9.1). */
export interface NotificationText {
  title: string;
  body: string;
  entityType: EntityType;
}

const TITLE_MAX = 100;

const SOS_TYPE_LABELS: Record<SosType, string> = {
  MEDICAL: 'Medis',
  FIRE: 'Kebakaran',
  CRIME: 'Kriminal',
  OTHER: 'Lainnya',
};

// Reports only move to IN_PROGRESS, RESOLVED or REJECTED in Lite.
const REPORT_STATUS_LABELS: Partial<Record<ReportStatus, string>> = {
  IN_PROGRESS: 'diproses',
  RESOLVED: 'selesai',
  REJECTED: 'ditolak',
};

const ENTITY_TYPE_BY_KIND: Record<NotificationType, EntityType> = {
  JOIN_REQUEST: 'MEMBERSHIP',
  JOIN_APPROVED: 'MEMBERSHIP',
  JOIN_REJECTED: 'MEMBERSHIP',
  ANNOUNCEMENT: 'ANNOUNCEMENT',
  REPORT_NEW: 'REPORT',
  REPORT_STATUS: 'REPORT',
  SOS_NEW: 'SOS_ALERT',
  SOS_ACCEPTED: 'SOS_ALERT',
  SOS_RESOLVED: 'SOS_ALERT',
};

/**
 * Pure texts of PRD 5.9.1: nine notification types, Indonesian, no literal
 * texts in any service. `{title}` is cut to 100 characters, and a
 * `SOS_RESOLVED` for a false alarm gets its own body.
 */
export function buildNotificationText(
  type: NotificationType,
  context: NotificationTextContext,
): NotificationText {
  const entityType = ENTITY_TYPE_BY_KIND[type];
  const title = (context.title ?? '').slice(0, TITLE_MAX);

  switch (type) {
    case 'JOIN_REQUEST':
      return {
        title: 'Permintaan bergabung baru',
        body: `${context.userName} (${context.houseBlock}) ingin bergabung ke ${context.label}.`,
        entityType,
      };
    case 'JOIN_APPROVED':
      return {
        title: 'Permintaan disetujui',
        body: `Kamu sekarang menjadi anggota ${context.label}.`,
        entityType,
      };
    case 'JOIN_REJECTED':
      return {
        title: 'Permintaan ditolak',
        body: `Permintaan bergabung ke ${context.label} ditolak oleh pengurus.`,
        entityType,
      };
    case 'ANNOUNCEMENT':
      return {
        title: 'Pengumuman baru',
        body: title,
        entityType,
      };
    case 'REPORT_NEW':
      return {
        title: 'Laporan warga baru',
        body: `${context.userName}: ${title}`,
        entityType,
      };
    case 'REPORT_STATUS':
      return {
        title: 'Status laporan diperbarui',
        body: `Laporan "${title}" kini ${REPORT_STATUS_LABELS[context.reportStatus ?? 'RESOLVED'] ?? ''}.`,
        entityType,
      };
    case 'SOS_NEW':
      return {
        title: `SOS ${SOS_TYPE_LABELS[context.sosType ?? 'OTHER']}!`,
        body: `${context.userName} (${context.houseBlock}) membutuhkan bantuan di ${context.label}.`,
        entityType,
      };
    case 'SOS_ACCEPTED':
      return {
        title: 'SOS diterima',
        body: `${context.handlerName} menerima SOS kamu dan akan membantu.`,
        entityType,
      };
    case 'SOS_RESOLVED':
      return {
        title: 'SOS ditutup',
        body: context.falseAlarm
          ? '"SOS kamu ditandai sebagai salah alarm."'
          : '"SOS kamu telah diselesaikan."',
        entityType,
      };
  }
}
