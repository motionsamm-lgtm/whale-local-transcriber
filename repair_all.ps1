param([switch]$Launch)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Stop-WithMessage([string]$message) {
    Write-Host "`nFIX FAILED: $message" -ForegroundColor Red
    Read-Host 'Press Enter to close this window'
    exit 1
}

try {
    $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
    $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $nodeCmd -and (Test-Path "$env:ProgramFiles\nodejs\node.exe")) { $nodePath = "$env:ProgramFiles\nodejs\node.exe" }
    elseif ($nodeCmd) { $nodePath = $nodeCmd.Source }
    else { Stop-WithMessage 'Node.js was not found. Install Node.js, then run this file again.' }
    if (-not $npmCmd -and (Test-Path "$env:ProgramFiles\nodejs\npm.cmd")) { $npmPath = "$env:ProgramFiles\nodejs\npm.cmd" }
    elseif ($npmCmd) { $npmPath = $npmCmd.Source }
    else { Stop-WithMessage 'npm.cmd was not found. Reinstall Node.js with npm, then run this file again.' }
    $nodeFolder = Split-Path -Parent $nodePath
    $env:Path = $nodeFolder + ';' + $env:Path

    # Never delete or overwrite the locked Electron files in the downloaded project.
    $runtimeRoot = Join-Path $env:LOCALAPPDATA 'WhaleLocal\Runtimes'
    $runtimeDir = Join-Path $runtimeRoot ('electron-45.3.4-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    $package = '{"name":"whale-local-runtime","version":"1.0.0","private":true,"devDependencies":{"electron":"45.3.4"}}'
    [System.IO.File]::WriteAllText((Join-Path $runtimeDir 'package.json'), $package, [System.Text.Encoding]::ASCII)

    Write-Host 'Installing a clean Electron runtime in a separate Windows folder...'
    Push-Location $runtimeDir
    & $npmPath install --ignore-scripts
    if ($LASTEXITCODE -ne 0) { Pop-Location; Stop-WithMessage 'npm could not install Electron. Check the network/npm output above.' }
    $installerCmd = Join-Path $runtimeDir 'node_modules\.bin\install-electron.cmd'
    if (-not (Test-Path $installerCmd)) { Pop-Location; Stop-WithMessage 'Electron install-electron command was not created by npm.' }
    & $installerCmd --no
    if ($LASTEXITCODE -ne 0) { Pop-Location; Stop-WithMessage 'Electron runtime download failed. Check the network/download output above.' }
    Pop-Location

    $electronExe = Join-Path $runtimeDir 'node_modules\electron\dist\electron.exe'
    if (-not (Test-Path $electronExe)) { Stop-WithMessage 'Electron finished without creating its runtime executable.' }
    [System.IO.File]::WriteAllText((Join-Path $root 'runtime_path.txt'), $runtimeDir, [System.Text.Encoding]::ASCII)
    Write-Host "`nClean runtime installed: $runtimeDir" -ForegroundColor Green

    if ($Launch) {
        Write-Host 'Starting Whale Local...'
        Set-Location $root
        & $electronExe $root
        $exitCode = $LASTEXITCODE
        Write-Host "`nWhale Local exited with code $exitCode."
        Read-Host 'Press Enter to close this window'
        exit $exitCode
    }
    Write-Host 'Setup complete. Double-click start_windows.bat to open Whale Local.' -ForegroundColor Green
} catch {
    Stop-WithMessage $_.Exception.Message
}
