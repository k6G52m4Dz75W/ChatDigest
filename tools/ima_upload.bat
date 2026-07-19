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
"%PY%" "%SCRIPT%" --help >nul 2>&1
if errorlevel 1 (
    echo [error] Cannot run Python script with: %PY%
    echo         Make sure this python works and deps are installed:
    echo         pip install -r "%SCRIPT_DIR%requirements.txt"
    echo         Or set PY= in ima_config.ini to a python that has the deps.
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
