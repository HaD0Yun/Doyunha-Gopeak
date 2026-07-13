#!/usr/bin/env bash

set -euo pipefail

readonly REPOSITORY="HaD0Yun/Doyunha-Gopeak"
readonly API_URL="https://api.github.com/repos/${REPOSITORY}/releases/latest"
readonly MAX_ARCHIVE_BYTES=134217728
readonly MAX_CHECKSUM_BYTES=4096
VERSION=""
GODOT_PATH=""
SHOW_CONFIGURE=""

usage() {
  cat <<'EOF'
GoPeak installer (Bun + GitHub Releases)

Usage: install.sh [--version VERSION]

Options:
  --version VERSION       Install an exact release (for example: 2.3.9)
  -d, --dir PATH          Deprecated: accepted through 2.3.x; Bun owns the global install prefix
  -g, --godot PATH        Deprecated: include GODOT_PATH in printed MCP configuration
  -c, --configure CLIENT  Deprecated: print config for claude, cursor, cline, or opencode
  -h, --help              Show this help

Legacy flags are removed in GoPeak 3.0. Set BUN_INSTALL before running this
installer if you need a custom Bun installation prefix.
EOF
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

deprecation() {
  printf 'Deprecated: %s is accepted through GoPeak 2.3.x and will be removed in 3.0. %s\n' "$1" "$2" >&2
}

is_valid_version() {
  local value="$1"
  local without_build="${value%%+*}"
  local build=""
  if [[ "$value" == *+* ]]; then
    build="${value#*+}"
    [[ -n "$build" && "$build" != *..* && "$build" =~ ^[0-9A-Za-z.-]+$ ]] || return 1
  fi
  local core="${without_build%%-*}"
  local prerelease=""
  if [[ "$without_build" == *-* ]]; then
    prerelease="${without_build#*-}"
    [[ -n "$prerelease" ]] || return 1
  fi
  [[ "$core" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || return 1
  if [[ -n "$prerelease" ]]; then
    [[ "$prerelease" != *..* && "$prerelease" =~ ^[0-9A-Za-z.-]+$ ]] || return 1
    local identifier
    local old_ifs="$IFS"
    IFS='.'
    for identifier in $prerelease; do
      [[ -n "$identifier" ]] || { IFS="$old_ifs"; return 1; }
      if [[ "$identifier" =~ ^[0-9]+$ && "$identifier" != "0" && "$identifier" == 0* ]]; then
        IFS="$old_ifs"
        return 1
      fi
    done
    IFS="$old_ifs"
  fi
}

curl_secure() {
  curl -fsSL \
    --proto '=https' \
    --proto-redir '=https' \
    --connect-timeout 10 \
    --max-time 120 \
    --retry 2 \
    --retry-all-errors \
    "$@"
}

file_size() {
  wc -c < "$1" | tr -d '[:space:]'
}

download_verified_release() {
  local version="$1"
  local archive_path="$2"
  local checksum_path="$3"
  local asset="gopeak-${version}.tgz"
  local release_base="https://github.com/${REPOSITORY}/releases/download/v${version}"
  curl_secure --max-filesize "$MAX_ARCHIVE_BYTES" -o "$archive_path" "${release_base}/${asset}" \
    || fail "could not download ${asset}"
  curl_secure --max-filesize "$MAX_CHECKSUM_BYTES" -o "$checksum_path" "${release_base}/${asset}.sha256" \
    || fail "could not download ${asset}.sha256"
  (( $(file_size "$archive_path") <= MAX_ARCHIVE_BYTES )) || fail "release archive exceeds the size limit"
  (( $(file_size "$checksum_path") <= MAX_CHECKSUM_BYTES )) || fail "release checksum exceeds the size limit"

  local expected
  expected="$(awk 'NR == 1 { print $1 }' "$checksum_path")"
  [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || fail "release checksum file is malformed"
  local actual
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$archive_path" | awk '{ print $1 }')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$archive_path" | awk '{ print $1 }')"
  else
    fail "SHA-256 verification requires sha256sum or shasum"
  fi
  [[ "$(printf '%s' "$actual" | tr '[:upper:]' '[:lower:]')" == "$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')" ]] \
    || fail "checksum verification failed; the existing GoPeak installation was not changed"
}

print_configuration() {
  local client="$1"
  local escaped_godot
  escaped_godot="$(printf '%s' "$GODOT_PATH" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  case "$client" in
    claude|cline)
      cat <<EOF
{
  "mcpServers": {
    "godot": {
      "command": "gopeak",
      "args": [],
      "env": { "GODOT_PATH": "${escaped_godot}" }
    }
  }
}
EOF
      ;;
    opencode)
      cat <<EOF
{
  "mcp": {
    "godot": {
      "type": "local",
      "command": ["gopeak"],
      "environment": { "GODOT_PATH": "${escaped_godot}" }
    }
  }
}
EOF
      ;;
    cursor)
      printf 'Cursor MCP command: gopeak\nEnvironment: GODOT_PATH=%s\n' "$GODOT_PATH"
      ;;
    *)
      fail "unsupported --configure client: $client"
      ;;
  esac
}

