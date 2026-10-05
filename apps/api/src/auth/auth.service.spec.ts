import { Role, AuditOutcome } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { AppException } from '../common/exceptions/app.exception';

describe('AuthService', () => {
  let prisma: any;
  let jwtService: any;
  let configService: any;
  let auditService: any;
  let service: AuthService;

  const configValues: Record<string, unknown> = {
    bcryptSaltRounds: 4, // low cost for fast tests
    'jwt.accessTtl': '15m',
    'jwt.refreshTtl': '7d',
    'jwt.accessSecret': 'test-access-secret',
    'jwt.refreshSecret': 'test-refresh-secret',
  };

  beforeEach(() => {
    prisma = {
      user: { count: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
      verifyAsync: jest.fn(),
      decode: jest.fn(),
    };
    configService = { get: jest.fn((key: string) => configValues[key]) };
    auditService = { log: jest.fn() };

    service = new AuthService(prisma, jwtService, configService, auditService);
  });

  describe('register', () => {
    it('creates the first user as SUPER_ADMIN with no hospital', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.user.create.mockImplementation(({ data }: any) => ({
        id: 'user-1',
        ...data,
      }));

      const { user } = await service.register(
        {
          email: 'Root@Example.com',
          password: 'Str0ngPass!',
          firstName: 'Root',
          lastName: 'Admin',
        },
        {},
      );

      expect(user.role).toBe(Role.SUPER_ADMIN);
      expect(user.hospitalId).toBeNull();
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'root@example.com' }) }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: AuditOutcome.SUCCESS }),
      );
    });

    it('refuses registration once at least one user exists', async () => {
      prisma.user.count.mockResolvedValue(1);

      await expect(
        service.register(
          { email: 'second@example.com', password: 'Str0ngPass!', firstName: 'A', lastName: 'B' },
          {},
        ),
      ).rejects.toThrow(AppException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('rejects an unknown email with a generic error and logs the failure', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'x' }, {}),
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: AuditOutcome.FAILURE }),
      );
    });

    it('rejects a wrong password with the same generic error', async () => {
      const passwordHash = await bcrypt.hash('CorrectPass1', 4);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        passwordHash,
        isActive: true,
        role: Role.DOCTOR,
        hospitalId: 'hosp-1',
        firstName: 'A',
        lastName: 'B',
      });

      await expect(
        service.login({ email: 'user@example.com', password: 'WrongPass1' }, {}),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('rejects a disabled account even with the correct password', async () => {
      const passwordHash = await bcrypt.hash('CorrectPass1', 4);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        passwordHash,
        isActive: false,
        role: Role.DOCTOR,
        hospitalId: 'hosp-1',
        firstName: 'A',
        lastName: 'B',
      });

      await expect(
        service.login({ email: 'user@example.com', password: 'CorrectPass1' }, {}),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('succeeds with correct credentials and issues a token pair', async () => {
      const passwordHash = await bcrypt.hash('CorrectPass1', 4);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        passwordHash,
        isActive: true,
        role: Role.DOCTOR,
        hospitalId: 'hosp-1',
        firstName: 'A',
        lastName: 'B',
      });

      const { tokens } = await service.login(
        { email: 'user@example.com', password: 'CorrectPass1' },
        {},
      );
      expect(tokens.accessToken).toBe('signed.jwt.token');
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('revokes every session for the user when a revoked refresh token is replayed', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', jti: 'rt-1' });
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: 'irrelevant',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      await expect(service.refresh('raw-token', {})).rejects.toMatchObject({
        code: 'REFRESH_TOKEN_REUSED',
      });

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', revokedAt: null } }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REFRESH_TOKEN_REUSED', outcome: AuditOutcome.FAILURE }),
      );
    });

    it('rejects an unknown refresh token id', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', jti: 'missing' });
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh('raw-token', {})).rejects.toMatchObject({
        code: 'INVALID_REFRESH_TOKEN',
      });
    });
  });
});
