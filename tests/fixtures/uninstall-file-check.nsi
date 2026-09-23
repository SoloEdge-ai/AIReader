Unicode true
Name "AIReader isolated uninstall test"
OutFile "${PROBE_ROOT}\generator.exe"
RequestExecutionLevel user
SilentInstall silent
SilentUnInstall silent
!define APP_EXECUTABLE_FILENAME "AIReader.exe"
!ifdef USE_GUARD
  !include "${GUARD_INCLUDE}"
!endif
Section
  CreateDirectory "${PROBE_ROOT}\installed"
  WriteUninstaller "${PROBE_ROOT}\installed\Uninstall.exe"
  FileOpen $0 "${PROBE_ROOT}\installed\AIReader.exe" w
  FileWrite $0 "This is fixture data, not an application."
  FileClose $0
  FileOpen $0 "${PROBE_ROOT}\installed\companion.txt" w
  FileWrite $0 "Keep this when executable removal is blocked."
  FileClose $0
SectionEnd
Section "Uninstall"
  ; No registry writes/deletes and no external app process interaction.
  StrCmp $INSTDIR "${PROBE_ROOT}\installed" valid refuse
  refuse:
    SetErrorLevel 99
    Quit
  valid:
    SetOutPath $TEMP
    !ifdef USE_GUARD
      !insertmacro aiRemoveMainExecutable
    !endif
    RMDir /r "${PROBE_ROOT}\installed"
    FileOpen $0 "${PROBE_ROOT}\completion.txt" w
    FileWrite $0 "The registration-removal stage was reached."
    FileClose $0
SectionEnd
