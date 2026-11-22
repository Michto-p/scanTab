# Progression – Scan Tableau

## État au 22 novembre 2026

Le dossier était vide à l'ouverture de la session. Les consignes reçues sont conservées dans `AGENTS.md`. L'utilisateur a confirmé que son message initial fait foi pour la phase 1 ; il est enregistré dans `CAHIER_DES_CHARGES.md`.

Le découpage ci-dessous reprend le périmètre explicite du cahier des charges confirmé. Aucune phase suivante ne sera engagée sans validation.

## Initialisation

- [x] Conserver les consignes, créer l'arborescence demandée et initialiser Git.
- [x] Lire le cahier des charges complet, ou obtenir la confirmation que le message initial fait foi pour la phase 1.

## Phase 1 – Collecte

- [x] Créer le socle PWA en modules ES : manifeste, service worker, ressources locales et disponibilité hors ligne.
- [x] Implémenter l'import et l'entrée caméra native, en conservant l'original et sa pleine résolution. Import vérifié dans Chrome ; caméra physique à essayer lors de la recette terrain.
- [x] Afficher les limites de netteté et permettre le cadrage de la photo (estimation et image uniforme vérifiées dans Chrome).
- [x] Redresser la perspective à partir de coins corrigibles par l'utilisateur (homographie, coins invalides et conservation des pixels vérifiés).
- [x] Proposer les rangées par contraste et permettre leur correction manuelle ; deux bandes du dessin annoté correctement proposées, fond uniforme sans proposition.
- [ ] Vérifier et compléter le repérage des rails DIN sur des photos réelles. L'heuristique livrée propose des bandes d'appareils et ne localise pas un rail masqué.
- [x] Calibrer l'échelle modulaire (18 mm) et corriger les séparations au demi-module (nombre de modules explicitement confirmé par l'utilisateur).
- [x] Découper les appareils en vignettes PNG pleine résolution (dimensions, jointures et modifications manuelles vérifiées sur le dessin annoté).
- [x] Saisir, corriger et valider humainement les étiquettes, avec provenance et confiance explicites. Une modification retire immédiatement la validation ; les valeurs illisibles restent « inconnu ».
- [x] Conserver les séances, photos, vignettes et validations dans IndexedDB (transaction atomique, Blobs, réouverture de la base et restauration après rechargement vérifiés dans Chrome).
- [x] Exporter un lot ZIP avec les vignettes PNG et `labels.json` conforme aux champs demandés ; seules les validations humaines sont exportées, y compris pour plusieurs photos d'une même séance.
- [x] Vérifier le parcours sur le dessin annoté dans Chrome, le regroupement de séance et le fonctionnement hors ligne.
- [ ] Faire la recette sur photos réelles et appareils cibles : caméra, orientation EXIF, Chrome Android, Safari iOS, installation PWA et moins de 5 s par rangée de 13 modules.
- [x] Présenter le bilan de livraison et s'arrêter pour revue, sans engager la phase 2. La phase 1 reste ouverte pour les deux tâches terrain ci-dessus.

## Vérification et limites

- Tests : 11 tests Node réussis et 6 contrôles image/données dans Chrome. Parcours d'interface vérifié : redressement, modification des limites et séparations, 17 vignettes, validation, invalidation lors d'une correction, ZIP de deux photos d'une séance, restauration des deux photos, puis rechargement réseau et cache HTTP coupés et ouverture d'une collecte sauvegardée. Aucun débordement horizontal à 390 px.
- Sur le dessin 720 × 520, 17 vignettes ont été créées en environ 0,01 s sur ce PC ; cette mesure ne permet pas de conclure sur des photos haute résolution ni sur les téléphones cibles.
- Le ZIP téléchargé a aussi été ouvert avec le lecteur ZIP .NET de Windows. Les tests vérifient les CRC, offsets du répertoire central, champs français, UUID distincts, séance commune, marquages corrigés et filtrage des validations.
- Fragilités : propositions par contraste à confirmer, rails physiques non localisés, netteté seulement estimée, mémoire des grandes images non évaluée sur mobile. Aucun OCR ni modèle n'est intégré à la collecte manuelle.
- Initialisation vérifiée : présence des 14 dossiers demandés, dépôt Git créé et dossier `shared` vide. Les essais photo ne s'appliquent pas à cette tâche d'initialisation.
- Un dessin synthétique annoté a été ajouté dans `tests/photos` pour tester les calculs. Aucun corpus de photos réelles n'a été fourni ; aucune qualité de reconnaissance ni de segmentation en conditions réelles ne peut être attestée.
- Aucun module Electracé n'a été fourni. `shared` reste vide ; aucune copie ni modification de ses modules n'est autorisée par défaut.
- Aucune dépendance n'a été ajoutée et aucune donnée n'a été transmise à un service externe.
- Les tâches fonctionnelles ne doivent être cochées qu'après leurs vérifications, dont les essais pertinents sur `tests/photos`.

