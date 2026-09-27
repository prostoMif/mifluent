#!/usr/bin/env bash
#
# Runs the OpenCode task queue unattended: one task at a time, in the order of
# docs/tasks/_Автопилот-очередь.txt. After each task: `npm run check`; green →
# commit locally; red → one repair pass; still red → the changes are stashed,
# the task is marked failed, and the queue moves on. Two failures in a row stop
# the run, since the next tasks usually depend on the failed ones.
#
# Never pushes. Never applies migrations. The owner reviews `git log` and
# pushes by hand.
#
#   scripts/autopilot.sh              # whole queue
#   scripts/autopilot.sh TASK-018     # start from this task
#
# Optional: TELEGRAM_BOT_TOKEN and OWNER_TELEGRAM_CHAT_ID in .env — a short
# message after every task, so progress can be followed from the phone.

set -uo pipefail
cd "$(dirname "$0")/.."

TASKS_DIR="docs/tasks"
QUEUE="$TASKS_DIR/_Автопилот-очередь.txt"
LOG_DIR=".autopilot"
MODEL="${AUTOPILOT_MODEL:-}"
TASK_TIMEOUT="${AUTOPILOT_TIMEOUT:-3h}"
START_FROM="${1:-}"

mkdir -p "$LOG_DIR"
grep -qx "/.autopilot/" .git/info/exclude 2>/dev/null || echo "/.autopilot/" >> .git/info/exclude

if [[ -f .env ]]; then
  BOT_TOKEN="$(grep -E '^TELEGRAM_BOT_TOKEN=' .env | cut -d= -f2- || true)"
  OWNER_CHAT="$(grep -E '^OWNER_TELEGRAM_CHAT_ID=' .env | cut -d= -f2- || true)"
fi

notify() {
  echo "[$(date '+%F %T')] $1" | tee -a "$LOG_DIR/run.log"
  if [[ -n "${BOT_TOKEN:-}" && -n "${OWNER_CHAT:-}" ]]; then
    node -e '
      const [token, chat, text] = process.argv.slice(1);
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: `🤖 autopilot: ${text}` }),
      }).catch(() => {});
    ' "$BOT_TOKEN" "$OWNER_CHAT" "$1" >/dev/null 2>&1 || true
  fi
}

status_of() { grep -m1 -E '^status:' "$1" | sed 's/^status:[[:space:]]*//'; }

set_status() {
  sed -i "0,/^status:.*/s//status: $2/" "$1"
}

run_agent() {
  local prompt="$1" log="$2"
  local args=(run --agent autopilot --auto)
  [[ -n "$MODEL" ]] && args+=(--model "$MODEL")
  timeout "$TASK_TIMEOUT" opencode "${args[@]}" "$prompt" >>"$log" 2>&1 </dev/null
}

if [[ -n "$(git status --porcelain)" ]]; then
  notify "рабочая копия не чистая — закоммить или спрячь изменения и запусти снова. Стоп."
  exit 1
fi

failures_in_row=0
started=$([[ -z "$START_FROM" ]] && echo 1 || echo 0)

while IFS= read -r line; do
  task="${line%%#*}"; task="$(echo "$task" | xargs)"
  [[ -z "$task" ]] && continue
  [[ $started -eq 0 && "$task" == "$START_FROM"* ]] && started=1
  [[ $started -eq 0 ]] && continue

  file="$(ls "$TASKS_DIR"/"$task"*.md 2>/dev/null | head -1)"
  if [[ -z "$file" ]]; then notify "$task: файл не найден, пропускаю"; continue; fi

  st="$(status_of "$file")"
  case "$st" in
    "готова к ревью"|"принята"|"выполнена") notify "$task: уже $st, пропускаю"; continue ;;
  esac

  # A task marked for Opus is not the free model's to attempt: stop here, so
  # everything after it (which usually depends on it) waits for the owner to
  # run it in Claude Code and restart with `scripts/autopilot.sh <next task>`.
  if grep -qE '^исполнитель:[[:space:]]*opus' "$file"; then
    notify "$task: задача для Opus — стоп. Выполни её в Claude Code, затем: scripts/autopilot.sh $task"
    exit 0
  fi

  log="$LOG_DIR/$task.log"
  notify "$task: начал"
  set_status "$file" "в работе (автопилот)"

  run_agent "Выполни задачу $file полностью. Сначала прочитай AGENTS.md." "$log"

  if ! npm run check >>"$log" 2>&1 </dev/null; then
    notify "$task: check красный, одна попытка починить"
    tail -n 120 "$log" > "$LOG_DIR/$task.check-tail.txt"
    run_agent "npm run check после задачи $file красный. Последние строки вывода — в файле $LOG_DIR/$task.check-tail.txt. Почини, не ослабляя тесты и правила линтера, и обнови отчёт в файле задачи." "$log"
  fi

  if npm run check >>"$log" 2>&1 </dev/null; then
    git add -A
    title="$(grep -m1 '^# ' "$file" | sed 's/^# //' | cut -c1-72)"
    if git commit -q -m "feat(autopilot): ${title}" -m "Task file: ${file#docs/tasks/}. Автопилот OpenCode; см. отчёт в файле задачи." >>"$log" 2>&1; then
      set_status "$file" "готова к ревью"
      notify "$task: ✅ готово, закоммичено ($(git rev-parse --short HEAD))"
      failures_in_row=0
    else
      notify "$task: check зелёный, но коммит не прошёл (хук?) — см. $log"
      git stash push -u -q -m "autopilot-failed-$task"
      set_status "$file" "не прошла (автопилот)"
      failures_in_row=$((failures_in_row + 1))
    fi
  else
    git stash push -u -q -m "autopilot-failed-$task"
    set_status "$file" "не прошла (автопилот)"
    printf '\n## %s — автопилот: %s не прошла\n- check красный после двух попыток; изменения в `git stash list` (autopilot-failed-%s), лог `.autopilot/%s.log`.\n' \
      "$(date +%F)" "$task" "$task" "$task" >> "$TASKS_DIR/_Вопросы владельцу.md"
    notify "$task: ❌ не прошла, изменения в stash, иду дальше"
    failures_in_row=$((failures_in_row + 1))
  fi

  if [[ $failures_in_row -ge 2 ]]; then
    notify "две задачи подряд не прошли — стоп. Нужен человек."
    exit 1
  fi
done < "$QUEUE"

notify "очередь закончилась"
