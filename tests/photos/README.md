# Photos de référence

Ce dossier est réservé aux photos de tableaux électriques et à leurs annotations attendues pour les vérifications de la phase 1.

Aucune photo réelle n'a été fournie. `tableau-synthetique.svg` et son fichier d'annotations décrivent deux rangées de treize modules : ce dessin permet de vérifier la géométrie et le découpage. Il ne valide ni le repérage sur des coffrets réels, ni les reflets, ni la lisibilité des marquages. Il ne doit pas être utilisé comme donnée d'apprentissage réelle.

Les tests Node rasterisent les rectangles opaques de ce dessin ; les tests Chrome utilisent le décodage SVG natif. Ajouter des photos réelles annotées (coffrets droits et inclinés, appareils larges, flou, reflets) pour la recette métier. Conserver l'identifiant de séance photo afin de permettre ultérieurement une séparation des jeux d'entraînement par séance.

`tableau-lecture-autonome.svg` et ses annotations proposent une scène artificielle distincte : une rangée de huit modules, six appareils de largeurs `[2, 1, 1, 1, 1, 2]`, des joints visibles et des marquages typographiques. La recette Chrome hors ligne vérifie la détection de l’échelle, les découpes PNG à la résolution originale et la lecture locale d’un différentiel, de quatre disjoncteurs et d’un contacteur. Les propositions restent non validées. Ce dessin vérifie le fonctionnement du parcours ; sa réussite ne mesure aucune précision sur des appareils réels.

`cadrage-autonome.annotations.json` décrit les coins attendus de coffrets artificiels frontaux et inclinés, avec variantes de bruit, reflets et coffret vide. `detourage-synthetique.annotations.json` décrit une façade isolée, son fond et les inscriptions à protéger. Les tests construisent les pixels à partir de ces annotations : ils vérifient le cadrage prudent, le masque alpha, les refus de détourage et la conservation de l'original. La recette Chrome les utilise aussi pour comparer les aperçus et contrôler le PNG réellement téléchargé.
