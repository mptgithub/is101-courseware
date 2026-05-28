@echo off
title IS101 Courseware Server
color 1F
cls

echo.
echo  ===============================================
echo   IS101 Courseware - College of Southern Nevada
echo   Copyright Dr. Mark Taormino - All Rights Reserved
echo  ===============================================
echo.

:: Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Node.js is not installed on this computer.
    echo.
    echo  Please install Node.js first:
    echo  1. Open your browser and go to: https://nodejs.org
    echo  2. Download the LTS version (the big green button)
    echo  3. Run the installer and follow the prompts
    echo  4. Restart your computer
    echo  5. Double-click this file again
    echo.
    echo  Press any key to open the Node.js download page...
    pause >nul
    start https://nodejs.org/en/download/
    exit
)

echo  Node.js found: 
node --version
echo.

:: Install dependencies if node_modules doesn't exist
if not exist "node_modules\" (
    echo  Installing server components... (this only happens once)
    echo  Please wait - do not close this window...
    echo.
    npm install
    if %errorlevel% neq 0 (
        echo.
        echo  ERROR: Installation failed.
        echo  Make sure you are connected to the internet and try again.
        pause
        exit
    )
    echo.
    echo  Installation complete!
    echo.
)

:: Create public folder if it doesn't exist
if not exist "public\" mkdir public

:: Copy any IS101 HTML files in the same folder into public/
echo  Setting up courseware files...
for %%f in (IS101_*.html) do (
    copy /y "%%f" "public\%%f" >nul
    echo    Loaded: %%f
)

:: Set the most recent START_HERE file as index.html
for %%f in (public\IS101_START_HERE_*.html) do (
    copy /y "%%f" "public\index.html" >nul
    echo    Set as home: %%f
)
echo.

echo  -----------------------------------------------
echo   Server is starting...
echo  -----------------------------------------------
echo.
echo   Student URL:    http://localhost:3000/login.html
echo   Instructor:     http://localhost:3000/instructor.html
echo   Password:       IS101admin2026!
echo.
echo   Share this with students on your local network:
echo   (run ipconfig in a separate window to find your IP address)
echo   Then share: http://YOUR-IP:3000/login.html
echo.
echo   Press Ctrl+C to stop the server when done.
echo  -----------------------------------------------
echo.

:: Open browser after a short delay
start "" cmd /c "timeout /t 2 >nul && start http://localhost:3000/login.html"

:: Start the server
node server.js

echo.
echo  Server stopped.
pause
