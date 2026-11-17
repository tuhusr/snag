# Builds the Snag installer and a zip of it.
#   .\release.ps1                          build only     (dist\Snag-Setup-<v>.exe + dist\Snag-<v>.zip)
#   .\release.ps1 -Publish [-Notes "..."]  build + publish to GitHub Releases, so installed copies offer the update
param([switch]$Publish, [string]$Notes = '')
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$tag = "v$version"

if ($Publish) {
  if (-not (gh auth token)) { throw 'Not signed in to GitHub. Run: gh auth login' }
  if (git status --porcelain) { throw 'Commit your changes first, so the release matches the code.' }
  $existing = @(gh release list --limit 200 --json tagName --jq '.[].tagName')
  if ($existing -contains $tag) { throw "Release $tag already exists. Raise the version in package.json first." }
}

# Build only; uploading is done below in one step (electron-builder's own uploader can race itself).
npx electron-builder --win nsis --publish never
if ($LASTEXITCODE) { throw "electron-builder failed ($LASTEXITCODE)" }

$exe = "dist\Snag-Setup-$version.exe"
$zip = "dist\Snag-$version.zip"
Compress-Archive -Force -Path $exe -DestinationPath $zip
Write-Host "Built $exe and $zip"

if ($Publish) {
  # GitHub only publishes a release for a tag that already exists on the remote.
  if (-not (git tag --list $tag)) { git tag $tag }
  git push origin HEAD $tag
  if ($LASTEXITCODE) { throw 'Could not push to GitHub.' }
  if (-not $Notes) { $Notes = "Snag $version. Download Snag-Setup-$version.exe and run it. Installed copies update themselves." }
  # latest.yml + blockmap are what installed copies read to find and download the update.
  gh release create $tag $exe "$exe.blockmap" 'dist\latest.yml' $zip --title "Snag $version" --notes $Notes --verify-tag
  if ($LASTEXITCODE) { throw 'Could not create the GitHub release.' }
  Write-Host "Published $tag"
}
