import { PartialType } from '@nestjs/swagger';
import { CreateAnnouncementDto } from './create-announcement.dto';

/** F-ANNOUNCEMENTS-2 / BR-35/36: every field optional, same validation. */
export class UpdateAnnouncementDto extends PartialType(CreateAnnouncementDto) {}
