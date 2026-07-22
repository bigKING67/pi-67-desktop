[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot "../../artifacts/prerequisites")
)

$ErrorActionPreference = "Stop"
$manifestPath = Join-Path $PSScriptRoot "bootstrap-inventory.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$runtime = $manifest.installerPrerequisites.dotnetDesktopRuntime
$output = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $output | Out-Null
$destination = Join-Path $output $runtime.fileName

function Assert-ExpectedHash([string]$Path) {
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA512).Hash.ToLowerInvariant()
    if ($actual -ne $runtime.sha512) {
        throw "SHA-512 mismatch for $Path. Expected $($runtime.sha512), got $actual."
    }
}

if (Test-Path -LiteralPath $destination) {
    Assert-ExpectedHash $destination
    Write-Output $destination
    exit 0
}

$temporary = "$destination.partial"
try {
    Invoke-WebRequest -Uri $runtime.url -OutFile $temporary -UseBasicParsing
    Assert-ExpectedHash $temporary
    Move-Item -LiteralPath $temporary -Destination $destination
}
finally {
    if (Test-Path -LiteralPath $temporary) {
        Remove-Item -LiteralPath $temporary -Force
    }
}

Write-Output $destination
