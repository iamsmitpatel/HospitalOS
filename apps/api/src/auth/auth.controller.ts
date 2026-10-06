import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import configuration, { AppConfig } from '../config/configuration';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/interceptors/response.interceptor';
import { RequestWithCorrelationId } from '../common/middleware/correlation-id.middleware';
import { parseDurationToMs } from '../common/utils/duration.util';
import { AuthService, IssuedTokenPair } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { RegisterPatientDto } from './dto/register-patient.dto';
import { LoginDto } from './dto/login.dto';
import { MeResponseDto } from './dto/auth-response.dto';
import { REFRESH_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE_PATH } from './auth.constants';

// A tighter budget than the global 'default' throttler bucket (see
// app.module.ts / configuration.ts) — login/registration/refresh are the
// classic brute-force/credential-stuffing/signup-spam targets and need
// their own strict limit, not the generous one every other route gets.
//
// Resolved via a function, not a static value read once at module-import
// time: @Throttle()'s options are evaluated by the guard on every request
// (ExecutionContext-aware Resolvable<T>), which is also what lets
// test/rate-limit.e2e-spec.ts override AUTH_THROTTLE_LIMIT at runtime
// (after this module has already been imported) and have it take effect.
const AUTH_THROTTLE_OVERRIDE = {
  default: {
    limit: () => configuration().authThrottle.limit,
    ttl: () => configuration().authThrottle.ttlSeconds * 1000,
  },
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  @Public()
  @Throttle(AUTH_THROTTLE_OVERRIDE)
  @Post('register')
  @ResponseMessage('Account created successfully.')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: RequestWithCorrelationId,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.authService.register(dto, this.requestContext(req));
    this.setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken, user };
  }

  @Public()
  @Throttle(AUTH_THROTTLE_OVERRIDE)
  @Post('register-patient')
  @ResponseMessage('Account created successfully.')
  async registerPatient(
    @Body() dto: RegisterPatientDto,
    @Req() req: RequestWithCorrelationId,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.authService.registerPatient(dto, this.requestContext(req));
    this.setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken, user };
  }

  @Public()
  @Throttle(AUTH_THROTTLE_OVERRIDE)
  @Post('login')
  @ResponseMessage('Logged in successfully.')
  async login(
    @Body() dto: LoginDto,
    @Req() req: RequestWithCorrelationId,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.authService.login(dto, this.requestContext(req));
    this.setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken, user };
  }

  @Public()
  @Throttle(AUTH_THROTTLE_OVERRIDE)
  @Post('refresh')
  @ResponseMessage('Token refreshed successfully.')
  async refresh(@Req() req: RequestWithCorrelationId, @Res({ passthrough: true }) res: Response) {
    const rawRefreshToken = (req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined) ?? '';
    const tokens = await this.authService.refresh(rawRefreshToken, this.requestContext(req));
    this.setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Logged out successfully.')
  async logout(@Req() req: RequestWithCorrelationId, @Res({ passthrough: true }) res: Response) {
    const rawRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
    await this.authService.logout(rawRefreshToken, this.requestContext(req));
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: REFRESH_TOKEN_COOKIE_PATH });
    return null;
  }

  @Get('me')
  @ApiResponse({ type: MeResponseDto })
  @ResponseMessage('Current user retrieved successfully.')
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.userId);
  }

  private setRefreshCookie(res: Response, tokens: IssuedTokenPair): void {
    const isProduction = this.configService.get('nodeEnv', { infer: true }) === 'production';
    res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: REFRESH_TOKEN_COOKIE_PATH,
      maxAge: parseDurationToMs(this.configService.get('jwt.refreshTtl', { infer: true })),
    });
  }

  private requestContext(req: Request & { correlationId?: string }) {
    return {
      ipAddress: req.ip,
      correlationId: req.correlationId,
    };
  }
}
