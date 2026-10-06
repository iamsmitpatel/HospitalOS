import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditOutcome, Department, Role } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { assertSameTenant, resolveTenantHospitalId } from '../common/utils/tenant.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { DepartmentResponseDto } from './dto/department-response.dto';

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    dto: CreateDepartmentDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<DepartmentResponseDto> {
    const hospitalId = await resolveTenantHospitalId(this.prisma, actor, dto.hospitalId);

    const existing = await this.prisma.department.findFirst({
      where: { hospitalId, OR: [{ code: dto.code }, { name: dto.name }] },
    });
    if (existing) {
      const field = existing.code === dto.code ? 'code' : 'name';
      throw new AppException(
        'DEPARTMENT_IDENTIFIER_TAKEN',
        `A department with this ${field} already exists in this hospital.`,
        HttpStatus.CONFLICT,
      );
    }

    const department = await this.prisma.department.create({
      data: { hospitalId, name: dto.name, code: dto.code, description: dto.description },
    });

    await this.auditService.log({
      action: AuditAction.DEPARTMENT_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId,
      resourceType: 'Department',
      resourceId: department.id,
      correlationId,
    });

    return this.toResponse(department);
  }

  async findAllForTenant(actor: AuthenticatedUser): Promise<DepartmentResponseDto[]> {
    if (actor.role === Role.SUPER_ADMIN) {
      const departments = await this.prisma.department.findMany({ orderBy: { name: 'asc' } });
      return departments.map((d) => this.toResponse(d));
    }
    if (!actor.hospitalId) {
      throw new AppException(
        'TENANT_CONTEXT_MISSING',
        'Caller has no associated hospital.',
        HttpStatus.FORBIDDEN,
      );
    }
    const departments = await this.prisma.department.findMany({
      where: { hospitalId: actor.hospitalId },
      orderBy: { name: 'asc' },
    });
    return departments.map((d) => this.toResponse(d));
  }

  async findOneForTenant(id: string, actor: AuthenticatedUser): Promise<DepartmentResponseDto> {
    const department = await this.getTenantScopedDepartmentOrThrow(id, actor);
    return this.toResponse(department);
  }

  async update(
    id: string,
    dto: UpdateDepartmentDto,
    actor: AuthenticatedUser,
    correlationId?: string,
  ): Promise<DepartmentResponseDto> {
    const department = await this.getTenantScopedDepartmentOrThrow(id, actor);

    if (dto.name && dto.name !== department.name) {
      const nameTaken = await this.prisma.department.findFirst({
        where: { hospitalId: department.hospitalId, name: dto.name, id: { not: department.id } },
      });
      if (nameTaken) {
        throw new AppException(
          'DEPARTMENT_IDENTIFIER_TAKEN',
          'A department with this name already exists in this hospital.',
          HttpStatus.CONFLICT,
        );
      }
    }

    const updated = await this.prisma.department.update({
      where: { id: department.id },
      data: { name: dto.name, description: dto.description, isActive: dto.isActive },
    });

    await this.auditService.log({
      action: AuditAction.DEPARTMENT_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: actor.userId,
      hospitalId: updated.hospitalId,
      resourceType: 'Department',
      resourceId: updated.id,
      correlationId,
      metadata: { changedFields: Object.keys(dto) },
    });

    return this.toResponse(updated);
  }

  /** Used by doctors.service.ts to validate a department reference without duplicating the tenant check. */
  async getTenantScopedDepartmentOrThrow(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<Department> {
    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department) {
      throw new AppException('DEPARTMENT_NOT_FOUND', 'Department not found.', HttpStatus.NOT_FOUND);
    }
    assertSameTenant(department.hospitalId, actor, 'DEPARTMENT_NOT_FOUND', 'Department not found.');
    return department;
  }

  private toResponse(department: Department): DepartmentResponseDto {
    return {
      id: department.id,
      hospitalId: department.hospitalId,
      name: department.name,
      code: department.code,
      description: department.description,
      isActive: department.isActive,
      createdAt: department.createdAt,
    };
  }
}
