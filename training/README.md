# Moteur du PC

Le serveur Node.js reçoit les actions explicites de la PWA. Tesseract.js lit les marquages ; Python classe uniquement la famille lorsqu'un modèle électrique entraîné existe. Aucun service d'IA distant n'est utilisé.

Ce serveur est facultatif : la PWA possède aussi son propre OCR, une estimation géométrique et des règles de familles qui fonctionnent directement sur le téléphone. Il n'est pas nécessaire de l'installer ou de connecter un PC pour le travail de base.

## Installation et démarrage Windows

1. Installer Node.js 24 ou récent.
2. Ouvrir `Installer-moteur.cmd` à la racine. Cette étape télécharge Python portable 3.14.10, les bibliothèques CPU, Tesseract.js, ses langues français/anglais et l'extracteur MobileNet V3 Small ImageNet. Aucun ajout au PATH ni au registre. Les fichiers restent dans `.local/`, ignoré par Git.
3. Ouvrir `Demarrer-PC.cmd`. Garder le terminal ouvert. Il affiche l'adresse réseau et le code d'appairage. `Ctrl+C` arrête le serveur.
4. Sur le téléphone, ouvrir `https://michto-p.github.io/scanTab/`, puis le panneau PC. Saisir l'adresse affichée (par exemple `http://192.168.1.20:8787`) et le code. Autoriser l'accès au réseau local si le navigateur le demande.

Sur un autre PC, cloner ou télécharger ce dépôt puis exécuter l'installation. Après installation initiale, analyse et entraînement n'effectuent aucun téléchargement. Les versions testées sont dans `requirements.txt` et `installer-moteur.ps1` ; les versions transitives installées sont consignées localement dans `.local/requirements-installes.txt`.

```powershell
# Diagnostic sans réseau
.local/python/python.exe -I -X utf8 training/engine.py status
# Serveur uniquement sur ce PC
node training/server.mjs
# Serveur sur le réseau local, origine web explicitement autorisée
node training/server.mjs --lan --origin https://michto-p.github.io
# HTTPS si le navigateur exige un certificat reconnu
node training/server.mjs --lan --origin https://michto-p.github.io --cert chemin/cert.pem --key chemin/key.pem
```

Le serveur ne modifie pas le pare-feu. Si Windows le demande, autoriser Node sur le réseau privé utilisé. Pas de redirection de port du routeur. Un Wi-Fi invité peut isoler les appareils. `localhost` sur le téléphone désigne le téléphone, pas le PC.

L'accès depuis une page HTTPS vers un serveur HTTP local dépend du navigateur et de ses permissions réseau. Chrome récent dispose d'une permission dédiée ; Safari/iOS doit encore être essayé, avec HTTPS reconnu par le téléphone si nécessaire. Un certificat auto-signé non approuvé ne suffit pas. Ne pas désactiver les protections du navigateur. En cas de refus, la collecte et l'export ZIP restent utilisables.

## Analyse

À l'étape **Valider**, sélectionner une vignette à vérifier, puis **Envoyer cette vignette pour analyse** dans le panneau PC. Seul son PNG est envoyé ; la photo complète n'est pas transmise. Une analyse n'alimente pas le corpus. Le texte OCR est conservé en mémoire pour affichage ; une image temporaire nécessaire au classifieur est supprimée après traitement.

Les champs encore inconnus reçoivent des propositions avec score et provenance. Les saisies existantes et la largeur du découpage sont conservées. Une correction ou un changement de vignette pendant l'attente fait écarter le résultat. La validation reste humaine.

L'OCR reconnaît une liste explicite de marques et des marquages tels que `C16`, `30 mA`, `IΔn 0,03 A`, `Type A`, `1P+N`. Une référence exige une mention explicite « réf/référence ». Les chiffres isolés ne deviennent pas une référence. Sous 0,8 de confiance OCR globale, ou en cas de contradiction, la valeur reste inconnue. Le score global n'est pas une garantie par champ. Pas de lecture des pictogrammes différentiels ni de catalogue de références dans cette version.

## Corpus et apprentissage

