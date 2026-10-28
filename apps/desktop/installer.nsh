!define BTK_PREFLIGHT_SCRIPT "${__FILEDIR__}\installer-preflight.ps1"
!include "${__FILEDIR__}\stage\installer-path-limit.nsh"

!macro btkRequireSafeReplacement maxPath
  InitPluginsDir
  File /oname=$PLUGINSDIR\btk-installer-preflight.ps1 "${BTK_PREFLIGHT_SCRIPT}"
  Push $0
  Push $1
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\btk-installer-preflight.ps1" -InstallDirectory "$INSTDIR" -MaxRelativePathLength ${maxPath}'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "Close AZOWL / AEGIS Agent Ops before continuing. An Enterprise installation must use the organization installer. Choose a shorter directory if the installation path is too long. No processes were terminated." /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  Pop $1
  Pop $0
!macroend

!macro customInit
  !insertmacro btkRequireSafeReplacement 0
!macroend

!macro customCheckAppRunning
  !insertmacro btkRequireSafeReplacement ${BTK_MAX_RELATIVE_PATH}
!macroend

!macro customUnInit
  !insertmacro customCheckAppRunning
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
  nsExec::ExecToStack '"$INSTDIR\resources\core\btk-desktop-core.exe" --remove-startup'
  Pop $0
  Pop $1
  ${EndIf}
!macroend

!macro btkRequirePreviousUninstallSucceeded
  ${If} ${Errors}
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${If} $R0 != 0
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro customUnInstallCheck
  !insertmacro btkRequirePreviousUninstallSucceeded
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro btkRequirePreviousUninstallSucceeded
!macroend
