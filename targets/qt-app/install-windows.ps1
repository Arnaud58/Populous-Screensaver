<#
.SYNOPSIS
    Installs the Populous screen saver for the current user.

.DESCRIPTION
    A Windows screen saver does not have to live in System32: the registry
    stores a full path, and Windows honours it from anywhere. So installing is
    copying this directory somewhere stable and writing one registry value.

    Everything happens under HKCU and LOCALAPPDATA, so no elevation is needed.

    The screen saver currently selected is remembered, and put back by
    -Uninstall. Windows offers no way to browse for a screen saver, so without
    this the previous one could only be restored through the dialog's list.

.PARAMETER Uninstall
    Restore the previous screen saver and remove the installed directory.

.PARAMETER InstallDir
    Where to install. Defaults to LOCALAPPDATA\Programs\Populous Screen Saver.

.PARAMETER TimeoutMinutes
    Idle delay before the screen saver starts. Left untouched when omitted.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File install-windows.ps1
#>

[CmdletBinding()]
param(
    [switch] $Uninstall,
    [string] $InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\Populous Screen Saver'),
    [int] $TimeoutMinutes = 0
)

$ErrorActionPreference = 'Stop'

$desktopKey = 'HKCU:\Control Panel\Desktop'
# The dialog labels a screen saver by this file name, minus the extension.
$executableName = 'Populous Screen Saver.scr'
$backupName = 'previous-screensaver.txt'

# Writing SCRNSAVE.EXE is not enough on its own: the running session keeps the
# value it read at logon. SPI_SETSCREENSAVEACTIVE with SPIF_SENDCHANGE makes it
# re-read, so the new screen saver applies without logging out.
$signature = @'
[DllImport("user32.dll", SetLastError = true)]
public static extern bool SystemParametersInfo(uint action, uint param, IntPtr pointer, uint flags);
'@

function Invoke-ScreenSaverRefresh {
    $api = Add-Type -MemberDefinition $signature -Name 'ScreenSaver' -Namespace 'Populous' -PassThru
    $SPI_SETSCREENSAVEACTIVE = 0x0011
    $SPIF_UPDATEINIFILE_SENDCHANGE = 0x0003
    [void] $api::SystemParametersInfo($SPI_SETSCREENSAVEACTIVE, 1, [IntPtr]::Zero, $SPIF_UPDATEINIFILE_SENDCHANGE)
}

function Get-CurrentScreenSaver {
    (Get-ItemProperty -Path $desktopKey -Name 'SCRNSAVE.EXE' -ErrorAction SilentlyContinue).'SCRNSAVE.EXE'
}

if ($Uninstall) {
    $backupPath = Join-Path $InstallDir $backupName
    $previous = if (Test-Path $backupPath) { (Get-Content $backupPath -Raw).Trim() } else { '' }

    $current = Get-CurrentScreenSaver
    if ($current -and $current.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase)) {
        if ($previous -and (Test-Path $previous)) {
            Set-ItemProperty -Path $desktopKey -Name 'SCRNSAVE.EXE' -Value $previous
            Write-Host "Restored $previous"
        } else {
            Remove-ItemProperty -Path $desktopKey -Name 'SCRNSAVE.EXE' -ErrorAction SilentlyContinue
            Set-ItemProperty -Path $desktopKey -Name 'ScreenSaveActive' -Value '0'
            Write-Host 'No previous screen saver recorded; screen saver disabled.'
        }
        Invoke-ScreenSaverRefresh
    } else {
        Write-Host 'Another screen saver is already selected; leaving it alone.'
    }

    if (Test-Path $InstallDir) {
        Remove-Item -Recurse -Force $InstallDir
        Write-Host "Removed $InstallDir"
    }
    return
}

$source = $PSScriptRoot
if (-not (Test-Path (Join-Path $source $executableName))) {
    throw "$executableName is not beside this script. Run it from the deployed directory."
}

# Remember what was selected before this install, but never overwrite an
# earlier backup with our own path when reinstalling.
$previous = Get-CurrentScreenSaver
$installedPath = Join-Path $InstallDir $executableName

if ((Resolve-Path $source).Path -ne $InstallDir) {
    $carryOver = $null
    $existingBackup = Join-Path $InstallDir $backupName
    if (Test-Path $existingBackup) {
        $carryOver = Get-Content $existingBackup -Raw
    }

    if (Test-Path $InstallDir) {
        Remove-Item -Recurse -Force $InstallDir
    }
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Copy-Item -Path (Join-Path $source '*') -Destination $InstallDir -Recurse -Force

    if ($carryOver) {
        Set-Content -Path (Join-Path $InstallDir $backupName) -Value $carryOver
    } elseif ($previous -and -not $previous.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase)) {
        Set-Content -Path (Join-Path $InstallDir $backupName) -Value $previous
    }

    Write-Host "Installed to $InstallDir"
}

Set-ItemProperty -Path $desktopKey -Name 'SCRNSAVE.EXE' -Value $installedPath
Set-ItemProperty -Path $desktopKey -Name 'ScreenSaveActive' -Value '1'
if ($TimeoutMinutes -gt 0) {
    Set-ItemProperty -Path $desktopKey -Name 'ScreenSaveTimeOut' -Value ([string]($TimeoutMinutes * 60))
}
Invoke-ScreenSaverRefresh

Write-Host 'Selected as the current screen saver.'
Write-Host 'Settings: right-click the desktop, Personalise, Lock screen, Screen saver.'
