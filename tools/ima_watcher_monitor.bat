@echo off
chcp 65001 >nul 2>&1
setlocal

set "SCRIPT_DIR=%~dp0"
set "SCRIPT=%SCRIPT_DIR%ima_watcher.py"
set "PYTHONIOENCODING=utf-8"

rem ====================================================================
rem Python 选择规则（按优先级）：
rem   1. ima_config.ini 里的 PY=（如果设了） — 显式覆盖，永远赢
rem   2. `where python`                      — PATH 里有就用
rem   3. `where py`                          — Windows Python launcher
rem   4. 报错
rem
rem 【为什么要在 ini 里写死 PY=】
rem Miniconda 默认安装不会注册为系统 python，也不会把 python.exe 加到
rem PATH；`where python` 在这种机器上找到的多半是 Microsoft Store 壳子或
rem 其他不相干的 python，根本不是你的 miniconda / 虚拟环境。脚本不会
rem 帮你"猜"该用哪个 python —— 那条路在 miniconda 上是死路。
rem
rem 【如果你 bridge 报 HTTP 500 + "No module named 'qcloud_cos'"】
rem 99% 是 PY 指向的 python 里没装 requirements.txt 里的依赖。两种修法：
rem   (a) 在那个 python 里装依赖：
rem         "C:\path\to\that\python.exe" -m pip install -r "%SCRIPT_DIR%requirements.txt"
rem   (b) 把 PY 改成已经装好依赖的那个 python.exe：
rem         虚拟环境路径形如：
rem           C:\Users\<你>\miniconda3\envs\<envname>\python.exe
rem         不知道 env 路径可以跑 `conda env list` 看。
rem
rem 这不是脚本的 bug，是配置问题；ini 不写 PY= 的话脚本只能"瞎猫碰死
rem 耗子"靠 where 找，miniconda 用户大概率踩坑。请在 ima_config.ini 里
rem 显式写 PY= 指向你装好依赖的那个 python.exe。
rem ====================================================================

set "PY="
if exist "%SCRIPT_DIR%ima_config.ini" (
    for /f "usebackq eol=; tokens=1,* delims==" %%A in ("%SCRIPT_DIR%ima_config.ini") do (
        for /f "tokens=1 delims= " %%K in ("%%A") do (
            for /f "eol= tokens=*" %%C in ("%%B") do (
                if /i "%%K"=="PY" set "PY=%%C"
            )
        )
    )
)
if defined PY goto :py_ok
where python >nul 2>&1 && (set "PY=python" & goto :py_ok)
where py >nul 2>&1     && (set "PY=py"     & goto :py_ok)
echo [error] No python/py in PATH and PY not set in ima_config.ini.
echo         Set PY=C:\path\to\python.exe in ima_config.ini, e.g. your Miniconda python.
echo         See comments at the top of this bat for why.
goto :end

:py_ok
"%PY%" "%SCRIPT%" --version >nul 2>&1
if errorlevel 1 (
    echo [error] Cannot run Python script with: %PY%
    echo         Ensure this python works and deps installed:
    echo             pip install -r "%SCRIPT_DIR%requirements.txt"
    echo         Or set PY= correct python.exe path in ima_config.ini.
    goto :end
)

if "%~1"=="" goto :default

for %%a in ("%~1\.") do set "ARG=%%~fa"
echo [start] IMA watcher monitor mode: "%ARG%"
echo         close this window to stop
"%PY%" "%SCRIPT%" "%ARG%"
goto :end

:default
echo [start] IMA watcher monitor mode: default SRC
echo         KB_ID/SRC read from ima_config.ini, close this window to stop
"%PY%" "%SCRIPT%"

:end
echo.
pause
endlocal
