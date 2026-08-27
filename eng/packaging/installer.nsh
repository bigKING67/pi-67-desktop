!include "LogicLib.nsh"
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "x64.nsh"

!ifndef BUILD_UNINSTALLER
  Var Pi67InstallPathGuardAllowed
  Var Pi67InstallPathGuardDialog
  Var Pi67InstallPathGuardLabel
  Var Pi67InstallPathGuardPathLabel
  Var Pi67InstallPathGuardReason
  Var Pi67UpdateProgressVisible

  !macro Pi67HideUpdateProgress
    ${If} $Pi67UpdateProgressVisible == "1"
      SpiderBanner::Destroy
      StrCpy $Pi67UpdateProgressVisible "0"
    ${EndIf}
  !macroend

  !macro customInit
    StrCpy $Pi67UpdateProgressVisible "0"
    ${If} ${isUpdated}
    ${AndIf} ${Silent}
      # A per-machine outer process relaunches elevated; let only the process
      # that performs extraction own the visible update surface.
      ${If} $hasPerMachineInstallation != "1"
      ${OrIf} ${UAC_IsAdmin}
        # Destroy must address the same plugin instance after extraction.
        SpiderBanner::Show /NOUNLOAD /MODERN
        StrCpy $Pi67UpdateProgressVisible "1"
        FindWindow $0 "#32770" "" $HWNDPARENT
        FindWindow $0 "#32770" "" $HWNDPARENT $0
        GetDlgItem $0 $0 1000
        SendMessage $0 ${WM_SETTEXT} 0 "STR:Installing Pi-67 update / 正在安装 Pi-67 更新，请稍候"
      ${EndIf}
    ${EndIf}
  !macroend

  !macro customInstall
    ${If} ${isUpdated}
      ${IfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
        !insertmacro Pi67HideUpdateProgress
        Abort "Updated application executable is unavailable."
      ${EndIf}
      Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
      ClearErrors
      CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 "" "" "${APP_DESCRIPTION}"
      ${If} ${Errors}
        !insertmacro Pi67HideUpdateProgress
        Abort "Updated Desktop shortcut could not be created."
      ${EndIf}
      WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
      !insertmacro Pi67HideUpdateProgress
    ${EndIf}
  !macroend

  !macro customPageAfterChangeDir
    Page custom Pi67InstallDirectoryGuardPre Pi67InstallDirectoryGuardLeave

    Function Pi67CheckInstallDirectory
      StrCpy $Pi67InstallPathGuardAllowed "0"
      StrCpy $Pi67InstallPathGuardReason "unwritable"

      Push $0
      Push $1
      Push $2
      Push $3
      Push $4

      ${If} $installMode == "CurrentUser"
        System::Call 'shlwapi::PathIsPrefixW(w "$PROGRAMFILES", w "$INSTDIR") i .r0'
        ${If} $0 != 0
          StrCpy $Pi67InstallPathGuardReason "protected"
          Goto pi67_install_path_guard_done
        ${EndIf}

        ${If} ${RunningX64}
          System::Call 'shlwapi::PathIsPrefixW(w "$PROGRAMFILES64", w "$INSTDIR") i .r0'
          ${If} $0 != 0
            StrCpy $Pi67InstallPathGuardReason "protected"
            Goto pi67_install_path_guard_done
          ${EndIf}
        ${EndIf}

        System::Call 'shlwapi::PathIsPrefixW(w "$WINDIR", w "$INSTDIR") i .r0'
        ${If} $0 != 0
          StrCpy $Pi67InstallPathGuardReason "protected"
          Goto pi67_install_path_guard_done
        ${EndIf}

        ReadEnvStr $4 "ProgramData"
        ${If} $4 != ""
          System::Call 'shlwapi::PathIsPrefixW(w r4, w "$INSTDIR") i .r0'
          ${If} $0 != 0
            StrCpy $Pi67InstallPathGuardReason "protected"
            Goto pi67_install_path_guard_done
          ${EndIf}
        ${EndIf}
      ${EndIf}

      StrCpy $2 "0"
      System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i .r0'
      ${If} $0 == -1
        ClearErrors
        CreateDirectory "$INSTDIR"
        ${If} ${Errors}
          Goto pi67_install_path_guard_done
        ${EndIf}
        StrCpy $2 "1"
      ${EndIf}

      StrCpy $3 ""
      System::Call 'kernel32::GetTempFileNameW(w "$INSTDIR", w "p67", i 0, w .r3) i .r1'
      ${If} $1 == 0
        ${If} $2 == "1"
          RMDir "$INSTDIR"
        ${EndIf}
        Goto pi67_install_path_guard_done
      ${EndIf}

      ClearErrors
      Delete "$3"
      ${If} ${Errors}
        ${If} $2 == "1"
          RMDir "$INSTDIR"
        ${EndIf}
        Goto pi67_install_path_guard_done
      ${EndIf}

      ${If} $2 == "1"
        RMDir "$INSTDIR"
      ${EndIf}
      StrCpy $Pi67InstallPathGuardAllowed "1"

    pi67_install_path_guard_done:
      Pop $4
      Pop $3
      Pop $2
      Pop $1
      Pop $0
    FunctionEnd

    Function Pi67InstallDirectoryGuardPre
      Call instFilesPre
      Call Pi67CheckInstallDirectory
      ${If} $Pi67InstallPathGuardAllowed == "1"
        Abort
      ${EndIf}

      !insertmacro MUI_HEADER_TEXT "Installation folder unavailable / 安装位置不可用" "Return and choose a current-user writable folder / 请返回选择当前用户可写的文件夹"

      nsDialogs::Create 1018
      Pop $Pi67InstallPathGuardDialog
      ${If} $Pi67InstallPathGuardDialog == error
        MessageBox MB_OK|MB_ICONSTOP "The selected installation folder is unavailable. Please return and choose a current-user writable folder."
        Quit
      ${EndIf}

      ${If} $Pi67InstallPathGuardReason == "protected"
        ${NSD_CreateLabel} 0u 0u 300u 64u "Current-user installation cannot use a machine-protected folder such as Program Files. Click Back and keep the default LocalAppData path, or restart Setup and choose all users.$\r$\n$\r$\n当前用户安装不能使用 Program Files 等系统保护目录。请点击“上一步”保留默认 LocalAppData 路径，或重新启动安装程序并选择所有用户。"
      ${Else}
        ${NSD_CreateLabel} 0u 0u 300u 64u "Setup cannot create and remove a temporary file in this folder. Click Back and choose another folder that the selected installation mode can write to.$\r$\n$\r$\n安装程序无法在此文件夹中创建并删除临时文件。请点击“上一步”，选择当前安装模式可写的其他文件夹。"
      ${EndIf}
      Pop $Pi67InstallPathGuardLabel

      ${NSD_CreateLabel} 0u 78u 300u 30u "$INSTDIR"
      Pop $Pi67InstallPathGuardPathLabel

      nsDialogs::Show
    FunctionEnd

    Function Pi67InstallDirectoryGuardLeave
      Abort
    FunctionEnd
  !macroend
!endif
