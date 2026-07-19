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
echo [error] No python/py in PATH and PY not set in ima_config.ini.
echo         Set PY=C:\path\to\python.exe in ima_config.ini, e.g. your Miniconda python.
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