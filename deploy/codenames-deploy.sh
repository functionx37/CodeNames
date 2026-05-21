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
NGINX_CONF_TARGET="${NGINX_CONF_TARGET:-/etc/nginx/snippets/codenames.conf}"
NGINX_SERVER_CONF="${NGINX_SERVER_CONF:-}"
PORT=3001
BASE_PATH="/codenames"

usage() {
    cat <<EOF
Usage: $(basename "$0") {run|stop|restart|status|logs|nginx-print|nginx-install}

Commands:
  run           Start the already uploaded service
  stop          Stop the running service
  restart       Restart the service
  status        Show whether the service is running
  logs          Tail the runtime log
  nginx-print    Print the bundled nginx config
  nginx-install  Install nginx snippet, update nginx config, test and reload
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
    require_command awk
    require_command install
    require_command mktemp
    require_command nginx

    if [[ ! -f "$NGINX_CONF_SOURCE" ]]; then
        echo "Missing nginx config: $NGINX_CONF_SOURCE" >&2
        exit 1
    fi

    run_as_root mkdir -p "$(dirname "$NGINX_CONF_TARGET")"
    run_as_root install -m 644 "$NGINX_CONF_SOURCE" "$NGINX_CONF_TARGET"

    ensure_nginx_include
    verify_nginx_config
    reload_nginx

    echo "Nginx snippet installed: $NGINX_CONF_TARGET"
    echo "Nginx config verified and reloaded."
}

discover_nginx_server_configs() {
    local path resolved
    local -A seen=()

    shopt -s nullglob
    for path in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
        [[ -e "$path" ]] || continue
        resolved=$(readlink -f "$path" 2>/dev/null || printf '%s' "$path")
        [[ -f "$resolved" ]] || continue
        if [[ -z "${seen[$resolved]:-}" ]]; then
            seen["$resolved"]=1
            printf '%s\n' "$resolved"
        fi
    done
    shopt -u nullglob
}

count_server_blocks() {
    local conf_file="$1"
    awk '
        /^[[:space:]]*server[[:space:]]*\{/ {
            count++
        }
        END {
            print count + 0
        }
    ' "$conf_file"
}

has_active_include_line() {
    local conf_file="$1"
    awk -v include_line="include $NGINX_CONF_TARGET;" '
        /^[[:space:]]*#/ {
            next
        }
        index($0, include_line) > 0 {
            found=1
        }
        END {
            exit found ? 0 : 1
        }
    ' "$conf_file"
}

detect_nginx_server_conf() {
    local conf_file server_count
    local -a candidates=()

    if [[ -n "$NGINX_SERVER_CONF" ]]; then
        conf_file=$(readlink -f "$NGINX_SERVER_CONF" 2>/dev/null || printf '%s' "$NGINX_SERVER_CONF")
        if [[ ! -f "$conf_file" ]]; then
            echo "Configured NGINX_SERVER_CONF does not exist: $NGINX_SERVER_CONF" >&2
            exit 1
        fi
        printf '%s\n' "$conf_file"
        return
    fi

    while IFS= read -r conf_file; do
        server_count=$(count_server_blocks "$conf_file")
        if (( server_count == 1 )); then
            candidates+=("$conf_file")
        fi
    done < <(discover_nginx_server_configs)

    if (( ${#candidates[@]} == 1 )); then
        printf '%s\n' "${candidates[0]}"
        return
    fi

    echo "Unable to auto-detect a unique nginx server config." >&2
    if (( ${#candidates[@]} > 1 )); then
        echo "Multiple candidate files were found:" >&2
        printf '  %s\n' "${candidates[@]}" >&2
    else
        echo "No candidate nginx server config was found under /etc/nginx/sites-enabled or /etc/nginx/conf.d." >&2
    fi
    echo "Re-run with: sudo NGINX_SERVER_CONF=/etc/nginx/sites-enabled/your-site $(basename "$0") nginx-install" >&2
    exit 1
}

insert_include_into_server_block() {
    local conf_file="$1"
    local tmp_file
    local awk_status

    tmp_file=$(mktemp)
    awk -v include_line="    include $NGINX_CONF_TARGET;" '
        function brace_delta(str, tmp, opens, closes) {
            tmp = str
            opens = gsub(/\{/, "", tmp)
            tmp = str
            closes = gsub(/\}/, "", tmp)
            return opens - closes
        }

        BEGIN {
            in_server = 0
            depth = 0
            inserted = 0
            server_count = 0
        }

        {
            if (!in_server && $0 ~ /^[[:space:]]*server[[:space:]]*\{[[:space:]]*($|#)/) {
                in_server = 1
                server_count++
                depth = brace_delta($0)
                print
                next
            }

            if (in_server) {
                next_depth = depth + brace_delta($0)
                if (next_depth == 0 && !inserted) {
                    print include_line
                    inserted = 1
                }
                print
                depth = next_depth
                if (depth == 0) {
                    in_server = 0
                }
                next
            }

            print
        }

        END {
            if (server_count == 0) {
                exit 2
            }
            if (server_count > 1) {
                exit 3
            }
            if (!inserted) {
                exit 4
            }
        }
    ' "$conf_file" > "$tmp_file"
    awk_status=$?

    case "$awk_status" in
        0)
            run_as_root install -m 644 "$tmp_file" "$conf_file"
            ;;
        2)
            rm -f "$tmp_file"
            echo "No nginx server block found in: $conf_file" >&2
            exit 1
            ;;
        3)
            rm -f "$tmp_file"
            echo "Multiple nginx server blocks found in: $conf_file" >&2
            echo "Set NGINX_SERVER_CONF to a file that contains exactly one target server block." >&2
            exit 1
            ;;
        *)
            rm -f "$tmp_file"
            echo "Failed to update nginx config: $conf_file" >&2
            exit 1
            ;;
    esac

    rm -f "$tmp_file"
}

ensure_nginx_include() {
    local conf_file
    local -a include_files=()

    while IFS= read -r conf_file; do
        if has_active_include_line "$conf_file"; then
            include_files+=("$conf_file")
        fi
    done < <(discover_nginx_server_configs)

    if (( ${#include_files[@]} > 1 )); then
        echo "The nginx include is already present in multiple files:" >&2
        printf '  %s\n' "${include_files[@]}" >&2
        echo "Please clean that up manually before re-running this command." >&2
        exit 1
    fi

    if (( ${#include_files[@]} == 1 )); then
        echo "Nginx include already present in: ${include_files[0]}"
        return
    fi

    conf_file=$(detect_nginx_server_conf)
    insert_include_into_server_block "$conf_file"
    echo "Added nginx include to: $conf_file"
}

verify_nginx_config() {
    run_as_root nginx -t
}

reload_nginx() {
    if command -v systemctl >/dev/null 2>&1; then
        if run_as_root systemctl reload nginx; then
            return
        fi
        echo "systemctl reload nginx failed, trying nginx -s reload..." >&2
    fi

    run_as_root nginx -s reload
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
