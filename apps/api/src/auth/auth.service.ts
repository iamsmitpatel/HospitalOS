import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditOutcome, Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { AppConfig } from '../config/configuration';
import { AppException } from '../common/exceptions/app.exception';
import { parseDurationToMs } from '../common/utils/duration.util';
import { sha256 } from '../common/utils/hash.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit.constants';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface AuthenticatedUserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  hospitalId: string | null;
}

export interface MeResponse {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  hospital: { id: string; name: string } | null;
}

interface RequestContext {
  ipAddress?: string;
  correlationId?: string;
}

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password.';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly auditService: AuditService,
  ) {}

  async register(
    dto: RegisterDto,
    ctx: RequestContext,
  ): Promise<{ user: AuthenticatedUserProfile; tokens: IssuedTokenPair }> {
    // Public self-registration is intentionally limited to bootstrapping the
    // very first platform SUPER_ADMIN. Every other account (hospital admins,
    // doctors, staff) is provisioned through the authenticated, RBAC-guarded
    // Users module so role and tenant assignment are always controlled
    // (see /DECISIONS.md "Why /auth/register is bootstrap-only").
    const existingUserCount = await this.prisma.user.count();
    if (existingUserCount > 0) {
      await this.auditService.log({
        action: AuditAction.USER_LOGIN_FAILED,
        outcome: AuditOutcome.FAILURE,
        ipAddress: ctx.ipAddress,
        correlationId: ctx.correlationId,
        metadata: { reason: 'registration_closed', email: dto.email },
      });
      throw new AppException(
        'REGISTRATION_CLOSED',
        'Public registration is closed. Contact your platform administrator.',
        HttpStatus.FORBIDDEN,
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
        role: Role.SUPER_ADMIN,
        hospitalId: null,
      },
    });

    await this.auditService.log({
      action: AuditAction.USER_REGISTERED,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: user.id,
      ipAddress: ctx.ipAddress,
      correlationId: ctx.correlationId,
      resourceType: 'User',
      resourceId: user.id,
    });

    const tokens = await this.issueTokenPair(
      user.id,
      user.email,
      user.role,
      user.hospitalId,
      ctx.ipAddress,
    );
    return { user: this.toProfile(user), tokens };
  }

  async login(
    dto: LoginDto,
    ctx: RequestContext,
  ): Promise<{ user: AuthenticatedUserProfile; tokens: IssuedTokenPair }> {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Same generic error and audit action whether the email doesn't exist,
    // the account is disabled, or the password is wrong — avoids leaking
    // which case applies to an unauthenticated caller.
    if (!user || !user.isActive || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      await this.auditService.log({
        action: AuditAction.USER_LOGIN_FAILED,
        outcome: AuditOutcome.FAILURE,
        hospitalId: user?.hospitalId ?? null,
        ipAddress: ctx.ipAddress,
        correlationId: ctx.correlationId,
        metadata: { email },
      });
      throw new AppException(
        'INVALID_CREDENTIALS',
        INVALID_CREDENTIALS_MESSAGE,
        HttpStatus.UNAUTHORIZED,
      );
    }

    await this.auditService.log({
      action: AuditAction.USER_LOGIN,
      outcome: AuditOutcome.SUCCESS,
      actorUserId: user.id,
      hospitalId: user.hospitalId,
      ipAddress: ctx.ipAddress,
      correlationId: ctx.correlationId,
    });

    const tokens = await this.issueTokenPair(
      user.id,
      user.email,
      user.role,
      user.hospitalId,
      ctx.ipAddress,
    );
    return { user: this.toProfile(user), tokens };
  }

  async refresh(rawRefreshToken: string, ctx: RequestContext): Promise<IssuedTokenPair> {
    const payload = await this.verifyRefreshJwt(rawRefreshToken);

    const record = await this.prisma.refreshToken.findUnique({ where: { id: payload.jti } });
    if (!record) {
      throw new AppException(
        'INVALID_REFRESH_TOKEN',
        'Refresh token is invalid.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (record.revokedAt) {
      // A revoked token being presented again indicates possible theft —
      // revoke every session for this user rather than just this one.
      await this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.auditService.log({
        action: AuditAction.REFRESH_TOKEN_REUSED,
        outcome: AuditOutcome.FAILURE,
        actorUserId: record.userId,
        ipAddress: ctx.ipAddress,
        correlationId: ctx.correlationId,
      });
      throw new AppException(
        'REFRESH_TOKEN_REUSED',
        'This refresh token has already been used. All sessions have been revoked for security.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (record.expiresAt.getTime() < Date.now()) {
      throw new AppException(
        'REFRESH_TOKEN_EXPIRED',
        'Refresh token has expired.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (record.tokenHash !== sha256(rawRefreshToken)) {
      throw new AppException(
        'INVALID_REFRESH_TOKEN',
        'Refresh token is invalid.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: record.userId } });
    if (!user || !user.isActive) {
      throw new AppException(
        'INVALID_REFRESH_TOKEN',
        'Refresh token is invalid.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const tokens = await this.issueTokenPair(
      user.id,
      user.email,
      user.role,
      user.hospitalId,
      ctx.ipAddress,
    );
    const [, newRecordId] = this.decodeRefreshToken(tokens.refreshToken);

    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date(), replacedByTokenId: newRecordId },
    });

    return tokens;
  }

  async logout(rawRefreshToken: string | undefined, ctx: RequestContext): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }
    try {
      const payload = await this.verifyRefreshJwt(rawRefreshToken);
      await this.prisma.refreshToken.updateMany({
        where: { id: payload.jti, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.auditService.log({
        action: AuditAction.USER_LOGOUT,
        outcome: AuditOutcome.SUCCESS,
        actorUserId: payload.sub,
        ipAddress: ctx.ipAddress,
        correlationId: ctx.correlationId,
      });
    } catch {
      // Already invalid/expired refresh token on logout is not an error worth surfacing.
    }
  }

  async me(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { hospital: { select: { id: true, name: true } } },
    });
    if (!user) {
      throw new AppException('USER_NOT_FOUND', 'User not found.', HttpStatus.NOT_FOUND);
    }
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      hospital: user.hospital ? { id: user.hospital.id, name: user.hospital.name } : null,
    };
  }

  private async issueTokenPair(
    userId: string,
    email: string,
    role: Role,
    hospitalId: string | null,
    ipAddress?: string,
  ): Promise<IssuedTokenPair> {
    const accessTtl = this.configService.get('jwt.accessTtl', { infer: true });
    const refreshTtl = this.configService.get('jwt.refreshTtl', { infer: true });

    // jsonwebtoken's numeric `expiresIn` is in SECONDS, not milliseconds —
    // parseDurationToMs() is divided down here deliberately. Passing
    // milliseconds straight through would silently make tokens live ~1000x
    // longer than configured (a 15m access token would live ~10 days).
    const accessToken = await this.jwtService.signAsync(
      { sub: userId, email, role, hospitalId },
      {
        secret: this.configService.get('jwt.accessSecret', { infer: true }),
        expiresIn: Math.floor(parseDurationToMs(accessTtl) / 1000),
      },
    );

    const refreshTokenId = randomUUID();
    const refreshToken = await this.jwtService.signAsync(
      { sub: userId, jti: refreshTokenId },
      {
        secret: this.configService.get('jwt.refreshSecret', { infer: true }),
        expiresIn: Math.floor(parseDurationToMs(refreshTtl) / 1000),
      },
    );

    const refreshTokenExpiresAt = new Date(Date.now() + parseDurationToMs(refreshTtl));

    await this.prisma.refreshToken.create({
      data: {
        id: refreshTokenId,
        userId,
        tokenHash: sha256(refreshToken),
        expiresAt: refreshTokenExpiresAt,
        createdByIp: ipAddress,
      },
    });

    return { accessToken, refreshToken, refreshTokenExpiresAt };
  }

  private async verifyRefreshJwt(rawRefreshToken: string): Promise<{ sub: string; jti: string }> {
    try {
      return await this.jwtService.verifyAsync(rawRefreshToken, {
        secret: this.configService.get('jwt.refreshSecret', { infer: true }),
      });
    } catch {
      throw new AppException(
        'INVALID_REFRESH_TOKEN',
        'Refresh token is invalid.',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private decodeRefreshToken(rawRefreshToken: string): [string, string] {
    const decoded = this.jwtService.decode<{ sub: string; jti: string }>(rawRefreshToken);
    return [decoded.sub, decoded.jti];
  }

  private toProfile(user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: Role;
    hospitalId: string | null;
  }): AuthenticatedUserProfile {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      hospitalId: user.hospitalId,
    };
  }
}
