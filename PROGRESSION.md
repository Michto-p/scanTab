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
- [ ] Fournir une publication et une inférence du réseau de familles sur téléphone. L'OCR et les règles de familles sans réseau d'apprentissage sont traités par la priorité d'autonomie ci-dessous.

Le modèle d'extraction ImageNet installé n'est pas un modèle de familles d'appareils électriques. Les anciennes mentions « sans dépendance » et « sans OCR » ci-dessus décrivent la livraison initiale ; l'extension ajoute des dépendances uniquement sur le PC. Aucun appel à une API d'IA distante.

Validation de l'extension : 21 tests Node réussis ; 12 tests Python réussis, export ONNX réel inclus ; recette Chrome complète avec OCR local réel et rechargement hors ligne, sans contact PC implicite. La connexion d'un téléphone réel depuis GitHub Pages reste à vérifier.

Publication : https://michto-p.github.io/scanTab/ ; dépôt https://github.com/Michto-p/scanTab. Serveur installé et démarré sur ce poste, port 8787. `Demarrer-PC.cmd` permet de le lancer ou de réafficher l'adresse et le code s'il est déjà actif. Les données, modèles PC et codes sont exclus de Git.

Essai du serveur installé avec le vrai sous-processus Python : création d'un travail, suivi authentifié, rejet du corpus vide et conservation de zéro image, zéro lot et aucun modèle électrique. Les tests ne constituent donc pas un apprentissage de production. À valider maintenant : collecte depuis un téléphone réel ; aucune phase suivante n'est engagée.

## Priorité active – analyse autonome sur téléphone

Correction explicite de l'utilisateur : fournir le travail de base embarqué avant la collecte de données, le PC étant facultatif.

- [x] Embarquer Tesseract.js 7.0.0 et ses langues localement (17,14 Mo, SHA-256 et licences), avec cache complet : OCR réel vérifié après coupure réseau/cache HTTP et fermeture effective des serveurs web et PC.
- [x] Extraire les marquages et proposer les familles par règles prudentes de provenance `regles_ocr`, sans attendre un modèle entraîné. Différentiels ambigus, contradictions et faible confiance restent inconnus ; pas de validation automatique.
- [x] Estimer les rangées, les séparations réelles et le pas modulaire : 12 tests géométriques réussis sur les scénarios annotés, dont 8/13 modules, appareils larges, demi-modules, fond sombre, reflets, perspective rejetée et repère explicite de 18 mm. Intégration de la suppression du défaut 13 modules avec le parcours ci-dessous.
- [x] Fournir l'analyse automatique de la photo, de la rangée ou d'une vignette sur téléphone, avec progrès, annulation effective, sauvegarde des lectures terminées et préservation des saisies humaines. La relecture peut améliorer une suggestion automatique moins confiante. Calibration tactile de 18 mm, reprise après annulation et absence de validation automatique vérifiées dans Chrome.
- [x] Tester sur les références annotées et publier la mise à jour GitHub Pages : déploiement réussi, page publique HTTP 200 ; OCR réel et parcours automatique, annulation/reprise et calibration tactile réussis après rechargement hors ligne depuis `/scanTab/`, sans PC configuré.
- [ ] Recette réelle Android/iOS et photos de tableaux : segmentation, reflets, lisibilité, performances. Ne pas confondre les essais synthétiques avec une qualité attestée sur le terrain.

Vérification de l'autonomie : 45 tests Node réussis. Recette Chrome : 6 contrôles initiaux, parcours manuel et liaison PC conservés ; puis serveurs web et PC de recette réellement fermés, réseau/cache HTTP désactivés, rechargement complet et 5 contrôles OCR embarqué + 5 contrôles de parcours automatique réussis. Le dessin annoté de 8 modules donne 6 PNG pleine résolution `[2,1,1,1,1,2]`, les marquages attendus et les propositions différentiel/disjoncteurs/contacteur, sans validation. Temps observé environ 1,3 à 2 s sur ce PC, aucune mesure de téléphone réel ni de précision métier. `/shared` inchangé.

Recette publique finale : les mêmes 10 contrôles OCR/parcours ont réussi avec la PWA de GitHub Pages hors ligne et aucun PC configuré. Sur ce PC : premier OCR ~0,45 s ; action complète sur le dessin de 8 modules ~1,15 s. Les tâches terrain restent ouvertes ; le PC et le futur corpus ne bloquent plus le travail de base embarqué.

