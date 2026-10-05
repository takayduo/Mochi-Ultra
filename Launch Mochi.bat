@echo off
title Mochi Desktop Companion
cd /d "%~dp0"
if exist "%~dp0node_modules\electron\dist\electron.exe" (
    start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
) else (
    start "" npm run app
)
exit
