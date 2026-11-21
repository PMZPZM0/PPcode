; Codex Harness Desktop 自定义 NSIS 安装钩子
; 覆盖安装时先清掉旧版自动化工具目录：0.0.4 及更早版本的 npm-global 只有空壳
; （node_modules 被 electron-builder 硬排除），直接覆盖安装会残留旧结构导致
; 新包的 node_modules 与旧 shim 混装。安装前整目录重置，保证与包内容一致。

; ${GetParameters} / ${GetOptions}（customInit 里识别应用内更新的 --updated 参数）。
; 模板本身经 multiUser.nsh 已 include 过 FileFunc，这里显式写一次消除宏展开顺序依赖
; （FileFunc.nsh 自带 include guard，重复引入无副作用）。
!include "FileFunc.nsh"

!macro preInit
  ; ⛔⛔ preInit（早于模板的运行中检查）：覆盖安装时弹「PPcode 无法关闭，请手动关闭它，
  ;   然后单击重试以继续」（用户实测，重启后仍复现）。两个成因都覆盖：
  ;   ① 托盘应用「关闭窗口=最小化到托盘」把 AppAlive 的 WM_CLOSE 吞了；
  ;   ② 解包阶段文件被占。按进程名强杀（含 /T 子进程树）；没在跑时报错无妨。
  ;   ⚠️ 应用若以管理员权限运行，非提权安装器杀不动 → 右键「以管理员身份运行」安装器。
  DetailPrint "正在关闭已运行的 PPcode…"
  nsExec::ExecToStack 'taskkill /F /T /IM "PPcode.exe"'
  Pop $0
  Pop $1
  Sleep 800
!macroend

!macro customInit
  ; 11-16 oneClick 迁移保护：旧版 assisted 安装可能选过「所有用户」（HKLM）。
  ; oneClick 默认按当前用户装到 %LOCALAPPDATA%\Programs；直接装会与旧全机安装并存两份。
  ;   · 管理员运行 ⇒ 原地覆盖旧的全机目录；
  ;   · 非管理员 ⇒ 明确提示先卸载旧版（不静默装第二份）。
  ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 != ""
    ${If} ${UAC_IsAdmin}
      StrCpy $INSTDIR $0
    ${Else}
      ; ⛔⛔ 11-21 闭环修复：判据不能只看 ${Silent}。
      ;   oneClick 安装器为了显示进度页是**非静默**的，而应用内更新 spawn 安装器时不带 /S
      ;   ⇒ 从这里点「安装」时 ${Silent} 恒假 ⇒ 只要机器上留着旧版的全机安装，就会弹
      ;   「请先卸载旧版」并 Quit（用户看到的就是「点了安装没反应，版本没变」）。
      ;   ⇒ 应用内更新发起时命令行带 `--updated`（update-service 的 spawn），用它识别更新路径，
      ;     与静默安装同等放行（装到当前用户目录，宁可留旧版也不能让更新整块失败）。
      ${GetParameters} $R9
      ${GetOptions} $R9 "--updated" $R8
      ${If} ${Silent}
        DetailPrint "静默更新：检测到旧版为全机安装（$0），本次按当前用户安装"
      ${Else}
        ${IfNot} ${Errors}
          DetailPrint "应用内更新：检测到旧版为全机安装（$0），本次按当前用户安装"
        ${Else}
          MessageBox MB_ICONEXCLAMATION|MB_OK "检测到旧版是按「所有用户」安装的：$0$\r$\n请先卸载旧版，或以管理员身份运行本次安装，避免出现两份安装。"
          Quit
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}

  ; 安装前清理旧版工具残留（只动安装目录内 harness 自己管理的 tools 子目录，
  ; 不碰用户数据：userData 在 %APPDATA%\PPcode，与安装目录无关）
  DetailPrint "清理旧版内置工具目录…"
  RMDir /r "$INSTDIR\resources\tools\npm-global"
  RMDir /r "$INSTDIR\resources\tools\pw-browsers"
  RMDir /r "$INSTDIR\resources\tools\cloak-cache"
!macroend

!macro customInstall
  ; 09-24 更正：自 09-16 起 cloakbrowser 与 Chromium/Playwright 内核都是**首次使用时按需下载**，
  ; 只有 nuphus 与 playwright-cli 随包。旧文案声称四者全部随包，会让人以为装完就能离线用。
  DetailPrint "内置工具：nuphus / playwright-cli 已随包；cloakbrowser 与浏览器内核在首次使用时按需下载"
!macroend
