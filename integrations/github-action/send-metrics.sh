#!/usr/bin/env bash
# Monta o payload de métricas e envia para POST <url>/api/metrics. Usado pela action (action.yml).
set -uo pipefail
shopt -s globstar nullglob 2>/dev/null || shopt -s nullglob

reports='[]'

# add <tipo> <categoria|-> <glob>
add() {
  local type="$1" category="$2" pattern="$3" file
  [ -z "$pattern" ] && return 0
  for file in $pattern; do
    [ -f "$file" ] || continue
    echo "comm-graph: incluindo $type ${category/-/} $file"
    reports=$(jq --arg type "$type" --arg category "$category" --rawfile content "$file" \
      '. + [{type: $type, content: $content} + (if $category == "-" then {} else {category: $category} end)]' <<<"$reports")
  done
}

coverage_type() {
  case "$1" in
    *coverage-summary.json) echo istanbul-summary ;;
    *.info | *lcov*) echo lcov ;;
    *.out | *coverprofile*) echo go-cover ;;
    *.xml) echo cobertura ;;
    *) echo "" ;;
  esac
}

if [ -n "${CG_COVERAGE:-}" ]; then
  for file in $CG_COVERAGE; do
    t=$(coverage_type "$file")
    if [ -z "$t" ]; then echo "comm-graph: formato de cobertura não reconhecido: $file"; continue; fi
    add "$t" - "$file"
  done
fi
add junit unit "${CG_JUNIT:-}"
add junit integration "${CG_JUNIT_INTEGRATION:-}"
add junit e2e "${CG_JUNIT_E2E:-}"
add sarif sast "${CG_SARIF_SAST:-}"
add sarif dast "${CG_SARIF_DAST:-}"
add sarif sca "${CG_SARIF_SCA:-}"
add sarif secrets "${CG_SARIF_SECRETS:-}"
add sonarqube - "${CG_SONARQUBE:-}"

# SonarQube/SonarCloud direto da API: medidas + quality gate num só JSON (lista).
if [ -n "${CG_SONAR_HOST_URL:-}" ] && [ -n "${CG_SONAR_PROJECT_KEY:-}" ]; then
  sonar_dir=$(mktemp -d)
  sonar_auth=()
  [ -n "${CG_SONAR_TOKEN:-}" ] && sonar_auth=(-u "${CG_SONAR_TOKEN}:")
  sonar_keys='bugs,vulnerabilities,security_hotspots,code_smells,coverage,duplicated_lines_density,ncloc,security_rating,reliability_rating,sqale_rating,security_review_rating'
  sonar_files=()
  curl -sSf ${sonar_auth[@]+"${sonar_auth[@]}"} -G "${CG_SONAR_HOST_URL%/}/api/measures/component" \
    --data-urlencode "component=${CG_SONAR_PROJECT_KEY}" --data-urlencode "metricKeys=${sonar_keys}" \
    -o "$sonar_dir/measures.json" && sonar_files+=("$sonar_dir/measures.json")
  curl -sSf ${sonar_auth[@]+"${sonar_auth[@]}"} -G "${CG_SONAR_HOST_URL%/}/api/qualitygates/project_status" \
    --data-urlencode "projectKey=${CG_SONAR_PROJECT_KEY}" \
    -o "$sonar_dir/gate.json" && sonar_files+=("$sonar_dir/gate.json")
  if [ "${#sonar_files[@]}" -gt 0 ]; then
    jq -s '.' "${sonar_files[@]}" >"$sonar_dir/sonar.json" && add sonarqube - "$sonar_dir/sonar.json"
  else
    echo "comm-graph: não foi possível ler o SonarQube em ${CG_SONAR_HOST_URL}"
  fi
fi

metrics_json="${CG_METRICS:-}"
[ -z "$metrics_json" ] && metrics_json='{}'

payload=$(jq -n \
  --arg owner "${GITHUB_REPOSITORY%%/*}" \
  --arg repo "${GITHUB_REPOSITORY#*/}" \
  --arg sha "$GITHUB_SHA" \
  --arg ref "${GITHUB_REF:-}" \
  --arg runUrl "${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}" \
  --argjson reports "$reports" \
  --argjson metrics "$metrics_json" \
  '{owner: $owner, repo: $repo, sha: $sha, ref: $ref, runUrl: $runUrl, reports: $reports, metrics: $metrics}')

status=$(curl -sS -o /tmp/comm-graph-response.json -w '%{http_code}' \
  -X POST "${CG_URL%/}/api/metrics" \
  -H "Authorization: Bearer ${CG_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data-binary @- <<<"$payload")

if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
  echo "comm-graph: métricas enviadas ($(jq -r '.warnings | length' /tmp/comm-graph-response.json) aviso(s))"
  jq -r '.warnings[]?' /tmp/comm-graph-response.json
  exit 0
fi
echo "comm-graph: falha no envio (HTTP $status): $(cat /tmp/comm-graph-response.json)"
[ "${CG_FAIL:-false}" = "true" ] && exit 1
exit 0
