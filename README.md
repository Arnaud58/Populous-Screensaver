# Populous Screen Saver pour KDE Plasma 6

Portage expérimental du screensaver Windows **Populous: The Beginning** de
Bullfrog vers un fond d'écran animé compatible avec KDE Plasma 6.

Le rendu utilisera un fond noir, comme la version connue sous Windows XP. Les
sprites et les effets sonores sont récupérés depuis le fichier original
`Populous Screen Saver.scr`, tandis que la logique d'animation sera réécrite en
QML et JavaScript.

## Objectifs

- reproduire les personnages animés sur un fond noir ;
- reproduire les déplacements, combats, sorts et l'Armageddon ;
- conserver les graphismes et effets sonores originaux ;
- fonctionner comme plugin de fond d'écran Plasma 6 ;
- pouvoir utiliser le plugin sur l'écran de verrouillage ;
- prendre en charge différentes résolutions et plusieurs écrans.

## État actuel

- [x] Copie et identification du fichier `.scr` original
- [x] Extraction des ressources Windows
- [x] Conversion de la planche de sprites en PNG RGBA
- [x] Conversion du bandeau Populous
- [x] Extraction et conversion des 28 sons WAV
- [x] Première détection automatique des frames
- [x] Génération d'une carte annotée de l'atlas
- [x] Première classification visuelle des familles de sprites
- [x] Regroupement des 32 cycles de marche des quatre tribus
- [ ] Regroupement des autres frames en animations cohérentes
- [ ] Création du prototype QML
- [ ] Réimplémentation de la simulation
- [ ] Ajout des sons
- [ ] Création de la configuration Plasma
- [ ] Installation et tests sur l'écran verrouillé

## Arborescence

```text
populous-plasma/
├── README.md
├── original/
│   └── Populous Screen Saver.scr
├── extracted/
│   ├── .text
│   ├── .data
│   └── .rsrc/
│       ├── BITMAP/
│       ├── ICON/
│       └── WAVE/
├── tools/
│   └── build-atlas.py
├── research/
│   ├── README.md
│   ├── sprites-detected.json
│   ├── sprites-detected.png
│   └── sprite-groups.json
└── package/
    └── contents/
        ├── images/
        │   ├── sprites.png
        │   └── plinth.png
        ├── sounds/
        └── sounds-converted/
```

## Dépendances

Sous Ubuntu et les distributions dérivées :

```bash
sudo apt install \
    7zip \
    ffmpeg \
    python3-pil \
    qml6-module-qtquick \
    qml6-module-qtquick-controls \
    qml6-module-qtquick-layouts \
    qml6-module-qtmultimedia \
    qml6-module-qtqml-workerscript
```

La première version sera entièrement réalisée en QML et JavaScript. Elle ne
nécessite donc pas de compilateur C++, de CMake ou de bibliothèques Qt de
développement.

## Pipeline

### 1. Préserver le fichier original

Le fichier original est conservé séparément afin que toutes les ressources
puissent être régénérées :

```bash
mkdir -p original
cp "../Populous Screen Saver.scr" original/
sha256sum "original/Populous Screen Saver.scr"
```

Somme SHA-256 connue :

```text
a25f7f7d219018fcf1888891738a706dff5f39f72de103a21dde3945f7097e0b
```

### 2. Extraire les ressources Windows

```bash
mkdir -p extracted
7z x "original/Populous Screen Saver.scr" -oextracted
```

Les ressources importantes sont :

- `IDB_POPSAVER.bmp` : planche de sprites couleur, 640 × 1277 pixels ;
- `IDB_POPSAVERMASK.bmp` : masque de transparence ;
- `IDB_PLINTH2.bmp` : bandeau Populous ;
- `WAVE/*` : 28 effets sonores PCM.

### 3. Construire l'atlas transparent

Le masque noir et blanc est inversé puis utilisé comme canal alpha :

```bash
mkdir -p package/contents/images

ffmpeg \
    -i extracted/.rsrc/BITMAP/IDB_POPSAVER.bmp \
    -i extracted/.rsrc/BITMAP/IDB_POPSAVERMASK.bmp \
    -filter_complex \
    "[1:v]format=gray,negate[alpha];[0:v][alpha]alphamerge,format=rgba" \
    -frames:v 1 \
    package/contents/images/sprites.png
```

Conversion du bandeau :

```bash
ffmpeg \
    -i extracted/.rsrc/BITMAP/IDB_PLINTH2.bmp \
    -frames:v 1 \
    package/contents/images/plinth.png
```

### 4. Récupérer les sons

Les ressources sont déjà des fichiers WAV, mais elles ne portent pas
d'extension :

```bash
mkdir -p package/contents/sounds

for source_file in extracted/.rsrc/WAVE/*; do
    sound_name="$(basename "$source_file")"
    sound_name="${sound_name#WAV_}"
    cp "$source_file" "package/contents/sounds/${sound_name,,}.wav"
done
```

Une version PCM 16 bits à 44,1 kHz est également conservée pour améliorer la
compatibilité avec Qt Multimedia :

```bash
mkdir -p package/contents/sounds-converted

for source_file in package/contents/sounds/*.wav; do
    sound_name="$(basename "$source_file")"
    ffmpeg -i "$source_file" \
        -ar 44100 \
        -ac 1 \
        -c:a pcm_s16le \
        "package/contents/sounds-converted/$sound_name"
done
```

### 5. Cartographier les sprites

La planche contient des lignes guides horizontales opaques. Le script de
recherche détecte ces guides, puis les colonnes transparentes qui séparent les
poses candidates :

```bash
python3 tools/build-atlas.py
```

Le script génère :

- `research/sprites-detected.json` : coordonnées des rectangles candidats ;
- `research/sprites-detected.png` : planche annotée pour vérification visuelle.

