# Logos de maison

Une maison peut afficher un **logo à la place de son nom écrit** dans l'en-tête
(demande Yann 2026-08-31 : la calligraphie PONAIRE). Les autres maisons gardent
leur nom en texte.

## Ajouter le logo d'une maison

1. **Déposer le fichier** ici, nommé `<slug>.webp` — le slug est le nom de la
   maison en minuscules, sans accent, espaces et ponctuation remplacés par `-`
   (`PONAIRE` → `ponaire.webp`).
2. **Déclarer le slug** dans `LOGOS_MAISON` (`site/app.js`).

Les deux, sinon rien ne s'affiche : la liste est explicite **par choix**. Le
repli « on tente l'image, on retombe sur le texte au 404 » fonctionne à l'écran
mais écrit une erreur en console pour chaque maison sans logo — or la recette
(`infra/ux-shot/recette.mjs`) échoue sur toute erreur console, et une porte qui
hurle sur un comportement normal finit ignorée.

## Format

| Contrainte | Valeur | Pourquoi |
|---|---|---|
| Format | WebP | ~30 % plus léger qu'un PNG à qualité égale, supporté partout |
| Hauteur affichée | 22 px (19 px en mobile) | l'en-tête fait 42 px en mobile — le logo ne doit jamais le pousser |
| Hauteur du fichier | ~64 px | 2 à 3× l'affichage, pour les écrans à forte densité |
| Poids visé | < 15 Ko | il est chargé sur chaque page |
| Fond | transparent | l'en-tête est blanc, mais pas partout ni pour toujours |

Le cache est géré par le cache-buster du site (`?v=<VERSION>`, `core/version.js`) :
un logo remplacé sous le même nom est repris au prochain `bump-version.mjs`, sans
purge manuelle.

## Recette

`node infra/ux-shot/recette.mjs accueil --deploye` avec la maison concernée
sélectionnée — et **ouvrir la capture** : un log vert prouve qu'un fichier s'est
chargé, jamais qu'il est lisible à 19 px de haut.
