[CmdletBinding()]
param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$buildRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'build'))
$moves = [Collections.Generic.List[object]]::new()
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
function BuildPath([string]$Relative) {
    $absolute = [IO.Path]::GetFullPath((Join-Path $buildRoot $Relative))
    if (!$absolute.StartsWith($buildRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Path escapes build workspace: $absolute" }
    return $absolute
}
function MoveBuild([string]$From, [string]$To) {
    $source = BuildPath $From
    $destination = BuildPath $To
    if (!(Test-Path -LiteralPath $source)) { return }
    if ($source -eq $destination -or $destination.StartsWith($source + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Cannot move a build folder into itself' }
    if (Test-Path -LiteralPath $destination) { throw "Destination already exists; refusing overwrite: $destination" }
    $moves.Add([pscustomobject]@{ from = $source; to = $destination })
    if ($Apply) {
        New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
        Move-Item -LiteralPath $source -Destination $destination
    }
}
$oldDesktopSelection = BuildPath 'desktop/ffmpeg-selection.json'
$desktopSelection = if (Test-Path -LiteralPath $oldDesktopSelection) { Get-Content -LiteralPath $oldDesktopSelection -Raw | ConvertFrom-Json } else { $null }
$oldWindowsSelection = BuildPath 'ffmpeg/artifacts/selected.json'
$windowsSelection = if (Test-Path -LiteralPath $oldWindowsSelection) { Get-Content -LiteralPath $oldWindowsSelection -Raw | ConvertFrom-Json } else { $null }
$oldLinuxSelection = BuildPath 'ffmpeg/artifacts/linux-x64/selected.json'
$linuxSelection = if (Test-Path -LiteralPath $oldLinuxSelection) { Get-Content -LiteralPath $oldLinuxSelection -Raw | ConvertFrom-Json } else { $null }

# Downloads and compiler inputs. Keep the installed binary pair at its stable path.
$sourceNames = (Get-Content -LiteralPath (Join-Path $projectRoot 'tooling/ffmpeg/sources.lock.json') -Raw | ConvertFrom-Json).sources.archive
foreach ($file in @(Get-ChildItem -LiteralPath (BuildPath 'ffmpeg/cache') -File -ErrorAction SilentlyContinue)) {
    $category = if ($sourceNames -contains $file.Name) { 'sources' } else { 'toolchains/win32-x64' }
    MoveBuild "ffmpeg/cache/$($file.Name)" "ffmpeg/cache/$category/$($file.Name)"
}
MoveBuild 'ffmpeg/npm-cache' 'ffmpeg/cache/npm'
MoveBuild 'ffmpeg/work/msys64' 'ffmpeg/toolchains/win32-x64/msys64'
MoveBuild 'ffmpeg/work/toolchain.identity' 'ffmpeg/toolchains/win32-x64/toolchain.identity'
foreach ($entry in @(Get-ChildItem -LiteralPath (BuildPath 'ffmpeg/work') -Force -ErrorAction SilentlyContinue)) {
    if ($entry.Name -notin @('win32-x64', 'linux-x64', 'msys64', 'toolchain.identity')) { MoveBuild "ffmpeg/work/$($entry.Name)" "ffmpeg/archive/win32-x64/previous-work/$($entry.Name)" }
}
# Immutable candidates and their archives are moved without modifying their bytes.
foreach ($entry in @(Get-ChildItem -LiteralPath (BuildPath 'ffmpeg/artifacts') -Force -ErrorAction SilentlyContinue)) {
    if ($entry.PSIsContainer -and $entry.Name -ne 'linux-x64') { MoveBuild "ffmpeg/artifacts/$($entry.Name)" "ffmpeg/candidates/win32-x64/$($entry.Name)" }
    elseif (!$entry.PSIsContainer -and $entry.Name -ne 'selected.json') {
        $id = $entry.Name -replace '\.zip(\.sha256)?$', ''
        MoveBuild "ffmpeg/artifacts/$($entry.Name)" "ffmpeg/releases/win32-x64/$id/$($entry.Name)"
    }
}
MoveBuild 'ffmpeg/artifacts/selected.json' 'ffmpeg/state/win32-x64/selected.json'
if ($null -ne $linuxSelection) {
    MoveBuild "ffmpeg/artifacts/linux-x64/$($linuxSelection.buildId)" "ffmpeg/candidates/linux-x64/$($linuxSelection.buildId)"
    foreach ($entry in @(Get-ChildItem -LiteralPath (BuildPath 'ffmpeg/artifacts/linux-x64') -File -ErrorAction SilentlyContinue)) {
        if ($entry.Name -ne 'selected.json') { MoveBuild "ffmpeg/artifacts/linux-x64/$($entry.Name)" "ffmpeg/releases/linux-x64/$($linuxSelection.buildId)/$($entry.Name)" }
    }
    MoveBuild 'ffmpeg/artifacts/linux-x64/selected.json' 'ffmpeg/state/linux-x64/selected.json'
}
foreach ($file in @(Get-ChildItem -LiteralPath (BuildPath 'ffmpeg') -File -Filter '*.log')) { MoveBuild "ffmpeg/$($file.Name)" "ffmpeg/logs/linux-x64/$($file.Name)" }

MoveBuild 'desktop/builder-cache' 'desktop/cache/builder'
MoveBuild 'desktop/electron-cache' 'desktop/cache/electron'
foreach ($name in @('icon.ico', 'icon.png')) { MoveBuild "desktop/$name" "desktop/assets/$name" }
MoveBuild 'desktop/dev-user-data' 'desktop/profiles/win32-x64/development'
MoveBuild 'desktop/dev-user-data-linux-x64' 'desktop/profiles/linux-x64/development'
MoveBuild 'desktop/smoke-dev-user' 'desktop/profiles/win32-x64/smoke-development'
MoveBuild 'desktop/smoke-packaged-user' 'desktop/profiles/win32-x64/smoke-packaged'
MoveBuild 'desktop/dev-smoke.json' 'desktop/reports/win32-x64/development/smoke.json'
MoveBuild 'desktop/dev-window.png' 'desktop/reports/win32-x64/development/window.png'
MoveBuild 'desktop/packaged-smoke.json' 'desktop/reports/win32-x64/packaged/smoke.json'
MoveBuild 'desktop/packaged-window.png' 'desktop/reports/win32-x64/packaged/window.png'
MoveBuild 'desktop/audit.json' 'desktop/reports/win32-x64/dependency-audit.json'
MoveBuild 'desktop/size-before-english.json' 'desktop/archive/win32-x64/measurements/size-before-english.json'
foreach ($entry in @(Get-ChildItem -LiteralPath (BuildPath 'desktop') -Directory -Filter 'portable QA *')) {
    MoveBuild "desktop/$($entry.Name)" "desktop/work/win32-x64/qa/$($entry.Name)"
}
foreach ($entry in @(Get-ChildItem -LiteralPath (BuildPath 'desktop') -Directory -Filter 'ffmpeg-release-*')) {
    $isSelected = $null -ne $desktopSelection -and ([IO.Path]::GetDirectoryName($desktopSelection.runtimeDirectory) -eq $entry.FullName)
    $target = if ($isSelected) { "desktop/work/win32-x64/staging/$($desktopSelection.buildId)" } else { "desktop/archive/win32-x64/staging/$($entry.Name)" }
    MoveBuild "desktop/$($entry.Name)" $target
}
MoveBuild 'desktop/ffmpeg-selection.json' 'desktop/state/win32-x64/ffmpeg-selection.json'
foreach ($file in @(Get-ChildItem -LiteralPath (BuildPath 'desktop') -File -Filter '*.log')) {
    $target = if ($file.Name.StartsWith('linux-')) { 'linux-x64' } else { 'win32-x64' }
    MoveBuild "desktop/$($file.Name)" "desktop/logs/$target/$($file.Name)"
}
MoveBuild 'desktop/output/win-unpacked' 'desktop/work/win32-x64/packages/win-unpacked'
foreach ($file in @(Get-ChildItem -LiteralPath (BuildPath 'desktop/output') -File -ErrorAction SilentlyContinue)) {
    $current = $file.Name -notlike '*-sources.zip' -or ($null -ne $desktopSelection -and $file.Name -eq $desktopSelection.sourceArchive)
    $target = if ($current) { "desktop/releases/win32-x64/$version" } else { "desktop/archive/win32-x64/release-assets/$version" }
    MoveBuild "desktop/output/$($file.Name)" "$target/$($file.Name)"
}
MoveBuild 'desktop/output/linux/linux-unpacked' 'desktop/work/linux-x64/packages/linux-unpacked'
foreach ($file in @(Get-ChildItem -LiteralPath (BuildPath 'desktop/output/linux') -File -ErrorAction SilentlyContinue)) {
    $target = if ($file.Name -like 'builder-*') { 'desktop/work/linux-x64/packages' } else { "desktop/releases/linux-x64/$version" }
    MoveBuild "desktop/output/linux/$($file.Name)" "$target/$($file.Name)"
}
foreach ($ubuntu in @('24.04', '26.04')) {
    MoveBuild "desktop/linux-ubuntu-$ubuntu/smoke-xdg" "desktop/profiles/linux-x64/ubuntu-$ubuntu/smoke-packaged/xdg"
    MoveBuild "desktop/linux-ubuntu-$ubuntu/output" "desktop/archive/linux-x64/qa-output/ubuntu-$ubuntu"
    MoveBuild "desktop/linux-ubuntu-$ubuntu" "desktop/reports/linux-x64/ubuntu-$ubuntu"
}
if ($Apply) {
    $utf8 = [Text.UTF8Encoding]::new($false)
    foreach ($area in @('desktop', 'ffmpeg')) {
        foreach ($target in @('win32-x64', 'linux-x64')) {
            foreach ($category in @('logs', 'work', 'state', 'reports')) {
                New-Item -ItemType Directory -Path (BuildPath "$area/$category/$target") -Force | Out-Null
            }
        }
    }
    if ($null -ne $windowsSelection) {
        $windowsSelection.directory = BuildPath "ffmpeg/candidates/win32-x64/$($windowsSelection.buildId)"
        [IO.File]::WriteAllText((BuildPath 'ffmpeg/state/win32-x64/selected.json'), ($windowsSelection | ConvertTo-Json -Depth 20) + "`n", $utf8)
    }
    if ($null -ne $desktopSelection) {
        $desktopSelection.directory = BuildPath "ffmpeg/candidates/win32-x64/$($desktopSelection.buildId)"
        $desktopSelection.runtimeDirectory = BuildPath "desktop/work/win32-x64/staging/$($desktopSelection.buildId)/runtime"
        [IO.File]::WriteAllText((BuildPath 'desktop/state/win32-x64/ffmpeg-selection.json'), ($desktopSelection | ConvertTo-Json -Depth 20) + "`n", $utf8)
    }
    # Leave old embedded paths in historical evidence untouched. Remove only
    # now-empty old category containers, never recursively delete their contents.
    foreach ($relative in @('desktop/output/linux', 'desktop/output', 'ffmpeg/artifacts/linux-x64', 'ffmpeg/artifacts')) {
        $directory = BuildPath $relative
        if ((Test-Path -LiteralPath $directory) -and @(Get-ChildItem -LiteralPath $directory -Force).Count -eq 0) { Remove-Item -LiteralPath $directory }
    }
    New-Item -ItemType Directory -Path (BuildPath 'desktop/state') -Force | Out-Null
    if ($moves.Count -gt 0) {
        $record = BuildPath ("desktop/state/migrations/" + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.json')
        New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($record)) -Force | Out-Null
        [IO.File]::WriteAllText($record, ($moves | ConvertTo-Json -Depth 10), $utf8)
    }
}
$moves | Format-Table from, to -AutoSize
Write-Output "Planned/moved $($moves.Count) entries. Apply=$Apply"
