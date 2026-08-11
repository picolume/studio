@echo off
REM Build WASM binary generator for PicoLume Studio
REM Run from the studio directory: scripts\build-wasm.bat

setlocal

set STUDIO_DIR=%~dp0..
set WASM_OUTPUT=%STUDIO_DIR%\frontend\src\wasm\bingen.wasm
set WASM_EXEC_SRC=%GOROOT%\lib\wasm\wasm_exec.js
set WASM_EXEC_DST=%STUDIO_DIR%\frontend\src\wasm\wasm_exec.js

REM Create output directory
if not exist "%STUDIO_DIR%\frontend\src\wasm" mkdir "%STUDIO_DIR%\frontend\src\wasm"

echo Building WASM module...

REM Set environment for WASM compilation
set GOOS=js
set GOARCH=wasm

REM Build from studio directory
pushd "%STUDIO_DIR%"
go build -o "%WASM_OUTPUT%" ./wasm
if errorlevel 1 (
    echo WASM build failed!
    popd
    exit /b 1
)
popd

echo   Created: %WASM_OUTPUT%

REM Copy wasm_exec.js
if exist "%WASM_EXEC_SRC%" (
    copy /Y "%WASM_EXEC_SRC%" "%WASM_EXEC_DST%" >nul
    echo   Copied: wasm_exec.js
) else (
    echo   Warning: wasm_exec.js not found at %WASM_EXEC_SRC%
    echo   You may need to copy it manually from your Go installation
)

echo.
echo WASM build complete!
echo Files are in: %STUDIO_DIR%\frontend\src\wasm

endlocal
