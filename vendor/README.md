# `site/vendor/` — librairies tierces embarquées

Ce dossier contient du code **qu'on n'écrit pas** et **qu'on ne modifie pas** : des
librairies externes copiées telles quelles dans le repo. Le site est statique et servi
par GitHub Pages, sans étape de build ni gestionnaire de paquets côté front — une
dépendance front se vendore donc à la main, ou elle n'existe pas.

Règle : **toute brique déposée ici est documentée ci-dessous** (d'où elle vient, quelle
version exacte, pourquoi elle est là, comment la mettre à jour). Une lib non documentée
est une lib que personne n'osera toucher dans six mois.

---

## `flag-icons/` — drapeaux de pays en SVG

| | |
|---|---|
| **Source** | https://github.com/lipis/flag-icons |
| **Version vendorée** | **7.5.0** (release publiée, jamais `main`) |
| **Licence** | MIT — voir [`flag-icons/LICENSE`](flag-icons/LICENSE), copié tel quel |
| **Poids** | 272 fichiers, ~2,0 Mo (271 SVG + la feuille CSS) |
| **Déposé le** | 2026-09-06 (arbitrage D-092) |

### Pourquoi une lib, et pas l'emoji

L'évidence serait d'écrire le drapeau en emoji (`🇫🇷`), sans aucune dépendance. **Ça ne
marche pas sur Windows** : Chrome et Edge n'ont pas de fonte contenant les drapeaux, et
affichent à la place les deux lettres du code pays dans un carré (`FR`). Le site se
consulte sur Windows (Yann) **et** sur Android (Alain) — il faut donc de vrais SVG, les
mêmes partout. Ne pas revenir sur ce point sans reproduire le rendu sur les deux
plateformes.

### Ce qui est vendoré, et ce qui ne l'est pas

Seulement ce qui sert :

- **les SVG au format 4x3** (rectangulaires, le drapeau tel qu'on le hisse) ;
- **la feuille CSS**, non minifiée pour rester lisible et auditable.

Sont volontairement **écartés** : les SVG 1x1 (variantes carrées, ~2,0 Mo — le poids
double sans usage), les sources Sass, `country.json` et le README amont.

Deux retouches, et deux seulement, appliquées au CSS d'origine :

1. les blocs de sélecteur `.fis` (qui servent les 1x1) sont **supprimés** — sinon le CSS
   référencerait 271 fichiers absents du repo ;
2. les chemins `url(../flags/4x3/…)` deviennent `url(flags/4x3/…)`, parce que la feuille
   vit à la racine du vendor et non plus dans un sous-dossier `css/`.

L'en-tête du fichier CSS le redit sur place.

### Utilisation

```html
<link rel="stylesheet" href="/vendor/flag-icons/flag-icons.css">

<span class="fi fi-fr"></span>   <!-- France -->
<span class="fi fi-jp"></span>   <!-- Japon -->
```

Le code pays est celui d'**ISO 3166-1 alpha-2, en minuscules**. `fi-xx` sert de drapeau
neutre quand le pays est inconnu. La largeur suit la taille du texte (`width: 1.333em`),
donc un drapeau se dimensionne avec `font-size` sur son conteneur.

### Mettre à jour

```sh
npm pack flag-icons@<version>      # dans un dossier temporaire, hors du repo
tar -xzf flag-icons-<version>.tgz
```

Puis, depuis le `package/` extrait :

1. remplacer `site/vendor/flag-icons/flags/4x3/` par `package/flags/4x3/` (les SVG bruts) ;
2. remplacer le `LICENSE` par celui du paquet ;
3. reprendre `package/css/flag-icons.css`, y **réappliquer les deux retouches** décrites
   plus haut (retirer les blocs `.fis`, réécrire les `url()`), et remettre l'en-tête ;
4. vérifier que chaque `url()` du CSS final désigne un fichier réellement présent — c'est
   le seul contrôle qui compte, et il attrape les deux retouches d'un coup ;
5. mettre à jour le numéro de version **dans ce tableau** et dans l'en-tête du CSS.
