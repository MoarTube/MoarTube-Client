param([switch]$DownloadOnly)
$ErrorActionPreference = 'Stop'
if (-not [Environment]::Is64BitOperatingSystem -or $env:OS -ne 'Windows_NT') {
    throw 'This runner setup currently supports Windows x64.'
}
$projectRoot = Split-Path -Parent $PSScriptRoot
$runnerRoot = Join-Path $projectRoot 'build\integration\runner'
$downloads = Join-Path $projectRoot 'build\integration\downloads'
if (Test-Path -LiteralPath (Join-Path $runnerRoot '.runner')) {
    Write-Host 'The integration runner is already registered. Start it with npm.cmd run test:runner.'
    exit 0
}
if (-not (Test-Path -LiteralPath (Join-Path $runnerRoot 'config.cmd'))) {
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/actions/runner/releases/latest' -Headers @{ 'User-Agent' = 'MoarTube-Integration-Setup' }
    $asset = @($release.assets | Where-Object { $_.name -match '^actions-runner-win-x64-[0-9.]+\.zip$' })
    if ($asset.Count -ne 1 -or $asset[0].digest -notmatch '^sha256:[a-f0-9]{64}$') {
        throw 'Cannot obtain a checksum-verified Windows runner release. Use the official GitHub runner setup instructions instead.'
    }
    $asset = $asset[0]
    $expected = $asset.digest.Substring(7)
    if ($asset.browser_download_url -notlike 'https://github.com/actions/runner/releases/download/*') {
        throw 'Unexpected GitHub runner download URL.'
    }
    New-Item -ItemType Directory -Force -Path $downloads, $runnerRoot | Out-Null
    $archive = Join-Path $downloads $asset.name
    if (-not (Test-Path -LiteralPath $archive)) {
        $partial = "$archive.partial"
        & curl.exe --fail --location --retry 9 --retry-connrefused --connect-timeout 10 --max-time 600 --output $partial $asset.browser_download_url
        if ($LASTEXITCODE -ne 0) { throw 'GitHub runner download failed; rerun setup to retry.' }
        if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
            throw 'GitHub runner archive checksum mismatch.'
        }
        Move-Item -LiteralPath $partial -Destination $archive
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
        throw 'Cached GitHub runner archive checksum mismatch.'
    }
    Expand-Archive -LiteralPath $archive -DestinationPath $runnerRoot -Force
    Write-Host "Prepared checksum-verified GitHub runner $($release.tag_name) at $runnerRoot"
}
if ($DownloadOnly) { exit 0 }
Write-Host 'Open https://github.com/MoarTube/MoarTube-Client/settings/actions/runners/new and copy the temporary registration token.'
Write-Host 'Enter that token at the runner prompt; do not paste it into chat or commit it.'
Write-Host 'Keep the default interactive mode (do not install a service) to use your signed-in GPU session.'
Push-Location -LiteralPath $runnerRoot
try {
    & .\config.cmd --url https://github.com/MoarTube/MoarTube-Client --name moartube-windows-gpu --labels moartube-integration --work _work
    $configurationExit = $LASTEXITCODE
} finally { Pop-Location }
exit $configurationExit
