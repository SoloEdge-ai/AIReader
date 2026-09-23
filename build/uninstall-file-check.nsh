!include "LogicLib.nsh"

; The default NSIS RMDir can leave a locked executable but still discard the
; uninstall registration. Check the managed main executable before that step.
; Do not terminate the owning process or schedule deletion on reboot.
!macro aiRemoveMainExecutable
  Push $0
  Push $R1
  Push $R2
  StrCpy $R1 0
  ${Do}
    ${IfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      ${ExitDo}
    ${EndIf}
    System::Call 'kernel32::DeleteFileW(w "$INSTDIR\${APP_EXECUTABLE_FILENAME}") i.r0 ?e'
    Pop $R2
    ${If} $0 != 0
      ${ExitDo}
    ${EndIf}
    IntOp $R1 $R1 + 1
    ${If} $R1 >= 40
      IfSilent +2
        MessageBox MB_ICONEXCLAMATION "Windows 未能删除 AIReader 程序文件（错误 $R2）。请关闭占用文件的程序后重试。卸载记录和快捷方式已保留。"
      SetErrorLevel 6
      Quit
    ${EndIf}
    Sleep 250
  ${Loop}
  Pop $R2
  Pop $R1
  Pop $0
!macroend
