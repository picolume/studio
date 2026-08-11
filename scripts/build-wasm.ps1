# Build WASM binary generator for PicoLume Studio
# Run from the studio directory: .\scripts\build-wasm.ps1

$ErrorActionPreference = "Stop"

$StudioDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$WasmOutput = Join-Path $StudioDir "frontend\src\wasm\bingen.wasm"

# Get GOROOT from go env if not set in environment
$GoRoot = $env:GOROOT
if (-not $GoRoot) {
    $GoRoot = (go env GOROOT).Trim()
}
$WasmExecSrc = Join-Path $GoRoot "lib\wasm\wasm_exec.js"
$WasmExecDst = Join-Path $StudioDir "frontend\src\wasm\wasm_exec.js"

# Ensure output directory exists
$WasmDir = Split-Path -Parent $WasmOutput
if (!(Test-Path $WasmDir)) {
    New-Item -ItemType Directory -Path $WasmDir -Force | Out-Null
}

Write-Host "Building WASM module..." -ForegroundColor Cyan

# Set environment for WASM compilation
$env:GOOS = "js"
$env:GOARCH = "wasm"

# Build the WASM module
Push-Location $StudioDir
try {
    go build -o $WasmOutput ./wasm
    if ($LASTEXITCODE -ne 0) {
        throw "WASM build failed"
    }
    Write-Host "  Created: $WasmOutput" -ForegroundColor Green
} finally {
    Pop-Location
    # Reset environment
    Remove-Item Env:GOOS -ErrorAction SilentlyContinue
    Remove-Item Env:GOARCH -ErrorAction SilentlyContinue
}

# Copy wasm_exec.js from Go installation
if (Test-Path $WasmExecSrc) {
    Copy-Item $WasmExecSrc $WasmExecDst -Force
    Write-Host "  Copied: wasm_exec.js" -ForegroundColor Green
} else {
    Write-Host "  Warning: wasm_exec.js not found at $WasmExecSrc" -ForegroundColor Yellow
    Write-Host "  You may need to copy it manually from your Go installation" -ForegroundColor Yellow
}

Write-Host "`nWASM build complete!" -ForegroundColor Green
Write-Host "Files are in: $WasmDir" -ForegroundColor Gray
