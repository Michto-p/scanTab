# Téléchargement initial explicite ; aucun téléchargement lors d'une analyse.
$ErrorActionPreference = 'Stop'
$racineProjet = Split-Path -Parent $PSScriptRoot
$dossierOCR = Join-Path $racineProjet '.local/ocr'
$dossierLangues = Join-Path $dossierOCR 'tessdata'
New-Item -ItemType Directory -Path $dossierLangues -Force | Out-Null
& npm.cmd install --prefix $dossierOCR 'tesseract.js@7.0.0' --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Installation Tesseract.js impossible.' }
foreach ($langue in @('eng','fra')) {
    $fichierLangue = Join-Path $dossierLangues ($langue + '.traineddata')
    if (-not (Test-Path -LiteralPath $fichierLangue)) {
        Invoke-WebRequest -UseBasicParsing -Uri ('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/' + $langue + '.traineddata') -OutFile $fichierLangue
    }
}
Write-Output 'OCR local installe (francais et anglais).'
