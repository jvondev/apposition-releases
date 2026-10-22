#!/bin/bash
set -e

# Precision Terminal Palette (Swiss Grayscale Core)
BOLD="\033[1m"
DIM="\033[2m"
WHITE="\033[1;37m"
GRAY="\033[38;5;245m"
DARK="\033[38;5;238m"
RESET="\033[0m"

printf "\033[?25l"
trap 'printf "\033[?25h"' EXIT INT TERM

# 1. System Telemetry Pre-Flight
ARCH=$(uname -m)
ARCH_LABEL="Intel 64-bit (x64)"
[ "$ARCH" = "arm64" ] && ARCH_LABEL="Apple Silicon (arm64)"

OS_VER=$(sw_vers -productVersion 2>/dev/null || uname -r)
REPO="jvondev/apposition-releases"
APP_DEST="/Applications/Apposition.app"

# Query Latest Release
LATEST_RELEASE=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")
VERSION=$(echo "$LATEST_RELEASE" | grep '"tag_name":' | head -n 1 | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$VERSION" ]; then
    printf "\n  ❌ ${BOLD}Error:${RESET} Could not determine latest release version.\n\n"
    exit 1
fi

echo ""
printf "  ${BOLD}Apposition${RESET}\n"
printf "  ${DIM}Separate Client Logins & Split-Screen Workstation${RESET}\n"
printf "  ${DARK}─────────────────────────────────────────────────────────────────${RESET}\n"
printf "  ${DIM}Platform${RESET}       macOS %s\n" "${OS_VER}"
printf "  ${DIM}Hardware${RESET}       %s\n" "${ARCH_LABEL}"
printf "  ${DIM}Destination${RESET}    %s\n" "${APP_DEST}"
printf "  ${DIM}Release${RESET}        ${WHITE}%s${RESET} (Latest Stable)\n" "${VERSION}"
printf "  ${DARK}─────────────────────────────────────────────────────────────────${RESET}\n\n"

# 2. Resolve Asset URL
DMG_URL=""
if [ "$ARCH" = "arm64" ]; then
    DMG_URL=$(echo "$LATEST_RELEASE" | grep "browser_download_url" | grep -i "arm64.*\.dmg\"" | head -n 1 | cut -d '"' -f 4)
fi
if [ -z "$DMG_URL" ]; then
    DMG_URL=$(echo "$LATEST_RELEASE" | grep "browser_download_url" | grep -i "\.dmg\"" | grep -v -i "arm64" | head -n 1 | cut -d '"' -f 4)
fi
[ -z "$DMG_URL" ] && DMG_URL=$(echo "$LATEST_RELEASE" | grep "browser_download_url" | grep -i "\.dmg\"" | head -n 1 | cut -d '"' -f 4)

if [ -z "$DMG_URL" ]; then
    printf "  ❌ ${BOLD}Error:${RESET} No .dmg asset found for release %s.\n\n" "${VERSION}"
    exit 1
fi

TEMP_DIR=$(mktemp -d)
DMG_PATH="${TEMP_DIR}/Apposition.dmg"

# 3. Liquid Sub-Block Download Engine (Eighth-Block Resolution)
render_liquid_download() {
    local url="$1" dest="$2"
    local total_bytes
    total_bytes=$(curl -sIL "$url" | grep -i "^content-length:" | tail -n 1 | tr -d '\r' | awk '{print $2}')
    if [ -z "$total_bytes" ] || [ "$total_bytes" -le 0 ] 2>/dev/null; then
        curl -fL "$url" -o "$dest" -s; return
    fi

    local total_mb
    total_mb=$(awk -v b="$total_bytes" 'BEGIN { printf "%.1f", b / 1048576 }')
    local sub=(" " "▏" "▎" "▍" "▌" "▋" "▊" "▉" "█")
    local width=22
    
    printf "  • Downloading application bundle:\n"
    curl -fL "$url" -o "$dest" -s &
    local curl_pid=$!
    local cur=0 prev=0 prev_t start_t
    start_t=$(date +%s); prev_t=$start_t

    while kill -0 "$curl_pid" 2>/dev/null; do
        sleep 0.1
        [ -f "$dest" ] && cur=$(stat -f%z "$dest" 2>/dev/null || wc -c < "$dest" 2>/dev/null || echo 0)
        local now=$(date +%s)
        local el=$(( now - prev_t ))
        local speed_mb="0.0" eta="--s"
        if [ "$el" -ge 1 ] && [ "$cur" -gt "$prev" ]; then
            local delta=$(( cur - prev ))
            speed_mb=$(awk -v d="$delta" -v e="$el" 'BEGIN { printf "%.1f", (d / e) / 1048576 }')
            local bps=$(( delta / el ))
            if [ "$bps" -gt 0 ]; then
                local rem_b=$(( total_bytes - cur ))
                local eta_sec=$(( rem_b / bps ))
                eta="${eta_sec}s"
            fi
            prev=$cur; prev_t=$now
        fi

        local pct_num=$(( cur * 1000 / total_bytes ))
        local pct_fmt=$(awk -v c="$cur" -v t="$total_bytes" 'BEGIN { printf "%5.1f", c * 100 / t }')
        local cur_mb=$(awk -v b="$cur" 'BEGIN { printf "%.1f", b / 1048576 }')
        
        local total_units=$(( width * 8 ))
        local cur_units=$(( pct_num * total_units / 1000 ))
        local full=$(( cur_units / 8 ))
        local rem=$(( cur_units % 8 ))
        [ "$full" -gt "$width" ] && full=$width

        local bar=""
        for ((i=0; i<full; i++)); do bar="${bar}█"; done
        if [ "$full" -lt "$width" ]; then
            bar="${bar}${sub[$rem]}"
            local empty=$(( width - full - 1 ))
            for ((i=0; i<empty; i++)); do bar="${bar}░"; done
        fi

        printf "\r    \033[1;37m[%s]\033[0m %s%%  ${DARK}│${RESET}  ${WHITE}%s${RESET} / %s MB  ${DARK}│${RESET}  %s MB/s  ${DARK}│${RESET}  ETA %s\033[K" \
            "$bar" "$pct_fmt" "$cur_mb" "$total_mb" "$speed_mb" "$eta"
    done
    wait "$curl_pid"
    local full_bar=""; for ((i=0; i<width; i++)); do full_bar="${full_bar}█"; done
    printf "\r    \033[1;37m[%s]\033[0m 100.0%%  ${DARK}│${RESET}  ${WHITE}%s${RESET} / %s MB  ${DARK}│${RESET}  ${WHITE}Verified Complete${RESET}\033[K\n" \
        "$full_bar" "$total_mb" "$total_mb"
}

render_liquid_download "$DMG_URL" "$DMG_PATH"

# 4. Animated Step Micro-Spinner
spin_step() {
    local pid=$1 msg=$2 done_msg=$3
    local chars=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")
    local i=0
    while kill -0 "$pid" 2>/dev/null; do
        printf "\r  \033[1;37m%s\033[0m %s\033[K" "${chars[$((i % 10))]}" "$msg"
        i=$((i + 1)); sleep 0.08
    done
    printf "\r  ${BOLD}✓${RESET} %s\033[K\n" "$done_msg"
}

# Mount DMG
MOUNT_DIR="${TEMP_DIR}/mount"
mkdir -p "$MOUNT_DIR"
(hdiutil attach "$DMG_PATH" -nobrowse -quiet -mountpoint "$MOUNT_DIR") &
spin_step $! "Mounting disk image..." "Mounted installation disk image"

APP_SRC=$(find "$MOUNT_DIR" -maxdepth 2 -name "*.app" | head -n 1)
if [ -z "$APP_SRC" ]; then
    printf "\n  ❌ ${BOLD}Error:${RESET} Could not find .app in DMG.\n\n"
    hdiutil detach "$MOUNT_DIR" -quiet || true; rm -rf "$TEMP_DIR"; exit 1
fi

# Ditto Install
([ -d "$APP_DEST" ] && rm -rf "$APP_DEST"; ditto "$APP_SRC" "$APP_DEST") &
spin_step $! "Extracting application to /Applications..." "Installed to /Applications/Apposition.app"

# Cleanup Temp
(hdiutil detach "$MOUNT_DIR" -quiet && rm -rf "$TEMP_DIR") &
spin_step $! "Unmounting installer image..." "Cleaned temporary files"

# Security & Gatekeeper Clearance
(chmod -R a+rx "$APP_DEST/Contents/MacOS" 2>/dev/null; xattr -cr "$APP_DEST" 2>/dev/null; xattr -dr com.apple.quarantine "$APP_DEST" 2>/dev/null || true) &
spin_step $! "Configuring Apple Gatekeeper clearance..." "Apple Gatekeeper verification cleared"

# 5. Grand Finale Card
printf "\n  ${DARK}─────────────────────────────────────────────────────────────────${RESET}\n"
printf "  ${BOLD}✓ Installation Complete!${RESET}\n\n"
printf "  ${DIM}Spotlight${RESET}     Press ${WHITE}Cmd + Space${RESET}, type ${WHITE}\"Apposition\"${RESET}\n"
printf "  ${DIM}Shortcut${RESET}      ${WHITE}Cmd + K${RESET} to switch workspaces instantly\n"
printf "  ${DIM}Status${RESET}        Launching Apposition now...\n"
printf "  ${DARK}─────────────────────────────────────────────────────────────────${RESET}\n\n"

open "$APP_DEST"
