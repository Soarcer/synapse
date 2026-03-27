@echo off
:: Synapse one-time setup — opens firewall ports and adds to PATH.
:: Requires admin. Auto-elevates if not already running as admin.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting admin privileges...
    powershell -Command "Start-Process cmd -ArgumentList '/c \"%~f0\"' -Verb RunAs"
    exit /b
)

echo.
echo  Synapse Setup
echo  =============
echo.

:: 1. Firewall rule for ports 27246-27248
netsh advfirewall firewall show rule name="Synapse" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Firewall rule already exists
) else (
    netsh advfirewall firewall add rule name="Synapse" dir=in action=allow protocol=TCP localport=27246-27248 >nul
    if %errorlevel% equ 0 (
        echo [OK] Firewall rule added (ports 27246-27248)
    ) else (
        echo [FAIL] Could not add firewall rule
    )
)

:: 2. Add portable folder to user PATH (so synapse.cmd works from anywhere)
set "SYNAPSE_DIR=%~dp0"
set "SYNAPSE_DIR=%SYNAPSE_DIR:~0,-1%"

echo %PATH% | findstr /i /c:"%SYNAPSE_DIR%" >nul
if %errorlevel% equ 0 (
    echo [OK] Already in PATH
) else (
    for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v PATH 2^>nul') do set "USER_PATH=%%b"
    if defined USER_PATH (
        setx PATH "%USER_PATH%;%SYNAPSE_DIR%" >nul
    ) else (
        setx PATH "%SYNAPSE_DIR%" >nul
    )
    echo [OK] Added to PATH: %SYNAPSE_DIR%
    echo     Open a new terminal for this to take effect.
)

echo.
echo  Done! Run "synapse start" from any project folder.
echo.
pause
