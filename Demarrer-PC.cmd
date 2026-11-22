@echo off
cd /d "%~dp0"
node training/server.mjs --lan --origin https://michto-p.github.io
if errorlevel 1 pause
