# Scan Tableau

PWA locale de collecte et de validation de photos de tableaux électriques pour le CFA et le CAP Électricien.

Les consignes de travail sont dans [AGENTS.md](AGENTS.md), et le suivi dans [PROGRESSION.md](PROGRESSION.md).

## État du projet

Initialisation de l'arborescence. L'application n'est pas encore implémentée.

Le fichier `CAHIER_DES_CHARGES.md` annoncé dans les consignes n'a pas été trouvé dans le dossier initial. Il reste à fournir son emplacement ou à confirmer que le message initial de l'utilisateur fait foi pour la phase 1.

## Organisation

- `app/` : application PWA, capture, traitement, segmentation, identification, apprentissage, base locale, interface, exports et règles.
- `shared/` : réservé aux modules Electracé ; lecture seule par défaut, aucune modification sans accord explicite.
- `models/` : futurs modèles locaux publiés et leur version.
- `training/` : futurs scripts d'entraînement sur PC.
- `tests/photos/` : corpus de photos de référence et résultats attendus, à fournir.

L'application devra fonctionner hors ligne après le premier chargement. Les ressources et les modèles seront servis localement, et les données resteront sur l'appareil sauf export demandé par l'utilisateur.
