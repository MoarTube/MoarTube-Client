param(
    [string]$RunnerDirectory,
    [string]$FfmpegPath,
    [string]$NodeSourceDirectory
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $RunnerDirectory) { $RunnerDirectory = Join-Path $projectRoot 'build\integration\runner' }
$RunnerDirectory = [IO.Path]::GetFullPath($RunnerDirectory)
if (-not (Test-Path -LiteralPath (Join-Path $RunnerDirectory '.runner') -PathType Leaf)) {
    throw 'Register the runner first: npm.cmd run test:runner:setup. See docs/local-integration-runner.md.'
}
if (-not $FfmpegPath) { $FfmpegPath = $env:FFMPEG_BIN }
if (-not $FfmpegPath) { $FfmpegPath = Join-Path $projectRoot 'build\ffmpeg\install\win32-x64\bin\ffmpeg.exe' }
$FfmpegPath = [IO.Path]::GetFullPath($FfmpegPath)
if (-not (Test-Path -LiteralPath $FfmpegPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $FfmpegPath) 'ffprobe.exe') -PathType Leaf)) {
    throw 'Compile FFmpeg first with npm.cmd run ffmpeg:build:windows, or supply -FfmpegPath with its absolute path.'
}
$listener = Join-Path $RunnerDirectory 'bin\Runner.Listener.exe'
$runnerVersion = (& $listener --version | Select-Object -Last 1).Trim()
if ($LASTEXITCODE -ne 0 -or [version]$runnerVersion -lt [version]'2.327.1') {
    throw 'GitHub Actions Runner 2.327.1 or newer is required.'
}
# The runner's separate checkout inherits this exact locally compiled binary pair.
$env:FFMPEG_BIN = $FfmpegPath
if (-not $NodeSourceDirectory) { $NodeSourceDirectory = $env:MOARTUBE_NODE_SOURCE_DIR }
if (-not $NodeSourceDirectory) { $NodeSourceDirectory = Join-Path (Split-Path -Parent $projectRoot) 'MoarTube-Node' }
$NodeSourceDirectory = [IO.Path]::GetFullPath($NodeSourceDirectory)
if (-not (Test-Path -LiteralPath (Join-Path $NodeSourceDirectory 'public\views\watch.ejs') -PathType Leaf)) {
    throw 'The viewer regression tests need a MoarTube Node source checkout. Supply -NodeSourceDirectory (see docs/local-integration-runner.md).'
}
$env:MOARTUBE_NODE_SOURCE_DIR = $NodeSourceDirectory
Write-Host "Using compiled FFmpeg: $FfmpegPath"
Write-Host 'Keep this terminal open. Start MoarTube Node on localhost:9090 before dispatching the E2E workflow.'
Push-Location -LiteralPath $RunnerDirectory
try {
    & (Join-Path $RunnerDirectory 'run.cmd')
    $runnerExit = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $runnerExit
