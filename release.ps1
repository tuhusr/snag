# Builds the Snag installer and a zip of it.
#   .\release.ps1            build only            (dist\Snag-Setup-<v>.exe + dist\Snag-<v>.zip)
#   .\release.ps1 -Publish   build + publish to GitHub Releases, so installed copies offer the update
param([switch]$Publish)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
if ($Publish) {
  $env:GH_TOKEN = (gh auth token)
  if (-not $env:GH_TOKEN) { throw 'Not signed in to GitHub. Run: gh auth login' }
  npx electron-builder --win nsis --publish always
} else {
  npx electron-builder --win nsis --publish never
}
if ($LASTEXITCODE) { throw "electron-builder failed ($LASTEXITCODE)" }

$zip = "dist\Snag-$version.zip"
Compress-Archive -Force -Path "dist\Snag-Setup-$version.exe" -DestinationPath $zip
Write-Host "Done: dist\Snag-Setup-$version.exe and $zip"
