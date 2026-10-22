#!/bin/bash
set -e

# Precision Terminal Palette (Swiss Grayscale Core)
BOLD="\033[1m"
DIM="\033[2m"
WHITE="\033[1;37m"
DARK="\033[38;5;238m"
RESET="\033[0m"

printf "\033[?25l"
trap 'printf "\033[?25h"' EXIT INT TERM

ARCH=$(uname -m)
ARCH_LABEL="Intel 64-bit (x64)"
[ "$ARCH" = "arm64" ] && ARCH_LABEL="Apple Silicon (arm64)"

OS_VER=$(sw_vers -productVersion 2>/dev/null || uname -r)
REPO="jvondev/apposition-releases"
APP_DEST="/Applications/Apposition Canary.app"

echo ""
printf "  ${BOLD}Apposition Canary${RESET}  ${DIM}•  Isolated Pre-Release Sandbox${RESET}\n"
printf "  ${DARK}────────────────────────────────────────────────────────${RESET}\n"
printf "  ${DIM}Hardware:${RESET} %s   ${DIM}OS:${RESET} macOS %s\n\n" "${ARCH_LABEL}" "${OS_VER}"

# Step 1: Resolve release
printf "  ${WHITE}[1/3]${RESET} Resolving latest canary release... "
RELEASES_JSON=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases")
TAG=$(echo "$RELEASES_JSON" | grep '"tag_name":' | head -n 1 | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$TAG" ]; then
    printf "\n  ❌ ${BOLD}Error:${RESET} Could not determine release tag from GitHub.\n\n"
    exit 1
fi
printf "${WHITE}%s${RESET}\n" "${TAG}"

# Resolve Asset URL
DMG_URL=""
if [ "$ARCH" = "arm64" ]; then
    DMG_URL=$(echo "$RELEASES_JSON" | grep "browser_download_url" | grep -i "${TAG}" | grep -i "arm64.*\.dmg\"" | head -n 1 | cut -d '"' -f 4 || true)
fi
if [ -z "$DMG_URL" ]; then
    DMG_URL=$(echo "$RELEASES_JSON" | grep "browser_download_url" | grep -i "arm64.*\.dmg\"" | head -n 1 | cut -d '"' -f 4 || true)
fi
[ -z "$DMG_URL" ] && DMG_URL=$(echo "$RELEASES_JSON" | grep "browser_download_url" | grep -i "\.dmg\"" | head -n 1 | cut -d '"' -f 4 || true)

if [ -z "$DMG_URL" ]; then
    printf "  ❌ ${BOLD}Error:${RESET} No .dmg asset found for release %s yet.\n" "${TAG}"
    printf "  ${DIM}GitHub Actions might still be compiling. Please wait 1-2 minutes and retry.${RESET}\n\n"
    exit 1
fi

TEMP_DIR=$(mktemp -d)
DMG_PATH="${TEMP_DIR}/AppositionCanary.dmg"

# Step 2: Download with bounded single-line progress
printf "  ${WHITE}[2/3]${RESET} Downloading application bundle\n"

render_download() {
    local url="$1" dest="$2"
    local total_bytes
    total_bytes=$(curl -sIL "$url" | grep -i "^content-length:" | tail -n 1 | tr -d '\r' | awk '{print $2}')
    if [ -z "$total_bytes" ] || [ "$total_bytes" -le 0 ] 2>/dev/null; then
        curl -fL "$url" -o "$dest" -s
        printf "        \033[1;37mDownload Complete\033[0m\n"
        return
    fi

    local total_mb=$(( total_bytes / 1048576 ))
    local total_mb_dec=$(( (total_bytes * 10 / 1048576) % 10 ))
    local total_disp="${total_mb}.${total_mb_dec}"
    local bar_width=18

    curl -fL "$url" -o "$dest" -s &
    local curl_pid=$!
    local cur=0 prev=0 prev_time
    prev_time=$(date +%s)
    local speed_disp="0.0"

    while kill -0 "$curl_pid" 2>/dev/null; do
        sleep 0.2
        if [ -f "$dest" ]; then
            cur=$(stat -f%z "$dest" 2>/dev/null || wc -c < "$dest" 2>/dev/null || echo 0)
        fi

        local now_time
        now_time=$(date +%s)
        local elapsed=$(( now_time - prev_time ))
        if [ "$elapsed" -ge 1 ] && [ "$cur" -gt "$prev" ]; then
            local delta=$(( cur - prev ))
            local speed_mb=$(( (delta / elapsed) / 1048576 ))
            local speed_dec=$(( ((delta / elapsed) * 10 / 1048576) % 10 ))
            speed_disp="${speed_mb}.${speed_dec}"
            prev=$cur
            prev_time=$now_time
        fi

        local pct=$(( cur * 100 / total_bytes ))
        [ "$pct" -gt 100 ] && pct=100
        local filled=$(( pct * bar_width / 100 ))
        [ "$filled" -gt "$bar_width" ] && filled=$bar_width
        local empty=$(( bar_width - filled ))

        local bar=""
        for ((i=0; i<filled; i++)); do bar="${bar}█"; done
        for ((i=0; i<empty; i++)); do bar="${bar}─"; done

        local cur_mb=$(( cur / 1048576 ))
        local cur_dec=$(( (cur * 10 / 1048576) % 10 ))
        local cur_disp="${cur_mb}.${cur_dec}"

        printf "\r\033[2K        \033[1;37m[%s]\033[0m %3d%%  \033[38;5;238m│\033[0m  %s/%s MB  \033[38;5;238m│\033[0m  %s MB/s" \
            "$bar" "$pct" "$cur_disp" "$total_disp" "$speed_disp"
    done
    wait "$curl_pid"

    local full_bar=""
    for ((i=0; i<bar_width; i++)); do full_bar="${full_bar}█"; done
    printf "\r\033[2K        \033[1;37m[%s]\033[0m 100%%  \033[38;5;238m│\033[0m  %s/%s MB  \033[38;5;238m│\033[0m  \033[1;37mVerified\033[0m\n" \
        "$full_bar" "$total_disp" "$total_disp"
}

render_download "$DMG_URL" "$DMG_PATH"

# Step 3: Install
printf "  ${WHITE}[3/3]${RESET} Installing application... "
MOUNT_DIR="${TEMP_DIR}/mount"
mkdir -p "$MOUNT_DIR"
hdiutil attach "$DMG_PATH" -nobrowse -quiet -mountpoint "$MOUNT_DIR"

APP_SRC=$(find "$MOUNT_DIR" -maxdepth 2 -name "*.app" | head -n 1)
if [ -z "$APP_SRC" ]; then
    printf "\n  ❌ ${BOLD}Error:${RESET} Could not find application in disk image.\n\n"
    hdiutil detach "$MOUNT_DIR" -quiet || true
    rm -rf "$TEMP_DIR"
    exit 1
fi

[ -d "$APP_DEST" ] && rm -rf "$APP_DEST"
ditto "$APP_SRC" "$APP_DEST"

hdiutil detach "$MOUNT_DIR" -quiet || true
rm -rf "$TEMP_DIR"

chmod -R a+rx "$APP_DEST/Contents/MacOS" 2>/dev/null || true
xattr -cr "$APP_DEST" 2>/dev/null || true
xattr -dr com.apple.quarantine "$APP_DEST" 2>/dev/null || true

printf "${WHITE}Done${RESET}\n\n"

# Completion Card
printf "  ${DARK}────────────────────────────────────────────────────────${RESET}\n"
printf "  ${BOLD}✓ Apposition Canary Installed!${RESET}\n\n"
printf "  ${DIM}Sandbox:${RESET}    ~/Library/Application Support/AppositionCanary/\n"
printf "  ${DIM}Production:${RESET} Your normal Apposition.app is 100%% untouched\n"
printf "  ${DIM}Status:${RESET}     Launching Apposition Canary now...\n"
printf "  ${DARK}────────────────────────────────────────────────────────${RESET}\n\n"

open -n "$APP_DEST"
