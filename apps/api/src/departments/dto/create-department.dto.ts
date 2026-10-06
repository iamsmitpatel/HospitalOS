import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateDepartmentDto {
  @ApiProperty({ example: 'Cardiology' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    example: 'CARD',
    description: 'Short code, unique within the hospital. Uppercase letters/digits.',
  })
  @IsString()
  @Matches(/^[A-Z0-9]{2,10}$/, {
    message: 'code must be 2-10 uppercase letters/digits',
  })
  code!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    required: false,
    description:
      'Target hospital. Required when a SUPER_ADMIN creates a department. Ignored (server-derives from the caller) when a HOSPITAL_ADMIN is creating it.',
  })
  @IsOptional()
  @IsUUID()
  hospitalId?: string;
}
