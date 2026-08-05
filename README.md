# Populous Screen Saver

A port of Bullfrog's 1998 Windows screen saver for **Populous: The Beginning**
to modern systems.

The original `.scr` is kept untouched as the source of truth. Its sprites and
sound effects are extracted from it; the simulation is rewritten from scratch.
Rendering is on a black background, like the version on Windows XP.

Two versions are built from one engine:

- a **faithful port**, reproducing the 1998 behaviour on one screen;
- a **modern version**, which the original could not do: a single continuous
  world spanning every monitor, high-DPI aware, with a seeded deterministic
  simulation.

## Status

Version 0.9.0. **The KDE Plasma 6 target works and is usable today** — as a
desktop wallpaper and on the lock screen, with a configuration page.

The **Windows screen saver** works and installs: one window per monitor over a
single continuous world, a settings dialog, and a self-contained archive with
its own installer.

The simulation currently has tribespeople walking, turning, avoiding each other
and leaving coloured footprints. Combat, conversions, shamans, spells and
Armageddon are not implemented yet, and no target plays sound.

See the [changelog](CHANGELOG.md) for what changed when, and the
[roadmap](docs/roadmap.md) for what comes next.

## Deliverables

| Target | Host | Renderer | Multi-monitor | Status |
| ------ | ---- | -------- | ------------- | ------ |
| `plasma` | KDE Plasma 6 wallpaper plugin | QML | one world per screen | **working** |
| `qt-app` (Windows) | `.scr` screen saver | QML | continuous world | **working** |
| `qt-app` (Linux) | standalone executable | QML | continuous world | should build, untested |
| `xscreensaver` | X11 screen saver hack | C / OpenGL | one world per window | planned |

The Plasma wallpaper plugin is also what KDE's **lock screen** consumes, so it
covers the screen-saver use case on KDE without being a screen saver in the X11
sense.

## Getting it

There are no published releases yet, but the Windows target now produces the
archive one would be made of. Until then, build from the repository.

### KDE Plasma 6

You need Python 3 with Pillow. The plugin itself is QML and JavaScript only —
no compiler, no CMake, no Qt development libraries.

```bash
git clone <this repository>
cd populous-screensaver

python3 tools/build-targets.py --clean
kpackagetool6 --type Plasma/Wallpaper --install build/plasma/org.poptheme.populous
```

Then pick it as your wallpaper, or on the lock screen:

```text
System Settings
→ Security & Privacy
→ Screen Locking
→ Configure Appearance
→ Wallpaper type
→ Populous Screen Saver
```

To remove it:

```bash
kpackagetool6 --type Plasma/Wallpaper --remove org.poptheme.populous
```

### Windows

Needs Qt 6.5 or newer and a C++ toolchain. The `package` target builds the
screen saver, gathers everything it needs to run, and zips the result:

```bash
python3 tools/build-targets.py qt-app
cmake -S build/qt-app -B build/qt-app-cmake -DCMAKE_PREFIX_PATH=C:/Qt/<version>/msvc2022_64
cmake --build build/qt-app-cmake --config Release --target package
```

That leaves `populous-screensaver-<version>-windows-x64.zip` — about 40 MB —
in `build/qt-app-cmake/`. Unpack it anywhere and run its installer:

```powershell
powershell -ExecutionPolicy Bypass -File install-windows.ps1
```

It copies itself to `%LOCALAPPDATA%\Programs\Populous Screen Saver` and selects
itself, no elevation needed. Windows offers no way to browse for a screen
saver, which is why the installer writes that setting rather than leaving it to
the dialog. Your previous screen saver is remembered and put back by
`install-windows.ps1 -Uninstall`, which also removes the installed copy.

Moving the mouse or pressing a key quits it, and the dialog's **Settings**
button opens its configuration.

The Microsoft Visual C++ 2015–2022 redistributable has to be present. It is on
practically every Windows 11 machine, and the archive deliberately does not
carry its 25 MB installer.

### Anywhere else

The engine runs in a plain window on any platform Qt 6 supports, with no
compiler at all:

```bash
python3 tools/build-targets.py preview
qml6 build/preview/ui/main.qml
```

This is a development preview rather than a screen saver: it does not go full
screen on its own and does not quit on input. Escape quits, `F` toggles full
screen. See [docs/development.md](docs/development.md) for the details,
including the Windows command name.

## Configuration

The Plasma target exposes:

- **number of characters**, from 1 to 100;
- **sprite size**: automatic, 1×, 2× or 3×;
- **footprints** on or off;
- an optional **random seed**, where 0 means a different run each time.

Changing the population, sprite size or seed starts a fresh world. Turning
footprints off clears the existing trail without interrupting movement.

Sound, Armageddon timing and multi-monitor mode will appear as the
corresponding simulation features land. The background always stays black.

## Documentation

| Document | What is in it |
| -------- | ------------- |
| [docs/architecture.md](docs/architecture.md) | Repository layout, how the engine is split from its host shells, and how the C port is kept honest |
| [docs/asset-pipeline.md](docs/asset-pipeline.md) | Extracting sprites and sounds from the 1998 binary, and what was worked out about the atlas |
| [docs/development.md](docs/development.md) | Building targets, running the preview, running the tests, working on Plasma |
| [docs/roadmap.md](docs/roadmap.md) | The five phases, what is done, what is next, and the acceptance checklist |
| [spec/simulation.md](spec/simulation.md) | Normative rules of the simulation — the contract the C port must reproduce |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

## Resources and distribution

The images, sounds, names and trademarks of Populous and Bullfrog remain the
property of their rights holders. The extracted resources are for local use.
If this project is published, the port's code must be kept separate from the
original resources.
