# Universal installer for AFWE (Windows PowerShell)
# Usage: irm https://raw.githubusercontent.com/StudioEaZY/afwe/main/scripts/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = "StudioEaZY/afwe"
$Tag = if ($env:AFWE_VERSION) { $env:AFWE_VERSION } else { "v0.1.0" }
$InstallDir = if ($env:AFWE_INSTALL_DIR) { $env:AFWE_INSTALL_DIR } else { "$env:USERPROFILE\.afwe\bin" }

Write-Host "▶ Detecting platform..." -ForegroundColor Cyan
$Arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
if ($Arch -eq [System.Runtime.InteropServices.Architecture]::X64) {
    $Target = "x86_64-pc-windows-msvc"
} else {
    Write-Error "Unsupported architecture: $Arch. Only x64 Windows is currently pre-built."
    return
}

Write-Host "  Detected target: $Target"

if (!(Test-Path -Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

$DownloadUrl = "https://github.com/$Repo/releases/download/$Tag/afwe-$Target.exe"
$Dest = Join-Path $InstallDir "afwe.exe"

Write-Host "▶ Downloading AFWE ($Tag) from GitHub Releases..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $DownloadUrl -OutFile $Dest

Write-Host "✓ Installed successfully to $Dest" -ForegroundColor Green

# Add to user PATH if not present
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
    Write-Host "▶ Adding $InstallDir to User PATH..." -ForegroundColor Cyan
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
    $env:Path = "$env:Path;$InstallDir"
    Write-Host "✓ PATH updated! Restart your terminal or run '$Dest' directly." -ForegroundColor Green
} else {
    Write-Host "✓ $InstallDir is already in your PATH." -ForegroundColor Green
}

Write-Host "`nRun 'afwe --version' or 'afwe init' to get started!" -ForegroundColor Green
