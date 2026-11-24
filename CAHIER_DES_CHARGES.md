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

## Priorité corrigée par l'utilisateur – autonomie sur téléphone

Le 22 novembre 2026, l'utilisateur précise que le travail de base doit fonctionner dès maintenant sur le téléphone, sans PC et sans attendre la collecte de données : mise à l'échelle modulaire, découpage et lecture des appareils. Le PC reste un complément pour l'apprentissage ultérieur.

- Embarquer Tesseract.js, son moteur et ses langues dans la PWA et son cache hors ligne. Aucun CDN ni appel au PC pour cette analyse.
- Proposer un parcours automatique depuis la photo, avec rangées, séparations de façades, estimation du pas modulaire et lecture OCR ; conserver les corrections manuelles et les PNG pleine résolution.
- Un module vaut 18 mm. La conversion pixels/mm demande une estimation visuelle du pas répété ou un repère calibré ; ne jamais fixer arbitrairement 13 modules ni présenter cette estimation comme une mesure physique certaine.
- Des règles explicites sur les marquages peuvent proposer une famille avant l'entraînement d'un réseau ; leur provenance est `regles_ocr`, jamais `classifieur`. Les ambiguïtés et faibles scores restent inconnus, aucune proposition n'est validée automatiquement.
- La collecte de données et l'amélioration par modèle viendront ensuite ; elles ne doivent pas bloquer les fonctions de base embarquées.

## Automatisation renforcée – 23 novembre 2026

L'utilisateur demande que le gros du travail soit effectué sur téléphone : lecture de photo, OCR, détection et détourage automatiques des produits modulaires.

- Après capture ou import, lancer par défaut le parcours local complet ; proposer un mode manuel désactivant ce démarrage.
- Proposer un cadrage et un redressement automatique uniquement si les indices visuels sont suffisants ; laisser l'original accessible et les coins corrigibles.
- Déporter les calculs de pixels et de géométrie dans un Web Worker local, avec progression et annulation avant comme pendant l'OCR.
- Conserver la vignette originale pleine résolution pour l'OCR et le corpus. Produire en plus un PNG à fond transparent si le détourage est assez fiable ; sinon garder les pixels et signaler cette limite. Une découpe rectangulaire ne doit pas être présentée comme un masque précis garanti.
- Ne pas modifier le format ZIP d'apprentissage ni transmettre automatiquement une photo au PC.

## Reprise du parcours depuis les photos – 23 novembre 2026

L'utilisateur précise le parcours attendu : prendre une ou plusieurs photos, trouver les appareils de façon autonome, adapter leur largeur modulaire puis lire chacun. Les exemples à couvrir sont le disjoncteur courant d'un module, le différentiel de deux modules et la prise modulaire de 2,5 modules. Ces formats ne sont pas des règles universelles de reconnaissance : la largeur de la façade et les marquages doivent se confirmer.

- Importer plusieurs photos dans une même séance et les analyser successivement sur le téléphone, sans PC ni transfert implicite ; permettre l'arrêt du lot.
- Repérer les façades avant d'exiger une échelle : l'OCR d'un appareil détecté ne doit pas être bloqué parce que sa largeur physique est inconnue.
- Conserver les vrais appareils larges, notamment 2,5 modules, et exclure les espaces vides des vignettes d'appareils quand les indices le permettent.
- Distinguer largeur estimée par géométrie, largeur issue d'une référence constructeur locale connue et largeur confirmée manuellement. Un type seul ne fixe pas les dimensions.
- Lire les prises modulaires et signaler une contradiction entre la largeur et un marquage explicite, sans modifier silencieusement le découpage pour faire correspondre une famille.
- Une photo floue, un appareil masqué, une perspective trop forte ou une façade sans contours ne permettent pas une détection garantie. L'application doit montrer ce qui reste inconnu et conserver les corrections ; « quelle que soit la photo » constitue un objectif de robustesse, pas une promesse de reconnaissance sans information visible.

## Correction du parcours demandée le 24 novembre 2026

L'utilisateur constate une détection insuffisante et une page trop chargée. La priorité reste la phase 1 : une photo, cadrage automatique, sélection directe des appareils à lire puis résultats utiles.

- Épurer l'écran principal : photo, sélection tactile, nombre de modules et lecture. Ranger les réglages de séance, les corrections fines et le PC parmi les options secondaires.
- Permettre de toucher les appareils proposés ou d'encadrer directement une rangée. Le nombre renseigné est la largeur totale de la zone, en modules de 18 mm ; chercher ensuite les joints visibles pour distinguer les appareils simples, larges et de 2,5 modules. Ne pas remplacer cette recherche par une coupe systématique tous les modules.
- Ne lancer l'OCR que sur les découpes choisies, après cette sélection. Conserver le cadrage automatique, les originaux, la validation humaine et l'export.
- Rapprocher les marquages des références embarquées et des références déjà validées sur cet appareil. Refuser les rapprochements ambigus et ne jamais utiliser une simple proposition comme donnée confirmée.
- Adapter le formulaire au type : un disjoncteur simple ne présente pas de champs de sensibilité ou de classe différentielle ; une prise ne présente pas de caractéristiques de protection. Un changement explicite de famille retire les caractéristiques devenues incompatibles.
- Aucune dépendance ni architecture nouvelle n'est nécessaire ; les calculs et l'OCR restent embarqués et hors ligne.

## Correction de la géométrie demandée après essai du 24 novembre 2026

Le parcours simplifié ne résout pas le problème de fond constaté par l'utilisateur : les limites de largeur et de hauteur d'un appareil ne sont pas correctement comprises. Reprendre la détection des façades et leur redressement avant de découper et de lire.

- Détecter les quatre bords d'une façade en deux dimensions, sans exiger une grande enceinte rectangulaire ni une rangée déjà calibrée. Une bande de texte ne doit pas devenir à elle seule la hauteur d'un appareil.
- Conserver un quadrilatère et les coordonnées dans la photo source. Regrouper les appareils par leur alignement et leur orientation, puis redresser chaque façade avant OCR ; ne pas lire seulement son rectangle englobant incliné.
- Estimer les largeurs modulaires dans le plan redressé, à partir des joints ou d'un repère fiable. Ne pas supposer une hauteur physique universelle à partir des seuls 18 mm.
- Vérifier visuellement les contours complets et les découpes sur une vraie photo de résolution suffisante ; mesurer les erreurs de géométrie, pas seulement le bon déroulement des boutons.
- Conserver les corrections humaines, les coordonnées sources et les données existantes. Ne pas annoncer une compréhension fiable de toute photo sans validation sur les photos concernées.
- Précision de l'utilisateur : les photos prioritaires sont prises avec cache/plastron. Détecter la façade visible jusqu'à la fenêtre du plastron, sans extrapoler des bornes masquées ni exiger le corps complet d'un appareil déposé.
