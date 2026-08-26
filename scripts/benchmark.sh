#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$PROJECT_ROOT"

SHORT_MATCH_ID=${BENCHMARK_SHORT_MATCH_ID:-8946228107}
NORMAL_MATCH_ID=${BENCHMARK_NORMAL_MATCH_ID:-8955653541}
LARGE_MATCH_ID=${BENCHMARK_LARGE_MATCH_ID:-8946303764}
MEASURED_RUNS=${BENCHMARK_RUNS:-3}
REPLAY_SOURCE=${BENCHMARK_REPLAY_SOURCE:-dota-stats-replays}
PARSER_IMAGE=${BENCHMARK_PARSER_IMAGE:-dota-stats-lab-parser:local}
APP_IMAGE=${BENCHMARK_APP_IMAGE:-dota-stats-lab-app:local}
WEB_IMAGE=${BENCHMARK_WEB_IMAGE:-dota-stats-lab-web:local}
E2E_IMAGE=${BENCHMARK_E2E_IMAGE:-dota-stats-lab-e2e:local}
HTTP_MATCH_ID=${BENCHMARK_HTTP_MATCH_ID:-$NORMAL_MATCH_ID}
GPM_WINDOW_SECONDS=${BENCHMARK_GPM_WINDOW_SECONDS:-60}
GPM_WARM_SAMPLES=${BENCHMARK_GPM_WARM_SAMPLES:-5}
GPM_MAX_ROUNDING_DIFFERENCE=${BENCHMARK_GPM_MAX_ROUNDING_DIFFERENCE:-1}
HEATMAP_RANGE_SECONDS=${BENCHMARK_HEATMAP_RANGE_SECONDS:-300}
HEATMAP_WARM_SAMPLES=${BENCHMARK_HEATMAP_WARM_SAMPLES:-5}
BROWSER_RENDER_SAMPLES=${BENCHMARK_BROWSER_RENDER_SAMPLES:-3}
ONLY_REPLAY=${BENCHMARK_ONLY:-all}
RUN_HTTP=${BENCHMARK_HTTP:-1}
BUILD_IMAGES=${BENCHMARK_BUILD:-1}
KEEP_SCRATCH=${BENCHMARK_KEEP_SCRATCH:-0}
OUTPUT_DIR=${BENCHMARK_OUTPUT_DIR:-$PROJECT_ROOT/benchmark-results/$(date -u +%Y%m%dT%H%M%SZ)}

[[ "$MEASURED_RUNS" =~ ^[1-9][0-9]*$ ]] || { echo "BENCHMARK_RUNS must be positive" >&2; exit 2; }
[[ "$RUN_HTTP" == 0 || "$RUN_HTTP" == 1 ]] || { echo "BENCHMARK_HTTP must be 0 or 1" >&2; exit 2; }
[[ "$BUILD_IMAGES" == 0 || "$BUILD_IMAGES" == 1 ]] || { echo "BENCHMARK_BUILD must be 0 or 1" >&2; exit 2; }
[[ "$ONLY_REPLAY" =~ ^(all|short|normal|large)$ ]] || { echo "BENCHMARK_ONLY must be all, short, normal, or large" >&2; exit 2; }
[[ "$GPM_WINDOW_SECONDS" =~ ^(1|5|10|30|60|300)$ ]] || { echo "BENCHMARK_GPM_WINDOW_SECONDS must be 1, 5, 10, 30, 60, or 300" >&2; exit 2; }
[[ "$GPM_WARM_SAMPLES" =~ ^[1-9][0-9]*$ ]] || { echo "BENCHMARK_GPM_WARM_SAMPLES must be positive" >&2; exit 2; }
[[ "$GPM_MAX_ROUNDING_DIFFERENCE" =~ ^([0-9]+([.][0-9]+)?|[.][0-9]+)$ ]] || { echo "BENCHMARK_GPM_MAX_ROUNDING_DIFFERENCE must be nonnegative" >&2; exit 2; }
[[ "$HEATMAP_RANGE_SECONDS" =~ ^[1-9][0-9]*$ ]] || { echo "BENCHMARK_HEATMAP_RANGE_SECONDS must be positive" >&2; exit 2; }
[[ "$HEATMAP_WARM_SAMPLES" =~ ^[1-9][0-9]*$ ]] || { echo "BENCHMARK_HEATMAP_WARM_SAMPLES must be positive" >&2; exit 2; }
[[ "$BROWSER_RENDER_SAMPLES" =~ ^[1-9][0-9]*$ ]] || { echo "BENCHMARK_BROWSER_RENDER_SAMPLES must be positive" >&2; exit 2; }

