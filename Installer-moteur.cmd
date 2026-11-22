@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File training\installer-moteur.ps1
if errorlevel 1 goto erreur
powershell.exe -NoProfile -ExecutionPolicy Bypass -File training\installer-ocr.ps1
if errorlevel 1 goto erreur
set "TORCH_HOME=%CD%\.local\pc\torch-cache"
".local\python\python.exe" -I -X utf8 training\engine.py setup
if errorlevel 1 goto erreur
echo Installation terminee. Vous pouvez ouvrir Demarrer-PC.cmd.
pause
exit /b 0
:erreur
echo Installation interrompue. Consultez le message ci-dessus.
pause
exit /b 1
