# Progression – Scan Tableau

## État au 22 novembre 2026

Le dossier était vide à l'ouverture de la session. Les consignes reçues sont conservées dans `AGENTS.md`. Le fichier `CAHIER_DES_CHARGES.md` annoncé n'est pas présent. Son emplacement, ou l'utilisation du message initial comme cahier des charges, a été demandé à l'utilisateur.

Le découpage ci-dessous est provisoire : il reprend uniquement le périmètre explicite du message initial et devra être rapproché du cahier des charges avant l'implémentation fonctionnelle.

## Initialisation

- [x] Conserver les consignes, créer l'arborescence demandée et initialiser Git.
- [ ] Lire le cahier des charges complet, ou obtenir la confirmation que le message initial fait foi pour la phase 1.

## Phase 1 – Collecte

- [ ] Créer le socle PWA en modules ES : manifeste, service worker, ressources locales et disponibilité hors ligne.
- [ ] Importer une photo et capturer une image par caméra en conservant la pleine résolution.
- [ ] Afficher les limites de netteté et permettre le cadrage de la photo.
- [ ] Redresser la perspective à partir de coins corrigibles par l'utilisateur.
- [ ] Repérer les rangées et rails DIN et permettre leur correction manuelle.
- [ ] Calibrer l'échelle modulaire (18 mm) et corriger les séparations au demi-module.
- [ ] Découper les appareils en vignettes pleine résolution.
- [ ] Saisir, corriger et valider humainement les étiquettes, avec provenance et confiance explicites.
- [ ] Conserver les séances, photos, vignettes et validations dans IndexedDB.
- [ ] Exporter un lot ZIP avec les vignettes PNG et `labels.json` conforme aux champs demandés.
- [ ] Vérifier le parcours sur les photos de référence, le fonctionnement hors ligne et les navigateurs cibles.
- [ ] Présenter le bilan de phase et attendre la validation avant la phase 2.

## Vérification et limites

- Initialisation vérifiée : présence des 14 dossiers demandés, dépôt Git créé et dossier `shared` vide. Les essais photo ne s'appliquent pas à cette tâche d'initialisation.
- Aucun corpus de photos n'a été fourni dans `tests/photos` ; aucune qualité de reconnaissance ni de segmentation ne peut être attestée.
- Aucun module Electracé n'a été fourni. `shared` reste vide ; aucune copie ni modification de ses modules n'est autorisée par défaut.
- Aucune dépendance n'a été ajoutée et aucune donnée n'a été transmise à un service externe.
- Les tâches fonctionnelles ne doivent être cochées qu'après leurs vérifications, dont les essais pertinents sur `tests/photos`.
