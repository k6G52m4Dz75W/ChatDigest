@echo off
chcp 65001 >nul 2>&1
setlocal

set "SCRIPT_DIR=%~dp0"
set "SCRIPT=%SCRIPT_DIR%ima_watcher.py"
set "PYTHONIOENCODING=utf-8"

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
echo [error] No python found.
echo         - Set PY= in ima_config.ini to your python.exe (Miniconda / venv users must do this;
echo           `where python` won't find miniconda). Path example:
echo             C:\Users\<you>\miniconda3\envs\<envname>\python.exe
echo         - Or add python.exe to PATH (e.g. python.org installer) and run again.
echo         See README "Optional: Auto-push to IMA" for details.
goto :end

:py_ok
"%PY%" "%SCRIPT%" --version >nul 2>&1
if errorlevel 1 (
    echo [error] Cannot run Python script with: %PY%
    echo         Make sure this python works and deps installed:
    echo             pip install -r "%SCRIPT_DIR%requirements.txt"
    echo         Or set PY= in ima_config.ini to a python that has the deps.
    goto :end
)

echo [start] IMA watcher bridge mode: python ima_watcher.py --serve
echo         Close this window to stop. KB_ID is read from ima_config.ini.
"%PY%" "%SCRIPT%" --serve

:end
echo.
pause
endlocal