## Extension autorisée – serveur PC et GitHub Pages

L'utilisateur a autorisé le moteur Python local et choisi `Michto-p/scanTab`. Cette extension ne clôt pas les essais terrain de phase 1 et ne lance pas la phase réglementaire.

- [x] Recevoir les ZIP validés sur un serveur PC local appairé, avec origines CORS explicites et tailles bornées.
- [x] Vérifier les PNG, dédoublonner par SHA-256, exclure les conflits et séparer les séances liées entre entraînement, validation et test.
- [x] Installer Python, PyTorch CPU, torchvision, ONNX Runtime, ONNX, Pillow et NumPy dans `.local/` ; préparer explicitement l'extracteur visuel local.
- [x] Implémenter l'entraînement d'une tête de familles et l'export ONNX : 12 tests Python réussis, dont entraînement et inférence ONNX réels sur corpus artificiel temporaire, sans candidat conservé en production.
- [x] Refuser l'apprentissage sans validation humaine, sans séances disjointes ou sans exemples suffisants par famille ; protéger l'adoption contre une précision inférieure et un changement d'évaluation.
- [x] Vérifier l'OCR local installé sur les marquages artificiels de `tests/photos` : Hager, 16 A et 30 mA reconnus par le vrai moteur Tesseract local.
- [x] Relier l'analyse de vignette, l'envoi de séance et le suivi d'entraînement à l'interface ; vérifier dans Chrome les propositions sans validation automatique, les saisies préservées et les résultats périmés. Le suivi des travaux est testé avec moteur simulé ; l'export et l'inférence CPU sont testés séparément avec Python réel.
- [x] Publier `app/` sur GitHub Pages dans `Michto-p/scanTab` et vérifier l'adresse publique : HTTP 200, déploiement Actions réussi, modules et service worker chargés depuis `/scanTab/`, puis rechargement complet hors ligne dans Chrome. Connexion réelle de cette page HTTPS au serveur PC HTTP local vérifiée dans Chrome de bureau avec permission réseau accordée.
- [ ] Essayer le téléphone réel sur le même Wi-Fi : autorisation réseau Chrome, pare-feu et HTTPS reconnu pour Safari.
- [ ] Collecter plusieurs séances réelles validées, entraîner puis mesurer la reconnaissance sur des séances réservées. Aucun modèle électrique n'est encore adopté.
- [ ] Fournir une publication et une inférence du modèle de familles sur téléphone ; pour cette extension, l'analyse automatique est effectuée sur le PC et la collecte reste hors ligne.

Le modèle d'extraction ImageNet installé n'est pas un modèle de familles d'appareils électriques. Les anciennes mentions « sans dépendance » et « sans OCR » ci-dessus décrivent la livraison initiale ; l'extension ajoute des dépendances uniquement sur le PC. Aucun appel à une API d'IA distante.

Validation de l'extension : 21 tests Node réussis ; 12 tests Python réussis, export ONNX réel inclus ; recette Chrome complète avec OCR local réel et rechargement hors ligne, sans contact PC implicite. La connexion d'un téléphone réel depuis GitHub Pages reste à vérifier.

Publication : https://michto-p.github.io/scanTab/ ; dépôt https://github.com/Michto-p/scanTab. Serveur installé et démarré sur ce poste, port 8787. `Demarrer-PC.cmd` permet de le lancer ou de réafficher l'adresse et le code s'il est déjà actif. Les données, modèles PC et codes sont exclus de Git.

Essai du serveur installé avec le vrai sous-processus Python : création d'un travail, suivi authentifié, rejet du corpus vide et conservation de zéro image, zéro lot et aucun modèle électrique. Les tests ne constituent donc pas un apprentissage de production. À valider maintenant : collecte depuis un téléphone réel ; aucune phase suivante n'est engagée.

## Priorité active – analyse autonome sur téléphone

Correction explicite de l'utilisateur : fournir le travail de base embarqué avant la collecte de données, le PC étant facultatif.

- [ ] Embarquer Tesseract.js et ses langues localement, avec cache complet et test OCR réel réseau et cache HTTP coupés.
- [ ] Extraire les marquages et proposer les familles par règles prudentes et provenance distincte, sans attendre un modèle entraîné.
- [x] Estimer les rangées, les séparations réelles et le pas modulaire : 12 tests géométriques réussis sur les scénarios annotés, dont 8/13 modules, appareils larges, demi-modules, fond sombre, reflets, perspective rejetée et repère explicite de 18 mm. Intégration de la suppression du défaut 13 modules avec le parcours ci-dessous.
- [ ] Fournir l'analyse automatique de la photo et de la rangée sur téléphone, avec progrès, annulation, conservation des corrections et validation humaine.
- [ ] Tester sur les références annotées et publier la mise à jour GitHub Pages.
- [ ] Recette réelle Android/iOS et photos de tableaux : segmentation, reflets, lisibilité, performances. Ne pas confondre les essais synthétiques avec une qualité attestée sur le terrain.
