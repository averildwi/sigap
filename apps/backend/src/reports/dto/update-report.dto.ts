import { PartialType } from '@nestjs/swagger';
import { CreateReportDto } from './create-report.dto';

/** F-REPORTS-4 / BR-50: same validators as create, all optional. */
export class UpdateReportDto extends PartialType(CreateReportDto) {}