Résultat actuel :

```text
39 lignes guides utiles
39 bandes de sprites
1179 rectangles candidats
```

Ces rectangles ne correspondent pas encore tous à une frame complète. Les
particules et les effets constitués de plusieurs éléments peuvent produire
plusieurs rectangles pour une seule frame logique.

### 6. Construire le manifeste d'animations

Cette étape est en cours. Les 128 frames de marche ont été identifiées et
regroupées en 32 animations : quatre tribus, huit directions et quatre poses
par cycle.

Le fichier `research/sprite-groups.json` contient une première classification
visuelle :

- grand personnage brun ;
- shamans bleu et rouge ;
- personnages dorés et verts ;
- petits marcheurs de plusieurs tribus ;
- chutes, roulades et personnages au sol ;
- flammes ;
- particules ;
- combattants ;
- séquences probablement associées à l'Armageddon ;
- effet circulaire de sort.

La suite consiste à créer un manifeste révisé `research/sprites.json` avec des
animations nommées :

```json
{
  "animations": {
    "brave_blue_walk_east": {
      "frameDuration": 120,
      "loop": true,
      "frames": [
        {
          "x": 0,
          "y": 0,
          "width": 18,
          "height": 26,
          "anchorX": 9,
          "anchorY": 26
        }
      ]
    }
  }
}
```

Pour chaque séquence, il faudra vérifier :

1. son début et sa fin dans l'atlas ;
2. l'ordre des frames ;
3. sa direction ;
4. sa tribu ou son type de personnage ;
5. sa durée approximative ;
6. son point d'ancrage au sol ;
7. son éventuel effet sonore.

Le point d'ancrage par défaut est le milieu inférieur du rectangle. Il devra
être corrigé pour les animations qui tremblent ou se décalent.

Les animations révisées sont construites avec :

```bash
python3 tools/build-sprites.py
```

Cette commande génère également :

- `package/contents/data/sprites.json`, destiné au plugin QML ;
- `research/walk-cycles.gif`, pour contrôler visuellement les cycles, les
  directions et les points d'ancrage.

### 7. Créer le prototype QML

Le premier prototype contiendra :

- un rectangle noir couvrant tout l'écran ;
- un chargeur pour `sprites.json` ;
- un composant `Character.qml` ;
- une animation de marche ;
- plusieurs personnages placés aléatoirement ;
- un changement de direction aux bords de l'écran ;
- une adaptation à la résolution et au facteur d'échelle.

Structure prévue :

```text
package/
├── metadata.json
└── contents/
    ├── ui/
    │   ├── main.qml
    │   ├── Character.qml
    │   └── Simulation.js
    ├── images/
    ├── sounds/
    └── config/
```

Le composant QML utilisera `sourceClipRect` pour afficher une zone de l'atlas,
sans créer plusieurs centaines de petits fichiers PNG.

### 8. Réimplémenter la simulation

La simulation sera ajoutée progressivement :

1. marche et changements de direction ;
2. différentes tribus ;
3. traces de pas ;
4. collisions ;
5. combats et morts ;
6. conversions ;
7. shamans et sorts ;
8. rassemblement au centre ;
9. Armageddon.

Le comportement visible sera reproduit en priorité. Le désassemblage des
129 Ko de code original servira seulement pour retrouver les règles,
probabilités ou temporisations ambiguës.

### 9. Ajouter les sons

Les effets seront joués avec Qt Multimedia. Ils seront associés aux événements
de la simulation, avec une limite du nombre de sons simultanés.

Les premiers sons à intégrer seront :

- attaques et coups ;
- conversion ;
- lancement de sort ;
- éclairs et tourbillon ;
- épées ;
- boucle de guerre pour l'Armageddon.

Le fonctionnement du son devra être vérifié séparément sur l'écran verrouillé.

### 10. Créer la configuration

Les réglages envisagés sont inspirés du screensaver original :

- nombre de personnages ;
- délai avant Armageddon ;
- activation des sons ;
- volume ;
- intensité des traces de pas ;
- taille des sprites ;
- graine aléatoire facultative pour les tests.

Le fond restera toujours noir.

### 11. Installer dans Plasma

Installation locale :

```bash
kpackagetool6 \
    --type Plasma/Wallpaper \
    --install package
```

Mise à jour pendant le développement :

```bash
kpackagetool6 \
    --type Plasma/Wallpaper \
    --upgrade package
```

Vérification :

```bash
kpackagetool6 --type Plasma/Wallpaper --list
```

Désinstallation :

```bash
kpackagetool6 \
    --type Plasma/Wallpaper \
    --remove org.poptheme.populous
```

### 12. Activer sur l'écran verrouillé

Dans Plasma :

```text
Configuration du système
→ Sécurité et confidentialité
→ Verrouillage de l'écran
→ Configurer l'apparence
→ Type de fond d'écran
→ Populous Screen Saver
```

Test rapide :

```text
Ctrl + Alt + L
```

## Validation

Avant de considérer le portage comme terminé, il faudra vérifier :

- le rendu sans bordures ni lignes guides ;
- la stabilité des personnages au sol ;
- les performances avec plusieurs dizaines de personnages ;
- les écrans à haute densité de pixels ;
- les configurations multi-écrans ;
- la session X11 actuelle ;
- une session Wayland ;
- le verrouillage et le déverrouillage répétés ;
- l'arrêt correct des sons au déverrouillage ;
- l'absence de processus ou de ressources conservés après la fermeture.

## Ressources et diffusion

Les images, sons, noms et marques Populous/Bullfrog restent la propriété de
leurs ayants droit. Les ressources extraites sont destinées à un usage local.
Le code du portage devra être conservé séparément des ressources originales si
le projet est publié.
