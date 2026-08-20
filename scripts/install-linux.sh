#!/bin/bash
set -e

echo ""
echo "  ┌────────────────────────────────────────────────────────┐"
echo "  │              APPOSITION DIGITAL WORKSPACE              │"
echo "  │          Local-First • Sandboxed • High-Speed          │"
echo "  └────────────────────────────────────────────────────────┘"
echo ""

# 1. Detect Architecture
ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    ARCH_KEY="arm64"
    echo "• Architecture: ARM 64-bit ($ARCH)"
else
    ARCH_KEY="x86_64"
    echo "• Architecture: x86_64"
fi

# 2. Fetch Latest Release Information from GitHub
REPO="jvondev/apposition-releases"
echo "• Fetching latest release info from GitHub..."

LATEST_RELEASE=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")
VERSION=$(echo "$LATEST_RELEASE" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$VERSION" ]; then
    echo "❌ Error: Could not determine latest release version."
    exit 1
fi

echo "• Latest version: ${VERSION}"

# 3. Find AppImage download URL
APPIMAGE_URL=$(echo "$LATEST_RELEASE" | grep "browser_download_url" | grep -i "\.AppImage\"" | head -n 1 | cut -d '"' -f 4)

if [ -z "$APPIMAGE_URL" ]; then
    echo "❌ Error: No .AppImage asset found for release ${VERSION}."
    exit 1
fi

# 4. Target Directories
BIN_DIR="${HOME}/.local/bin"
APP_DIR="${HOME}/Applications"
DESKTOP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/512x512/apps"

mkdir -p "$BIN_DIR" "$APP_DIR" "$DESKTOP_DIR" "$ICON_DIR"

APPIMAGE_PATH="${APP_DIR}/Apposition-${VERSION}.AppImage"
SYMLINK_PATH="${BIN_DIR}/apposition"

echo "• Downloading Apposition AppImage..."
curl -L --progress-bar -o "$APPIMAGE_PATH" "$APPIMAGE_URL"
chmod +x "$APPIMAGE_PATH"

# Symlink to ~/.local/bin/apposition
ln -sf "$APPIMAGE_PATH" "$SYMLINK_PATH"

# 5. Fetch Icon & Create .desktop Entry
echo "• Setting up desktop integration..."
ICON_PATH="${ICON_DIR}/apposition.png"
curl -fsSL "https://raw.githubusercontent.com/${REPO}/main/assets/icon.png" -o "$ICON_PATH" 2>/dev/null || true

cat <<EOF > "${DESKTOP_DIR}/apposition.desktop"
[Desktop Entry]
Name=Apposition
Comment=A smart digital workspace to organize web apps, accounts, and tasks in one place
Exec=${APPIMAGE_PATH} %U
Icon=apposition
Type=Application
StartupWMClass=apposition
Categories=Utility;Network;WebBrowser;
MimeType=x-scheme-handler/apposition;
Terminal=false
EOF

chmod +x "${DESKTOP_DIR}/apposition.desktop"

# Update desktop database if available
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
fi

echo ""
echo "  ┌────────────────────────────────────────────────────────┐"
echo "  │  ✓ Successfully installed Apposition ${VERSION}!         │"
echo "  │  Run 'apposition' or launch from Application Menu.     │"
echo "  └────────────────────────────────────────────────────────┘"
echo ""

# 6. Optionally Launch
if [ -t 0 ]; then
    read -p "Would you like to launch Apposition now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        "$APPIMAGE_PATH" &
    fi
fi
