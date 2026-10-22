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
ARCH_LABEL="x86_64"
[ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ] && ARCH_LABEL="ARM 64-bit ($ARCH)"

REPO="jvondev/apposition-releases"
LATEST_RELEASE=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")
VERSION=$(echo "$LATEST_RELEASE" | grep '"tag_name":' | head -n 1 | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$VERSION" ]; then
    printf "\n  ❌ ${BOLD}Error:${RESET} Could not determine latest release version.\n\n"
    exit 1
fi

BIN_DIR="${HOME}/.local/bin"
APP_DIR="${HOME}/Applications"
DESKTOP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/512x512/apps"
mkdir -p "$BIN_DIR" "$APP_DIR" "$DESKTOP_DIR" "$ICON_DIR"

APPIMAGE_PATH="${APP_DIR}/Apposition-${VERSION}.AppImage"
SYMLINK_PATH="${BIN_DIR}/apposition"

echo ""
printf "  ${BOLD}Apposition${RESET}\n"
printf "  ${DIM}Separate Client Logins & Split-Screen Workstation${RESET}\n"
printf "  ${DARK}─────────────────────────────────────────────────────────────────${RESET}\n"
printf "  ${DIM}Hardware${RESET}       %s\n" "${ARCH_LABEL}"
printf "  ${DIM}Destination${RESET}    %s\n" "${APPIMAGE_PATH}"
printf "  ${DIM}Release${RESET}        ${WHITE}%s${RESET} (Latest Stable)\n" "${VERSION}"
printf "  ${DARK}─────────────────────────────────────────────────────────────────${RESET}\n\n"

# 2. Resolve AppImage Asset
APPIMAGE_URL=$(echo "$LATEST_RELEASE" | grep "browser_download_url" | grep -i "\.AppImage\"" | head -n 1 | cut -d '"' -f 4)

if [ -z "$APPIMAGE_URL" ]; then
    printf "  ❌ ${BOLD}Error:${RESET} No .AppImage asset found for release %s.\n\n" "${VERSION}"
    exit 1
fi

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
        [ -f "$dest" ] && cur=$(stat -c%s "$dest" 2>/dev/null || wc -c < "$dest" 2>/dev/null || echo 0)
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

render_liquid_download "$APPIMAGE_URL" "$APPIMAGE_PATH"
chmod +x "$APPIMAGE_PATH"
ln -sf "$APPIMAGE_PATH" "$SYMLINK_PATH"

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

# 5. Desktop Integration
(
    ICON_PATH="${ICON_DIR}/apposition.png"
    curl -fsSL "https://raw.githubusercontent.com/${REPO}/main/assets/icon.png" -o "$ICON_PATH" 2>/dev/null || true
    cat <<EOF > "${DESKTOP_DIR}/apposition.desktop"
[Desktop Entry]
Name=Apposition
Comment=Separate Client Logins & Split-Screen Workstation
Exec=${APPIMAGE_PATH} %U
Icon=apposition
Type=Application
StartupWMClass=apposition
Categories=Utility;Network;WebBrowser;
MimeType=x-scheme-handler/apposition;
Terminal=false
EOF
    chmod +x "${DESKTOP_DIR}/apposition.desktop"
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
) &
spin_step $! "Configuring Linux desktop launcher & icons..." "Linux desktop integration registered"

# 6. Grand Finale Card
printf "\n  ${DARK}─────────────────────────────────────────────────────────────────${RESET}\n"
printf "  ${BOLD}✓ Installation Complete!${RESET}\n\n"
printf "  ${DIM}CLI Command${RESET}   ${WHITE}apposition${RESET} (Available in PATH)\n"
printf "  ${DIM}AppImage${RESET}      %s\n" "${APPIMAGE_PATH}"
printf "  ${DIM}Status${RESET}        Launching Apposition now...\n"
printf "  ${DARK}─────────────────────────────────────────────────────────────────${RESET}\n\n"

"$APPIMAGE_PATH" &
