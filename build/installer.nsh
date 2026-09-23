!include "LogicLib.nsh"

; The app is installed for the current Windows user without elevation.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!ifndef BUILD_UNINSTALLER
  !include "nsDialogs.nsh"
  !include "WordFunc.nsh"
  !include "x64.nsh"
  !insertmacro VersionCompare

  Var aiInstalledLocation
  Var aiInstalledVersion
  Var aiInstallRadio
  Var aiUpdateRadio

  !macro customInit
    ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" CurrentBuildNumber
    ${If} $0 < 22000
    ${OrIfNot} ${RunningX64}
      IfSilent +2
        MessageBox MB_ICONSTOP "AIReader 需要 Windows 11 x64。"
      SetErrorLevel 2
      Abort
    ${EndIf}

    ReadRegStr $aiInstalledLocation HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $aiInstalledLocation != ""
    ${AndIfNot} ${FileExists} "$aiInstalledLocation\AIReader.exe"
      StrCpy $aiInstalledLocation ""
    ${EndIf}

    StrCpy $aiInstalledVersion ""
    ${If} $aiInstalledLocation != ""
      ReadRegStr $aiInstalledVersion HKCU "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
      ${If} $aiInstalledVersion != ""
        ${VersionCompare} "$aiInstalledVersion" "${VERSION}" $0
        ${If} $0 == 1
          IfSilent +2
            MessageBox MB_ICONSTOP "已安装较新的 AIReader $aiInstalledVersion。请下载更新的安装包。"
          SetErrorLevel 3
          Abort
        ${EndIf}
      ${EndIf}
    ${EndIf}
  !macroend

  !macro customWelcomePage
    Page custom AIReaderChoiceCreate AIReaderChoiceLeave

    Function AIReaderChoiceCreate
      !insertmacro MUI_HEADER_TEXT "AIReader ${VERSION}" "选择安装或更新"
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}

      ${NSD_CreateLabel} 0u 2u 100% 28u "为当前 Windows 用户安装。书库、笔记和登录资料保存在本机用户目录，更新时会保留。"
      Pop $0

      ${NSD_CreateRadioButton} 4u 38u 96% 22u "安装 AIReader ${VERSION}"
      Pop $aiInstallRadio
      ${NSD_CreateRadioButton} 4u 68u 96% 22u "更新已安装的 AIReader"
      Pop $aiUpdateRadio

      ${If} $aiInstalledLocation == ""
        ${NSD_Check} $aiInstallRadio
        EnableWindow $aiUpdateRadio 0
        ${NSD_CreateLabel} 4u 102u 96% 42u "未检测到已安装版本。安装后可在开始菜单启动，也可从 Windows 设置中卸载。"
      ${Else}
        ${NSD_Check} $aiUpdateRadio
        EnableWindow $aiInstallRadio 0
        ${NSD_SetText} $aiUpdateRadio "更新 / 修复 AIReader（$aiInstalledVersion → ${VERSION}）"
        ${NSD_CreateLabel} 4u 102u 96% 42u "检测到已安装版本，程序将更新到原位置。请先关闭正在运行的 AIReader。"
      ${EndIf}
      Pop $0
      nsDialogs::Show
    FunctionEnd

    Function AIReaderChoiceLeave
      ${If} $aiInstalledLocation == ""
        ${NSD_GetState} $aiInstallRadio $0
      ${Else}
        ${NSD_GetState} $aiUpdateRadio $0
      ${EndIf}
      ${If} $0 != ${BST_CHECKED}
        MessageBox MB_ICONEXCLAMATION "请选择可用的安装方式。"
        Abort
      ${EndIf}
    FunctionEnd
  !macroend
!endif
