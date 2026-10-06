# 🍡 Mochi Ultra — 1-Click Automated Installer for Any Windows PC
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Download-Fast($url, $dest, $showProgress = $false) {
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        if ($showProgress) {
            & curl.exe -# -SL "$url" -o "$dest"
        } else {
            & curl.exe -sSL "$url" -o "$dest"
        }
    } else {
        $wc = New-Object System.Net.WebClient
        $wc.DownloadFile($url, $dest)
    }
}

Write-Host ""
Write-Host "===================================================" -ForegroundColor Magenta
Write-Host "      🍡 MOCHI ULTRA 1-CLICK WINDOWS INSTALLER     " -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Magenta
Write-Host ""

# 1. Check & Install Node.js if missing
Write-Host "[1/6] Checking Node.js environment..." -ForegroundColor Yellow

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    if (Test-Path "$env:ProgramFiles\nodejs\node.exe") {
        $env:Path = "$env:ProgramFiles\nodejs;" + $env:Path
        $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    } elseif (Test-Path "${env:ProgramFiles(x86)}\nodejs\node.exe") {
        $env:Path = "${env:ProgramFiles(x86)}\nodejs;" + $env:Path
        $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    }
}

if (-not $nodeCmd) {
    Write-Host "      Node.js not detected. Installing Node.js LTS automatically..." -ForegroundColor Cyan
    $installed = $false
    $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetCmd) {
        Write-Host "      Checking Windows Package Manager (winget)..." -ForegroundColor Gray
        try {
            $p = Start-Process winget -ArgumentList "install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements" -Wait -PassThru
            if (Test-Path "$env:ProgramFiles\nodejs\node.exe") {
                $installed = $true
            }
        } catch {
            $installed = $false
        }
    }
    if (-not $installed) {
        $msiUrl = "https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi"
        $msiDest = "$env:TEMP\nodejs_lts.msi"
        Write-Host "      Downloading official Node.js 22 LTS installer from nodejs.org..." -ForegroundColor Gray
        Download-Fast $msiUrl $msiDest
        Write-Host "      Installing Node.js..." -ForegroundColor Gray
        Start-Process msiexec.exe -ArgumentList "/i `"$msiDest`" /passive /norestart" -Wait
    }
    $env:Path = "$env:ProgramFiles\nodejs;$env:APPDATA\npm;" + $env:Path
}

$npmExe = "npm"
if (Test-Path "$env:ProgramFiles\nodejs\npm.cmd") {
    $npmExe = "$env:ProgramFiles\nodejs\npm.cmd"
}
if (Test-Path "$env:ProgramFiles\nodejs\node.exe") {
    $nodeExe = "$env:ProgramFiles\nodejs\node.exe"
} else {
    $nodeExe = "node"
}

Write-Host "      ✓ Node.js is ready: $(& $nodeExe -v)" -ForegroundColor Green

# 2. Check Python for Mark-LV Autonomous Engine
Write-Host "[2/6] Checking Python 3 environment..." -ForegroundColor Yellow
$pyCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pyCmd) {
    $pyCmd = Get-Command py -ErrorAction SilentlyContinue
}

if (-not $pyCmd) {
    Write-Host "      Python not detected. Installing Python 3.12 automatically via winget..." -ForegroundColor Cyan
    $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetCmd) {
        try {
            Start-Process winget -ArgumentList "install Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements" -Wait
        } catch {}
    }
}
$pyCmd = Get-Command python -ErrorAction SilentlyContinue
if ($pyCmd) {
    Write-Host "      ✓ Python is ready: $(python --version)" -ForegroundColor Green
} else {
    Write-Host "      ⚠ Python was not installed automatically. You can install Python from python.org to enable Mark-LV autonomous live engine." -ForegroundColor Gray
}

# 3. Download Mochi Ultra from GitHub
Write-Host "[3/6] Downloading Mochi Ultra from GitHub..." -ForegroundColor Yellow
$installFolder = "$env:USERPROFILE\Mochi-Ultra"
if (-not (Test-Path $installFolder)) {
    New-Item -ItemType Directory -Path $installFolder -Force | Out-Null
}

$zipUrl = "https://github.com/takayduo/Mochi-Ultra/archive/refs/heads/main.zip"
$zipFile = "$env:TEMP\MochiUltra_Latest.zip"
$extractTemp = "$env:TEMP\MochiUltra_Extract"

Download-Fast $zipUrl $zipFile

if (Test-Path $extractTemp) {
    Remove-Item -Recurse -Force $extractTemp
}
Expand-Archive -Path $zipFile -DestinationPath $extractTemp -Force

# Copy files into target folder
Copy-Item -Path "$extractTemp\Mochi-Ultra-main\*" -Destination $installFolder -Recurse -Force
Remove-Item -Recurse -Force $zipFile, $extractTemp

Write-Host "      ✓ Downloaded into $installFolder" -ForegroundColor Green

# 4. Install NPM Dependencies & Python Requirements
Write-Host "[4/6] Installing packages (npm install & pip)..." -ForegroundColor Yellow
Set-Location -Path $installFolder

if (Test-Path "$installFolder\package-lock.json") {
    Remove-Item -Force "$installFolder\package-lock.json" -ErrorAction SilentlyContinue
}

& $npmExe install

# Install Python requirements for Mark-LV engine if python is available
if ($pyCmd -and (Test-Path "$installFolder\engine\requirements.txt")) {
    Write-Host "      Installing Mark-LV engine Python dependencies..." -ForegroundColor Cyan
    try {
        & python -m pip install --upgrade pip --quiet
        & python -m pip install -r "$installFolder\engine\requirements.txt" --quiet
        Write-Host "      ✓ Python dependencies installed." -ForegroundColor Green
    } catch {
        Write-Host "      ⚠ Python dependency install encountered a note: $_" -ForegroundColor Gray
    }
}

# Ensure Electron binary is fully extracted (bypasses npm bug #4828 on clean Windows)
$electronDist = Join-Path $installFolder "node_modules\electron\dist"
$electronExe = Join-Path $electronDist "electron.exe"

if (-not (Test-Path $electronExe)) {
    Write-Host "      Configuring Electron binary..." -ForegroundColor Cyan
    $electronPkgPath = Join-Path $installFolder "node_modules\electron\package.json"
    if (Test-Path $electronPkgPath) {
        $electronPkg = Get-Content $electronPkgPath -Raw | ConvertFrom-Json
        $electronVersion = $electronPkg.version
    } else {
        $electronVersion = "44.5.1"
    }
    
    $electronZipUrl = "https://github.com/electron/electron/releases/download/v$electronVersion/electron-v$electronVersion-win32-x64.zip"
    $electronZipPath = "$env:TEMP\electron-v$electronVersion.zip"
    
    Write-Host "      Downloading Electron v$electronVersion (~150 MB)... please wait a moment." -ForegroundColor Cyan
    Download-Fast $electronZipUrl $electronZipPath $true
    
    Write-Host "      Extracting Electron files..." -ForegroundColor Gray
    if (-not (Test-Path $electronDist)) {
        New-Item -ItemType Directory -Path $electronDist -Force | Out-Null
    }
    Expand-Archive -Path $electronZipPath -DestinationPath $electronDist -Force
    Set-Content -Path (Join-Path $installFolder "node_modules\electron\path.txt") -Value "electron.exe" -NoNewline
    Remove-Item -Force $electronZipPath -ErrorAction SilentlyContinue
    Write-Host "      ✓ Electron binary ready: $electronExe" -ForegroundColor Green
}

# 5. Build Mochi Ultra
Write-Host "[5/6] Building application bundle (vite build)..." -ForegroundColor Yellow
if (Test-Path "$installFolder\node_modules\esbuild\install.js") {
    & $nodeExe "$installFolder\node_modules\esbuild\install.js" 2>$null
}
& $npmExe run build

# 6. Create Desktop Shortcut
Write-Host "[6/6] Creating Desktop Shortcut..." -ForegroundColor Yellow
$desktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
$shortcutPath = Join-Path $desktopPath "Mochi Ultra.lnk"
$electronExe = Join-Path $installFolder "node_modules\electron\dist\electron.exe"

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)

if (Test-Path $electronExe) {
    $shortcut.TargetPath = $electronExe
    $shortcut.Arguments = "."
} else {
    $shortcut.TargetPath = "cmd.exe"
    $shortcut.Arguments = "/c `"$installFolder\Launch Mochi Ultra.bat`""
}

$shortcut.WorkingDirectory = $installFolder
$iconFile = Join-Path $installFolder "public\icons\icon.ico"
if (Test-Path $iconFile) {
    $shortcut.IconLocation = "$iconFile,0"
}
$shortcut.Description = "Mochi Ultra — AI Desktop Companion with Autonomous PC Control Engine"
$shortcut.Save()

Write-Host "      ✓ Desktop shortcut created: $shortcutPath" -ForegroundColor Green

Write-Host ""
Write-Host "===================================================" -ForegroundColor Green
Write-Host "   🎉 SUCCESS: Mochi Ultra is installed and ready! " -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Launching Mochi Ultra now..." -ForegroundColor Cyan

if (Test-Path $electronExe) {
    Start-Process -FilePath $electronExe -ArgumentList "." -WorkingDirectory $installFolder
} else {
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$installFolder\Launch Mochi Ultra.bat`"" -WindowStyle Hidden
}
