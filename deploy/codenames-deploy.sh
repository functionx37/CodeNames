#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
RUNTIME_DIR="$SCRIPT_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/codenames.pid"
LOG_FILE="$RUNTIME_DIR/codenames.log"
PORT=3001
BASE_PATH="/codenames"

usage() {
    cat <<EOF
Usage: $(basename "$0") {run|stop|restart|status|logs}

Commands:
  run      Install deps if needed, build, and start the service
  stop     Stop the running service
  restart  Restart the service
  status   Show whether the service is running
  logs     Tail the runtime log
EOF
}

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2
        exit 1
    fi
}

ensure_runtime_dir() {
    mkdir -p "$RUNTIME_DIR"
}

read_pid() {
    if [[ -f "$PID_FILE" ]]; then
        tr -d '[:space:]' < "$PID_FILE"
    fi
}

is_running() {
    local pid
    pid=$(read_pid)
    [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null
}

cleanup_stale_pid() {
    if [[ -f "$PID_FILE" ]] && ! is_running; then
        rm -f "$PID_FILE"
    fi
}

ensure_node() {
    require_command node
    require_command npm

    local node_major
    node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
    if (( node_major < 18 )); then
        echo "Node.js 18+ is required. Current version: $(node -v)" >&2
        exit 1
    fi
}

install_dependencies_if_needed() {
    if [[ ! -d "$PROJECT_DIR/node_modules" ]]; then
        echo "node_modules not found, running npm ci..."
        (
            cd "$PROJECT_DIR"
            npm ci
        )
    fi
}

build_project() {
    echo "Building project..."
    (
        cd "$PROJECT_DIR"
        npm run build
    )
}

start_service() {
    ensure_runtime_dir
    cleanup_stale_pid

    if is_running; then
        echo "Codenames is already running. PID: $(read_pid)"
        exit 0
    fi

    ensure_node
    install_dependencies_if_needed
    build_project

    echo "" >> "$LOG_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] starting codenames" >> "$LOG_FILE"

    (
        cd "$PROJECT_DIR"
        nohup env PORT="$PORT" BASE_PATH="$BASE_PATH" node dist/server/index.js >> "$LOG_FILE" 2>&1 &
        echo $! > "$PID_FILE"
    )

    sleep 2

    if ! is_running; then
        echo "Failed to start service. Recent log output:" >&2
        tail -n 50 "$LOG_FILE" >&2 || true
        exit 1
    fi

    echo "Codenames started successfully."
    echo "URL: http://127.0.0.1:${PORT}${BASE_PATH}"
    echo "PID: $(read_pid)"
    echo "Log: $LOG_FILE"
}

stop_service() {
    cleanup_stale_pid

    if ! [[ -f "$PID_FILE" ]]; then
        echo "Codenames is not running."
        exit 0
    fi

    local pid
    pid=$(read_pid)

    if [[ -z "${pid:-}" ]] || ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$PID_FILE"
        echo "Codenames is not running."
        exit 0
    fi

    echo "Stopping Codenames. PID: $pid"
    kill "$pid"

    for _ in {1..10}; do
        if ! kill -0 "$pid" 2>/dev/null; then
            rm -f "$PID_FILE"
            echo "Codenames stopped."
            return
        fi
        sleep 1
    done

    echo "Process did not exit after 10 seconds, forcing shutdown..."
    kill -9 "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    echo "Codenames stopped."
}

show_status() {
    cleanup_stale_pid

    if is_running; then
        echo "Codenames is running."
        echo "URL: http://127.0.0.1:${PORT}${BASE_PATH}"
        echo "PID: $(read_pid)"
        echo "Log: $LOG_FILE"
    else
        echo "Codenames is not running."
    fi
}

show_logs() {
    ensure_runtime_dir

    if [[ ! -f "$LOG_FILE" ]]; then
        echo "Log file does not exist yet: $LOG_FILE"
        exit 0
    fi

    tail -f "$LOG_FILE"
}

main() {
    case "${1:-}" in
        run)
            start_service
            ;;
        stop)
            stop_service
            ;;
        restart)
            stop_service
            start_service
            ;;
        status)
            show_status
            ;;
        logs)
            show_logs
            ;;
        *)
            usage
            exit 1
            ;;
    esac
}

main "${1:-}"
