#!/usr/bin/env pwsh
# CAPA Installer Script for Windows
# Licensed under the MIT license

param(
    [string]$InstallDir = "",
    [switch]$NoModifyPath = $false,
    [switch]$Verbose = $false,
    [switch]$Quiet = $false,
    [switch]$Help = $false
)

$ErrorActionPreference = "Stop"

# Constants
$APP_NAME = "capa"
$APP_VERSION = "1.1.0"
$GITHUB_REPO = "infragate/capa"

# Environment variable overrides
if ($env:CAPA_INSTALL_DIR) {
    $InstallDir = $env:CAPA_INSTALL_DIR
}
if ($env:CAPA_NO_MODIFY_PATH -eq "1") {
    $NoModifyPath = $true
}
if ($env:CAPA_UNMANAGED_INSTALL) {
    $NoModifyPath = $true
}
if ($env:CAPA_PRINT_VERBOSE -eq "1") {
    $Verbose = $true
}
if ($env:CAPA_PRINT_QUIET -eq "1") {
    $Quiet = $true
}

# Colors
$ColorReset = "`e[0m"
$ColorRed = "`e[31m"
$ColorGreen = "`e[32m"
$ColorYellow = "`e[33m"
$ColorBlue = "`e[34m"

function Show-Usage {
    Write-Host @"
capa-installer.ps1

The installer for CAPA (Capabilities Package Manager) $APP_VERSION

This script installs the CAPA binary to:
    `$env:CAPA_INSTALL_DIR (if set)
    `$env:LOCALAPPDATA\Programs\capa (default)

It will then add that directory to your PATH environment variable.

USAGE:
    .\install.ps1 [OPTIONS]
    
    Or via web:
    powershell -ExecutionPolicy ByPass -c "irm https://capa.infragate.ai/install.ps1 | iex"

OPTIONS:
    -InstallDir <DIR>
            Install to a custom directory

    -NoModifyPath
            Don't configure the PATH environment variable

    -Verbose
            Enable verbose output

    -Quiet
            Disable progress output

    -Help
            Print help information

ENVIRONMENT VARIABLES:
    CAPA_INSTALL_DIR        Custom installation directory
    CAPA_NO_MODIFY_PATH     Set to 1 to skip PATH modification
    CAPA_UNMANAGED_INSTALL  Set to 1 for CI/unmanaged installs
    CAPA_PRINT_VERBOSE      Set to 1 for verbose output
    CAPA_PRINT_QUIET        Set to 1 for quiet output

EXAMPLES:
    # Install with defaults
    irm https://capa.infragate.ai/install.ps1 | iex

    # Install to custom directory
    `$env:CAPA_INSTALL_DIR="C:\Tools"; irm https://capa.infragate.ai/install.ps1 | iex

    # Install without modifying PATH
    powershell -c "irm https://capa.infragate.ai/install.ps1 | iex" -NoModifyPath
"@
}

function Write-Info {
    param([string]$Message)
    if (-not $Quiet) {
        Write-Host "${ColorBlue}INFO${ColorReset}: $Message"
    }
}

function Write-Success {
    param([string]$Message)
    if (-not $Quiet) {
        Write-Host "${ColorGreen}✓${ColorReset} $Message"
    }
}

function Write-Warning {
    param([string]$Message)
    if (-not $Quiet) {
        Write-Host "${ColorYellow}WARN${ColorReset}: $Message" -ForegroundColor Yellow
    }
}

function Write-Error-Custom {
    param([string]$Message)
    if (-not $Quiet) {
        Write-Host "${ColorRed}ERROR${ColorReset}: $Message" -ForegroundColor Red
    }
    exit 1
}

function Write-Verbose-Custom {
    param([string]$Message)
    if ($Verbose) {
        Write-Host $Message
    }
}

function Get-Architecture {
    $arch = $env:PROCESSOR_ARCHITECTURE
    $arch64 = $env:PROCESSOR_ARCHITEW6432
    
    if ($arch64) {
        $arch = $arch64
    }
    
    switch ($arch) {
        "AMD64" { return "x86_64-pc-windows-msvc" }
        "ARM64" { return "aarch64-pc-windows-msvc" }
        "x86" { return "i686-pc-windows-msvc" }
        default {
            Write-Error-Custom "Unsupported architecture: $arch"
        }
    }
}

function Get-InstallDirectory {
    if ($InstallDir) {
        return $InstallDir
    }
    
    $localAppData = $env:LOCALAPPDATA
    if (-not $localAppData) {
        Write-Error-Custom "Could not determine installation directory (LOCALAPPDATA not set)"
    }
    
    return Join-Path $localAppData "Programs\capa"
}

function Test-InPath {
    param([string]$Directory)
    
    $pathDirs = $env:PATH -split ";"
    foreach ($dir in $pathDirs) {
        if ($dir -eq $Directory) {
            return $true
        }
    }
    return $false
}

function Add-ToPath {
    param([string]$Directory)
    
    if ($NoModifyPath) {
        return
    }
    
    if (Test-InPath $Directory) {
        Write-Verbose-Custom "Directory already in PATH"
        return
    }
    
    try {
        Write-Info "Adding $Directory to PATH..."
        
        # Get current user PATH
        $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
        
        # Add directory if not present
        if ($userPath -notlike "*$Directory*") {
            $newPath = "$Directory;$userPath"
            [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
            
            # Update current session
            $env:PATH = "$Directory;$env:PATH"
            
            Write-Success "Added to PATH"
        }
    }
    catch {
        Write-Warning "Failed to add to PATH: $_"
        Write-Host "You may need to add $Directory to your PATH manually"
    }
}

function Install-Capa {
    Write-Host ""
    Write-Host "${ColorGreen}╔═══════════════════════════════════════╗${ColorReset}"
    Write-Host "${ColorGreen}║  CAPA Installer v$APP_VERSION           ║${ColorReset}"
    Write-Host "${ColorGreen}╚═══════════════════════════════════════╝${ColorReset}"
    Write-Host ""
    
    # Detect architecture
    Write-Info "Detecting platform..."
    $arch = Get-Architecture
    Write-Success "Detected: $arch"
    
    # Get installation directory
    $installDir = Get-InstallDirectory
    Write-Info "Installation directory: $installDir"
    
    # Create installation directory
    if (-not (Test-Path $installDir)) {
        Write-Info "Creating installation directory..."
        New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    }
    
    # Determine binary name
    $binaryName = "capa-$arch.exe"
    $downloadUrl = "https://github.com/$GITHUB_REPO/releases/download/v$APP_VERSION/$binaryName"
    $destPath = Join-Path $installDir "capa.exe"
    
    Write-Info "Downloading CAPA..."
    Write-Verbose-Custom "URL: $downloadUrl"
    
    try {
        # Download binary
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $downloadUrl -OutFile $destPath -UseBasicParsing
        Write-Success "Downloaded CAPA binary"
    }
    catch {
        Write-Error-Custom "Failed to download CAPA from $downloadUrl`n$_"
    }
    
    Write-Success "Installed CAPA to $destPath"
    
    # Add to PATH
    Add-ToPath $installDir
    
    # Print success message
    Write-Host ""
    Write-Host "${ColorGreen}╔═══════════════════════════════════════╗${ColorReset}"
    Write-Host "${ColorGreen}║  CAPA installed successfully! 🎉      ║${ColorReset}"
    Write-Host "${ColorGreen}╚═══════════════════════════════════════╝${ColorReset}"
    Write-Host ""
    Write-Host "To get started, run:"
    Write-Host "  ${ColorBlue}capa init${ColorReset}     # Initialize a new project"
    Write-Host "  ${ColorBlue}capa --help${ColorReset}   # Show all commands"
    Write-Host ""
    
    if (-not $NoModifyPath) {
        Write-Host "${ColorYellow}Note:${ColorReset} You may need to restart your terminal for PATH changes to take effect."
        Write-Host ""
    }
    
    Write-Host "Documentation: https://github.com/$GITHUB_REPO"
    Write-Host ""
}

# Main execution
try {
    if ($Help) {
        Show-Usage
        exit 0
    }
    
    Install-Capa
}
catch {
    Write-Error-Custom "Installation failed: $_"
}
