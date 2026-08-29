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
if [ "$ARCH" = "arm64" ]; then
    echo "• Architecture: Apple Silicon (arm64)"
else
    echo "• Architecture: Intel 64-bit (x64)"
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

# 3. Find DMG download URL matching architecture
if [ "$ARCH" = "arm64" ]; then
    DMG_URL=$(echo "$LATEST_RELEASE" | grep "browser_download_url" | grep -i "arm64.*\.dmg\"" | head -n 1 | cut -d '"' -f 4)
fi
if [ -z "$DMG_URL" ]; then
    DMG_URL=$(echo "$LATEST_RELEASE" | grep "browser_download_url" | grep -i "\.dmg\"" | grep -v -i "arm64" | head -n 1 | cut -d '"' -f 4)
fi
if [ -z "$DMG_URL" ]; then
    DMG_URL=$(echo "$LATEST_RELEASE" | grep "browser_download_url" | grep -i "\.dmg\"" | head -n 1 | cut -d '"' -f 4)
fi

if [ -z "$DMG_URL" ]; then
    echo "❌ Error: No .dmg asset found for release ${VERSION}."
    exit 1
fi

TEMP_DIR=$(mktemp -d)
DMG_PATH="${TEMP_DIR}/Apposition.dmg"

echo "• Downloading Apposition installer..."
curl -L --progress-bar -o "$DMG_PATH" "$DMG_URL"

# 4. Mount DMG
echo "• Mounting disk image..."
MOUNT_DIR="${TEMP_DIR}/mount"
mkdir -p "$MOUNT_DIR"
hdiutil attach "$DMG_PATH" -nobrowse -quiet -mountpoint "$MOUNT_DIR"

# 5. Copy App to /Applications
APP_SRC=$(find "$MOUNT_DIR" -maxdepth 2 -name "*.app" | head -n 1)

if [ -z "$APP_SRC" ]; then
    echo "❌ Error: Could not find .app in DMG."
    hdiutil detach "$MOUNT_DIR" -quiet || true
    rm -rf "$TEMP_DIR"
    exit 1
fi

APP_DEST="/Applications/Apposition.app"

echo "• Installing to /Applications/Apposition.app..."
if [ -d "$APP_DEST" ]; then
    echo "  Updating previous installation..."
    rm -rf "$APP_DEST"
fi

cp -R "$APP_SRC" "/Applications/"

# 6. Unmount & Cleanup Temp
hdiutil detach "$MOUNT_DIR" -quiet || true
rm -rf "$TEMP_DIR"

# 7. Strip Quarantine Extended Attribute (Bypasses Gatekeeper "Damaged" check)
echo "• Removing Gatekeeper quarantine flags..."
xattr -dr com.apple.quarantine "$APP_DEST" 2>/dev/null || true

echo ""
echo "  ┌────────────────────────────────────────────────────────┐"
echo "  │  ✓ Successfully installed Apposition ${VERSION}!         │"
echo "  │  Open from Spotlight or Applications folder.          │"
echo "  └────────────────────────────────────────────────────────┘"
echo ""

# 8. Optionally Launch
if [ -t 0 ]; then
    read -p "Would you like to launch Apposition now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        open "$APP_DEST"
    fi
fi
