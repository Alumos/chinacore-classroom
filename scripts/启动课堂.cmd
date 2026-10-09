@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 中国芯 · 强国梦 - 课堂服务
if not exist "china-chip.exe" (
  echo 未找到 china-chip.exe，请先完成构建或解压完整的便携版。
  pause
  exit /b 1
)
echo 正在启动课堂，请保持此窗口打开。
echo 请在浏览器打开 http://localhost:18080/screen
echo.
china-chip.exe
echo.
echo 课堂服务已停止。
pause
