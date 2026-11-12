import { generateKeyPairSync, KeyObject } from 'crypto';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import * as jwt from 'jsonwebtoken';

/**
 * A stand-in OIDC provider for tests. It serves a JWKS endpoint and signs
 * RS256 access tokens, so the API runs its real verification path
 * (issuer, audience, expiry, signature) without Keycloak.
 */
export class OidcFixture {
  readonly issuer = 'http://issuer.test/realms/waypoint';
  readonly audience = 'waypoint-api';
  private readonly kid = 'test-key-1';
  private readonly privateKey: KeyObject;
  private readonly publicJwk: Record<string, unknown>;
  private server?: Server;
  jwksUri = '';

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKey = privateKey;
    this.publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: this.kid, use: 'sig', alg: 'RS256' };
  }

  async start() {
    this.server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [this.publicJwk] }));
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.jwksUri = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}/jwks`;
  }

  async stop() {
    await new Promise((resolve) => this.server?.close(resolve));
  }

  token(
    sub: string,
    roles: string[],
    overrides: { audience?: string; issuer?: string; key?: KeyObject; expiresIn?: number } = {},
  ) {
    return jwt.sign(
      { realm_access: { roles }, email: `${sub}@example.com`, preferred_username: sub },
      (overrides.key ?? this.privateKey).export({ format: 'pem', type: 'pkcs1' }),
      {
        algorithm: 'RS256',
        keyid: this.kid,
        subject: sub,
        issuer: overrides.issuer ?? this.issuer,
        audience: overrides.audience ?? this.audience,
        expiresIn: overrides.expiresIn ?? 300,
      },
    );
  }
}

export function otherKey(): KeyObject {
  return generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
}
