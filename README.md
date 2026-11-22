# Scan Tableau

PWA locale de collecte et de validation de photos de tableaux électriques pour le CFA et le CAP Électricien.

Les consignes de travail sont dans [AGENTS.md](AGENTS.md), et le suivi dans [PROGRESSION.md](PROGRESSION.md).

## État du projet

Le parcours de collecte est utilisable : import et entrée caméra native, cadrage, redressement, proposition de rangées, correction au demi-module, vignettes PNG, étiquettes humaines, stockage local et export ZIP par séance.

L'identification utilise la saisie manuelle. Aucun OCR, classifieur, apprentissage, modèle ni contrôle réglementaire n'est encore intégré. Le repérage automatique des rails DIN sur photos réelles et la recette sur téléphones restent ouverts en phase 1 ; voir les cases non cochées dans `PROGRESSION.md`.

L'utilisateur a confirmé que son message initial fait foi pour la phase 1. Il est conservé dans [CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md).

## Organisation

- `app/` : application PWA, capture, traitement, segmentation, identification, apprentissage, base locale, interface, exports et règles.
- `shared/` : réservé aux modules Electracé ; lecture seule par défaut, aucune modification sans accord explicite.
- `models/` : futurs modèles locaux publiés et leur version.
- `training/` : futurs scripts d'entraînement sur PC.
- `tests/photos/` : dessin synthétique annoté ; corpus de photos réelles encore à fournir.

L'application fonctionne hors ligne une fois la mention « Disponible hors ligne » affichée. Les ressources sont locales ; aucune dépendance, aucun CDN, aucune API d'IA distante ni aucun envoi de photo ne sont utilisés. Les données quittent le navigateur uniquement lorsque l'utilisateur demande le téléchargement du ZIP.

## Lancement local

Node.js 24 ou récent suffit, sans installation de bibliothèque :

```sh
node scripts/serve.mjs
```

Ouvrir `http://localhost:8080/app/`. Attendre la mention « Disponible hors ligne » avant de couper la connexion. Un fichier ouvert directement par `file://` ne permet pas le service worker.

```sh
node --test tests/*.test.mjs
node tests/run-browser.mjs
```

La recette navigateur utilise Chrome installé sur Windows ; `CHROME_PATH` permet de désigner un autre exécutable Chromium. Pour un téléphone, servir les fichiers de `app/` en HTTPS : une adresse HTTP du PC sur le réseau local ne suffit pas pour la caméra et le service worker.

## Parcours de collecte

1. Prendre une photo avec la caméra native du téléphone ou importer une image. Le fichier original est conservé, sans réduction de résolution. Un format illisible est signalé ; JPEG et PNG sont les formats conseillés pour les essais.
2. Ouvrir « Informations de séance et de validation » pour nommer le tableau et confirmer l'identifiant de séance. Toutes les photos d'une même prise de vue doivent garder cet identifiant ; « Nouvelle séance » en crée un autre.
3. Dans « Redresser », déplacer les quatre coins ou renseigner leurs positions en pourcentage. Appliquer le redressement ; le traitement utilise l'image originale, pas la miniature d'affichage.
4. Dans « Découper », proposer ou ajouter les rangées. Ajuster leurs limites et confirmer leur nombre de modules. **13 modules est une proposition initiale**, pas une mesure de la photo. Un module vaut 18 mm.
5. Ajuster les séparations par demi-module : toucher l'intérieur d'une rangée, ou saisir les positions séparées par des points-virgules (`1; 2; 4; 6.5`). Retirer une séparation réunit les appareils larges. Créer les vignettes.
6. Vérifier chaque vignette, saisir la famille et les marquages lisibles, renseigner le validateur, puis valider. Une famille identifiable est nécessaire ; les autres champs peuvent rester « inconnu ». Toute correction retire la validation de l'appareil.
7. Exporter la séance en ZIP. Les photos enregistrées portant le même identifiant sont regroupées ; seules leurs vignettes validées sont incluses. Un cadrage modifié doit être appliqué avant l'export.

Les photos enregistrées se rouvrent dans la liste, y compris après redémarrage hors ligne. Une sauvegarde automatique confirme « Enregistré sur cet appareil ». Le stockage appartient au profil du navigateur ; conserver les ZIP pour les transferts sur PC et avant d'effacer les données du navigateur.

## Format du ZIP

ZIP standard sans compression (les PNG sont déjà compressés), avec noms UTF-8 et CRC-32, sans bibliothèque supplémentaire :

```text
vignettes/<id>.png
labels.json
```

`labels.json` contient un tableau d'appareils. Chaque entrée porte `id`, `famille`, `marque`, `référence`, `calibre`, `courbe`, `sensibilité`, `classe`, `pôles`, `modules`, `séance`, `date` et `validé_par`.

Chaque caractéristique est un objet `{ "valeur": ..., "confiance": ..., "niveau": "manuel" }`. Le calibre est saisi en A et la sensibilité en mA ; la largeur numérique est arrondie au demi-module. Une valeur inconnue conserve une confiance de 0. Après validation, la confiance de 1 atteste une confirmation humaine et ne représente pas une probabilité calculée par un modèle.

`séance` est l'identifiant commun à la prise de vue, distinct de l'identifiant de chaque photo conservée localement. `date` est la date ISO de validation humaine. Les photos originales ne sont pas incluses dans le ZIP. La séparation future des données d'entraînement devra utiliser `séance`.

## Vérification et limites

Les tests couvrent les quadrilatères invalides, la perspective, les demi-modules, les bandes du dessin annoté, la validation, l'exclusion des appareils non validés et le format ZIP. La recette Chrome vérifie aussi les pixels, IndexedDB, les corrections dans l'interface, un export regroupant deux photos, la restauration et le rechargement sans réseau ni cache HTTP.

Le dessin de `tests/photos` n'est pas une photo réelle. La proposition de rangées utilise le contraste, ne garantit pas la localisation des rails DIN et exige une correction humaine. La netteté estimée ne garantit pas la lisibilité d'un marquage. Les grandes images peuvent atteindre les limites mémoire du téléphone ; aucune réduction silencieuse de résolution n'est appliquée.

La caméra physique, l'orientation des photos de téléphone, Safari iOS, Chrome Android et l'objectif de moins de 5 secondes par rangée réelle de 13 modules restent à essayer. Aucun résultat de reconnaissance automatique n'est revendiqué à cette phase.
