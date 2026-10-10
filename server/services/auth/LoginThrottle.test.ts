import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginThrottle } from './LoginThrottle.ts';

describe('LoginThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('bloqueia ao atingir o máximo de falhas na janela', () => {
    const t = new LoginThrottle(3, 60_000);
    t.fail('email:a');
    t.fail('email:a');
    expect(t.isBlocked('email:a')).toBe(false);
    t.fail('email:a');
    expect(t.isBlocked('email:a')).toBe(true);
    expect(t.isBlocked('email:b')).toBe(false);
  });

  it('falhas antigas saem da janela e desbloqueiam', () => {
    const t = new LoginThrottle(2, 60_000);
    t.fail('k');
    t.fail('k');
    expect(t.isBlocked('k')).toBe(true);
    vi.advanceTimersByTime(60_001);
    expect(t.isBlocked('k')).toBe(false);
    t.fail('k');
    expect(t.isBlocked('k')).toBe(false);
  });

  it('reset limpa as falhas da chave', () => {
    const t = new LoginThrottle(1);
    t.fail('k');
    expect(t.isBlocked('k')).toBe(true);
    t.reset('k');
    expect(t.isBlocked('k')).toBe(false);
  });

  it('padrão: 5 falhas em 15 minutos', () => {
    const t = new LoginThrottle();
    for (let i = 0; i < 4; i++) t.fail('k');
    expect(t.isBlocked('k')).toBe(false);
    t.fail('k');
    expect(t.isBlocked('k')).toBe(true);
    vi.advanceTimersByTime(15 * 60_000 + 1);
    expect(t.isBlocked('k')).toBe(false);
  });
});
