@echo off
chcp 65001 >nul
echo 正在启动服务器...

REM 启动 Memory Server
echo 启动 Memory Server...
start "Memory Server" cmd /k "uv run python memory_server.py --enable-shutdown"

REM 等待一下确保 Memory Server 启动
timeout /t 2 /nobreak >nul

REM 启动 Main Server（使用 --open-browser，关闭主页时自动关闭服务器）
echo 启动 Main Server...
start "Main Server" cmd /k "uv run python main_server.py --open-browser"

REM 等待一下确保 Main Server 完全启动
timeout /t 4 /nobreak >nul

REM 两个服务器已启动，现在打开浏览器
echo 正在打开浏览器...
start "" "http://127.0.0.1:48911"

echo.
echo 服务器已启动！
echo Main Server: http://127.0.0.1:48911
echo Memory Server: http://127.0.0.1:48912
echo.
echo 按任意键关闭此窗口（服务器将继续运行）...
pause >nul