while (($# > 0)); do
  case "$1" in
    --version)
      (($# >= 2)) || fail "--version requires a value"
      VERSION="${2#v}"
      shift 2
      ;;
    -d|--dir)
      (($# >= 2)) || fail "$1 requires a value"
      deprecation "--dir" "The checkout directory is ignored; set BUN_INSTALL for a custom Bun prefix."
      shift 2
      ;;
    -g|--godot)
      (($# >= 2)) || fail "$1 requires a value"
      GODOT_PATH="$2"
      deprecation "--godot" "GODOT_PATH is now supplied in your MCP client configuration."
      shift 2
      ;;
    -c|--configure)
      (($# >= 2)) || fail "$1 requires a value"
      SHOW_CONFIGURE="$2"
      deprecation "--configure" "Use the Bun configuration examples in the README."
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

command -v bun >/dev/null 2>&1 || fail "Bun is required. Install it from https://bun.sh"
command -v curl >/dev/null 2>&1 || fail "curl is required to download the GitHub Release"

if [[ -z "$VERSION" ]]; then
  release_json="$(curl_secure --max-filesize 1048576 -H 'Accept: application/vnd.github+json' -H 'User-Agent: gopeak-installer' "$API_URL")" \
    || fail "could not resolve the latest GitHub Release"
  (( ${#release_json} <= 1048576 )) || fail "latest release response exceeds the size limit"
  VERSION="$(printf '%s' "$release_json" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1)"
fi
is_valid_version "$VERSION" || fail "invalid release version: ${VERSION:-<empty>}"

CURRENT_VERSION=""
if bun pm ls -g 2>/dev/null | grep -q 'gopeak@'; then
  current_output="$(gopeak version 2>/dev/null)" || fail "existing GoPeak version could not be resolved; installation was not changed"
  CURRENT_VERSION="$(printf '%s' "$current_output" | sed -n 's/.*v\([^[:space:]]*\).*/\1/p' | head -n 1)"
  is_valid_version "$CURRENT_VERSION" || fail "existing GoPeak version is malformed; installation was not changed"
  if [[ "$CURRENT_VERSION" == "$VERSION" ]]; then
    printf 'GoPeak %s is already installed; no changes were made.\n' "$VERSION"
    if [[ -n "$SHOW_CONFIGURE" ]]; then
      print_configuration "$SHOW_CONFIGURE"
    elif [[ -n "$GODOT_PATH" ]]; then
      print_configuration claude
    fi
    exit 0
  fi
fi

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
archive_path="${TEMP_DIR}/gopeak-${VERSION}.tgz"
checksum_path="${archive_path}.sha256"

printf 'Downloading GoPeak %s from GitHub Releases...\n' "$VERSION"
download_verified_release "$VERSION" "$archive_path" "$checksum_path"

rollback_archive=""
if [[ -n "$CURRENT_VERSION" ]]; then
  rollback_archive="${TEMP_DIR}/gopeak-${CURRENT_VERSION}.tgz"
  download_verified_release "$CURRENT_VERSION" "$rollback_archive" "${rollback_archive}.sha256"

  printf 'Checksums verified. Replacing the existing Bun installation...\n'
  bun remove -g gopeak || fail "Bun could not remove the existing GoPeak release"
  if ! bun add -g "$archive_path"; then
    if bun add -g "$rollback_archive"; then
      fail "Bun could not install GoPeak ${VERSION}; the previous release was restored"
    fi
    fail "Bun could not install GoPeak ${VERSION}, and rollback also failed"
  fi
else
  printf 'Checksum verified. Installing with Bun...\n'
  bun add -g "$archive_path" || fail "Bun could not install the verified GoPeak release"
fi

printf '\nGoPeak %s installed successfully.\n' "$VERSION"
printf 'Shell notification hooks are optional; enable them manually with: gopeak setup\n'
if [[ -n "$SHOW_CONFIGURE" ]]; then
  print_configuration "$SHOW_CONFIGURE"
elif [[ -n "$GODOT_PATH" ]]; then
  print_configuration claude
fi
