import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './guards';
import { Role } from './user';

function ctx(roles: Role[] | undefined, required: Role[] | undefined) {
  const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
  const context = {
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => ({ user: roles ? { id: 'u', roles } : undefined }) }),
  } as unknown as ExecutionContext;
  return { guard: new RolesGuard(reflector), context };
}

describe('RolesGuard', () => {
  it('allows routes with no role requirement', () => {
    const { guard, context } = ctx(['requester'], undefined);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a caller with one of the required roles', () => {
    const { guard, context } = ctx(['requester', 'approver'], ['approver']);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('forbids a caller without the role', () => {
    const { guard, context } = ctx(['requester'], ['approver']);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
