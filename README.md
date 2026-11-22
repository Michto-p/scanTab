# Scan Tableau

PWA locale de collecte et de validation de photos de tableaux électriques pour le CFA et le CAP Électricien.

Les consignes de travail sont dans [AGENTS.md](AGENTS.md), et le suivi dans [PROGRESSION.md](PROGRESSION.md).

## État du projet

Socle PWA local initialisé ; fonctionnalités de collecte en cours d'implémentation.

L'utilisateur a confirmé que son message initial fait foi pour la phase 1. Il est conservé dans [CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md).

## Organisation

- `app/` : application PWA, capture, traitement, segmentation, identification, apprentissage, base locale, interface, exports et règles.
- `shared/` : réservé aux modules Electracé ; lecture seule par défaut, aucune modification sans accord explicite.
- `models/` : futurs modèles locaux publiés et leur version.
- `training/` : futurs scripts d'entraînement sur PC.
- `tests/photos/` : corpus de photos de référence et résultats attendus, à fournir.

L'application devra fonctionner hors ligne après le premier chargement. Les ressources et les modèles seront servis localement, et les données resteront sur l'appareil sauf export demandé par l'utilisateur.

## Lancement local

Node.js 24 ou récent suffit, sans installation de bibliothèque :

```sh
node scripts/serve.mjs
```

Ouvrir `http://localhost:8080/app/`. Attendre la mention « Disponible hors ligne » avant de couper la connexion. Un fichier ouvert directement par `file://` ne permet pas le service worker.

```sh
node --test tests/*.test.mjs
node tests/run-browser.mjs --shell
```

La recette navigateur utilise Chrome installé sur Windows ; `CHROME_PATH` permet de désigner un autre exécutable Chromium. Pour un téléphone, servir les fichiers de `app/` en HTTPS : une adresse HTTP du PC sur le réseau local ne suffit pas pour la caméra et le service worker.
