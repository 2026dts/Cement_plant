param(
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Dashboard = Join-Path $Root "dashboard-frontend"
$Widget = Join-Path $Root "widget-frontend"
$Processes = @()

function Ensure-Dependencies {
    param([string]$Path)

    if (-not (Test-Path (Join-Path $Path "node_modules"))) {
        Write-Host "Installing dependencies in $Path..." -ForegroundColor Yellow
        Push-Location $Path
        try {
            & npm.cmd install
            if ($LASTEXITCODE -ne 0) {
                throw "npm install failed in $Path"
            }
        }
        finally {
            Pop-Location
        }
    }
}

function Assert-PortAvailable {
    param([int]$Port)

    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if ($listener) {
        throw "Port $Port is already in use. Stop the existing service using this port, then run start.ps1 again."
    }
}

function Start-ServiceProcess {
    param(
        [string]$Path,
        [string]$Command,
        [string[]]$Arguments
    )

    $process = Start-Process `
        -FilePath $Command `
        -ArgumentList $Arguments `
        -WorkingDirectory $Path `
        -NoNewWindow `
        -PassThru

    $script:Processes += $process
    return $process
}

try {
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        throw "Node.js is required. Install Node.js LTS and run this script again."
    }

    if (-not $SkipInstall) {
        Ensure-Dependencies $Backend
        Ensure-Dependencies $Dashboard
    }

    Assert-PortAvailable 4000
    Assert-PortAvailable 4173
    Assert-PortAvailable 5173

    Write-Host "Starting cement plant services..." -ForegroundColor Cyan
    Start-ServiceProcess $Backend "npm.cmd" @("run", "dev") | Out-Null
    Start-ServiceProcess $Dashboard "npm.cmd" @("run", "dev") | Out-Null
    Start-ServiceProcess $Widget "npx.cmd" @("--yes", "serve", ".", "-l", "4173") | Out-Null

    Write-Host "Dashboard: http://localhost:5173" -ForegroundColor Green
    Write-Host "Widget:    http://localhost:4173/widget.html?id=iron_ore" -ForegroundColor Green
    Write-Host "Backend:   http://localhost:4000/api/items" -ForegroundColor Green
    Write-Host "Press Ctrl+C to stop all services." -ForegroundColor Yellow

    while ($true) {
        $running = @($Processes | Where-Object { -not $_.HasExited })
        if ($running.Count -eq 0) {
            break
        }
        Wait-Process -Id $running[0].Id -Timeout 1 -ErrorAction SilentlyContinue
    }
}
finally {
    foreach ($process in $Processes) {
        if (-not $process.HasExited) {
            & taskkill.exe /PID $process.Id /T /F | Out-Null
        }
    }
}