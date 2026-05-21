#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
STAGE_DIR="${STAGE_DIR:-$SCRIPT_DIR/.release}"
REMOTE_DIR="${REMOTE_DIR:-/var/www/codenames}"
REMOTE_TMP_DIR="${REMOTE_TMP_DIR:-/tmp/codenames-upload}"

usage() {
    cat <<EOF
Usage:
  $(basename "$0") stage
  $(basename "$0") push <user@host>
  $(basename "$0") push-and-restart <user@host>

Environment:
  STAGE_DIR   Local staging directory, default: $STAGE_DIR
  REMOTE_DIR  Remote deploy directory, default: $REMOTE_DIR
  REMOTE_TMP_DIR  Remote temporary upload directory, default: $REMOTE_TMP_DIR
EOF
}

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2
        exit 1
    fi
}

ensure_local_tools() {
    require_command node
    require_command npm
    require_command rsync
}

build_project() {
    echo "Building project locally..."
    (
        cd "$PROJECT_DIR"
        npm run build
    )
}

reset_stage_dir() {
    rm -rf "$STAGE_DIR"
    mkdir -p "$STAGE_DIR/deploy" "$STAGE_DIR/server/data" "$STAGE_DIR/server/logs" "$STAGE_DIR/dist"
}

copy_release_files() {
    rsync -a "$PROJECT_DIR/dist/" "$STAGE_DIR/dist/"
    rsync -a "$PROJECT_DIR/server/data/" "$STAGE_DIR/server/data/"
    rsync -a "$PROJECT_DIR/deploy/codenames-deploy.sh" "$STAGE_DIR/deploy/"
    rsync -a "$PROJECT_DIR/deploy/nginx-codenames.conf" "$STAGE_DIR/deploy/"
    rsync -a "$PROJECT_DIR/package.json" "$PROJECT_DIR/package-lock.json" "$STAGE_DIR/"
    chmod +x "$STAGE_DIR/deploy/codenames-deploy.sh"
}

install_runtime_dependencies() {
    echo "Installing production dependencies into release..."
    if (
        cd "$STAGE_DIR"
        npm ci --omit=dev --ignore-scripts
    ); then
        return
    fi

    echo "npm ci --omit=dev failed, falling back to copying local node_modules/"
    if [[ ! -d "$PROJECT_DIR/node_modules" ]]; then
        echo "Fallback unavailable: local node_modules/ does not exist." >&2
        exit 1
    fi

    rsync -a --delete "$PROJECT_DIR/node_modules/" "$STAGE_DIR/node_modules/"
}

write_release_info() {
    local revision="unknown"

    if command -v git >/dev/null 2>&1; then
        revision=$(git -C "$PROJECT_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")
    fi

    cat > "$STAGE_DIR/DEPLOY_INFO" <<EOF
generated_at=$(date '+%Y-%m-%d %H:%M:%S')
git_revision=$revision
base_path=/codenames
port=3001
EOF
}

stage_release() {
    ensure_local_tools
    build_project
    reset_stage_dir
    copy_release_files
    install_runtime_dependencies
    write_release_info

    echo "Release staged at: $STAGE_DIR"
}

ensure_remote_tools() {
    require_command ssh
    require_command rsync
}

upload_release() {
    local remote="$1"

    ensure_remote_tools
    stage_release

    ssh "$remote" "mkdir -p '$REMOTE_TMP_DIR'"
    rsync -az --delete "$STAGE_DIR"/ "$remote":"$REMOTE_TMP_DIR"/
    ssh -t "$remote" "sudo mkdir -p '$REMOTE_DIR' && sudo rsync -a --delete --filter='protect /deploy/.runtime/***' '$REMOTE_TMP_DIR/' '$REMOTE_DIR/' && sudo chown -R \$(id -un):\$(id -gn) '$REMOTE_DIR'"

    echo "Release uploaded to: $remote:$REMOTE_DIR"
    echo "Next commands on server:"
    echo "  cd $REMOTE_DIR"
    echo "  ./deploy/codenames-deploy.sh nginx-install"
    echo "  ./deploy/codenames-deploy.sh run"
}

restart_remote_service() {
    local remote="$1"
    ssh "$remote" "cd '$REMOTE_DIR' && ./deploy/codenames-deploy.sh restart"
}

main() {
    case "${1:-}" in
        stage)
            stage_release
            ;;
        push)
            if [[ $# -ne 2 ]]; then
                usage
                exit 1
            fi
            upload_release "$2"
            ;;
        push-and-restart)
            if [[ $# -ne 2 ]]; then
                usage
                exit 1
            fi
            upload_release "$2"
            restart_remote_service "$2"
            ;;
        *)
            usage
            exit 1
            ;;
    esac
}

main "$@"
