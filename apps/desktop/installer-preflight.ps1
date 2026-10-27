param(
    [Parameter(Mandatory=$true)][string]$InstallDirectory,
    [ValidateSet('update','uninstall')][string]$Mode = 'update',
    [ValidateRange(0,4096)][int]$MaxRelativePathLength = 0
)
$ErrorActionPreference = 'Stop'

function Assert-PersonalDirectory([string]$Directory) {
    $full = [IO.Path]::GetFullPath($Directory)
    $current = $full
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'redirected installation' }
        }
        $parent = Split-Path -Parent $current
        if ($parent -eq $current) { break }
        $current = $parent
    }
    $manifest = Join-Path $full 'resources\desktop-release.json'
    if ((Test-Path -LiteralPath (Join-Path $full 'AEGIS Agent Ops.exe')) -and -not (Test-Path -LiteralPath $manifest)) { throw 'unknown existing installation' }
    if (Test-Path -LiteralPath $manifest) {
        $file = Get-Item -LiteralPath $manifest -Force
        if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $file.Length -gt 4194304) { throw 'invalid release' }
        $release = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($release.schema -cne 'btk.desktop.release.v1' -or $release.channel -cne 'local-preview' -or $release.harness_required -or $release.harness_runtime -or $release.development_updates) { throw 'different installation family' }
    }
    if (Test-Path -LiteralPath (Join-Path $full 'resources\harness-runtime')) { throw 'enterprise runtime present' }
    foreach ($name in @('harness-runtime.zip','harness-runtime.json')) {
        if (Test-Path -LiteralPath (Join-Path $full ('resources\core\'+$name))) { throw 'integrated runtime present' }
    }
}

try {
    if (-not [IO.Path]::IsPathRooted($InstallDirectory)) { exit 2 }
    $root = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\') + '\'
    if ($root.Length -lt 5) { exit 2 }
    if ($MaxRelativePathLength -gt 0 -and $root.Length + $MaxRelativePathLength -gt 259) { exit 3 }
    Assert-PersonalDirectory $root
    # NSIS may remove the registered previous installation even if another
    # destination was selected. Never replace an integrated organization build.
    foreach ($key in @(Get-ChildItem HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall -ErrorAction Stop)) {
        $entry = Get-ItemProperty -LiteralPath $key.PSPath
        if ($entry.DisplayName -eq 'AEGIS Agent Ops') {
            if (-not $entry.InstallLocation) { throw 'unknown registered installation' }
            Assert-PersonalDirectory $entry.InstallLocation
        }
    }
    $names = @('AEGIS Agent Ops.exe','btk-desktop-core.exe','btk-agent-runtime.exe','btk-agent-updater.exe')
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        $busy = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in $names }).Count -gt 0
        if (-not $busy) { exit 0 }
        if ([DateTime]::UtcNow -ge $deadline) { exit 2 }
        Start-Sleep -Milliseconds 250
    } while ($true)
} catch { exit 2 }
