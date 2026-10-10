import { describe, expect, it } from 'vitest';
import { NODE_KINDS } from '../../shared/constants.ts';
import { ICONS, KIND_DEFAULT_ICON, iconEntry, resolveIcon, searchIcons } from './iconCatalog.ts';

describe('iconCatalog', () => {
  it('ids únicos e no formato si:/lu:', () => {
    const ids = ICONS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^(si|lu):[a-z0-9-]+$/);
    for (const k of NODE_KINDS) expect(iconEntry(KIND_DEFAULT_ICON[k])).toBeDefined();
  });

  it('iconEntry', () => {
    expect(iconEntry('si:redis')?.label).toBe('Redis');
    expect(iconEntry('si:nope')).toBeUndefined();
    expect(iconEntry(null)).toBeUndefined();
    expect(iconEntry(undefined)).toBeUndefined();
    expect(iconEntry('')).toBeUndefined();
  });

  describe('resolveIcon', () => {
    it('ícone explícito vence', () => {
      expect(resolveIcon({ icon: 'lu:bot', tech: 'redis', kind: 'service' })).toBe('lu:bot');
    });

    it('ícone desconhecido é ignorado', () => {
      expect(resolveIcon({ icon: 'si:desconhecido', tech: null, kind: 'database' })).toBe('lu:database');
    });

    it('deduz pela tecnologia (palavra inteira, sem diferenciar maiúsculas)', () => {
      expect(resolveIcon({ icon: null, tech: 'PostgreSQL 16', kind: 'database' })).toBe('si:postgresql');
      expect(resolveIcon({ icon: null, tech: 'postgres', kind: 'database' })).toBe('si:postgresql');
      expect(resolveIcon({ icon: null, tech: 'Amazon EKS', kind: 'infra' })).toBe('si:amazonwebservices');
      expect(resolveIcon({ icon: null, tech: 'eks', kind: 'infra' })).toBe('si:kubernetes');
      expect(resolveIcon({ icon: null, tech: 'C# / ASP', kind: 'service' })).toBe('si:dotnet');
      expect(resolveIcon({ icon: null, tech: 'Claude', kind: 'external' })).toBe('si:anthropic');
    });

    it('o termo que aparece primeiro vence; empate fica com o mais longo', () => {
      expect(resolveIcon({ icon: null, tech: 'node / express', kind: 'service' })).toBe('si:nodedotjs');
      expect(resolveIcon({ icon: null, tech: 'express on node', kind: 'service' })).toBe('si:express');
      // "spring boot" (com espaço, substring) e "spring" começam juntos: o mais longo vence (mesmo ícone).
      expect(resolveIcon({ icon: null, tech: 'spring boot', kind: 'service' })).toBe('si:spring');
      // "aws lambda" é mais longo que "aws" na mesma posição.
      expect(resolveIcon({ icon: null, tech: 'aws lambda', kind: 'infra' })).toBe('si:awslambda');
      expect(resolveIcon({ icon: null, tech: 'next.js', kind: 'service' })).toBe('si:nextdotjs');
    });

    it('não casa pedaços de palavra', () => {
      // "go" dentro de "mongo"/"django" não conta.
      expect(resolveIcon({ icon: null, tech: 'django', kind: 'service' })).toBe('si:django');
      expect(resolveIcon({ icon: null, tech: 'gopher', kind: 'service' })).toBe('lu:server');
    });

    it('sem tecnologia reconhecida cai no padrão do tipo', () => {
      expect(resolveIcon({ icon: null, tech: 'cobol', kind: 'queue' })).toBe('lu:inbox');
      expect(resolveIcon({ icon: null, tech: '', kind: 'module' })).toBe('lu:box');
      expect(resolveIcon({ icon: null, tech: null, kind: 'external' })).toBe('lu:globe');
    });
  });

  it('searchIcons por rótulo, palavra-chave ou id', () => {
    expect(searchIcons('  ')).toHaveLength(ICONS.length);
    expect(searchIcons('Redis').map((i) => i.id)).toEqual(['si:redis']);
    expect(searchIcons('k8s').map((i) => i.id)).toEqual(['si:kubernetes']);
    expect(searchIcons('hard-drive').map((i) => i.id)).toEqual(['lu:hard-drive']);
    expect(searchIcons('zzzz')).toEqual([]);
  });
});
