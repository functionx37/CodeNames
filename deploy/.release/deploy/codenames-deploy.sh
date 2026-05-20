#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
RUNTIME_DIR="$SCRIPT_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/codenames.pid"
LOG_FILE="$RUNTIME_DIR/codenames.log"
SERVER_ENTRY="$PROJECT_DIR/dist/server/index.js"
VOCABULARY_FILE="$PROJECT_DIR/server/data/vocabulary.json"
CLIENT_INDEX_FILE="$PROJECT_DIR/dist/client/index.html"
NGINX_CONF_SOURCE="$PROJECT_DIR/deploy/nginx-codenames.conf"
NGINX_CONF_TARGET="${NGINX_CONF_TARGET:-/etc/nginx/conf.d/codenames.conf}"
PORT=3001
BASE_PATH="/codenames"

usage() {
    cat <<EOF
Usage: $(basename "$0") {run|stop|restart|status|logs|nginx-print|nginx-install}

Commands:
  run           Start the already uploaded service
  stop     Stop the running service
  restart  Restart the service
  status   Show whether the service is running
  logs     Tail the runtime log
  nginx-print    Print the bundled nginx config
  nginx-install  Install nginx config and reload nginx
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
    require_command setsid

    local node_major
    node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
    if (( node_major < 18 )); then
        echo "Node.js 18+ is required. Current version: $(node -v)" >&2
        exit 1
    fi
}

ensure_release_layout() {
    local missing=0

    if [[ ! -f "$SERVER_ENTRY" ]]; then
        echo "Missing server entry: $SERVER_ENTRY" >&2
        missing=1
    fi

    if [[ ! -f "$VOCABULARY_FILE" ]]; then
        echo "Missing vocabulary file: $VOCABULARY_FILE" >&2
        missing=1
    fi

    if [[ ! -f "$CLIENT_INDEX_FILE" ]]; then
        echo "Missing frontend build file: $CLIENT_INDEX_FILE" >&2
        missing=1
    fi

    if [[ ! -d "$PROJECT_DIR/node_modules" ]]; then
        echo "Missing runtime dependencies: $PROJECT_DIR/node_modules" >&2
        missing=1
    fi

    if (( missing != 0 )); then
        echo "The uploaded release is incomplete. Run the local publish script first." >&2
        exit 1
    fi

    mkdir -p "$PROJECT_DIR/server/logs"
}

run_as_root() {
    if [[ "$(id -u)" -eq 0 ]]; then
        "$@"
        return
    fi

    if command -v sudo >/dev/null 2>&1; then
        sudo "$@"
        return
    fi

    echo "This action requires root privileges. Re-run as root or install sudo." >&2
    exit 1
}

install_nginx_config() {
    require_command install
    require_command nginx

    if [[ ! -f "$NGINX_CONF_SOURCE" ]]; then
        echo "Missing nginx config: $NGINX_CONF_SOURCE" >&2
        exit 1
    fi

    run_as_root mkdir -p "$(dirname "$NGINX_CONF_TARGET")"
    run_as_root install -m 644 "$NGINX_CONF_SOURCE" "$NGINX_CONF_TARGET"
    run_as_root nginx -t

    if command -v systemctl >/dev/null 2>&1; then
        run_as_root systemctl reload nginx
    elif command -v service >/dev/null 2>&1; then
        run_as_root service nginx reload
    else
        echo "Nginx config installed. Reload nginx manually." >&2
        return
    fi

    echo "Nginx config installed: $NGINX_CONF_TARGET"
}

start_service() {
    ensure_runtime_dir
    cleanup_stale_pid

    if is_running; then
        echo "Codenames is already running. PID: $(read_pid)"
        exit 0
    fi

    ensure_node
    ensure_release_layout

    echo "" >> "$LOG_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] starting codenames" >> "$LOG_FILE"

    (
        cd "$PROJECT_DIR"
        setsid env PORT="$PORT" BASE_PATH="$BASE_PATH" node "$SERVER_ENTRY" >> "$LOG_FILE" 2>&1 < /dev/null &
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
    echo "Static directory: $PROJECT_DIR/dist/client"
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
        echo "Static directory: $PROJECT_DIR/dist/client"
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
        nginx-print)
            cat "$NGINX_CONF_SOURCE"
            ;;
        nginx-install)
            install_nginx_config
            ;;
        *)
            usage
            exit 1
            ;;
    esac
}

main "${1:-}"
