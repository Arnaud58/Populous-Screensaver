# Development

Building the targets, seeing the engine run, and running the tests.

## Dependencies

The pipeline needs **Python 3 with Pillow**. The Plasma target and the preview
need only a **Qt 6 QML runtime** — no C++ compiler, no CMake, no Qt development
libraries. The tests need **Node**.

On Ubuntu and derivatives:

```bash
sudo apt install \
    7zip \
    ffmpeg \
    python3-pil \
    qml-qt6 \
    qml6-module-qtquick \
    qml6-module-qtquick-controls \
    qml6-module-qtquick-layouts \
    qml6-module-qtmultimedia \
    qml6-module-qtqml-workerscript
```

`7zip` and `ffmpeg` are only needed to regenerate `assets/` from the original
`.scr`. The derived assets are versioned, so a normal build does not touch
them.

The standalone Qt application and the xscreensaver hack will need a toolchain;
that stays confined to those targets.

## Building targets

Targets are never stored assembled. Every shared file lives once, under
`assets/` or `core/`, and is copied into `build/` on demand:

```bash
python3 tools/build-targets.py --clean      # every target
python3 tools/build-targets.py preview      # just one
```

Adding a target means declaring a layout in `TARGETS` inside
`tools/build-targets.py` — a list of source-to-destination pairs.

## Running the preview

The fastest way to see the engine, on any platform Qt supports:

```bash
python3 tools/build-targets.py preview
qml6 build/preview/ui/main.qml
```

Ubuntu installs the Qt 6 runtime as `qml6`. The unversioned `qml` command may
instead belong to `qtchooser` and select an older Qt installation. On Windows
the executable is `C:\Qt\<version>\msvc2022_64\bin\qml.exe`.

| Key | Effect |
| --- | ------ |
| `Esc` | quit |
| `F` | toggle full screen |
| `M` | toggle multi-screen rehearsal |

**Rehearsal mode** fakes a three-screen layout inside the one window: three
screens side by side, the last two shorter than the first, so a dead zone
appears along the bottom right. The screens are outlined. Characters should
cross the seams freely and never appear outside the outlines.

It exists because the continuous multi-monitor world has no real multi-window
host yet. Once the standalone application exists, rehearsal mode stops being
the only way to check that behaviour.

## Building the standalone application

Needs Qt 6.5 or newer, CMake and a C++ toolchain. The payload is assembled
first, then built from `build/qt-app` — everything under `ui/`, `images/` and
`data/` is compiled into the executable through a generated `resources.qrc`.

```bash
python3 tools/build-targets.py qt-app
cmake -S build/qt-app -B build/qt-app-cmake -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_PREFIX_PATH=/path/to/Qt/6.x/gcc_64
cmake --build build/qt-app-cmake
```

On Windows the target is `populous.scr`; elsewhere it is a plain executable.
Qt's own CMake and Ninja can be replaced by the ones Visual Studio ships, under
`Common7/IDE/CommonExtensions/Microsoft/CMake/`.

| Argument | Behaviour |
| -------- | --------- |
| `/s` | run full screen on every monitor, quit on input |
| `/c` | settings dialog |
| `/w` | ordinary windows — for development |
| `/p <hwnd>` | draw into the settings dialog's thumbnail |

**Testing it from PowerShell:** `Start-Process` goes through `ShellExecute`,
and `.scr` files have their own shell verbs (Install, Config, Test), so the
arguments are not passed as written. Copy the binary to `.exe` for testing, or
invoke it through `cmd /c`.

### Testing `/p`

`/p` needs a window handle to draw into, so it needs a host. Creating one from
PowerShell works, but two things will mislead you:

- `Form.PointToScreen` and `Form.Location` are unreliable there — the form may
  not be where they claim. Read the geometry back through Win32
  `GetClientRect` plus `ClientToScreen` on the handle instead, and place the
  form with `SetWindowPos`.
- A screenshot proves nothing on its own. The binary logs the parent it ended
  up with, which is the decisive check and does not depend on the form being
  visible at all:

```text
preview: child 265824, parent now 4132618, expected 4132618, 320x240
```

Run with `QT_FORCE_STDERR_LOGGING=1` and redirect stderr, since the executable
is built without a console.

### The end-to-end check

The real consumer is the Windows screen-saver dialog, which calls the binary
itself for both `/p` and `/s`. It needs a deployed copy and one registry value:

```powershell
windeployqt --release --qmldir build/qt-app/ui build/qt-app-deploy/populous.scr
Set-ItemProperty 'HKCU:\Control Panel\Desktop' 'SCRNSAVE.EXE' <full path>
rundll32.exe shell32.dll,Control_RunDLL desk.cpl,,1
```

**Back the old value up first and restore it afterwards** — it is the user's
screen saver.

`--qmldir` is required. The QML lives in the compiled `.qrc`, so `windeployqt`
cannot scan it from disk; without the flag it ships no QML modules and the
binary exits 1 the moment it tries to load `main.qml`.

Qt's DLLs must be reachable — put `<Qt>/bin` on `PATH` when running from the
build directory. The binary is not deployable yet; see
[roadmap.md](roadmap.md#what-is-left-in-this-phase).

## Running the tests

```bash
node --test "tests/**/*.test.mjs"
```

The simulation has no QML dependency, no clock access and no ambient
randomness, so it runs under plain Node. The tests load `core/js/Simulation.js`
by stripping its `.pragma library` line and evaluating it.

`tests/golden/` holds recorded traces for a single-screen and a three-screen
world. Regenerate them only when a rule deliberately changes:

```bash
node tools/generate-golden.mjs
```

A trace changing when you did not mean it to is the point: it means the
simulation now behaves differently for the same seed.

### What the tests do not cover

No code test can judge sprite orientation. See
[asset-pipeline.md](asset-pipeline.md#the-direction-order) — the check is
`research/direction-check.png`.

## Working on the Plasma target

Install once, then upgrade after each change:

```bash
python3 tools/build-targets.py
kpackagetool6 --type Plasma/Wallpaper --upgrade build/plasma/org.poptheme.populous
```

Check what is installed, or remove it:

```bash
kpackagetool6 --type Plasma/Wallpaper --list
kpackagetool6 --type Plasma/Wallpaper --remove org.poptheme.populous
```

### Testing the lock screen

`Ctrl + Alt + L` locks the session. To iterate without locking it, KDE's real
lock-screen shell can be launched directly:

```bash
/usr/lib/x86_64-linux-gnu/libexec/kscreenlocker_greet --testing
```

The password interface deliberately blurs and darkens animated wallpapers.
After it fades away, the Populous world remains visible until Plasma turns the
monitor off according to the current power-management policy.

The configuration page has to declare `configDialog` and
`wallpaperConfiguration`: Plasma injects both when loading the page, from the
desktop wallpaper dialog *and* from the screen-locker appearance module.
Omitting them works on the desktop and fails on the lock screen.

## Regenerating assets

Only needed when changing how sprites are extracted or grouped. The full chain,
in order:

```bash
python3 tools/extract-native-sprites.py   # native cell table from the binary
python3 tools/build-atlas.py              # heuristic frame detection
python3 tools/build-sprites.py            # the manifest and review artefacts
python3 tools/build-targets.py --clean    # reassemble payloads
```

See [asset-pipeline.md](asset-pipeline.md) for what each step does.

## Conventions

Commit messages follow `.claude/COMMIT_CONVENTION.md`: one emoji shortcode
describing the main change, then an imperative present-tense summary.

Documentation and code comments are in English. The simulation's normative
rules live in [spec/simulation.md](../spec/simulation.md) and are written as
each rule is implemented, not reconstructed afterwards.
