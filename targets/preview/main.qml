import QtQuick
import QtQuick.Window

// Windowed preview host. Runs the engine anywhere Qt runs, with no Plasma and
// no compiler:
//
//     python tools/build-targets.py preview
//     qml.exe build/preview/ui/main.qml
//
// This is also the skeleton the standalone screen saver will grow from: the
// difference is one window per screen instead of one window, plus a C++ entry
// point handling /s, /c and /p.
Window {
    id: previewWindow

    width: 1280
    height: 720
    visible: true
    color: "black"
    title: "Populous Screen Saver — preview"

    PopulousWorld {
        anchors.fill: parent
    }

    // Convenience for a preview only: Escape quits, F toggles full screen.
    Shortcut {
        sequences: ["Esc"]
        onActivated: Qt.quit()
    }

    Shortcut {
        sequences: ["F"]
        onActivated: previewWindow.visibility = previewWindow.visibility === Window.FullScreen
            ? Window.Windowed
            : Window.FullScreen
    }
}
