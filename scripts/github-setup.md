# Configuração do repositório no GitHub

Ajustes que não ficam versionados. Rode **depois** de criar o repositório remoto `joaodobread/atlas` e fazer o
primeiro push da `main` (os checks obrigatórios só podem ser escolhidos depois que o CI rodou uma vez).

Pré-requisito: `gh auth login` com uma conta administradora do repositório.

```bash
export REPO=joaodobread/atlas
```

## 1. Descrição, topics e Discussions

Pela interface: _Settings → General_ (descrição, site, Discussions) e engrenagem do _About_ (topics).

```bash
gh api -X PATCH "repos/$REPO" \
  -f description="Mapa vivo da arquitetura: comunicação entre sistemas, RAG sobre a documentação e saúde dos repositórios. Self-hosted." \
  -F has_discussions=true -F has_issues=true -F has_wiki=false -F has_projects=false

gh api -X PUT "repos/$REPO/topics" \
  -f 'names[]=architecture' -f 'names[]=software-architecture' -f 'names[]=diagram' -f 'names[]=rag' \
  -f 'names[]=self-hosted' -f 'names[]=github' -f 'names[]=postgres' -f 'names[]=pgvector' -f 'names[]=typescript'
```

## 2. Merge só por squash e apagar branch após o merge

_Settings → General → Pull Requests_: deixe só **Allow squash merging** (título do PR como mensagem) e marque
**Automatically delete head branches**.

```bash
gh api -X PATCH "repos/$REPO" \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
  -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY \
  -F delete_branch_on_merge=true -F allow_update_branch=true
```

## 2.1 Quem pode abrir PR

_Settings → General → Pull requests_: em **quem pode criar pull requests**, escolha **Collaborators only** — todos
continuam vendo e comentando, mas só quem você convidar como colaborador abre PR (contribuições externas passam a
chegar por issue/Discussions). Alternativas: **limitar PRs abertos** de quem não tem escrita (com lista de exceções)
ou desligar os PRs de vez (_Features → Pull requests_). Essa opção não tem comando `gh api` documentado: use a interface.
Referências: [changelog de fev/2026](https://github.blog/changelog/2026-02-13-new-repository-settings-for-configuring-pull-request-access/)
e [limite de PRs abertos](https://github.blog/changelog/2026-06-17-limit-open-pull-requests-for-users-without-write-access/).

## 3. Ruleset da `main`

_Settings → Rules → Rulesets → New branch ruleset_: alvo `main` (branch padrão), exigir PR com **1 aprovação**,
**descartar aprovações em push novo**, **checks obrigatórios** `check` e `image` (workflow CI) com **branch
atualizada**, **bloquear force push e deleção** e **exigir histórico linear**.

```bash
gh api -X POST "repos/$REPO/rulesets" --input - <<'JSON'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["squash"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [{ "context": "check" }, { "context": "image" }]
      }
    }
  ]
}
JSON
```

> Projeto com um mantenedor só: com 1 aprovação obrigatória você não consegue mesclar os próprios PRs. Adicione-se
> em `bypass_actors` (papel _Repository admin_, `"actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "pull_request"`)
> ou convide outro revisor.

## 4. Actions: token somente leitura e PRs de forks

_Settings → Actions → General_: **Workflow permissions = Read repository contents** (os workflows pedem o que
precisam por job), desmarque _Allow GitHub Actions to create and approve pull requests_ (o release-please só precisa
**criar** PRs: se ele falhar ao abrir o PR de release, marque essa opção) e em _Fork pull request workflows_ escolha
**Require approval for first-time contributors**.

```bash
gh api -X PUT "repos/$REPO/actions/permissions/workflow" \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false

gh api -X PUT "repos/$REPO/actions/permissions/fork-pr-contributor-approval" \
  -f approval_policy=first_time_contributors
```

## 5. Segurança: secret scanning, push protection, Dependabot e reporte privado

_Settings → Code security_: ative **Secret scanning** + **Push protection**, **Dependabot alerts** + **Dependabot
security updates** e **Private vulnerability reporting**.

```bash
gh api -X PATCH "repos/$REPO" --input - <<'JSON'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
JSON

gh api -X PUT "repos/$REPO/vulnerability-alerts"
gh api -X PUT "repos/$REPO/automated-security-fixes"
gh api -X PUT "repos/$REPO/private-vulnerability-reporting"
```

## 6. Pacote no GHCR

Depois da primeira release, em _Packages → atlas → Package settings_: mude a visibilidade para **Public** e confirme
que o pacote está ligado ao repositório (o label `org.opencontainers.image.source` já faz isso).

## Conferência

```bash
gh api "repos/$REPO" --jq '{squash: .allow_squash_merge, merge: .allow_merge_commit, rebase: .allow_rebase_merge, delete_branch: .delete_branch_on_merge, discussions: .has_discussions, security: .security_and_analysis}'
gh api "repos/$REPO/rulesets" --jq '.[] | {name, enforcement}'
gh api "repos/$REPO/actions/permissions/workflow"
gh api "repos/$REPO/private-vulnerability-reporting"
```
