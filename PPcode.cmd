@echo off
rem ─────────────────────────────────────────────────────────────────────────
rem PPcode 启动器（源码目录直跑，不打包）
rem
rem 两条路：
rem   · 桌面「PPcode」快捷方式 → 直接拉 electron.exe（无控制台、最快）
rem   · 本 .cmd                → 看得到主进程日志；产物缺失会自动补构建
rem
rem 用法：PPcode.cmd          正常启动
rem       PPcode.cmd dev      开发模式（vite dev server + HMR）
rem
rem 数据目录：%APPDATA%\PPcode（引擎 home 在 %APPDATA%\PPcode\codex-home）
rem ⛔ 与原来的 Codex Harness 完全分开，互不干扰。
rem ⛔ 改了 electron/ 或 src/ 下的代码要先构建（本脚本只在产物缺失时自动补一次）。
rem ─────────────────────────────────────────────────────────────────────────
setlocal
cd /d "%~dp0"

if /i "%~1"=="dev" (
  call npm run dev
  goto :end
)

if not exist "dist-electron\main.js" goto :build
if not exist "dist\index.html" goto :build
goto :run

:build
echo [PPcode] 缺少构建产物，先构建一次…
call npm run build
if errorlevel 1 goto :fail

:run
echo [PPcode] 启动中（数据目录 %APPDATA%\PPcode）…
rem ⛔ 清掉 ELECTRON_RUN_AS_NODE：某些终端/工具链会注入它，那会让 electron 退化成纯 Node 跑，
rem    报 "Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')"。
set ELECTRON_RUN_AS_NODE=
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
goto :end

:fail
echo [PPcode] 构建失败，请检查上面的输出。
pause

:end
endlocal
