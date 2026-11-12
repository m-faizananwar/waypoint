import { toAuthUser } from './user';

describe('toAuthUser', () => {
  it('merges realm and client roles and drops roles this API does not define', () => {
    const user = toAuthUser(
      {
        sub: 'u1',
        email: 'a@example.com',
        preferred_username: 'alice',
        realm_access: { roles: ['requester', 'offline_access', 'uma_authorization'] },
        resource_access: { 'waypoint-api': { roles: ['approver'] }, other: { roles: ['admin'] } },
      },
      'waypoint-api',
    );
    expect(user).toEqual({ id: 'u1', email: 'a@example.com', name: 'alice', roles: ['requester', 'approver'] });
  });

  it('gives no roles when the token has none', () => {
    expect(toAuthUser({ sub: 'u2' }, 'waypoint-api').roles).toEqual([]);
  });
});