## Travail en cours – automatisation renforcée du 23 novembre 2026

- [x] Démarrer le parcours local dès la capture/import, avec option de mode manuel conservée.
- [x] Proposer le cadrage et le redressement par géométrie, en conservant les corrections et les incertitudes.
- [x] Effectuer géométrie/redressement/détourage dans un Web Worker local, avec annulation de toutes les étapes.
- [x] Ajouter un détourage transparent prudent, un aperçu comparatif et un téléchargement PNG, sans altérer la vignette originale d'apprentissage.
- [x] Vérifier le parcours complet hors ligne, les annulations, les originaux et les exports puis publier la mise à jour.

Vérification locale : 63 tests Node réussis, dont 7 scénarios de cadrage, 8 de détourage et 3 de redressement des pixels. La recette Chrome réussit ses 22 contrôles détaillés et ses parcours complémentaires : mode manuel, import automatique, arrêt dès la recherche de cadrage puis pendant l'OCR, reprise, calibration tactile, saisies conservées, original intact, vrai PNG transparent téléchargé, IndexedDB et ZIP conservés. Les serveurs web et PC sont effectivement fermés et le cache HTTP coupé avant la recette embarquée. Aucun débordement à 390 px. Le cache v8 inclut tous les modules des workers. Aucun changement dans `/shared` ni ajout de dépendance.

Ces essais restent synthétiques. Sur ce PC, le dessin autonome de 8 modules et 6 appareils prend environ 1,65 s ; les performances Android/iOS et la précision sur photos réelles restent à mesurer. Le détourage retire seulement un fond homogène nettement distinct, connecté au bord : les façades touchant le cadre, les fonds variables et les contours ambigus restent intacts avec une explication. L'original reste la source de l'OCR et du ZIP ; le PNG transparent est un téléchargement distinct.

