import { describe, expect, it } from 'vitest';
import { redactSecrets } from './redactSecrets.ts';

describe('redactSecrets', () => {
  it('remove blocos de chave privada', () => {
    const text = 'antes\n-----BEGIN RSA PRIVATE KEY-----\nMIIabc\nxyz\n-----END RSA PRIVATE KEY-----\ndepois';
    expect(redactSecrets(text)).toBe('antes\n[chave privada redigida]\ndepois');
  });

  it.each([
    ['token do GitHub (ghp_)', `ghp_${'a'.repeat(36)}`],
    ['token do GitHub (gho_)', `gho_${'B'.repeat(30)}`],
    ['PAT fino do GitHub', `github_pat_${'a1_'.repeat(10)}`],
    ['chave AWS AKIA', 'AKIAABCDEFGHIJKLMNOP'],
    ['chave AWS ASIA', 'ASIAABCDEFGHIJKLMNOP'],
    ['token do Slack', 'xoxb-1234567890-abcdef'],
    ['chave da OpenAI', `sk-${'x'.repeat(30)}`],
    ['chave da Anthropic', `sk-ant-${'y'.repeat(30)}`],
    ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop'],
    ['chave do Google', `AIza${'z'.repeat(35)}`],
  ])('redige %s', (_label, secret) => {
    const out = redactSecrets(`valor ${secret} fim`);
    expect(out).toBe('valor [redigido] fim');
  });

  it('redige credenciais em URLs mantendo esquema e host', () => {
    expect(redactSecrets('postgres://admin:s3nh4@db.interno:5432/app')).toBe('postgres://[redigido]@db.interno:5432/app');
    expect(redactSecrets('https://user:pass@example.com/x')).toBe('https://[redigido]@example.com/x');
  });

  it('redige valores atribuídos a nomes sensíveis e mantém os nomes', () => {
    expect(redactSecrets('DB_PASSWORD=supersecreta')).toBe('DB_PASSWORD=[redigido]');
    expect(redactSecrets('api_key: abcd1234')).toBe('api_key: [redigido]');
    expect(redactSecrets('"clientSecret": "xyz12345"')).toBe('"clientSecret": "[redigido]"');
    expect(redactSecrets("  AUTH_TOKEN = 'qwerty'")).toBe("  AUTH_TOKEN = '[redigido]'");
    expect(redactSecrets('{privateKey: "abcdef"}')).toBe('{privateKey: "[redigido]"}');
    expect(redactSecrets('aws_access_key=ABCDEFG')).toBe('aws_access_key=[redigido]');
    expect(redactSecrets('pwd=hunter22')).toBe('pwd=[redigido]');
    expect(redactSecrets('db_credential: valor1')).toBe('db_credential: [redigido]');
  });

  it('mantém texto sem segredos e valores curtos', () => {
    const text = 'PORT=3000\nNODE_ENV=production\nTOKEN=abc\nnome: serviço';
    expect(redactSecrets(text)).toBe(text);
  });

  it('mantém referências a variáveis (nomes) intactas', () => {
    expect(redactSecrets('process.env.JWT_SECRET')).toBe('process.env.JWT_SECRET');
  });
});
