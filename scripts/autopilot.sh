#!/usr/bin/env bash
#
# Runs the OpenCode task queue unattended — meant to be left overnight.
#
# Each task gets a fresh OpenCode session, so one chat's context limit never
# stops the queue. After a session: `npm run check`; red → one repair pass;
# green → local commit. If the agent's report says «частично», the next
# session continues the same task (up to AUTOPILOT_SESSIONS, default 3). A
# session that changes nothing is taken as the free model's API being down:
# wait AUTOPILOT_IDLE_WAIT seconds (default 900) and retry, stop after four.
# Tasks marked `исполнитель: opus` are skipped; a queue line
# `TASK-034 requires TASK-033` waits for its prerequisite. Progress lines go to
# docs/tasks/_Передача.md. Two unfinished tasks in a row stop the run.
#
# Never pushes. Never applies migrations. The owner reviews `git log` and
# pushes by hand.
#
#   scripts/autopilot.sh              # whole queue
#   scripts/autopilot.sh TASK-018     # start from this task
#
# Overnight, without the laptop going to sleep:
#   systemd-inhibit --what=sleep:idle:handle-lid-switch scripts/autopilot.sh
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
  # A run cut short (laptop off, terminal closed) leaves its task marked
  # «в работе (автопилот)» and its edits uncommitted. Pick that task up where
  # it stopped instead of refusing to start; any other dirty tree is the
  # owner's own work and is not touched.
  interrupted="$(grep -l -E '^status:[[:space:]]*в работе \(автопилот\)' "$TASKS_DIR"/TASK-*.md 2>/dev/null | head -1)"
  if [[ -z "$interrupted" ]]; then
    notify "рабочая копия не чистая — закоммить или спрячь изменения и запусти снова. Стоп."
    exit 1
  fi
  interrupted_task="$(basename "$interrupted" | grep -oE '^TASK-[0-9]+')"
  notify "$interrupted_task: прерванная задача, продолжаю с незакоммиченными изменениями"
  START_FROM="$interrupted_task"
fi

is_done() {
  case "$(status_of "$1")" in
    "готова к ревью"|"принята"|"выполнена") return 0 ;;
  esac
  return 1
}

# The agent's own verdict: the last "**Статус:**" line of the report it wrote.
report_is_partial() {
  grep -E '^\*\*Статус:\*\*' "$1" | tail -1 | grep -q 'частично'
}

handoff() {
  printf -- '- %s — %s\n' "$(date '+%F %H:%M')" "$1" >> "$TASKS_DIR/_Передача.md"
}

TASK_PROMPT_RULES="Правила: AGENTS.md, docs/code-style.md и разделы 0a, 2 и пункты 1–3 раздела 3 из docs/tasks/_Промпт-OpenCode.md. Очередь и коммиты ведёт скрипт: делай только эту задачу, не коммить, файл _Передача.md не трогай. Если в конце файла задачи уже есть отчёт со статусом «частично» — продолжи с того, что там перечислено как несделанное, готовое не переделывай. Если в рабочей копии уже есть незакоммиченные изменения — это прерванная прошлая сессия по этой же задаче: посмотри git diff и продолжи их, не начинай заново. В конце — отчёт в файле задачи: статус «готова к ревью» только если выполнены ВСЕ пункты раздела «Требования», иначе «частично» и список несделанного."

MAX_SESSIONS="${AUTOPILOT_SESSIONS:-3}"
IDLE_WAIT="${AUTOPILOT_IDLE_WAIT:-900}"
MAX_IDLE=4

printf '\n## Автопилот — запуск %s\n' "$(date '+%F %H:%M')" >> "$TASKS_DIR/_Передача.md"

failures_in_row=0
started=$([[ -z "$START_FROM" ]] && echo 1 || echo 0)

