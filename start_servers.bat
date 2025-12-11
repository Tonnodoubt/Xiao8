@echo off
chcp 65001 >nul
echo ========================================
echo   启动 N.E.K.O. 服务器
echo ========================================
echo.

REM 获取脚本所在目录
cd /d "%~dp0"

REM 检查虚拟环境是否存在，优先使用虚拟环境中的 Python
if exist ".venv\Scripts\python.exe" (
    set PYTHON_CMD=.venv\Scripts\python.exe
    echo [信息] 使用虚拟环境中的 Python
) else (
    set PYTHON_CMD=python
    echo [信息] 使用系统 Python
)

REM 检查 Python 是否可用
%PYTHON_CMD% --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Python，请确保 Python 已安装并添加到 PATH
    echo 或者运行 "uv sync" 创建虚拟环境
    pause
    exit /b 1
)

echo [1/3] 正在启动记忆服务器 (端口 48912)...
start "N.E.K.O. Memory Server" cmd /k "%PYTHON_CMD% memory_server.py"
timeout /t 2 /nobreak >nul

echo [2/3] 正在启动主服务器 (端口 48911)...
start "N.E.K.O. Main Server" cmd /k "%PYTHON_CMD% main_server.py"
timeout /t 5 /nobreak >nul

echo [3/3] 正在打开浏览器...
start http://localhost:48911

echo.
echo ========================================
echo   服务器启动完成！
echo ========================================
echo 主服务器: http://localhost:48911
echo 记忆服务器: http://localhost:48912
echo.
echo 提示: 关闭服务器窗口即可停止服务
echo ========================================
pause

