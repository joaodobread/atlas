# Política de segurança

## Versões suportadas

Só a **última release** publicada recebe correções de segurança. Atualize para a versão mais recente antes de reportar.

## Como reportar uma vulnerabilidade

**Nunca abra uma issue pública** para problemas de segurança.

Use o [reporte privado de vulnerabilidades do GitHub](https://github.com/joaodobread/atlas/security/advisories/new)
(aba _Security → Report a vulnerability_). Inclua:

- versão (tag ou commit) e modo de deploy (imagem do GHCR, build local, dev);
- passos para reproduzir e o impacto esperado;
- se possível, uma prova de conceito mínima — sem dados reais de terceiros.

## Prazos

- Confirmação de recebimento: até **3 dias úteis**.
- Avaliação inicial e severidade: até **10 dias úteis**.
- Correção: conforme a severidade; problemas críticos têm prioridade sobre qualquer outra tarefa. Combinamos a data
  da divulgação com quem reportou e damos o crédito no advisory, se desejado.

## Escopo

Interessam especialmente:

- **Segredos**: vazamento de chave do LLM, token do GitHub, `APP_SECRET`, credenciais de banco/storage (pela API, logs,
  documentos gerados ou exportações).
- **Autenticação e autorização**: sessões, tokens de API, papéis (leitor/editor/admin), bloqueio de login.
- **CSRF** e cabeçalhos de segurança.
- **SSRF** na introspecção de repositórios, em URLs de LLM configuráveis ou em integrações que fazem requisições.
- **Injeção via conteúdo de repositório ou do LLM**: prompt injection que leve a ações indevidas, XSS por Markdown,
  nomes de arquivos/nós ou respostas do LLM, injeção de SQL.
- Isolamento dos buckets (privado x público) e acesso a arquivos.

Fora do escopo: ataques que exigem acesso de administrador já comprometido, negação de serviço volumétrica e
vulnerabilidades em dependências sem caminho explorável no Atlas (reporte ao projeto de origem).
