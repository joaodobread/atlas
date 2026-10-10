import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROLE_PERMISSIONS } from '../../shared/constants.ts';
import type { User } from '../../shared/types.ts';
import { AuthUser } from './auth/AuthUser.ts';
import { AppError, BusinessRuleError, ForbiddenError, NotFoundError, TooManyRequestsError, UnauthorizedError, ValidationError } from './errors/AppError.ts';
import { EventBus } from './events/EventBus.ts';

const user = (role: User['role']): User => ({
  id: 7,
  email: 'a@b.com',
  name: 'Ana',
  role,
  active: true,
  created_at: '2026-01-01T00:00:00.000Z',
  last_login_at: null,
  onboarded_at: null,
});

describe('EventBus', () => {
  afterEach(() => vi.restoreAllMocks());

  it('entrega o payload a todos os handlers do evento e ignora outros eventos', () => {
    const bus = new EventBus();
    const a = vi.fn<(p: { documentIds: number[] }) => void>();
    const b = vi.fn<(p: { documentIds: number[] }) => void>();
    const other = vi.fn<() => void>();
    bus.on('documents.changed', a);
    bus.on('documents.changed', b);
    bus.on('graph.changed', other);
    bus.emit('documents.changed', { documentIds: [1, 2] });
    expect(a).toHaveBeenCalledWith({ documentIds: [1, 2] });
    expect(b).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it('emitir sem handlers não falha', () => {
    expect(() => new EventBus().emit('graph.changed')).not.toThrow();
  });

  it('a função devolvida por on() cancela a inscrição', () => {
    const bus = new EventBus();
    const h = vi.fn<() => void>();
    const off = bus.on('graph.changed', h);
    bus.emit('graph.changed');
    off();
    bus.emit('graph.changed');
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('isola erros de um handler: os demais continuam recebendo', () => {
    const bus = new EventBus();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const after = vi.fn<() => void>();
    bus.on('llm.changed', () => {
      throw new Error('falhou');
    });
    bus.on('llm.changed', after);
    expect(() => bus.emit('llm.changed')).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('llm.changed'), expect.any(Error));
  });
});

describe('AppError', () => {
  it.each([
    [NotFoundError, 404],
    [ValidationError, 400],
    [BusinessRuleError, 422],
    [UnauthorizedError, 401],
    [ForbiddenError, 403],
    [TooManyRequestsError, 429],
  ] as const)('%o tem status %i, nome da classe e detalhes', (Cls, status) => {
    const err = new Cls('mensagem', { campo: 'x' });
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(status);
    expect(err.name).toBe(Cls.name);
    expect(err.message).toBe('mensagem');
    expect(err.details).toEqual({ campo: 'x' });
  });

  it('details é opcional', () => {
    expect(new NotFoundError('x').details).toBeUndefined();
  });
});

describe('AuthUser', () => {
  it('expõe id, via e as permissões do papel', () => {
    const u = new AuthUser(user('editor'), 'token');
    expect(u.id).toBe(7);
    expect(u.via).toBe('token');
    expect([...u.permissions]).toEqual([...ROLE_PERMISSIONS.editor]);
  });

  it('can() respeita o papel', () => {
    const viewer = new AuthUser(user('viewer'), 'session');
    expect(viewer.can('graph:read')).toBe(true);
    expect(viewer.can('graph:write')).toBe(false);
    const editor = new AuthUser(user('editor'), 'session');
    expect(editor.can('graph:write')).toBe(true);
    expect(editor.can('users:manage')).toBe(false);
    const admin = new AuthUser(user('admin'), 'session');
    expect(admin.can('users:manage')).toBe(true);
    expect(admin.can('settings:manage')).toBe(true);
  });
});
