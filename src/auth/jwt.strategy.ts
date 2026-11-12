import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { passportJwtSecret } from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Env } from '../config/env';
import { AccessTokenClaims, AuthUser, toAuthUser } from './user';

/**
 * Validates OIDC access tokens issued by the identity provider (Keycloak in
 * docker-compose, Entra ID or any OIDC provider in production). Signature keys
 * come from the provider's JWKS endpoint and are cached and rate limited, so a
 * key rotation at the provider is picked up without a restart.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly audience: string;

  constructor(config: ConfigService<Env, true>) {
    const issuer = config.get('OIDC_ISSUER', { infer: true });
    const jwksUri =
      config.get('OIDC_JWKS_URI', { infer: true }) ?? `${issuer}/protocol/openid-connect/certs`;
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      issuer,
      audience: config.get('OIDC_AUDIENCE', { infer: true }),
      algorithms: ['RS256'],
      secretOrKeyProvider: passportJwtSecret({
        jwksUri,
        cache: true,
        cacheMaxAge: 10 * 60 * 1000,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
      }),
    });
    this.audience = config.get('OIDC_AUDIENCE', { infer: true });
  }

  validate(claims: AccessTokenClaims): AuthUser {
    if (!claims?.sub) throw new UnauthorizedException('Token has no subject');
    return toAuthUser(claims, this.audience);
  }
}
