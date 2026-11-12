export const ROLES = ['requester', 'approver'] as const;
export type Role = (typeof ROLES)[number];

/** The caller, as established from a verified OIDC access token. */
export interface AuthUser {
  id: string;
  email?: string;
  name?: string;
  roles: Role[];
}

/** Claims we read from a Keycloak-style access token. */
export interface AccessTokenClaims {
  sub: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
}

/**
 * Maps token claims to an AuthUser. Roles may come from realm roles or from
 * client roles on the API's own client. Unknown roles are dropped, so a token
 * can never grant a role this service does not define.
 */
export function toAuthUser(claims: AccessTokenClaims, clientId: string): AuthUser {
  const raw = [
    ...(claims.realm_access?.roles ?? []),
    ...(claims.resource_access?.[clientId]?.roles ?? []),
  ];
  const roles = [...new Set(raw)].filter((r): r is Role => (ROLES as readonly string[]).includes(r));
  return {
    id: claims.sub,
    email: claims.email,
    name: claims.name ?? claims.preferred_username,
    roles,
  };
}
