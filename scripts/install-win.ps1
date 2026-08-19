# Apposition Windows Automated Installer
# Zero Telemetry • Local-First Digital Workspace

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  ┌────────────────────────────────────────────────────────┐" -ForegroundColor White
Write-Host "  │              APPOSITION DIGITAL WORKSPACE              │" -ForegroundColor White
Write-Host "  │          Local-First • Sandboxed • High-Speed          │" -ForegroundColor Gray
Write-Host "  └────────────────────────────────────────────────────────┘" -ForegroundColor White
Write-Host ""

$repo = "jvondev/apposition-releases"
$apiUrl = "https://api.github.com/repos/$repo/releases/latest"

Write-Host "==> Fetching latest release information..." -ForegroundColor Cyan

try {
    $release = Invoke-RestMethod -Uri $apiUrl -UseBasicParsing -Headers @{ "User-Agent" = "Apposition-Installer" }
    $asset = $release.assets | Where-Object { $_.name -like "*.exe" -and $_.name -notlike "*.blockmap" } | Select-Object -First 1

    if (-not $asset) {
        throw "Could not find a valid .exe release asset."
    }

    $downloadUrl = $asset.browser_download_url
    $fileName = $asset.name
    $tempPath = Join-Path $env:TEMP $fileName

    Write-Host "==> Downloading $fileName..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tempPath -UseBasicParsing

    Write-Host "==> Launching Apposition Setup..." -ForegroundColor Green
    Start-Process -FilePath $tempPath

    Write-Host ""
    Write-Host "==> Apposition installer launched successfully!" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Please download manually from: https://github.com/$repo/releases/latest" -ForegroundColor Yellow
    exit 1
}