**Envoyer la séance validée au PC** transfère seulement les appareils validés de la séance ouverte. Les lots restent dans `.local/pc/batches/`, les PNG dans `.local/pc/images/`. Sauvegarder ce dossier sur un support choisi explicitement. Le code d'appairage est dans `.local/pc/pairing-code` ; ne pas le publier. Pour le renouveler, arrêter le serveur, supprimer uniquement ce fichier, puis redémarrer.

**Préparer les données d'apprentissage** vérifie les validations, fusionne les imports, dédoublonne par SHA-256 et exclut les étiquettes contradictoires. Une correction plus récente du même appareil dans la même séance remplace l'ancienne. Des séances liées par une image identique restent ensemble. Le découpage déterministe est d'environ 80 % entraînement, 10 % validation, 10 % test par groupe de séances, pas par vignette.

**Entraîner le modèle sur le PC** prépare les données puis lance un travail CPU. Un seul entraînement est accepté à la fois ; les imports peuvent continuer, mais la préparation du jeu est verrouillée jusqu'à la fin. Fermer le téléphone n'interrompt pas le travail ; arrêter le serveur l'interrompt. Les identifiants de travaux sont conservés en mémoire pendant la vie du serveur, jusqu'aux 20 derniers.

Il faut au minimum deux familles, et pour **chaque** famille au moins 3 vignettes distinctes en entraînement, 2 en validation et 2 en test, provenant de séances disjointes entre jeux. Ces minima protègent le mécanisme ; ils ne suffisent pas à garantir une reconnaissance utile. Collecter des séances variées, appareils, éclairages et prises de vue indépendants. Les quasi-doublons visuels ne sont pas détectés : garder le même identifiant de séance pour toutes les photos liées.

L'extracteur visuel préentraîné est figé. Une tête dense apprend les familles humaines ; les caractéristiques électriques restent issues de l'OCR et de la validation. Le prétraitement conserve l'appareil entier dans un carré blanc de 224 px, sans recadrage central. L'export ONNX est comparé à PyTorch puis évalué avec ONNX Runtime CPU sur les séances de test réservées.

Les candidats, leur SHA-256, date, précision, couverture au seuil et classes sont dans `.local/pc/models/candidates/`. `models/current.json` dans ce même dossier PC pointe sur le modèle adopté. Adoption automatique seulement si la précision ne baisse pas sur exactement la même évaluation et les mêmes familles. Si l'évaluation change, le candidat est conservé pour revue ; aucune adoption forcée n'est proposée ici. Une confiance famille inférieure à 0,8 produit « inconnu ».

**Aucun modèle électrique n'est livré au départ.** ImageNet sert seulement d'extracteur : l'OCR fonctionne déjà, mais la famille reste inconnue tant qu'un modèle n'a pas été entraîné et adopté. L'inférence de familles sur téléphone et la publication de ses versions dans le dossier public `/models` restent à implémenter. Le modèle PC n'est pas publié automatiquement.

## Tests

```powershell
npm test
node tests/run-browser.mjs --ocr
$env:SCAN_TABLEAU_TEST_TRAIN = '1'
.local/python/python.exe -I -X utf8 -m unittest discover -s tests -p test_engine.py
```

Le dernier test entraîne/exporte un modèle avec des poids artificiels dans un dossier temporaire ensuite supprimé. Il vérifie le mécanisme, ne mesure pas la reconnaissance d'un tableau réel et ne crée pas de modèle de production.

## Protocole

API locale uniquement, Bearer d'appairage obligatoire, origines CORS exactes, pas de cookies ni redirections. `GET /api/status`, `POST /api/analyze` (PNG ≤ 32 Mio et 40 mégapixels), `POST /api/batches` (ZIP ≤ 128 Mio), `POST /api/dataset/prepare`, `POST /api/train`, `GET /api/jobs/<UUID>`. Aucune route pour lire librement un fichier du PC. Le code, les données, l'interpréteur et les journaux `.local/` ne sont jamais servis par le serveur statique.

Le code protège l'accès au corpus mais un transfert HTTP local n'est pas chiffré. Utiliser le Wi-Fi de confiance et HTTPS pour protéger photos et code en transit.
