import QtQuick
import QtQuick.Window

// Windowed preview host. Runs the engine anywhere Qt runs, with no Plasma and
// no compiler:
//
//     python tools/build-targets.py preview
//     qml6 build/preview/ui/main.qml   // Ubuntu
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

    // Rehearsal mode fakes a multi-monitor layout inside this single window:
    // three screens side by side, the last two shorter than the first, which
    // is the shape that produces a dead zone along the bottom. It exists to
    // check the continuous world before there is a real multi-window host.
    property bool rehearsal: false

    readonly property real screenWidth: width / 3
    readonly property var rehearsalRects: [
        { "x": 0, "y": 0, "width": screenWidth, "height": height },
        { "x": screenWidth, "y": 0, "width": screenWidth, "height": height * 0.9 },
        { "x": screenWidth * 2, "y": 0, "width": screenWidth, "height": height * 0.9 }
    ]

    PopulousWorld {
        id: engine

        anchors.fill: parent
        worldRects: previewWindow.rehearsal ? previewWindow.rehearsalRects : null
    }

    // Outlines the screens making up the world. Anything outside them is the
    // dead zone, and no character should ever be seen there.
    Repeater {
        model: previewWindow.rehearsal ? previewWindow.rehearsalRects : []

        delegate: Rectangle {
            required property var modelData

            x: modelData.x
            y: modelData.y
            width: modelData.width
            height: modelData.height
            color: "transparent"
            border.color: "#2f7d4f"
            border.width: 2
        }
    }

    Text {
        anchors.left: parent.left
        anchors.bottom: parent.bottom
        anchors.margins: 8
        color: "#707070"
        font.pixelSize: 12
        text: previewWindow.rehearsal
            ? "rehearsal: 3 screens, dead zone bottom right  —  M single screen, F full screen, Esc quit"
            : "single screen  —  M multi-screen rehearsal, F full screen, Esc quit"
    }

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

    Shortcut {
        sequences: ["M"]
        onActivated: previewWindow.rehearsal = !previewWindow.rehearsal
    }
}
