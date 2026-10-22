# Apposition Windows Automated Installer
# Precision Grayscale • High-Speed Digital Workstation

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  Apposition" -ForegroundColor White -NoNewline
Write-Host "  •  Separate Client Logins & Split-Screen Workstation" -ForegroundColor DarkGray
Write-Host "  ────────────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""

$repo = "jvondev/apposition-releases"
$apiUrl = "https://api.github.com/repos/$repo/releases/latest"

try {
    # Step 1: Query release
    Write-Host "  [1/3] Resolving latest release... " -ForegroundColor White -NoNewline
    $release = Invoke-RestMethod -Uri $apiUrl -UseBasicParsing -Headers @{ "User-Agent" = "Apposition-Installer" }
    $version = $release.tag_name
    Write-Host "$version" -ForegroundColor White

    $asset = $release.assets | Where-Object { $_.name -like "*.exe" -and $_.name -notlike "*.blockmap" } | Select-Object -First 1
    if (-not $asset) {
        throw "Could not find a valid .exe release asset for $version."
    }

    $downloadUrl = $asset.browser_download_url
    $fileName = $asset.name
    $tempPath = Join-Path $env:TEMP $fileName

    # Step 2: Download
    Write-Host "  [2/3] Downloading application bundle" -ForegroundColor White
    $barWidth = 18
    $webClient = New-Object System.Net.WebClient
    $webClient.Headers.Add("User-Agent", "Apposition-Installer")

    $lastPercent = -1
    $eventHandler = {
        param($sender, $e)
        $pct = $e.ProgressPercentage
        if ($pct -ne $script:lastPercent -and ($pct % 2 -eq 0 -or $pct -eq 100)) {
            $script:lastPercent = $pct
            $filled = [Math]::Floor($pct * $barWidth / 100)
            if ($filled -gt $barWidth) { $filled = $barWidth }
            $empty = $barWidth - $filled
            $bar = ("█" * $filled) + ("─" * $empty)
            $receivedMb = [Math]::Round($e.BytesReceived / 1MB, 1)
            $totalMb = [Math]::Round($e.TotalBytesToReceive / 1MB, 1)
            
            $line = "`r        [$bar] $($pct.ToString().PadLeft(3))%  │  $receivedMb/$totalMb MB"
            Write-Host -NoNewline $line
        }
    }

    Register-ObjectEvent -InputObject $webClient -EventName DownloadProgressChanged -Action $eventHandler | Out-Null
    $webClient.DownloadFileTaskAsync($downloadUrl, $tempPath).GetAwaiter().GetResult()
    $webClient.Dispose()
    Write-Host "  │  Verified" -ForegroundColor White

    # Step 3: Install
    Write-Host "  [3/3] Launching Apposition Setup... " -ForegroundColor White -NoNewline
    Start-Process -FilePath $tempPath
    Write-Host "Done" -ForegroundColor White
    Write-Host ""

    # Completion Card
    Write-Host "  ────────────────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host "  ✓ Apposition Installed!" -ForegroundColor White
    Write-Host ""
    Write-Host "  Status:  Setup is launching. Follow prompts to finish." -ForegroundColor Gray
    Write-Host "  ────────────────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host ""
} catch {
    Write-Host ""
    Write-Host "  ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  Please download manually from: https://github.com/$repo/releases/latest" -ForegroundColor DarkGray
    Write-Host ""
    exit 1
}
