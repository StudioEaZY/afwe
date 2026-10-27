# AFWE PowerShell Demo
#   Part 1: Read-only tour of shipped demo project.
#   Part 2: Turn protocol on a throw-away git copy (begin -> assume -> commit, REDO, and fix).
#   Part 3: Cross-module caller severance (SEVERED_CAPABILITY), dead-on-arrival exports, and history.
# Usage:  .\scripts\demo.ps1
#         $env:AFWE="target\release\afwe.exe"; .\scripts\demo.ps1

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$AfweCmd = if ($env:AFWE) {
    $env:AFWE
} elseif (Get-Command afwe -ErrorAction SilentlyContinue) {
    "afwe"
} elseif (Test-Path (Join-Path $RepoRoot "target\debug\afwe.exe")) {
    Join-Path $RepoRoot "target\debug\afwe.exe"
} elseif (Test-Path (Join-Path $RepoRoot "target\release\afwe.exe")) {
    Join-Path $RepoRoot "target\release\afwe.exe"
} else {
    "afwe"
}

function Run-Cmd {
    param([string]$Command, [string[]]$Arguments)
    Write-Host "`n$ $Command $($Arguments -join ' ')" -ForegroundColor Cyan
    & $Command $Arguments
}

function Step-Header {
    param([string]$Title)
    Write-Host "`n====================================================================" -ForegroundColor Yellow
    Write-Host $Title -ForegroundColor Yellow
    Write-Host "====================================================================" -ForegroundColor Yellow
}

Step-Header "1. The shipped demo — read-only tour"
$DemoDir = Join-Path $RepoRoot "examples\demo-project"
Push-Location $DemoDir
try {
    Run-Cmd $AfweCmd @("status")
    Run-Cmd $AfweCmd @("pin", "list")
    Run-Cmd $AfweCmd @("intent", "list")
    try {
        & $AfweCmd verify --no-commands
    } catch {
        Write-Host "(exit code expected: the demo contains deliberate violations)" -ForegroundColor DarkGray
    }
} finally {
    Pop-Location
}

Step-Header "2. The turn protocol on a throw-away git copy"
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("afwe-demo-" + [System.Guid]::NewGuid().ToString().Substring(0,8))
$WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ("afwe-work-" + [System.Guid]::NewGuid().ToString().Substring(0,8))
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null

Copy-Item -Path "$DemoDir\*" -Destination $TempDir -Recurse -Force
Push-Location $TempDir

