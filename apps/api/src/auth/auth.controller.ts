import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AppConfig } from '../config/configuration';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/interceptors/response.interceptor';
import { RequestWithCorrelationId } from '../common/middleware/correlation-id.middleware';
import { parseDurationToMs } from '../common/utils/duration.util';
import { AuthService, IssuedTokenPair } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { MeResponseDto } from './dto/auth-response.dto';
import { REFRESH_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE_PATH } from './auth.constants';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  @Public()
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
