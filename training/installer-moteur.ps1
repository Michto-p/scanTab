# Installation confinée au projet. Aucun changement du PATH ou du registre Windows.
$ErrorActionPreference = 'Stop'
$racineProjet = Split-Path -Parent $PSScriptRoot
$dossierInstallation = Join-Path $racineProjet '.local'
$dossierPython = Join-Path $dossierInstallation 'python'
$dossierTelechargements = Join-Path $dossierInstallation 'downloads'
$pythonExecutable = Join-Path $dossierPython 'python.exe'
New-Item -ItemType Directory -Path $dossierPython,$dossierTelechargements -Force | Out-Null

if (-not (Test-Path -LiteralPath $pythonExecutable)) {
    $archivePython = Join-Path $dossierTelechargements 'python-3.14.10-embed-amd64.zip'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://www.python.org/ftp/python/3.14.10/python-3.14.10-embed-amd64.zip' -OutFile $archivePython
    $empreintePython = (Get-FileHash -LiteralPath $archivePython -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($empreintePython -ne '90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159') { throw 'Empreinte SHA-256 de Python incorrecte.' }
    Expand-Archive -LiteralPath $archivePython -DestinationPath $dossierPython -Force
}
$configurationPython = "python314.zip`n.`nLib/site-packages`nimport site`n"
[IO.File]::WriteAllText((Join-Path $dossierPython 'python314._pth'), $configurationPython, [Text.UTF8Encoding]::new($false))
$env:PIP_CACHE_DIR = Join-Path $dossierInstallation 'pip-cache'
if (-not (Test-Path -LiteralPath (Join-Path $dossierPython 'Lib/site-packages/pip'))) {
    $scriptPip = Join-Path $dossierTelechargements 'get-pip.py'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile $scriptPip
    & $pythonExecutable -I $scriptPip --disable-pip-version-check --no-warn-script-location
    if ($LASTEXITCODE -ne 0) { throw 'Installation de pip impossible.' }
}
& $pythonExecutable -I -m pip install --only-binary=:all: --disable-pip-version-check --no-warn-script-location -r (Join-Path $PSScriptRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Installation des bibliothèques de reconnaissance impossible.' }
& $pythonExecutable -I -m pip install --only-binary=:all: --disable-pip-version-check --no-warn-script-location 'torch==2.14.1' 'torchvision==0.29.1' --index-url 'https://download.pytorch.org/whl/cpu'
if ($LASTEXITCODE -ne 0) { throw 'Installation de PyTorch CPU impossible.' }
& $pythonExecutable -I -m pip freeze | Set-Content -LiteralPath (Join-Path $dossierInstallation 'requirements-installes.txt') -Encoding UTF8
& $pythonExecutable -I -c 'import torch, torchvision, onnxruntime, numpy, PIL'
if ($LASTEXITCODE -ne 0) { throw 'Verification du moteur impossible.' }
Write-Output 'Moteur CPU local installe.'
