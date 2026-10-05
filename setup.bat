@echo off
setlocal enabledelayedexpansion
title Mochi Setup & Launcher
cd /d "%~dp0"

echo ===================================================
echo             MOCHI INSTALLER & LAUNCHER
echo ===================================================
echo.

:: 1. Check for Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    if exist "%ProgramFiles%\nodejs\node.exe" (
        set "PATH=%ProgramFiles%\nodejs;%PATH%"
    ) else if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
        set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
    ) else (
        echo [!] Node.js was not detected on your PC.
        echo [*] Installing Node.js 22 LTS automatically for you, please wait...
        echo.
        where winget >nul 2>nul
        if !ERRORLEVEL! EQU 0 (
            winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
        ) else (
            echo Downloading Node.js installer from nodejs.org...
            powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi' -OutFile '%TEMP%\nodejs.msi'"
            echo Installing Node.js...
            msiexec /i "%TEMP%\nodejs.msi" /passive /norestart
        )
        set "PATH=%ProgramFiles%\nodejs;%PATH%"
    )
)

:: Verify node again
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Could not automatically install Node.js.
    echo Please download and install Node.js from https://nodejs.org
    echo Then run this setup.bat file again!
    pause
    exit /b 1
)

echo [OK] Node.js is ready!
echo.

:: 2. Install dependencies
if not exist "node_modules\electron\dist\electron.exe" (
    echo [*] Installing Mochi dependencies...
    if exist "package-lock.json" del /f /q "package-lock.json" 2>nul
    call npm install
)

:: Verify electron binary was extracted successfully
if not exist "node_modules\electron\dist\electron.exe" (
    echo [*] Downloading Electron binary directly...
    powershell -NoProfile -Command "$v = '44.5.1'; if (Test-Path 'node_modules\electron\package.json') { $v = (Get-Content 'node_modules\electron\package.json' -Raw | ConvertFrom-Json).version }; $zip = \"$env:TEMP\electron.zip\"; Invoke-WebRequest -Uri \"https://github.com/electron/electron/releases/download/v$v/electron-v$v-win32-x64.zip\" -OutFile $zip; if (-not (Test-Path 'node_modules\electron\dist')) { New-Item -ItemType Directory -Path 'node_modules\electron\dist' -Force | Out-Null }; Expand-Archive -Path $zip -DestinationPath 'node_modules\electron\dist' -Force; Set-Content -Path 'node_modules\electron\path.txt' -Value 'electron.exe' -NoNewline; Remove-Item -Force $zip -ErrorAction SilentlyContinue" >nul 2>nul
)

:: 3. Build Mochi
echo [*] Building Mochi...
call npm run build

:: 4. Create Desktop Shortcut pointing directly to electron.exe (no .vbs!)
powershell -NoProfile -Command "$wsh = New-Object -ComObject WScript.Shell; $s = $wsh.CreateShortcut([System.IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'Mochi.lnk')); $electron = [System.IO.Path]::Combine('%~dp0', 'node_modules\electron\dist\electron.exe'); if (Test-Path $electron) { $s.TargetPath = $electron; $s.Arguments = '.' } else { $s.TargetPath = 'cmd.exe'; $s.Arguments = '/c \"\"%~dp0Launch Mochi.bat\"\"' }; $s.WorkingDirectory = '%~dp0'; if (Test-Path '%~dp0public\icons\icon.ico') { $s.IconLocation = '%~dp0public\icons\icon.ico,0' }; $s.Description = 'Mochi — Creator Desktop Companion'; $s.Save()" >nul 2>nul

echo.
echo ===================================================
echo   [SUCCESS] Mochi is installed and ready!
echo   A desktop shortcut 'Mochi' has been created.
echo ===================================================
echo.
echo Starting Mochi now...
if exist "%~dp0node_modules\electron\dist\electron.exe" (
    start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
) else (
    start "" "%~dp0Launch Mochi.bat"
)
exit
