# Comm Graph — action de métricas

Envia, a partir do workflow de cada repositório, as métricas que o Comm Graph usa no scorecard:

| Entrada                                                  | Formatos                                                                                                              | Vira                                                |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `coverage`                                               | `coverage-summary.json` (Istanbul/Jest/Vitest), `lcov.info`, `coverage.out` (Go), Cobertura XML                       | cobertura de linhas/branches                        |
| `junit`, `junit-integration`, `junit-e2e`                | JUnit XML (Jest, Vitest, go-junit-report, Surefire, pytest, Playwright…)                                              | testes passando/falhando                            |
| `sarif-sast`, `sarif-dast`, `sarif-sca`, `sarif-secrets` | SARIF 2.1 (Semgrep, CodeQL, ZAP, Trivy, gitleaks, Rainforest…)                                                        | achados por severidade                              |
| `sonarqube` ou `sonar-host-url` + `sonar-project-key`    | JSON de `api/measures/component` + `api/qualitygates/project_status`, ou busca direto da API (token em `sonar-token`) | quality gate, notas A–E, vulnerabilidades, hotspots |
| `metrics`                                                | JSON: `coverageLines`, `coverageBranches`, `mutationScore`, `flakyRate`, `lintErrors`, `lintWarnings`                 | valores já calculados                               |

O servidor interpreta os arquivos, guarda o histórico (`repo_metrics`) e recalcula a nota do repositório.

## Uso

1. No Comm Graph, crie um usuário **editor** para o CI, entre com ele e gere um token em “Minha conta e tokens”.
2. Salve o token como secret `COMM_GRAPH_TOKEN` (na organização ou no repositório).
3. Adicione ao workflow, depois dos passos que geram os relatórios:

```yaml
- uses: <sua-org>/comm-graph/integrations/github-action@main
  if: always() # envia mesmo se os testes falharem
  with:
    url: https://comm-graph.minhaempresa.com
    token: ${{ secrets.COMM_GRAPH_TOKEN }}
    coverage: coverage/coverage-summary.json
    junit: reports/junit.xml
    sarif-sast: semgrep.sarif
    sarif-dast: zap.sarif
    # SonarQube/SonarCloud (opcional): busca medidas e quality gate depois da análise do Sonar
    sonar-host-url: https://sonarcloud.io
    sonar-project-key: minha-org_meu-repo
    sonar-token: ${{ secrets.SONAR_TOKEN }}
```

SAST, DAST, SCA, segredos e SonarQube alimentam também o **relatório de segurança** (tela “Segurança”).

Precisa de `bash`, `jq` e `curl` (já vêm nos runners `ubuntu-latest`). A chamada é um `POST /api/metrics` com
`Authorization: Bearer <token>`; qualquer outra CI pode montar o mesmo JSON.
