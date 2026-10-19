import {
  buildNotificationText,
  NotificationTextContext,
} from './notification-templates';

describe('buildNotificationText', () => {
  it('cuts the {title} placeholder to 100 characters', () => {
    const text = buildNotificationText('ANNOUNCEMENT', {
      title: 'a'.repeat(105),
    });

    expect(text.body).toBe('a'.repeat(100));
  });

  it('uses the false-alarm body of SOS_RESOLVED when falseAlarm is set', () => {
    const text = buildNotificationText('SOS_RESOLVED', { falseAlarm: true });

    expect(text.title).toBe('SOS ditutup');
    expect(text.body).toBe('"SOS kamu ditandai sebagai salah alarm."');
  });

  it('maps all nine types to their BR-66 title, body and entityType', () => {
    const ctx: NotificationTextContext = {
      userName: 'Siti',
      houseBlock: 'Blok A1',
      label: 'RT001/RW006',
      title: 'Lampu jalan mati',
      sosType: 'FIRE',
      handlerName: 'Pak Budi',
      reportStatus: 'IN_PROGRESS',
    };

    expect(buildNotificationText('JOIN_REQUEST', ctx)).toEqual({
      title: 'Permintaan bergabung baru',
      body: 'Siti (Blok A1) ingin bergabung ke RT001/RW006.',
      entityType: 'MEMBERSHIP',
    });
    expect(buildNotificationText('JOIN_APPROVED', ctx)).toEqual({
      title: 'Permintaan disetujui',
      body: 'Kamu sekarang menjadi anggota RT001/RW006.',
      entityType: 'MEMBERSHIP',
    });
    expect(buildNotificationText('JOIN_REJECTED', ctx)).toEqual({
      title: 'Permintaan ditolak',
      body: 'Permintaan bergabung ke RT001/RW006 ditolak oleh pengurus.',
      entityType: 'MEMBERSHIP',
    });
    expect(buildNotificationText('ANNOUNCEMENT', ctx)).toEqual({
      title: 'Pengumuman baru',
      body: 'Lampu jalan mati',
      entityType: 'ANNOUNCEMENT',
    });
    expect(buildNotificationText('REPORT_NEW', ctx)).toEqual({
      title: 'Laporan warga baru',
      body: 'Siti: Lampu jalan mati',
      entityType: 'REPORT',
    });
    expect(buildNotificationText('REPORT_STATUS', ctx)).toEqual({
      title: 'Status laporan diperbarui',
      body: 'Laporan "Lampu jalan mati" kini diproses.',
      entityType: 'REPORT',
    });
    expect(buildNotificationText('SOS_NEW', ctx)).toEqual({
      title: 'SOS Kebakaran!',
      body: 'Siti (Blok A1) membutuhkan bantuan di RT001/RW006.',
      entityType: 'SOS_ALERT',
    });
    expect(buildNotificationText('SOS_ACCEPTED', ctx)).toEqual({
      title: 'SOS diterima',
      body: 'Pak Budi menerima SOS kamu dan akan membantu.',
      entityType: 'SOS_ALERT',
    });
    expect(buildNotificationText('SOS_RESOLVED', ctx)).toEqual({
      title: 'SOS ditutup',
      body: '"SOS kamu telah diselesaikan."',
      entityType: 'SOS_ALERT',
    });
  });
});