Publication du 23 novembre : commit applicatif `0399041`, déploiement GitHub Pages réussi ([exécution 45148784806](https://github.com/Michto-p/scanTab/actions/runs/45148784806)), page publique HTTP 200 et cache v8 confirmé dans un profil neuf. Les 16 contrôles publics OCR/worker/parcours/PNG téléchargé passent après rechargement avec réseau et cache HTTP désactivés, depuis `/scanTab/` et sans PC configuré ; environ 1,64 s sur le dessin de 8 modules sur ce PC. Les anciens cadrages sans provenance sont conservés comme manuels au chargement. Les tâches terrain restent ouvertes ; aucune phase suivante n'est engagée.

## Priorité active – repérer les appareils avant de lire leur format

- [x] Importer plusieurs photos et les analyser successivement, avec conservation des résultats et arrêt du lot.
- [x] Repérer les façades indépendamment de l'échelle, respecter les appareils de 2,5 modules et exclure les espaces visibles lorsque leurs contours sont distincts ; limites réelles ci-dessous.
- [x] Permettre la lecture des appareils repérés même lorsque le nombre de modules reste inconnu ; confirmer la largeur avant validation et export.
- [x] Identifier une prise modulaire sur marquages/références connus, confronter la largeur à la lecture et afficher les incertitudes.
- [x] Vérifier ces parcours hors ligne sur les références annotées, publier et documenter les limites sur photos réelles.

Recette locale : **97 tests Node réussis**, puis recette Chrome complète avec serveurs web et PC réellement fermés et réseau/cache HTTP désactivés. Les 30 contrôles détaillés embarqués réussissent : OCR, workers, import automatique, annulations, lot de photos avec fichier invalide, sélection tactile d'une façade, prise isolée sans échelle, correction de référence retirant son ancien format, validation humaine de 2,5 modules et ZIP conservant les PNG originaux. Les parcours manuels et la liaison PC restent vérifiés séparément avant la coupure réseau. Les originaux de la photo précédente sont libérés en mémoire après sauvegarde pour le traitement du lot. Aucune dépendance ajoutée, `/shared` inchangé.

Une photo publique réelle est désormais gardée dans `tests/photos`, avec attribution et licence CC BY-SA 3.0 ; elle ne sert pas à l'apprentissage. La recette géométrique retrouve 20 façades par rangée centrale (couverture des bandes annotées : 98,7 % et 90 %, sans chevauchement), malgré le coffret voisin. Le parcours complet avec cadrage fournit 42 vignettes, toutes lues par Tesseract local et non validées, en environ 3,08 s sur ce PC. Les marquages de cette ancienne image sont trop petits pour certifier les références ; les bandes cibles ne sont pas un comptage métier certifié. Des appareils bas restent manqués ou mal séparés et la recherche sans cadrage propose encore des subdivisions et des zones de coffret. Les zones sans échelle sont explicitement à vérifier. Ces résultats ne prouvent pas une reconnaissance universelle ni le respect des 5 s sur téléphone.

Publication vérifiée : commit applicatif `ea75525`, [déploiement GitHub Pages réussi 45215881234](https://github.com/Michto-p/scanTab/actions/runs/45215881234), page publique HTTP 200 et cache **v10** dans un profil Chrome neuf. Après coupure du réseau et du cache HTTP, les **30 contrôles publics** OCR/worker/parcours/lots/ZIP/photo réelle réussissent depuis `/scanTab/`, sans PC configuré. Dernière mesure publique sur ce PC : dessin de 8 modules ~1,83 s ; photo réelle de 42 vignettes ~4,32 s. Ces durées varient selon la charge du poste et ne constituent pas une mesure mobile. Les 42 PNG restaurés ont aussi été comparés aux rectangles de l'image redressée : dimensions conformes et pixels RGBA identiques ; toutes les miniatures sont visibles après décodage. Le compteur de vignettes reste cohérent après correction humaine.

La phase 1 reste ouverte pour les essais sur un corpus réel varié et les téléphones Android/iOS, notamment caméra, orientation, mémoire et performances. Aucune phase suivante engagée.

## Priorité active – parcours simplifié du 24 novembre 2026

Retour utilisateur : très peu d'appareils détectés en pratique et page trop chargée. Les recettes précédentes ne suffisent pas à attester la qualité métier. Reprendre le parcours autour de la photo et d'une sélection simple.

- [x] Épurer l'écran principal et présenter photo, cadrage automatique puis sélection directe avant lecture.
- [x] Ajouter la sélection tactile d'une zone et son nombre total de modules ; utiliser ce repère pour retrouver les appareils simples et larges sans fabriquer de séparations.
- [x] Lire uniquement les découpes choisies et rapprocher l'OCR des références embarquées ou déjà validées localement.
- [x] Adapter les champs au type d'appareil et retirer les caractéristiques incompatibles après une correction humaine de famille.
- [ ] Vérifier le parcours simplifié, sa persistance et le fonctionnement hors ligne, puis publier et documenter les limites restantes.

Vérification locale : **122 tests Node réussis**, dont 14 de sélection calibrée et 11 sur les types/références validées. Les **19 contrôles guidés Chrome** réussissent après rechargement réseau/cache HTTP coupés, avec vrais gestes tactiles et moteur Tesseract local : import sans OCR, zone de huit modules donnant six appareils `[2,1,1,1,1,2]`, zoom de la zone, seulement deux appareils choisis et lus, fiche disjoncteur sans champs différentiels, correction du type et réouverture. Revenir à la sélection puis ajouter une autre zone conserve identifiants, pixels et corrections des premières découpes. Une validation par l'interface de la référence Hager MFS716 est retrouvée sur une nouvelle lecture de même marque/référence, avec source `base_validee` et sans nouvelle validation. IndexedDB est parcouru une seule fois, sans renvoyer les images dans la liste des références. Anciennes recettes de capture/manipulation manuelle, liaison PC, ZIP et détourage conservées et vérifiées.

La sélection est extraite de l'image avant réduction pour préserver les détails d'une petite zone dans une grande photo ; les vignettes restent découpées dans l'image redressée pleine résolution. Pendant une lecture de lot, toutes les miniatures ne sont plus recréées à chaque appareil. Les captures 390 px montrent les réglages repliés, le rail horizontal et les seules caractéristiques pertinentes. Aucune dépendance ajoutée et `/shared` inchangé. Dernière mesure du parcours guidé de six appareils sur ce PC : environ 2,29 s ; d'autres recettes sur poste chargé ont dépassé 5 s. Aucune performance Android/iOS attestée.

Limites restantes : le repérage global garde ses faux positifs et appareils manqués ; la sélection d'une rangée et de son total modulaire sert de repère supplémentaire, pas de reconnaissance sémantique entraînée. Sur la photo publique, des joints faibles restent fusionnés, même avec une zone calibrée ; un grand intervalle peut donc contenir plusieurs appareils. Les zones sans joint restent inconnues. Aucun score de précision métier n'est déduit de ces dessins, d'une seule photo publique ou d'un nombre de contrôles réussis.
