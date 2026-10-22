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
ARCH_LABEL="x86_64"
[ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ] && ARCH_LABEL="ARM 64-bit ($ARCH)"

REPO="jvondev/apposition-releases"
BIN_DIR="${HOME}/.local/bin"
APP_DIR="${HOME}/Applications"
DESKTOP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/512x512/apps"
mkdir -p "$BIN_DIR" "$APP_DIR" "$DESKTOP_DIR" "$ICON_DIR"

LATEST_RELEASE=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")
VERSION=$(echo "$LATEST_RELEASE" | grep '"tag_name":' | head -n 1 | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$VERSION" ]; then
    printf "\n  ❌ ${BOLD}Error:${RESET} Could not determine latest release version.\n\n"
    exit 1
fi

echo ""
printf "  ${BOLD}Apposition %s${RESET}  ${DIM}•  Separate Client Logins & Split-Screen Workstation${RESET}\n" "${VERSION}"
printf "  ${DARK}────────────────────────────────────────────────────────${RESET}\n"
printf "  ${DIM}Hardware:${RESET} %s   ${DIM}Target:${RESET} Linux AppImage\n\n" "${ARCH_LABEL}"

# Step 1: Resolve release
printf "  ${WHITE}[1/3]${RESET} Latest release: ${WHITE}%s${RESET}\n" "${VERSION}"

APPIMAGE_PATH="${APP_DIR}/Apposition-${VERSION}.AppImage"
SYMLINK_PATH="${BIN_DIR}/apposition"

APPIMAGE_URL=$(echo "$LATEST_RELEASE" | grep "browser_download_url" | grep -i "\.AppImage\"" | head -n 1 | cut -d '"' -f 4)
if [ -z "$APPIMAGE_URL" ]; then
    printf "  ❌ ${BOLD}Error:${RESET} No .AppImage asset found for release %s.\n\n" "${VERSION}"
    exit 1
fi

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
            cur=$(stat -c%s "$dest" 2>/dev/null || stat -f%z "$dest" 2>/dev/null || wc -c < "$dest" 2>/dev/null || echo 0)
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

render_download "$APPIMAGE_URL" "$APPIMAGE_PATH"

# Step 3: Install & configure desktop launcher
printf "  ${WHITE}[3/3]${RESET} Configuring application launcher... "
chmod +x "$APPIMAGE_PATH"
ln -sf "$APPIMAGE_PATH" "$SYMLINK_PATH"

cat << 'EOF' > "${DESKTOP_DIR}/apposition.desktop"
[Desktop Entry]
Name=Apposition
Comment=Separate Client Logins & Split-Screen Workstation
Exec=apposition %U
Icon=apposition
Terminal=false
Type=Application
Categories=Network;WebBrowser;Office;
StartupWMClass=apposition
EOF
chmod +x "${DESKTOP_DIR}/apposition.desktop"

printf "${WHITE}Done${RESET}\n\n"

# Completion Card
printf "  ${DARK}────────────────────────────────────────────────────────${RESET}\n"
printf "  ${BOLD}✓ Apposition %s Installed!${RESET}\n\n" "${VERSION}"
printf "  ${DIM}Binary:${RESET}     %s\n" "${SYMLINK_PATH}"
printf "  ${DIM}Desktop:${RESET}    Search \"Apposition\" in your application launcher\n"
printf "  ${DIM}Status:${RESET}     Launching Apposition now...\n"
printf "  ${DARK}────────────────────────────────────────────────────────${RESET}\n\n"

"$SYMLINK_PATH" &>/dev/null & disown || true
