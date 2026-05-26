#!/usr/bin/env bash
set -u

output_file="$(mktemp)"
trap 'rm -f "$output_file"' EXIT

npm ci 2>&1 | tee "$output_file"
npm_status="${PIPESTATUS[0]}"

if [[ "$npm_status" -eq 0 ]]; then
  exit 0
fi

echo "::error::npm ci failed with exit code ${npm_status}"

declare -a log_files=()
log_limit="${NPM_CI_LOG_LIMIT:-5}"

add_log_file() {
  local file="$1"

  if [[ -f "$file" ]]; then
    local existing
    for existing in "${log_files[@]}"; do
      if [[ "$existing" == "$file" ]]; then
        return
      fi
    done
    log_files+=("$file")
  fi
}

while IFS= read -r file; do
  add_log_file "$file"
done < <(sed -nE 's/.*found in: (.*-debug-[0-9]+\.log).*/\1/p' "$output_file")

if [[ "${#log_files[@]}" -eq 0 ]]; then
  npm_cache_dir="$(npm config get cache 2>/dev/null || true)"
  if [[ -z "$npm_cache_dir" || "$npm_cache_dir" == "undefined" ]]; then
    npm_cache_dir="${HOME:-}/.npm"
  fi

  npm_log_dir="${npm_cache_dir}/_logs"
  if [[ -d "$npm_log_dir" ]]; then
    while IFS= read -r file; do
      add_log_file "$file"
    done < <(find "$npm_log_dir" -maxdepth 1 -type f -name '*-debug-*.log' -print | sort -r | head -n "$log_limit")
  fi
fi

if [[ "${#log_files[@]}" -eq 0 ]]; then
  echo "::warning::No npm debug log files found."
  exit "$npm_status"
fi

echo "Printing ${#log_files[@]} npm debug log file(s):"

for log_file in "${log_files[@]}"; do
  echo "::group::npm debug log: ${log_file}"
  cat "$log_file"
  echo "::endgroup::"
done

exit "$npm_status"
