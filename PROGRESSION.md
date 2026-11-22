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
- [ ] Vérifier le parcours sur les photos de référence, le fonctionnement hors ligne et les navigateurs cibles.
- [ ] Présenter le bilan de phase et attendre la validation avant la phase 2.

## Vérification et limites

- Socle : 2 tests Node réussis ; recette Chrome sans interface réussie (rechargement réseau coupé, ressources du socle disponibles, absence de débordement à 390 px). Safari et les appareils physiques restent à vérifier.
- Initialisation vérifiée : présence des 14 dossiers demandés, dépôt Git créé et dossier `shared` vide. Les essais photo ne s'appliquent pas à cette tâche d'initialisation.
- Un dessin synthétique annoté a été ajouté dans `tests/photos` pour tester les calculs. Aucun corpus de photos réelles n'a été fourni ; aucune qualité de reconnaissance ni de segmentation en conditions réelles ne peut être attestée.
- Aucun module Electracé n'a été fourni. `shared` reste vide ; aucune copie ni modification de ses modules n'est autorisée par défaut.
- Aucune dépendance n'a été ajoutée et aucune donnée n'a été transmise à un service externe.
- Les tâches fonctionnelles ne doivent être cochées qu'après leurs vérifications, dont les essais pertinents sur `tests/photos`.
