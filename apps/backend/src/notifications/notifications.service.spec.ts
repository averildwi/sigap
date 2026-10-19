import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

interface TxMock {
  notification: { createMany: jest.Mock };
}

describe('NotificationsService.createMany', () => {
  let service: NotificationsService;
  let tx: TxMock;

  beforeEach(async () => {
    tx = {
      notification: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const prisma = { $transaction: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  it('writes one row per recipient with the text from the template fn', async () => {
    await service.createMany(tx, {
      userIds: ['admin-1', 'admin-2'],
      communityId: 'community-1',
      type: 'JOIN_REQUEST',
      entityId: 'membership-1',
      context: {
        userName: 'Siti',
        houseBlock: 'Blok A1',
        label: 'RT001/RW006',
      },
    });

    expect(tx.notification.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'admin-1',
          communityId: 'community-1',
          type: 'JOIN_REQUEST',
          title: 'Permintaan bergabung baru',
          body: 'Siti (Blok A1) ingin bergabung ke RT001/RW006.',
          entityType: 'MEMBERSHIP',
          entityId: 'membership-1',
        },
        {
          userId: 'admin-2',
          communityId: 'community-1',
          type: 'JOIN_REQUEST',
          title: 'Permintaan bergabung baru',
          body: 'Siti (Blok A1) ingin bergabung ke RT001/RW006.',
          entityType: 'MEMBERSHIP',
          entityId: 'membership-1',
        },
      ],
    });
  });

  it('writes nothing without recipients (an admin list can be empty)', async () => {
    await service.createMany(tx, {
      userIds: [],
      communityId: 'community-1',
      type: 'JOIN_REQUEST',
      entityId: 'membership-1',
      context: {
        userName: 'Siti',
        houseBlock: 'Blok A1',
        label: 'RT001/RW006',
      },
    });

    expect(tx.notification.createMany).not.toHaveBeenCalled();
  });
});