if docker info >/dev/null 2>&1; then DOCKER=(docker); else DOCKER=(sudo docker); fi
if "${DOCKER[@]}" compose version >/dev/null 2>&1; then COMPOSE=("${DOCKER[@]}" compose); else COMPOSE=(sudo docker compose); fi

if [[ "$BUILD_IMAGES" == 1 ]]; then
  services=(parser loader)
  [[ "$RUN_HTTP" == 1 ]] && services+=(web e2e)
  "${COMPOSE[@]}" build "${services[@]}"
fi

for image in "$PARSER_IMAGE" "$APP_IMAGE"; do
  "${DOCKER[@]}" image inspect "$image" >/dev/null
done
if [[ "$RUN_HTTP" == 1 ]]; then
  "${DOCKER[@]}" image inspect "$WEB_IMAGE" "$E2E_IMAGE" >/dev/null
fi

if [[ "$REPLAY_SOURCE" == /* ]]; then
  [[ -d "$REPLAY_SOURCE" ]] || { echo "Replay root is not a directory: $REPLAY_SOURCE" >&2; exit 2; }
  REPLAY_MOUNT=(--mount "type=bind,src=$REPLAY_SOURCE,dst=/data/replays,readonly")
else
  "${DOCKER[@]}" volume inspect "$REPLAY_SOURCE" >/dev/null
  REPLAY_MOUNT=(--mount "type=volume,src=$REPLAY_SOURCE,dst=/data/replays,readonly")
fi

mkdir -p "$OUTPUT_DIR"
WORK_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/dota-benchmark.XXXXXX")
RUNS_FILE="$OUTPUT_DIR/runs.jsonl"
ENVIRONMENT_FILE="$OUTPUT_DIR/environment.json"
: > "$RUNS_FILE"
active_containers=()

cleanup() {
  local name
  for name in "${active_containers[@]:-}"; do
    [[ "$name" == dota-benchmark-* ]] && "${DOCKER[@]}" rm --force "$name" >/dev/null 2>&1 || true
  done
  if [[ "$KEEP_SCRATCH" == 0 && "$WORK_ROOT" == "${TMPDIR:-/tmp}"/dota-benchmark.* ]]; then
    make_removable "$WORK_ROOT"
    rm -rf -- "$WORK_ROOT"
  else
    echo "Benchmark scratch retained at $WORK_ROOT" >&2
  fi
}
trap cleanup EXIT INT TERM

make_removable() {
  local directory=$1
  [[ -d "$directory" ]] || return 0
  chmod -R a+rwX "$directory" 2>/dev/null || \
    "${DOCKER[@]}" run --rm --network none --user 0 --entrypoint chmod \
      --mount "type=bind,src=$directory,dst=/scratch" "$APP_IMAGE" -R a+rwX /scratch
}

parser_identity=$(jq -c . parser-identity.json)
cpu_model=$(awk -F: '/model name/ {sub(/^[[:space:]]+/, "", $2); print $2; exit}' /proc/cpuinfo)
memory_bytes=$(awk '/MemTotal/ {print $2 * 1024}' /proc/meminfo)
os_name=$(awk -F= '$1 == "PRETTY_NAME" {gsub(/^"|"$/, "", $2); print $2}' /etc/os-release)
git_revision=$(git rev-parse HEAD)
git_dirty=false; [[ -n $(git status --porcelain) ]] && git_dirty=true
docker_version=$("${DOCKER[@]}" version --format '{{.Server.Version}}')
compose_version=$("${COMPOSE[@]}" version --short)

jq -n \
  --arg cpu "$cpu_model" --argjson cpus "$(nproc)" --argjson memory "$memory_bytes" \
  --arg os "$os_name" --arg kernel "$(uname -srmo)" \
  --arg docker "$docker_version" --arg compose "$compose_version" \
  --arg revision "$git_revision" --argjson dirty "$git_dirty" \
  --argjson identity "$parser_identity" \
  --arg duckdb "$(jq -r '.dependencies["@duckdb/node-api"]' package.json)" \
  --arg tanstackStart "$(jq -r '.dependencies["@tanstack/react-start"]' package.json)" \
  --arg node "$(jq -r '.engines.node' package.json)" \
  --arg parserImage "$("${DOCKER[@]}" image inspect -f '{{.Id}}' "$PARSER_IMAGE")" \
  --arg appImage "$("${DOCKER[@]}" image inspect -f '{{.Id}}' "$APP_IMAGE")" \
  '{cpuModel:$cpu,logicalCpus:$cpus,memoryBytes:$memory,os:$os,kernel:$kernel,
    dockerVersion:$docker,composeVersion:$compose,gitRevision:$revision,gitDirty:$dirty,
    parserIdentity:$identity,software:{node:$node,duckdbNodeApi:$duckdb,tanstackStart:$tanstackStart},
    images:{parser:$parserImage,app:$appImage}}' > "$ENVIRONMENT_FILE"

sample_memory() {
  local name=$1 output=$2 peak=0 bytes
  while [[ $("${DOCKER[@]}" inspect -f '{{.State.Running}}' "$name" 2>/dev/null || true) == true ]]; do
    bytes=$("${DOCKER[@]}" top "$name" -eo pid,rss 2>/dev/null | awk 'NR > 1 {sum += $2} END {printf "%.0f\n", sum * 1024}' || true)
    if [[ -n "$bytes" ]]; then
      (( bytes > peak )) && peak=$bytes
    fi
    sleep 0.2
  done
  printf '%s\n' "$peak" > "$output"
}

run_measured_container() {
  local phase=$1 log_file=$2 peak_file=$3; shift 3
  local name start_ns end_ns exit_code sampler_pid
  name="dota-benchmark-${phase}-$$-$RANDOM"
  active_containers+=("$name")
  start_ns=$(date +%s%N)
  "${DOCKER[@]}" run --detach --name "$name" "$@" >/dev/null
  sample_memory "$name" "$peak_file" & sampler_pid=$!
  exit_code=$("${DOCKER[@]}" wait "$name")
  end_ns=$(date +%s%N)
  "${DOCKER[@]}" logs "$name" > "$log_file" 2>&1 || true
  wait "$sampler_pid" || true
  "${DOCKER[@]}" rm "$name" >/dev/null
  active_containers=("${active_containers[@]/$name}")
  CONTAINER_WALL_MS=$(( (end_ns - start_ns) / 1000000 ))
  if [[ "$exit_code" != 0 ]]; then
    cat "$log_file" >&2
    echo "$phase container failed with exit code $exit_code" >&2
    return "$exit_code"
  fi
}

detect_replay() {
  local match_id=$1
  "${DOCKER[@]}" run --rm --network none --entrypoint sh "${REPLAY_MOUNT[@]}" "$PARSER_IMAGE" -c \
    'if [ -f "/data/replays/'"$match_id"'/replay.dem.bz2" ]; then printf "%s" "/data/replays/'"$match_id"'/replay.dem.bz2"; elif [ -f "/data/replays/'"$match_id"'/replay.dem" ]; then printf "%s" "/data/replays/'"$match_id"'/replay.dem"; else exit 1; fi'
}

run_http_probe() {
  local scratch=$1 match_id=$2 acknowledgement=$3 name port probe
  name="dota-benchmark-web-$$-$RANDOM"
  active_containers+=("$name")
  "${DOCKER[@]}" run --detach --name "$name" --init --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true --memory 4g --cpus 1 --pids-limit 128 \
    --publish 127.0.0.1::3000 --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
    "${REPLAY_MOUNT[@]}" \
    --mount "type=bind,src=$scratch/staging,dst=/work/staging" \
    --mount "type=bind,src=$scratch/warehouse,dst=/data/warehouse" \
    --mount "type=bind,src=$scratch/queries,dst=/data/queries" \
    -e WAREHOUSE_PATH=/data/warehouse/dota.duckdb -e REPLAY_ROOT=/data/replays \
    -e STAGING_ROOT=/work/staging -e JOBS_ROOT=/work/staging/jobs -e QUERY_FILES_ROOT=/data/queries \
    "$WEB_IMAGE" >/dev/null
  port=$("${DOCKER[@]}" port "$name" 3000/tcp | awk -F: 'NR == 1 {print $NF}')
  for _ in $(seq 1 120); do
    curl --silent --fail --max-time 2 "http://127.0.0.1:$port/health" >/dev/null && break
    sleep 0.5
  done
  curl --silent --fail --max-time 2 "http://127.0.0.1:$port/health" >/dev/null
  probe=$("${DOCKER[@]}" run --rm --network host \
    --mount "type=bind,src=$PROJECT_ROOT/scripts/verify-overview.mjs,dst=/work/verify-overview.mjs,readonly" \
    -e BENCHMARK_BASE_URL="http://127.0.0.1:$port" -e BENCHMARK_MATCH_ID="$match_id" \
    -e BENCHMARK_OVERVIEW_SAMPLES=30 -e BENCHMARK_BROWSER_RENDER_SAMPLES="$BROWSER_RENDER_SAMPLES" \
    -e BENCHMARK_ACKNOWLEDGEMENT="$acknowledgement" "$E2E_IMAGE" node /work/verify-overview.mjs)
  "${DOCKER[@]}" rm --force "$name" >/dev/null
  active_containers=("${active_containers[@]/$name}")
  printf '%s' "$probe"
}

measure_gpm() {
  local scratch=$1 match_id=$2
  "${DOCKER[@]}" run --rm --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true --memory 4g --cpus 1 --pids-limit 128 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
    --mount "type=bind,src=$scratch/warehouse,dst=/data/warehouse" \
    --mount "type=bind,src=$PROJECT_ROOT/scripts/measure-gpm.mjs,dst=/app/measure-gpm.mjs,readonly" \
    -e WAREHOUSE_PATH=/data/warehouse/dota.duckdb -e BENCHMARK_MATCH_ID="$match_id" \
    -e BENCHMARK_GPM_WINDOW_SECONDS="$GPM_WINDOW_SECONDS" -e BENCHMARK_GPM_OUTPUT_STEP_SECONDS=1 \
    -e BENCHMARK_GPM_WARM_SAMPLES="$GPM_WARM_SAMPLES" \
    -e BENCHMARK_GPM_MAX_ROUNDING_DIFFERENCE="$GPM_MAX_ROUNDING_DIFFERENCE" \
    --entrypoint node "$APP_IMAGE" /app/measure-gpm.mjs
}

measure_positions() {
  local scratch=$1 match_id=$2
  "${DOCKER[@]}" run --rm --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true --memory 4g --cpus 1 --pids-limit 128 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
    --mount "type=bind,src=$scratch/warehouse,dst=/data/warehouse" \
    --mount "type=bind,src=$PROJECT_ROOT/scripts/measure-positions.mjs,dst=/app/measure-positions.mjs,readonly" \
    -e WAREHOUSE_PATH=/data/warehouse/dota.duckdb -e BENCHMARK_MATCH_ID="$match_id" \
    -e BENCHMARK_HEATMAP_RANGE_SECONDS="$HEATMAP_RANGE_SECONDS" \
    -e BENCHMARK_HEATMAP_WARM_SAMPLES="$HEATMAP_WARM_SAMPLES" \
    --entrypoint node "$APP_IMAGE" /app/measure-positions.mjs
}

run_ingestion() {
  local label=$1 match_id=$2 kind=$3 run_number=$4
  local scratch replay_path replay_bytes manifest_file manifest_copy parser_wall loader_wall
  local parser_peak loader_peak peak complete metrics metrics_output warehouse_bytes gpm_json positions_json http_json=null acknowledgement=0
  local position_exported_rows position_stored_rows
  scratch="$WORK_ROOT/run-${label}-${kind}-${run_number}-$RANDOM"
  mkdir -p "$scratch/staging/inbox" "$scratch/staging/claimed" "$scratch/staging/jobs" "$scratch/warehouse" "$scratch/queries"
  chmod 0777 "$scratch/staging/inbox" "$scratch/staging/claimed" "$scratch/staging/jobs" "$scratch/warehouse" "$scratch/queries"
  replay_path=$(detect_replay "$match_id")
  replay_bytes=$("${DOCKER[@]}" run --rm --network none --entrypoint stat "${REPLAY_MOUNT[@]}" "$PARSER_IMAGE" -c %s "$replay_path")

  run_measured_container "parser-$label-$kind-$run_number" "$scratch/parser.log" "$scratch/parser.peak" \
    --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --memory 4g --cpus 2 --pids-limit 256 \
    --tmpfs /tmp:rw,exec,nosuid,nodev,size=2304m,mode=1777 "${REPLAY_MOUNT[@]}" \
    --mount "type=bind,src=$scratch/staging/inbox,dst=/work/staging/inbox" \
    "$PARSER_IMAGE" "$match_id" --replay "$replay_path" --staging-root /work/staging/inbox
  parser_wall=$CONTAINER_WALL_MS
  manifest_file=$(find "$scratch/staging/inbox/$match_id" -mindepth 2 -maxdepth 2 -name manifest.json -print -quit)
  [[ -n "$manifest_file" ]] || { cat "$scratch/parser.log" >&2; echo "Parser did not publish a manifest" >&2; return 1; }
  manifest_copy="$scratch/manifest.json"; cp "$manifest_file" "$manifest_copy"

  run_measured_container "loader-$label-$kind-$run_number" "$scratch/loader.log" "$scratch/loader.peak" \
    --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --memory 4g --cpus 2 --pids-limit 256 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
    --mount "type=bind,src=$scratch/staging,dst=/work/staging" \
    --mount "type=bind,src=$scratch/warehouse,dst=/data/warehouse" \
    -e MATCH_ID="$match_id" -e STAGING_ROOT=/work/staging \
    -e STAGING_INBOX_ROOT=/work/staging/inbox -e STAGING_CLAIMED_ROOT=/work/staging/claimed \
    -e WAREHOUSE_PATH=/data/warehouse/dota.duckdb "$APP_IMAGE" load
  loader_wall=$CONTAINER_WALL_MS
  parser_peak=$(<"$scratch/parser.peak"); loader_peak=$(<"$scratch/loader.peak")
  (( parser_peak > loader_peak )) && peak=$parser_peak || peak=$loader_peak
  complete=$(( parser_wall + loader_wall ))

  metrics_output=$(printf '%s\n' "SELECT e.extraction_id, e.preparation_elapsed_ms::VARCHAR AS preparation_ms, e.parse_elapsed_ms::VARCHAR AS parsing_ms, e.load_elapsed_ms::VARCHAR AS load_ms, e.summary_elapsed_ms::VARCHAR AS summary_ms, e.output_size_bytes::VARCHAR AS output_bytes, coalesce(json_extract_string(e.record_counts, '$.total'), '0') AS retained_rows, (SELECT count(*)::VARCHAR FROM analysis.player_gold_events AS gold WHERE gold.extraction_id = e.extraction_id) AS gold_event_rows, (SELECT count(*)::VARCHAR FROM analysis.hero_position_samples AS position WHERE position.extraction_id = e.extraction_id) AS position_rows, m.duration_seconds::VARCHAR AS duration_seconds FROM catalog.extractions e LEFT JOIN analysis.matches m USING (extraction_id) WHERE e.match_id = $match_id ORDER BY e.completed_at DESC LIMIT 1;" | \
    "${DOCKER[@]}" run --rm --interactive --network none --read-only \
      --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
      --mount "type=bind,src=$scratch/warehouse,dst=/data/warehouse" \
      -e WAREHOUSE_PATH=/data/warehouse/dota.duckdb "$APP_IMAGE" sql)
  metrics=$(sed -n '1p' <<<"$metrics_output")
  [[ $(jq -r '.extraction_id // empty' <<<"$metrics") ]] || { echo "Could not read benchmark metrics" >&2; return 1; }
  position_exported_rows=$(jq -r '.files.heroPositions.records // empty' "$manifest_copy")
  position_stored_rows=$(jq -r '.position_rows | tonumber' <<<"$metrics")
  if [[ -n "$position_exported_rows" && "$position_exported_rows" != "$position_stored_rows" ]]; then
    echo "Position row mismatch: parser exported $position_exported_rows but loader stored $position_stored_rows" >&2
    return 1
  fi
  warehouse_bytes=$(stat -c %s "$scratch/warehouse/dota.duckdb")
  gpm_json=$(measure_gpm "$scratch" "$match_id")
  positions_json=$(measure_positions "$scratch" "$match_id")

  if [[ "$match_id" == "$HTTP_MATCH_ID" ]]; then acknowledgement=1; fi
  if [[ "$RUN_HTTP" == 1 && "$kind" == measured && "$run_number" == "$MEASURED_RUNS" \
    && ( "$label" == normal || "$label" == large || "$match_id" == "$HTTP_MATCH_ID" ) ]]; then
    http_json=$(run_http_probe "$scratch" "$match_id" "$acknowledgement")
  fi

  jq -n --arg label "$label" --arg matchId "$match_id" --arg kind "$kind" --argjson run "$run_number" \
    --argjson replayBytes "$replay_bytes" --argjson parserWall "$parser_wall" --argjson loaderWall "$loader_wall" \
    --argjson peak "$peak" --argjson complete "$complete" --argjson warehouseBytes "$warehouse_bytes" \
    --argjson metrics "$metrics" --argjson gpm "$gpm_json" --argjson positions "$positions_json" \
    --argjson manifest "$(<"$manifest_copy")" --argjson http "$http_json" \
    '{label:$label,matchId:$matchId,kind:$kind,run:$run,replayBytes:$replayBytes,
      matchDurationSeconds:(if $metrics.duration_seconds == null then null else ($metrics.duration_seconds|tonumber) end),
      preparationMs:($metrics.preparation_ms|tonumber),parsingMs:($metrics.parsing_ms|tonumber),
      duckdbWriteMs:(($metrics.load_ms|tonumber)-($metrics.summary_ms|tonumber)),
      summaryMs:($metrics.summary_ms|tonumber),completeMs:$complete,
      parserContainerWallMs:$parserWall,loaderContainerWallMs:$loaderWall,
      peakRssBytes:$peak,retainedRows:($metrics.retained_rows|tonumber),
      exportedRows:([$manifest.files[].records]|add),outputBytes:($metrics.output_bytes|tonumber),
      positionExportedRows:(($manifest.files.heroPositions.records // 0)|tonumber),
      positionOutputBytes:(($manifest.files.heroPositions.bytes // 0)|tonumber),
      extractionId:$metrics.extraction_id,warehouseBytes:$warehouseBytes,
      goldEventRows:($metrics.gold_event_rows|tonumber),positionStoredRows:($metrics.position_rows|tonumber),
      gpm:$gpm,positions:$positions,
      http:(if $http == null then null else $http end)}' >> "$RUNS_FILE"
  echo "$label $kind run $run_number complete: $complete ms" >&2

  if [[ "$KEEP_SCRATCH" == 0 && "$scratch" == "$WORK_ROOT"/run-* ]]; then
    make_removable "$scratch"
    rm -rf -- "$scratch"
  fi
}

labels=(short normal large)
matches=("$SHORT_MATCH_ID" "$NORMAL_MATCH_ID" "$LARGE_MATCH_ID")
for index in "${!labels[@]}"; do
  [[ "$ONLY_REPLAY" == all || "$ONLY_REPLAY" == "${labels[$index]}" ]] || continue
  run_ingestion "${labels[$index]}" "${matches[$index]}" warmup 0
  for run in $(seq 1 "$MEASURED_RUNS"); do
    run_ingestion "${labels[$index]}" "${matches[$index]}" measured "$run"
  done
done

RESULTS_FILE="$OUTPUT_DIR/results.json"
jq -n --arg generatedAt "$(date -u +%FT%TZ)" --slurpfile environment "$ENVIRONMENT_FILE" \
  --slurpfile runs "$RUNS_FILE" --arg replaySource "$REPLAY_SOURCE" --argjson measuredRuns "$MEASURED_RUNS" \
  --argjson httpEnabled "$RUN_HTTP" --argjson browserRenderSamples "$BROWSER_RENDER_SAMPLES" \
  --argjson gpmWindowSeconds "$GPM_WINDOW_SECONDS" --argjson gpmWarmSamples "$GPM_WARM_SAMPLES" \
  --argjson gpmMaxRoundingDifference "$GPM_MAX_ROUNDING_DIFFERENCE" \
  --argjson heatmapRangeSeconds "$HEATMAP_RANGE_SECONDS" --argjson heatmapWarmSamples "$HEATMAP_WARM_SAMPLES" \
  '{schemaVersion:3,generatedAt:$generatedAt,environment:$environment[0],
    configuration:{replaySource:$replaySource,warmupRuns:1,measuredRuns:$measuredRuns,
      overviewSamples:(if $httpEnabled == 1 then 30 else 0 end),parserMemoryLimitBytes:4294967296,
      browserRenderSamples:(if $httpEnabled == 1 then $browserRenderSamples else 0 end),
      gpmWindowSeconds:$gpmWindowSeconds,gpmOutputStepSeconds:1,gpmWarmSamples:$gpmWarmSamples,
      gpmMaxRoundingDifference:$gpmMaxRoundingDifference,
      heatmapRangeSeconds:$heatmapRangeSeconds,heatmapGridSize:64,heatmapWarmSamples:$heatmapWarmSamples,
      loaderMemoryLimitBytes:4294967296,parserCpus:2,loaderCpus:2,memorySampleIntervalMs:200},
    runs:$runs}' > "$RESULTS_FILE"
node scripts/render-benchmark.mjs "$RESULTS_FILE" "$OUTPUT_DIR/BENCHMARK.md"
echo "Benchmark results: $RESULTS_FILE"
echo "Benchmark report:  $OUTPUT_DIR/BENCHMARK.md"