try {
    git init -q
    git add -A
    git -c user.name=demo -c user.email=demo@example.com commit -qm "demo baseline"

    # Turn t0001
    Run-Cmd $AfweCmd @("turn", "begin", "Add a charge helper to payments", "--target", "payments")
    $Assume1 = @{
        intents = @(
            @{ id = "charge2"; action = "create"; targets = @("payments"); title = "Charge helper" }
        )
        assumptions = @(
            @{
                id = "no-debugger"
                text = "the new charge code has no debugger statements"
                claim = @{ type = "forbid_pattern"; pattern = "debugger"; files = @("src/payments/charge.ts") }
            }
        )
    } | ConvertTo-Json -Depth 5
    $Assume1Path = Join-Path $WorkDir "assume-1.json"
    [System.IO.File]::WriteAllText($Assume1Path, $Assume1)
    Run-Cmd $AfweCmd @("turn", "assume", "t0001", "--file", $Assume1Path)
    [System.IO.File]::WriteAllText((Join-Path $TempDir "src\payments\charge.ts"), "export function charge2(amount: number) { return amount * 2 }`n")
    Run-Cmd $AfweCmd @("turn", "commit", "t0001", "--summary", "Add charge2 helper")

    # Turn t0002 — Forbidden import boundary (REDO) then fixed
    Run-Cmd $AfweCmd @("turn", "begin", "Let the checkout show the button", "--target", "payments")
    $Assume2 = @{
        intents = @(
            @{ id = "checkout-button"; action = "update"; targets = @("payments") }
        )
    } | ConvertTo-Json -Depth 5
    $Assume2Path = Join-Path $WorkDir "assume-2.json"
    [System.IO.File]::WriteAllText($Assume2Path, $Assume2)
    Run-Cmd $AfweCmd @("turn", "assume", "t0002", "--file", $Assume2Path)

    # Attempt 1: UI import in payments -> REDO
    $BadCheckout = "import { User } from '../identity/user';`nimport { Button } from '../ui/Button';`nexport function checkout(user: User) { return Button; }`n"
    [System.IO.File]::WriteAllText((Join-Path $TempDir "src\payments\checkout.ts"), $BadCheckout)
    try {
        & $AfweCmd turn commit t0002
    } catch {
        Write-Host "(REDO expected: forbidden UI import in payments rejected)" -ForegroundColor DarkGray
    }

    # Fix: Clean import
    $GoodCheckout = "import { User } from '../identity/user';`nimport { charge2 } from './charge';`nexport function checkout(user: User) { return charge2(10); }`n"
    [System.IO.File]::WriteAllText((Join-Path $TempDir "src\payments\checkout.ts"), $GoodCheckout)
    Run-Cmd $AfweCmd @("turn", "commit", "t0002", "--summary", "Checkout uses charge2 (no UI, clean boundary)")

    Step-Header "3. Cross-boundary capability ratchet: severed callers (The t0022 bug catcher)"
    Run-Cmd $AfweCmd @("turn", "begin", "Refactor checkout without calling charge2", "--target", "payments")
    $Assume3 = @{
        intents = @(
            @{ id = "decouple-charge"; action = "update"; targets = @("payments") }
        )
    } | ConvertTo-Json -Depth 5
    $Assume3Path = Join-Path $WorkDir "assume-3.json"
    [System.IO.File]::WriteAllText($Assume3Path, $Assume3)
    Run-Cmd $AfweCmd @("turn", "assume", "t0003", "--file", $Assume3Path)

    # Remove caller in checkout.ts; charge.ts is UNTOUCHED!
    $DecoupledCheckout = "import { User } from '../identity/user';`nexport function checkout(user: User) { return 42; }`n"
    [System.IO.File]::WriteAllText((Join-Path $TempDir "src\payments\checkout.ts"), $DecoupledCheckout)
    try {
        & $AfweCmd turn commit t0003
    } catch {
        Write-Host "(SEVERED_CAPABILITY intercepted: callee went dead in untouched file)" -ForegroundColor Green
    }

    # Fix: Declare deprecation/replacement in turn assume!
    $Assume3Fixed = @{
        intents = @(
            @{ id = "decouple-charge"; action = "update"; targets = @("payments") },
            @{ id = "deprecate-charge2"; action = "replace"; targets = @("src/payments/charge.ts") }
        )
    } | ConvertTo-Json -Depth 5
    $Assume3FixedPath = Join-Path $WorkDir "assume-3-fixed.json"
    [System.IO.File]::WriteAllText($Assume3FixedPath, $Assume3Fixed)
    Run-Cmd $AfweCmd @("turn", "assume", "t0003", "--file", $Assume3FixedPath)
    Run-Cmd $AfweCmd @("turn", "commit", "t0003", "--summary", "Decoupled charge2 with explicit replacement declaration")

    Step-Header "4. Dead-on-arrival capability detection"
    Run-Cmd $AfweCmd @("turn", "begin", "Add uncalled zombie helper", "--target", "payments")
    $Assume4 = @{
        intents = @(
            @{ id = "touch-checkout"; action = "update"; targets = @("payments") }
        )
    } | ConvertTo-Json -Depth 5
    $Assume4Path = Join-Path $WorkDir "assume-4.json"
    [System.IO.File]::WriteAllText($Assume4Path, $Assume4)
    Run-Cmd $AfweCmd @("turn", "assume", "t0004", "--file", $Assume4Path)

    # Introduce new uncalled export with 0 references
    $ZombieCheckout = "import { User } from '../identity/user';`nexport function checkout(user: User) { return 42; }`nexport function zombieFunction(x: number) { return x * 999; }`n"
    [System.IO.File]::WriteAllText((Join-Path $TempDir "src\payments\checkout.ts"), $ZombieCheckout)
    try {
        & $AfweCmd turn commit t0004
    } catch {
        Write-Host "(DEAD_ON_ARRIVAL intercepted: new export born with 0 callers)" -ForegroundColor Green
    }

    Step-Header "5. What the history now says"
    Run-Cmd $AfweCmd @("timeline")
    Run-Cmd $AfweCmd @("timeline", "losses")
    Run-Cmd $AfweCmd @("board")
    git log --format="%h %s%n    %b" -4

    Write-Host "`nThe throw-away repository is at: $TempDir" -ForegroundColor Cyan
    Write-Host "Open the Studio on the shipped demo with: cd examples\demo-project; $AfweCmd studio" -ForegroundColor Green
} finally {
    Pop-Location
}
