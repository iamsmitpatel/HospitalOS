import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditOutcome, Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { AppException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';

const ROLES_ONLY_SUPER_ADMIN_CAN_ASSIGN: Role[] = [Role.SUPER_ADMIN, Role.HOSPITAL_ADMIN];

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly auditService: AuditService,
  ) {}

  async create(
    dto: CreateUserDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<UserResponseDto> {
    const targetHospitalId = await this.resolveTargetHospitalId(dto, actor);

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new AppException(
        'EMAIL_ALREADY_IN_USE',
        'A user with this email already exists.',
        HttpStatus.CONFLICT,
      );
    }

    const passwordHash = await bcrypt.hash(
      dto.password,
      this.configService.get('bcryptSaltRounds', { infer: true }),
    );

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
        hospitalId: targetHospitalId,
      },
    });

    await this.auditService.log({
      action: AuditAction.USER_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: targetHospitalId,
      resourceType: 'User',
      resourceId: user.id,
      correlationId,
      metadata: { role: user.role },
    });

    return this.toResponse(user);
  }

  async findAllForTenant(actor: AuthenticatedUser): Promise<UserResponseDto[]> {
    const where = actor.role === Role.SUPER_ADMIN ? {} : { hospitalId: actor.hospitalId };
    const users = await this.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' } });
    return users.map((u) => this.toResponse(u));
  }

  async findOneForTenant(id: string, actor: AuthenticatedUser): Promise<UserResponseDto> {
    const user = await this.getTenantScopedUserOrThrow(id, actor);
    return this.toResponse(user);
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<UserResponseDto> {
    const target = await this.getTenantScopedUserOrThrow(id, actor);

    if (
      dto.role &&
      actor.role !== Role.SUPER_ADMIN &&
      ROLES_ONLY_SUPER_ADMIN_CAN_ASSIGN.includes(dto.role)
    ) {
      throw new AppException(
        'ROLE_NOT_ALLOWED',
        'Only a platform SUPER_ADMIN can assign this role.',
        HttpStatus.FORBIDDEN,
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: target.id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
        isActive: dto.isActive,
      },
    });

    await this.auditService.log({
      action: AuditAction.USER_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: updated.hospitalId,
      resourceType: 'User',
      resourceId: updated.id,
      correlationId,
      metadata: { changedFields: Object.keys(dto) },
    });

    return this.toResponse(updated);
  }

  /** Server-derives the tenant for the new user — never trusts a client-supplied hospitalId outright (see master doc §8). */
  private async resolveTargetHospitalId(
    dto: CreateUserDto,
    actor: AuthenticatedUser,
  ): Promise<string | null> {
    if (actor.role === Role.HOSPITAL_ADMIN) {
      if (ROLES_ONLY_SUPER_ADMIN_CAN_ASSIGN.includes(dto.role)) {
        throw new AppException(
          'ROLE_NOT_ALLOWED',
          'A HOSPITAL_ADMIN cannot create SUPER_ADMIN or HOSPITAL_ADMIN accounts.',
          HttpStatus.FORBIDDEN,
        );
      }
      if (!actor.hospitalId) {
        throw new AppException(
          'TENANT_CONTEXT_MISSING',
          'Caller has no associated hospital.',
          HttpStatus.FORBIDDEN,
        );
      }
      return actor.hospitalId;
    }

    // actor.role === Role.SUPER_ADMIN (the only other role holding user.create — see PermissionsGuard)
    if (dto.role === Role.SUPER_ADMIN) {
      return null;
    }
    if (!dto.hospitalId) {
      throw new AppException(
        'HOSPITAL_ID_REQUIRED',
        'hospitalId is required when creating a non-SUPER_ADMIN user.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const hospital = await this.prisma.hospital.findUnique({ where: { id: dto.hospitalId } });
    if (!hospital || !hospital.isActive) {
      throw new AppException(
        'HOSPITAL_NOT_FOUND',
        'Target hospital not found or inactive.',
        HttpStatus.NOT_FOUND,
      );
    }
    return hospital.id;
  }

  private async getTenantScopedUserOrThrow(id: string, actor: AuthenticatedUser): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    // 404 (not 403) for cross-tenant access so a caller cannot distinguish
    // "doesn't exist" from "exists in a hospital you can't see" (§9, §30).
    if (!user || (actor.role !== Role.SUPER_ADMIN && user.hospitalId !== actor.hospitalId)) {
      throw new AppException('USER_NOT_FOUND', 'User not found.', HttpStatus.NOT_FOUND);
    }
    return user;
  }

  private toResponse(user: User): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      hospitalId: user.hospitalId,
      isActive: user.isActive,
      createdAt: user.createdAt,
    };
  }
}
