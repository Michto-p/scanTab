<!-- Le 22 novembre 2026, l'utilisateur a confirmé que son message initial fait foi pour la phase 1. -->

# Scan Tableau – Reconnaissance photo de tableaux électriques

## Objectif

PWA qui photographie un tableau électrique modulaire, découpe chaque appareil, l'identifie (famille, marque, référence, calibre, courbe, sensibilité, classe différentielle) et permet sa validation. Outil pédagogique (CFA, CAP Électricien) et d'allègement de la charge de travail. Priorité : la reconnaissance.

Le cahier des charges complet est dans CAHIER_DES_CHARGES.md, à la racine. Il fait foi en cas de doute.

## Démarrage autonome

Au début de chaque session :

1. Lire ce fichier, puis CAHIER_DES_CHARGES.md.
2. Lire PROGRESSION.md (le créer s'il n'existe pas) : il liste les tâches de la phase en cours, cochées ou non.
3. Si l'arborescence n'existe pas, la créer, initialiser Git et faire un premier commit.
4. Prendre la prochaine tâche non cochée de la phase en cours, l'implémenter, la tester, la cocher dans PROGRESSION.md, puis faire un commit au message clair en français.
5. Enchaîner les tâches de la phase sans demander, sauf décision d'architecture, ajout de dépendance non listée, ou modification de /shared.
6. En fin de phase : résumer ce qui marche, ce qui reste fragile, et s'arrêter pour validation avant la phase suivante.

## Règles absolues

- 100 % hors ligne après le premier chargement. AUCUN appel à une API d'IA distante.
- IA uniquement locale : ONNX Runtime Web ou TensorFlow.js, Tesseract.js, OpenCV.js.
- Bibliothèques et modèles servis localement (pas de CDN à l'exécution).
- Aucune donnée ne quitte l'appareil sans action explicite de l'utilisateur.
- Seules les données validées par un humain servent à l'apprentissage.
- Pas de sur-ingénierie : JavaScript natif (modules ES), pas de framework lourd, pas d'étape de build sauf nécessité démontrée.
- Interface et commentaires en français.

## Projet indépendant

Cet outil est séparé d'Electracé. Il réutilise seulement certains modules et le moteur de présentation, copiés dans /shared. Ne JAMAIS modifier /shared sans demander : ces modules doivent rester compatibles avec Electracé.

## Arborescence

```text
/app                 PWA (index.html, manifest, service worker)
/app/capture         caméra, cadrage, netteté, import galerie
/app/pretraitement   redressement perspective, CLAHE, reflets
/app/segmentation    rails DIN, rangées, échelle modulaire, découpage
/app/identification  cascade : code-barres > OCR référence > OCR caractéristiques > classifieur > saisie manuelle
/app/apprentissage   vecteurs, k plus proches voisins, tête dense (Web Worker)
/app/base            IndexedDB : références, vignettes, étiquettes, modèles
/app/interface       validation, correction, vue schématique
/app/exports         ZIP de données, CSV, PDF, JSON
/app/regles          règles NF C 15-100 versionnées (phase 4)
/shared              modules repris d'Electracé (lecture seule par défaut)
/models              modèles publiés + version.json
/training            scripts Python d'entraînement sur PC (hors PWA)
/tests/photos        photos de référence annotées + résultats attendus
```

## Conventions

- Module modulaire = 18 mm ; largeurs arrondies au demi-module.
- Chaque résultat porte : valeur, score de confiance, niveau de la cascade.
- Sous le seuil de confiance : renvoyer « inconnu », ne jamais inventer.
- Le réseau classe d'abord la FAMILLE ; marque, calibre, courbe et sensibilité viennent de l'OCR et de la base.
- Vignettes découpées dans l'image en pleine résolution.
- Export de lot : ZIP = vignettes PNG + labels.json (id, famille, marque, référence, calibre, courbe, sensibilité, classe, pôles, modules, séance, date, validé_par).

## Cycle téléphone / PC

1. Téléphone : collecte et validation, export ZIP ou Firebase Storage (optionnel).
2. PC (/training) : fusion, dédoublonnage, séparation par SÉANCE photo (jamais par photo), entraînement, export ONNX.
3. Publication dans /models avec version.json (version, date, précision).
4. L'app compare les versions au démarrage, met en cache le nouveau modèle, et ne l'adopte que si sa précision est au moins égale.

## Phase en cours

Phase 1 – Collecte : capture, redressement, rails, découpage modulaire avec correction manuelle, validation, IndexedDB, export ZIP.

## Façon de travailler

- Petites étapes testables, une fonctionnalité à la fois.
- Tester sur /tests/photos avant de cocher une tâche.
- Signaler franchement les limites (photo floue, marquage illisible) plutôt que masquer l'incertitude.
- Cibles : Chrome et Safari récents, Android et iOS ; moins de 5 s par rangée de 13 modules ; modèles embarqués sous 30 Mo.

## Extension demandée le 22 novembre 2026 – liaison téléphone / PC

L'utilisateur demande une PWA hébergée sur GitHub Pages et un serveur fonctionnant sur le PC, auquel le téléphone peut se connecter lorsqu'il est sur le même réseau local pour analyser les photos et enrichir le modèle.

- GitHub Pages distribue les fichiers statiques de l'application ; les photos, étiquettes privées et codes d'appairage restent hors du dépôt et de l'hébergement.
- Le serveur du PC est facultatif. La collecte, les corrections, la validation et l'export ZIP restent utilisables hors connexion sans ce serveur.
- Une adresse locale et un code permettent l'appairage. Aucun balayage du réseau, aucun envoi automatique de photo et aucune API d'IA sur Internet.
- L'analyse au PC et le transfert des validations sont des actions explicites. Seules les validations humaines alimentent le corpus d'apprentissage ; les prédictions restent à confirmer.
- Le PC dédoublonne les images, conserve les séances et prépare les jeux par séance. Des doublons entre séances relient celles-ci pour éviter une fuite entre entraînement et test. Les étiquettes contradictoires sont exclues.
- La liaison doit tenir compte de CORS, de l'autorisation d'accès au réseau local et, pour les configurations qui l'exigent, d'HTTPS avec un certificat reconnu par le téléphone.
- Le moteur d'analyse et d'entraînement nécessite un modèle initial, des données et un accord pour toute dépendance non listée. Sans moteur, le serveur l'indique et ne prétend pas reconnaître ni entraîner.
- Accord reçu : moteur Python CPU local avec PyTorch, ONNX Runtime, Pillow et NumPy, torchvision pour l'extracteur et ONNX pour l'export. Les installations et le téléchargement initial de l'extracteur sont explicites ; analyse et entraînement utilisent ensuite uniquement les fichiers locaux.
- Dépôt choisi : `Michto-p/scanTab`. Publication statique de `app/`, données privées et installations dans `.local/` ignoré par Git.
- La première version analyse une vignette sélectionnée explicitement. Elle propose les marquages par OCR et la famille si un modèle électrique a été entraîné. Elle ne remplace pas une saisie connue et ne valide jamais automatiquement.
- Un candidat ONNX de moins de 30 Mo est évalué sur des séances réservées. Il remplace automatiquement le modèle local seulement si sa précision est au moins égale sur les mêmes familles et la même évaluation ; sinon il reste candidat. Un changement d'évaluation exige une revue.
