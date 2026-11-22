# Ressources OCR embarquées

Distributions officielles Tesseract.js 7.0.0 et tesseract.js-core 7.0.0, langues `eng` et `fra` du projet tessdata_fast. Les scripts et modèles sont servis depuis ce dossier ; aucun CDN n'est utilisé par l'application.

Sources : https://github.com/naptha/tesseract.js, https://github.com/naptha/tesseract.js-core, https://github.com/tesseract-ocr/tessdata_fast. Licences Apache 2.0 et mentions des dépendances dans les fichiers `LICENSE-*.txt` ci-joints. `version.json` consigne tailles et SHA-256 de la copie vérifiée.

Les trois fichiers `core/*-lstm.wasm.js` embarquent le WASM dans leur distribution JavaScript : aucun fichier `.wasm` supplémentaire n'est chargé. Le worker choisit la variante compatible avec le navigateur ; l'application utilise uniquement le moteur LSTM.

Copie reproductible : `node scripts/preparer-ocr.mjs` depuis les paquets installés dans `.local/ocr`. Les PNG photographiés ne sont jamais copiés ici et ce moteur n'effectue aucun apprentissage sur les photos.
