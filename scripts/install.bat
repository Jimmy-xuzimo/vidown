@echo off
REM Vidown 一键安装脚本 (Windows)
SETLOCAL ENABLEDELAYEDEXPANSION

SET PROJECT_DIR=%~dp0..
CD /D %PROJECT_DIR%

ECHO ==^> Vidown 安装脚本 (Windows)
ECHO     Python: 
python --version 2>NUL || (ECHO     未检测到 python，请先安装 Python 3.10+ & EXIT /B 1)

REM ---- 1. ffmpeg ----
ECHO ==^> 1/4 检查 ffmpeg
where ffmpeg >NUL 2>NUL
IF %ERRORLEVEL% NEQ 0 (
    ECHO     ! 未找到 ffmpeg，请从 https://www.gyan.dev/ffmpeg/builds/ 下载
    ECHO       并将 ffmpeg.exe / ffprobe.exe 所在目录加入 PATH
) ELSE (
    ECHO     ^✓ ffmpeg: 
    ffmpeg -version 2>NUL | findstr /R "ffmpeg version"
)

REM ---- 2. venv ----
ECHO ==^> 2/4 创建虚拟环境
IF NOT EXIST ".venv" (
    python -m venv .venv
)
CALL .venv\Scripts\activate.bat

python -m pip install --upgrade pip wheel setuptools

ECHO ==^> 3/4 安装 Python 依赖
pip install -r requirements.txt

IF /I "%1"=="--with-optional" (
    ECHO ==^> 安装可选依赖
    pip install -r requirements-optional.txt
)

ECHO ==^> 4/4 安装 Vidown
pip install -e .

ECHO ==^> 验证
vidown check

ECHO ==^> 完成！启动 GUI: vidown gui
ENDLOCAL