while IFS= read -r line; do
  entry="${line%%#*}"; entry="$(echo "$entry" | xargs)"
  [[ -z "$entry" ]] && continue
  task="${entry%% *}"
  requires=""
  [[ "$entry" == *" requires "* ]] && requires="${entry##* requires }"
  [[ $started -eq 0 && "$task" == "$START_FROM"* ]] && started=1
  [[ $started -eq 0 ]] && continue

  file="$(ls "$TASKS_DIR"/"$task"*.md 2>/dev/null | head -1)"
  if [[ -z "$file" ]]; then notify "$task: файл не найден, пропускаю"; continue; fi
  if is_done "$file"; then continue; fi

  # Opus tasks are skipped, not attempted; tasks that need one wait for it.
  if grep -qE '^исполнитель:[[:space:]]*opus' "$file"; then
    notify "$task: задача для Opus — пропускаю"
    handoff "$task — ждёт Opus, пропущена"
    continue
  fi
  if [[ -n "$requires" ]]; then
    req_file="$(ls "$TASKS_DIR"/"$requires"*.md 2>/dev/null | head -1)"
    if [[ -z "$req_file" ]] || ! is_done "$req_file"; then
      notify "$task: ждёт $requires — пропускаю"
      handoff "$task — ждёт $requires, пропущена"
      continue
    fi
  fi

  log="$LOG_DIR/$task.log"
  notify "$task: начал"
  set_status "$file" "в работе (автопилот)"

  session=1
  idle=0
  outcome="failed"
  while [[ $session -le $MAX_SESSIONS ]]; do
    run_agent "Задача: $file. $TASK_PROMPT_RULES" "$log"

    # No change at all usually means the free model's API was down, not that
    # the task is impossible: wait and try again without spending a session.
    if [[ -z "$(git status --porcelain)" ]] && ! report_is_partial "$file"; then
      idle=$((idle + 1))
      if [[ $idle -ge $MAX_IDLE ]]; then
        notify "$task: модель $idle раз подряд ничего не сделала — стоп (API недоступен?)"
        handoff "$task — стоп: модель не отвечает; продолжить: scripts/autopilot.sh $task"
        exit 1
      fi
      notify "$task: изменений нет — жду $((IDLE_WAIT / 60)) мин и пробую снова"
      sleep "$IDLE_WAIT"
      continue
    fi

    if ! { npm run check >>"$log" 2>&1 </dev/null && scripts/build-web.sh >>"$log" 2>&1 </dev/null; }; then
      notify "$task: check или сборка сайта красные, попытка починить"
      tail -n 120 "$log" > "$LOG_DIR/$task.check-tail.txt"
      run_agent "npm run check после задачи $file красный. Последние строки вывода — в файле $LOG_DIR/$task.check-tail.txt. Почини, не ослабляя тесты и правила линтера, и обнови отчёт в файле задачи. $TASK_PROMPT_RULES" "$log"
    fi

    if npm run check >>"$log" 2>&1 </dev/null && scripts/build-web.sh >>"$log" 2>&1 </dev/null; then
      title="$(grep -m1 '^# ' "$file" | sed 's/^# //' | cut -c1-72)"
      if [[ -n "$(git status --porcelain)" ]]; then
        git add -A
        if ! git commit -q -m "feat(autopilot): ${title}" -m "Task file: ${file#docs/tasks/}. Автопилот OpenCode, сессия $session; см. отчёт в файле задачи." >>"$log" 2>&1; then
          notify "$task: check зелёный, но коммит не прошёл (хук?) — см. $log"
          break
        fi
      fi
      if report_is_partial "$file"; then
        notify "$task: частично (сессия $session), продолжаю в новой сессии"
        session=$((session + 1))
        continue
      fi
      outcome="done"
      break
    fi
    session=$((session + 1))
  done

  if [[ "$outcome" == "done" ]]; then
    set_status "$file" "готова к ревью"
    notify "$task: ✅ готово ($(git rev-parse --short HEAD))"
    handoff "$task — готова к ревью, коммит $(git rev-parse --short HEAD)"
    failures_in_row=0
  else
    [[ -n "$(git status --porcelain)" ]] && git stash push -u -q -m "autopilot-failed-$task"
    set_status "$file" "частично (автопилот)"
    notify "$task: ❌ не доделана за $MAX_SESSIONS сессии, иду дальше"
    handoff "$task — не доделана; остаток в отчёте задачи, незакоммиченное — git stash (autopilot-failed-$task)"
    failures_in_row=$((failures_in_row + 1))
  fi

  if [[ $failures_in_row -ge 2 ]]; then
    notify "две задачи подряд не получились — стоп. Нужен человек."
    handoff "стоп: две задачи подряд не получились"
    exit 1
  fi
done < "$QUEUE"

handoff "очередь закончилась"
notify "очередь закончилась"
