# Builds signed installers and generates latest.json for the auto-updater.
# Usage:  .\scripts\release.ps1            (uses default repo)
#         .\scripts\release.ps1 -Repo "username/nimbus"
param(
    [string]$Repo = "tumasov69/nimbus",
    [string]$KeyPath = "$env:USERPROFILE\.tauri\nimbus_updater.key",
    # Updater key password — taken from the NIMBUS_KEY_PASSWORD env var so it
    # is never stored in source. Falls back to empty.
    [string]$KeyPassword = $env:NIMBUS_KEY_PASSWORD
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $KeyPath -Raw)
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $KeyPassword

npm run tauri build
if ($LASTEXITCODE -ne 0) { throw "build failed" }

$conf = Get-Content "src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json
$version = $conf.version
$nsisDir = "src-tauri\target\release\bundle\nsis"
# Match the current version exactly — older builds may still sit in the dir.
$setup = Get-ChildItem $nsisDir -Filter "*_${version}_*-setup.exe" | Select-Object -First 1
$sig = Get-ChildItem $nsisDir -Filter "*_${version}_*-setup.exe.sig" | Select-Object -First 1
if (-not $setup) { throw "setup.exe for version $version not found" }
if (-not $sig) { throw "signature (.sig) not found - check signing key env vars" }

$latest = [ordered]@{
    version  = $version
    pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = @{
        "windows-x86_64" = @{
            # ReadAllText: plain string without PowerShell ETS properties,
            # which ConvertTo-Json would otherwise serialize as an object.
            signature = [System.IO.File]::ReadAllText($sig.FullName).Trim()
            url = "https://github.com/$Repo/releases/download/v$version/$($setup.Name)"
        }
    }
}
$json = $latest | ConvertTo-Json -Depth 5
# UTF-8 without BOM: the updater's JSON parser rejects a BOM.
$latestPath = Join-Path (Resolve-Path $nsisDir) "latest.json"
[System.IO.File]::WriteAllText($latestPath, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "=== Release v$version ready ===" -ForegroundColor Green

# Publish to GitHub automatically when gh CLI and a token are available.
$tokenFile = "$env:USERPROFILE\.tauri\nimbus_github.token"
$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh -and (Test-Path $tokenFile)) {
    $env:GH_TOKEN = [System.IO.File]::ReadAllText($tokenFile).Trim()

    # Release notes: section for this version from RELEASE_NOTES.md, if present.
    $notesArgs = @("--generate-notes")
    $notesFile = "RELEASE_NOTES.md"
    if (Test-Path $notesFile) {
        # ReadAllText honours the UTF-8 BOM/encoding; Get-Content -Raw would
        # misread UTF-8 as the system ANSI codepage (mojibake on RU Windows).
        $all = [System.IO.File]::ReadAllText((Resolve-Path $notesFile))
        $pattern = "(?ms)^##\s*v?$([regex]::Escape($version))\b.*?(?=^##\s|\z)"
        $m = [regex]::Match($all, $pattern)
        if ($m.Success) {
            $tmp = Join-Path $env:TEMP "nimbus_notes_$version.md"
            [System.IO.File]::WriteAllText($tmp, $m.Value.Trim(), (New-Object System.Text.UTF8Encoding($false)))
            $notesArgs = @("--notes-file", $tmp)
        }
    }

    gh release create "v$version" $setup.FullName $sig.FullName $latestPath `
        --repo $Repo --title "Nimbus $version" @notesArgs
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Published: https://github.com/$Repo/releases/tag/v$version" -ForegroundColor Green

        # Keep only the latest release: delete older ones (and their tags).
        $tags = gh release list --repo $Repo --json tagName -q '.[].tagName'
        foreach ($tag in $tags) {
            if ($tag -and $tag -ne "v$version") {
                Write-Host "Removing old release $tag"
                gh release delete $tag --repo $Repo --cleanup-tag --yes 2>$null
            }
        }
    } else {
        Write-Host "gh release create failed - upload manually:" -ForegroundColor Yellow
        Write-Host "  $($setup.FullName)"
        Write-Host "  $($sig.FullName)"
        Write-Host "  $latestPath"
    }
} else {
    Write-Host "Upload these files to GitHub release tag v${version}:"
    Write-Host "  1. $($setup.FullName)"
    Write-Host "  2. $($sig.FullName)"
    Write-Host "  3. $latestPath"
}
Write-Host "MSI for manual distribution: src-tauri\target\release\bundle\msi\"
