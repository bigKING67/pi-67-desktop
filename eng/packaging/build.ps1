[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",
    [string]$OutputRoot = (Join-Path $PSScriptRoot "../../artifacts")
)

$ErrorActionPreference = "Stop"
$repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
$artifacts = [System.IO.Path]::GetFullPath($OutputRoot)
$appOutput = Join-Path $artifacts "app/win-x64"
$bootstrapOutput = Join-Path $artifacts "runtime-bootstrap"
$releaseOutput = Join-Path $artifacts "release"
$versionSource = Join-Path $repo "eng/version.json"
$version = Get-Content -LiteralPath $versionSource -Raw | ConvertFrom-Json
$expectedMsiName = "Pi67-Desktop-$($version.semver)-win-x64.msi"
$expectedBundleName = "Pi67-Desktop-Setup-$($version.semver)-win-x64.exe"

New-Item -ItemType Directory -Force -Path $appOutput, $bootstrapOutput, $releaseOutput | Out-Null
Get-ChildItem -LiteralPath $releaseOutput -Force | Remove-Item -Recurse -Force

& node (Join-Path $repo "eng/version/verify-version.mjs")
if ($LASTEXITCODE -ne 0) { throw "Version projection verification failed." }

& dotnet publish (Join-Path $repo "src/Pi67.Desktop.App/Pi67.Desktop.App.csproj") `
    --configuration $Configuration --runtime win-x64 --no-restore --output $appOutput
if ($LASTEXITCODE -ne 0) { throw "App publish failed." }

& dotnet publish (Join-Path $repo "installer/Pi67.Desktop.RuntimeBootstrap/Pi67.Desktop.RuntimeBootstrap.csproj") `
    --configuration $Configuration --runtime win-x64 --no-restore --output $bootstrapOutput
if ($LASTEXITCODE -ne 0) { throw "Runtime bootstrap publish failed." }

$dotnetInstaller = & (Join-Path $PSScriptRoot "prepare-prerequisites.ps1") `
    -OutputDirectory (Join-Path $artifacts "prerequisites")

& dotnet build (Join-Path $repo "installer/Pi67.Desktop.Msi/Pi67.Desktop.Msi.wixproj") `
    --configuration $Configuration --no-restore `
    "-p:AppPublishDir=$appOutput"
if ($LASTEXITCODE -ne 0) { throw "MSI build failed." }

$msiCandidates = @(Get-ChildItem -LiteralPath (Join-Path $artifacts "installer/msi") -Filter $expectedMsiName -Recurse)
if ($msiCandidates.Count -ne 1) { throw "Expected exactly one MSI named $expectedMsiName; found $($msiCandidates.Count)." }
$msi = $msiCandidates[0]

$runtimeBootstrap = Join-Path $bootstrapOutput "Pi67.Desktop.RuntimeBootstrap.exe"
$windowsAppRuntime = Join-Path $repo ".nuget/packages/microsoft.windowsappsdk.runtime/2.3.1/tools/MSIX/win10-x64"
& dotnet build (Join-Path $repo "installer/Pi67.Desktop.Bundle/Pi67.Desktop.Bundle.wixproj") `
    --configuration $Configuration --no-restore `
    "-p:MsiPath=$($msi.FullName)" `
    "-p:DotNetDesktopRuntimeInstaller=$dotnetInstaller" `
    "-p:RuntimeBootstrapExe=$runtimeBootstrap" `
    "-p:WindowsAppRuntimeDir=$windowsAppRuntime"
if ($LASTEXITCODE -ne 0) { throw "Burn bundle build failed." }

$bundleCandidates = @(Get-ChildItem -LiteralPath (Join-Path $artifacts "installer/bundle") -Filter $expectedBundleName -Recurse)
if ($bundleCandidates.Count -ne 1) { throw "Expected exactly one bundle named $expectedBundleName; found $($bundleCandidates.Count)." }
$bundle = $bundleCandidates[0]

Copy-Item -LiteralPath $msi.FullName -Destination $releaseOutput -Force
Copy-Item -LiteralPath $bundle.FullName -Destination $releaseOutput -Force
Copy-Item -LiteralPath (Join-Path $repo "eng/compatibility/compatibility.json") -Destination $releaseOutput -Force
Copy-Item -LiteralPath (Join-Path $repo "eng/packaging/bootstrap-inventory.json") -Destination $releaseOutput -Force

Write-Output $releaseOutput
