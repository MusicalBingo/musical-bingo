@echo off
title Musical Bingo server
cd /d "%~dp0"
if not exist node_modules (
  echo Installing for the first time, please wait...
  call npm install
)
call npm start
pause
