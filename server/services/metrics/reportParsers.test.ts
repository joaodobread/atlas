import { describe, expect, it } from 'vitest';
import { parseCobertura, parseGoCover, parseIstanbulSummary, parseJunit, parseLcov, parseSarif } from './reportParsers.ts';

describe('parseIstanbulSummary', () => {
  it('lê o total de linhas e branches', () => {
    expect(parseIstanbulSummary(JSON.stringify({ total: { lines: { pct: 87.5 }, branches: { pct: 70 } } }))).toEqual({ lines: 87.5, branches: 70 });
  });
  it('trata percentuais ausentes ou inválidos como null', () => {
    expect(parseIstanbulSummary(JSON.stringify({ total: { lines: { pct: 'Unknown' } } }))).toEqual({ lines: null, branches: null });
  });
  it('rejeita resumo sem total e JSON inválido', () => {
    expect(() => parseIstanbulSummary('{}')).toThrow('coverage-summary sem "total"');
    expect(() => parseIstanbulSummary('não é json')).toThrow(SyntaxError);
  });
});

describe('parseLcov', () => {
  it('soma vários arquivos', () => {
    expect(parseLcov('SF:a\nLF:10\nLH:8\nBRF:4\nBRH:2\nend_of_record\nSF:b\nLF:10\nLH:2\nBRF:0\nBRH:0\nend_of_record')).toEqual({ lines: 50, branches: 50 });
  });
  it('branches null quando não há BRF', () => {
    expect(parseLcov('LF:3\nLH:1')).toEqual({ lines: 33.33, branches: null });
  });
  it('rejeita lcov sem linhas', () => {
    expect(() => parseLcov('SF:a\nend_of_record')).toThrow('lcov sem linhas (LF)');
  });
});

describe('parseGoCover', () => {
  it('calcula cobertura por statements', () => {
    const profile = ['mode: set', 'a.go:1.1,2.2 3 1', 'a.go:3.1,4.2 1 0', '  b.go:5.1,6.2 4 2  ', 'lixo'].join('\n');
    expect(parseGoCover(profile)).toEqual({ lines: 87.5, branches: null });
  });
  it('rejeita perfil vazio', () => {
    expect(() => parseGoCover('mode: set\n')).toThrow('coverprofile vazio');
  });
});

describe('parseCobertura', () => {
  it('lê line-rate e branch-rate da raiz', () => {
    expect(parseCobertura('<?xml version="1.0"?><coverage line-rate="0.8123" branch-rate="0.5" version="1"><packages/></coverage>')).toEqual({
      lines: 81.23,
      branches: 50,
    });
  });
  it('atributos ausentes viram null', () => {
    expect(parseCobertura('<coverage version="1"></coverage>')).toEqual({ lines: null, branches: null });
  });
  it('rejeita XML sem <coverage>', () => {
    expect(() => parseCobertura('<report/>')).toThrow('XML Cobertura sem <coverage>');
  });
});

describe('parseJunit', () => {
  it('conta casos aprovados, falhos, com erro e ignorados', () => {
    const xml = `<testsuites><testsuite>
      <testcase name="a"/>
      <testcase name="b"><failure message="x"/></testcase>
      <testcase name="c"><error/></testcase>
      <testcase name="d"><skipped/></testcase>
      <testcase name="e"><system-out>ok</system-out></testcase>
    </testsuite></testsuites>`;
    expect(parseJunit(xml)).toEqual({ total: 5, passed: 2, failed: 2, skipped: 1 });
  });
  it('usa os atributos do testsuite quando não há <testcase>', () => {
    expect(parseJunit('<testsuites tests="10" failures="1" errors="2" skipped="1" disabled="1"></testsuites>')).toEqual({
      total: 10,
      passed: 5,
      failed: 3,
      skipped: 2,
    });
    expect(parseJunit('<testsuite tests="3"/>')).toEqual({ total: 3, passed: 3, failed: 0, skipped: 0 });
  });
  it('rejeita relatório sem casos', () => {
    expect(() => parseJunit('<testsuite tests="0"/>')).toThrow('JUnit sem casos de teste');
    expect(() => parseJunit('<nada/>')).toThrow('JUnit sem casos de teste');
  });
});

describe('parseSarif', () => {
  it('classifica por security-severity do resultado ou da regra', () => {
    const sarif = {
      runs: [
        {
          tool: {
            driver: {
              name: 'CodeQL',
              rules: [
                { id: 'r-crit', properties: { 'security-severity': '9.8' } },
                { id: 'r-low', properties: { 'security-severity': '2' } },
              ],
            },
          },
          results: [
            { ruleId: 'r-crit' },
            { ruleId: 'r-low' },
            { ruleId: 'x', properties: { 'security-severity': 7.5 } },
            { ruleId: 'x', properties: { 'security-severity': 5 } },
          ],
        },
      ],
    };
    expect(parseSarif(JSON.stringify(sarif))).toEqual({ tools: ['CodeQL'], counts: { critical: 1, high: 1, medium: 1, low: 1 } });
  });

  it('sem CVSS usa o level do resultado, o da regra ou warning', () => {
    const sarif = {
      runs: [
        {
          tool: { driver: { name: 'Semgrep', rules: [{ id: 'n', defaultConfiguration: { level: 'note' } }] } },
          results: [
            { level: 'error' },
            { level: 'warning' },
            { ruleId: 'n' },
            {},
            { level: 'none' },
            { properties: { 'security-severity': '0' }, level: 'note' },
          ],
        },
        { tool: { driver: { name: 'Semgrep' } } },
        {},
      ],
    };
    expect(parseSarif(JSON.stringify(sarif))).toEqual({ tools: ['Semgrep'], counts: { critical: 0, high: 1, medium: 2, low: 2 } });
  });

  it('ignora resultados suprimidos', () => {
    const sarif = {
      runs: [
        {
          results: [
            { level: 'error', suppressions: [{ kind: 'inSource' }] },
            { level: 'error', suppressions: [] },
          ],
        },
      ],
    };
    expect(parseSarif(JSON.stringify(sarif))).toEqual({ tools: [], counts: { critical: 0, high: 1, medium: 0, low: 0 } });
  });

  it('rejeita SARIF sem runs', () => {
    expect(() => parseSarif('{}')).toThrow('SARIF sem "runs"');
  });
});
