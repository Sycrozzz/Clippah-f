@echo off
REM Clippahh launcher for Windows (not tested on Windows in the build environment).
REM Requires Node.js 20+ and a running PostgreSQL whose URL is in .env
cd /d "%~dp0\.."
if not exist ".env" (
  echo Creating .env from .env.example - please edit DATABASE_URL, then run this script again.
  copy ".env.example" ".env" >nul
  notepad ".env"
  exit /b 0
)
if not exist "node_modules" call npm install || exit /b 1
call npx drizzle-kit push --force || exit /b 1
if not exist ".next" call npm run build || exit /b 1
start "" http://localhost:3000
call npm run start -- -H 127.0.0.1
