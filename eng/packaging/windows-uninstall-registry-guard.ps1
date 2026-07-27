[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Snapshot', 'Observe', 'Cleanup')]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$InstallRoot,

  [Parameter(Mandatory = $true)]
  [string]$StatePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-Sha256 {
  param([Parameter(Mandatory = $true)][string]$Value)

  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    return ([Convert]::ToHexString($algorithm.ComputeHash($bytes))).ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
  }
}

function Resolve-BoundedPaths {
  if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
    throw 'Windows uninstall Registry guard requires RUNNER_TEMP.'
  }
  if ($env:GITHUB_RUN_ID -notmatch '^[1-9][0-9]{0,19}$' `
    -or $env:GITHUB_RUN_ATTEMPT -notmatch '^[1-9][0-9]{0,9}$') {
    throw 'Windows uninstall Registry guard requires bounded GitHub run identity.'
  }
  $runnerTemp = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
  $resolvedInstallRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
  $resolvedStatePath = [IO.Path]::GetFullPath($StatePath)
  $expectedLeaf = "pi67-native-install-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"
  $expectedStateLeaf = "$expectedLeaf-uninstall-registry.json"

  if (-not ($resolvedInstallRoot + '\').StartsWith($runnerTemp, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Windows uninstall Registry guard install root escaped RUNNER_TEMP.'
  }
  if ([IO.Path]::GetFileName($resolvedInstallRoot) -ne $expectedLeaf) {
    throw 'Windows uninstall Registry guard install root identity is invalid.'
  }
  if (-not $resolvedStatePath.StartsWith($runnerTemp, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Windows uninstall Registry guard state escaped RUNNER_TEMP.'
  }
  if ([IO.Path]::GetFileName($resolvedStatePath) -ne $expectedStateLeaf) {
    throw 'Windows uninstall Registry guard state identity is invalid.'
  }

  return [pscustomobject]@{
    InstallRoot = $resolvedInstallRoot
    InstallRootHash = (Get-Sha256 ($resolvedInstallRoot.ToUpperInvariant()))
    StatePath = $resolvedStatePath
  }
}

function Resolve-InstallLocation {
  param([AllowNull()][object]$Value)

  if ($Value -isnot [string] -or [string]::IsNullOrWhiteSpace($Value)) { return $null }
  if ($Value -match '[\x00-\x1F\x7F]') { return $null }
  try {
    return [IO.Path]::GetFullPath($Value).TrimEnd('\')
  } catch {
    return $null
  }
}

function Get-RegistryLocations {
  return @(
    [pscustomobject]@{
      Hive = [Microsoft.Win32.RegistryHive]::CurrentUser
      HiveIdentity = 'HKCU'
      View = [Microsoft.Win32.RegistryView]::Registry64
      ViewIdentity = 'Registry64'
    },
    [pscustomobject]@{
      Hive = [Microsoft.Win32.RegistryHive]::CurrentUser
      HiveIdentity = 'HKCU'
      View = [Microsoft.Win32.RegistryView]::Registry32
      ViewIdentity = 'Registry32'
    },
    [pscustomobject]@{
      Hive = [Microsoft.Win32.RegistryHive]::LocalMachine
      HiveIdentity = 'HKLM'
      View = [Microsoft.Win32.RegistryView]::Registry64
      ViewIdentity = 'Registry64'
    },
    [pscustomobject]@{
      Hive = [Microsoft.Win32.RegistryHive]::LocalMachine
      HiveIdentity = 'HKLM'
      View = [Microsoft.Win32.RegistryView]::Registry32
      ViewIdentity = 'Registry32'
    }
  )
}

function Get-UninstallEntries {
  $entries = [Collections.Generic.List[object]]::new()
  foreach ($location in (Get-RegistryLocations)) {
    $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey($location.Hive, $location.View)
    try {
      $uninstallKey = $baseKey.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall', $false)
      if ($null -eq $uninstallKey) { continue }
      try {
        foreach ($subKeyName in $uninstallKey.GetSubKeyNames()) {
          $entryKey = $uninstallKey.OpenSubKey($subKeyName, $false)
          if ($null -eq $entryKey) { continue }
          try {
            $rawLocation = $entryKey.GetValue(
              'InstallLocation',
              $null,
              [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
            )
            $resolvedLocation = Resolve-InstallLocation $rawLocation
            $identitySource = "$($location.HiveIdentity)|$($location.ViewIdentity)|$subKeyName"
            $entries.Add([pscustomobject]@{
              Hive = $location.Hive
              View = $location.View
              SubKeyName = $subKeyName
              InstallLocation = $resolvedLocation
              Identity = "$($location.HiveIdentity):$($location.ViewIdentity):$(Get-Sha256 $identitySource)"
            })
          } finally {
            $entryKey.Dispose()
          }
        }
      } finally {
        $uninstallKey.Dispose()
      }
    } finally {
      $baseKey.Dispose()
    }
  }
  return @($entries | Sort-Object -Property Identity -Unique)
}

function Get-ExactInstallEntries {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Entries,
    [Parameter(Mandatory = $true)][string]$ExpectedInstallRoot
  )

  return @($Entries | Where-Object {
    $null -ne $_.InstallLocation -and $_.InstallLocation.Equals(
      $ExpectedInstallRoot,
      [StringComparison]::OrdinalIgnoreCase
    )
  })
}

function Get-EntriesByIdentity {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Entries,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Identities
  )

  $expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($identity in $Identities) { [void]$expected.Add($identity) }
  return @($Entries | Where-Object { $expected.Contains($_.Identity) })
}

function Read-GuardState {
  param([Parameter(Mandatory = $true)][object]$Paths)

  if (-not (Test-Path -LiteralPath $Paths.StatePath -PathType Leaf)) {
    throw 'Windows uninstall Registry guard state is missing.'
  }
  $state = Get-Content -LiteralPath $Paths.StatePath -Raw | ConvertFrom-Json
  if ($state.schemaVersion -ne 1 -or $state.installRootHash -ne $Paths.InstallRootHash) {
    throw 'Windows uninstall Registry guard state does not match this bounded install root.'
  }
  return $state
}

function Write-GuardState {
  param(
    [Parameter(Mandatory = $true)][object]$Paths,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$BaselineEntryIdentities,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$ObservedNewEntryIdentities
  )

  $state = [ordered]@{
    schemaVersion = 1
    installRootHash = $Paths.InstallRootHash
    baselineEntryIdentities = @($BaselineEntryIdentities | Sort-Object -Unique)
    observedNewEntryIdentities = @($ObservedNewEntryIdentities | Sort-Object -Unique)
  }
  $state | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $Paths.StatePath -Encoding utf8NoBOM
}

function Get-NewEntries {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Entries,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$BaselineEntryIdentities
  )

  $baseline = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($identity in $BaselineEntryIdentities) { [void]$baseline.Add($identity) }
  return @($Entries | Where-Object { -not $baseline.Contains($_.Identity) })
}

function Remove-ExactEntry {
  param(
    [Parameter(Mandatory = $true)][object]$Entry,
    [Parameter(Mandatory = $true)][string]$ExpectedInstallRoot
  )

  $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey($Entry.Hive, $Entry.View)
  try {
    $uninstallKey = $baseKey.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall', $true)
    if ($null -eq $uninstallKey) { return }
    try {
      $entryKey = $uninstallKey.OpenSubKey($Entry.SubKeyName, $false)
      if ($null -eq $entryKey) { return }
      try {
        $rawLocation = $entryKey.GetValue(
          'InstallLocation',
          $null,
          [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
        )
        $currentLocation = Resolve-InstallLocation $rawLocation
      } finally {
        $entryKey.Dispose()
      }
      if ($null -eq $currentLocation -or -not $currentLocation.Equals(
        $ExpectedInstallRoot,
        [StringComparison]::OrdinalIgnoreCase
      )) {
        throw "Refusing to remove uninstall Registry entry whose InstallLocation changed: $($Entry.Identity)."
      }
      $uninstallKey.DeleteSubKeyTree($Entry.SubKeyName, $false)
    } finally {
      $uninstallKey.Dispose()
    }
  } finally {
    $baseKey.Dispose()
  }
}

$paths = Resolve-BoundedPaths

if ($Action -eq 'Snapshot') {
  $allEntries = @(Get-UninstallEntries)
  $baselineEntries = @(Get-ExactInstallEntries $allEntries $paths.InstallRoot)
  $baselineIdentities = @($baselineEntries | ForEach-Object { $_.Identity })
  Write-GuardState $paths $baselineIdentities @()
  if ($baselineIdentities.Count -gt 0) {
    throw "Bounded Windows install root already has uninstall Registry entries: $($baselineIdentities -join ', ')."
  }
  Write-Output 'Windows uninstall Registry baseline contains no entry for the bounded install root.'
  exit 0
}

if (-not (Test-Path -LiteralPath $paths.StatePath -PathType Leaf)) {
  if ($Action -eq 'Cleanup') {
    Write-Output 'Windows uninstall Registry cleanup was not initialized; no Registry entry is authorized for removal.'
    exit 0
  }
  throw 'Windows uninstall Registry guard state is missing.'
}

$state = Read-GuardState $paths
$baselineIdentities = @($state.baselineEntryIdentities)
$observedNewEntryIdentities = @($state.observedNewEntryIdentities)
$allCurrentEntries = @(Get-UninstallEntries)
$currentEntries = @(Get-ExactInstallEntries $allCurrentEntries $paths.InstallRoot)
$newEntries = @(Get-NewEntries $currentEntries $baselineIdentities)
$newIdentities = @($newEntries | ForEach-Object { $_.Identity })

if ($Action -eq 'Observe') {
  Write-GuardState $paths $baselineIdentities $newIdentities
  if ($newIdentities.Count -eq 0) {
    throw 'Installed Windows candidate did not create an uninstall Registry entry bound to the exact install root.'
  }
  Write-Output "Observed bounded Windows uninstall Registry entry identities: $($newIdentities -join ', ')."
  exit 0
}

$cleanupFailure = $null
try {
  $observedEntries = @(Get-EntriesByIdentity $allCurrentEntries $observedNewEntryIdentities)
  $changedObservedEntries = @($observedEntries | Where-Object {
    $null -eq $_.InstallLocation -or -not $_.InstallLocation.Equals(
      $paths.InstallRoot,
      [StringComparison]::OrdinalIgnoreCase
    )
  })
  $changedObservedIdentities = @($changedObservedEntries | ForEach-Object { $_.Identity })
  if ($changedObservedIdentities.Count -gt 0) {
    $cleanupFailure = "Observed uninstall Registry entries changed InstallLocation and were not removed: $($changedObservedIdentities -join ', ')."
  }
  foreach ($entry in $newEntries) {
    Remove-ExactEntry $entry $paths.InstallRoot
  }
  $remainingAllEntries = @(Get-UninstallEntries)
  $remainingEntries = @(Get-ExactInstallEntries $remainingAllEntries $paths.InstallRoot)
  $remainingNewEntries = @(Get-NewEntries $remainingEntries $baselineIdentities)
  $remainingIdentities = @($remainingNewEntries | ForEach-Object { $_.Identity })
  if ($remainingIdentities.Count -gt 0) {
    throw "Failed to remove bounded uninstall Registry entry identities: $($remainingIdentities -join ', ')."
  }
  if ($newIdentities.Count -gt 0 -and $null -eq $cleanupFailure) {
    $cleanupFailure = "Windows candidate cleanup left uninstall Registry entries; exact bounded entries were removed: $($newIdentities -join ', ')."
  }
} finally {
  Remove-Item -LiteralPath $paths.StatePath -Force -ErrorAction SilentlyContinue
}

if ($null -ne $cleanupFailure) { throw $cleanupFailure }
Write-Output 'Windows uninstall Registry cleanup verified no new entry for the bounded install root.'
