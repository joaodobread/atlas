/**
 * Remove segredos de um texto antes de guardá-lo ou mandá-lo ao LLM.
 * Mantém nomes de variáveis (úteis para entender integrações) e troca valores sensíveis por [redigido].
 */
export function redactSecrets(text: string): string {
  return (
    text
      // Blocos de chave privada.
      .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[chave privada redigida]')
      // Tokens com formato conhecido (GitHub, AWS, Slack, OpenAI/Anthropic, JWT, Google).
      .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[redigido]')
      .replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '[redigido]')
      .replace(/\bxox[abpors]-[A-Za-z0-9-]{10,}\b/g, '[redigido]')
      .replace(/\bsk-(ant-)?[A-Za-z0-9_-]{20,}\b/g, '[redigido]')
      .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redigido]')
      .replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, '[redigido]')
      // Credenciais em URLs (user:senha@host).
      .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1[redigido]@')
      // Atribuições a chaves com nome sensível: KEY=valor, key: valor, "key": "valor".
      .replace(
        /((?:^|[\s{,"'])[\w.-]*(?:secret|token|passw(?:or)?d|pwd|api[_-]?key|private[_-]?key|credential|auth[_-]?key|access[_-]?key)[\w.-]*["']?\s*[:=]\s*)(["']?)([^\s"',}#]{4,})\2/gim,
        '$1$2[redigido]$2',
      )
  );
}
