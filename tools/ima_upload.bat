@echo off
chcp 65001 >nul 2>&1
setlocal

set "SCRIPT_DIR=%~dp0"
set "PYTHONIOENCODING=utf-8"
set "SCRIPT=%SCRIPT_DIR%ima_upload.py"
set "KB_ID="
set "SRC="
set "PY="

if exist "%SCRIPT_DIR%ima_config.ini" (
    for /f "usebackq eol=; tokens=1,* delims==" %%A in ("%SCRIPT_DIR%ima_config.ini") do (
        for /f "tokens=1 delims= " %%K in ("%%A") do (
            for /f "eol= tokens=*" %%C in ("%%B") do (
                if /i "%%K"=="KB_ID" set "KB_ID=%%C"
                if /i "%%K"=="SRC" set "SRC=%%C"
                if /i "%%K"=="PY" set "PY=%%C"
            )
        )
    )
) else (
    if exist "%SCRIPT_DIR%ima_config_sample.ini" (
        echo [config] ima_config.ini not found. Copy ima_config_sample.ini to ima_config.ini and set KB_ID.
        echo          See ima_upload_notes.txt for full instructions.
    )
)

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
rem 【如果你 upload 报 "No module named 'qcloud_cos'"】
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

if defined PY goto :py_ok
where python >nul 2>&1 && (set "PY=python" & goto :py_ok)
where py >nul 2>&1     && (set "PY=py"     & goto :py_ok)
echo [error] No python/py in PATH and PY not set in ima_config.ini.
echo         Set PY=C:\path\to\python.exe in ima_config.ini, e.g. your Miniconda python.
echo         See comments at the top of this bat for why.
goto :end

:py_ok
"%PY%" "%SCRIPT%" --help >nul 2>&1
if errorlevel 1 (
    echo [error] Cannot run Python script with: %PY%
    echo         Make sure this python works and deps are installed:
    echo         pip install -r "%SCRIPT_DIR%requirements.txt"
    echo         Or set PY= correct python.exe path in ima_config.ini.
    goto :end
)

if not defined KB_ID (
    echo [error] KB_ID not set. Copy ima_config_sample.ini to ima_config.ini and set KB_ID=your_kb_id.
    echo         See ima_upload_notes.txt.
    goto :end
)

if "%~1"=="" goto :from_src

:drop
call :handle_one "%~1"
shift
if not "%~1"=="" goto :drop
goto :end

:from_src
if not defined SRC (
    echo [error] SRC not set and no file dropped. Set SRC=folder in ima_config.ini,
    echo         or drag a file or a folder onto this bat. See ima_upload_notes.txt.
    goto :end
)
if not exist "%SRC%" (
    echo [error] SRC folder does not exist: %SRC%
    goto :end
)
for %%f in ("%SRC%\*.md") do call :upload "%%~f"
goto :end

:handle_one
set "ARG=%~1"
if exist "%ARG%\*" (
    call :folder "%ARG%"
) else (
    call :upload "%ARG%"
)
goto :eof

:folder
for %%f in ("%~1\*.md") do call :upload "%%~f"
goto :eof

:upload
set "ARG=%~1"
if /i not "%~x1"==".md" (
    echo [skip] not a .md file: %ARG%
    goto :eof
)
echo [upload] %ARG%
"%PY%" "%SCRIPT%" --kb-id "%KB_ID%" --file "%ARG%"
set "RC=%errorlevel%"
echo.
if %RC%==0 (
    echo [OK] uploaded: %ARG%
    set /a OK_CNT+=1 >nul
) else (
    echo [FAIL] upload failed, exit code %RC%: %ARG%
    set /a FAIL_CNT+=1 >nul
)
goto :eof

:end
echo.
if defined OK_CNT echo [summary] uploaded OK : %OK_CNT%
if defined FAIL_CNT echo [summary] failed       : %FAIL_CNT%
if not defined OK_CNT if not defined FAIL_CNT echo [summary] no files were uploaded.
pause
endlocal
goto :eof
