; Codex Harness Desktop 自定义 NSIS 安装钩子
; 覆盖安装时先清掉旧版自动化工具目录：0.0.4 及更早版本的 npm-global 只有空壳
; （node_modules 被 electron-builder 硬排除），直接覆盖安装会残留旧结构导致
; 新包的 node_modules 与旧 shim 混装。安装前整目录重置，保证与包内容一致。

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
