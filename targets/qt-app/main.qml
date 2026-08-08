import QtQuick
import QtQuick.Window

// Standalone host. One simulation, one window per monitor, one continuous
// world across all of them.
//
// The root is non-visual: windows come from Qt.application.screens rather than
// being declared, so the layout is whatever the machine reports. Engine
// components sit in the same directory and need no import.
QtObject {
    id: host

    // Set from C++ before the component is created.
    property bool fullScreen: true
    // Preview mode draws into the little monitor of the Windows settings
    // dialog: one small window, reparented from C++, no screen takeover.
    property bool previewMode: false
    property int characterCount: 150
    property int spriteScaleOverride: 0
    property bool footprintsEnabled: true
    property int randomSeed: 0
    property int armageddonSeconds: 120

    readonly property var screens: Qt.application.screens

    // The world spans every monitor, in virtual-desktop coordinates. Gaps
    // between screens of different heights are excluded by the simulation.
    readonly property var screenRects: {
        if (previewMode) {
            // Exactly the window C++ sized from the thumbnail's client rect.
            // A fixed 640x480 world seen through a 150x110 hole is black
            // almost all the time: the characters are simply elsewhere.
            return [{
                "x": 0,
                "y": 0,
                "width": previewWindow.width,
                "height": previewWindow.height
            }]
        }
        var rects = []
        for (var index = 0; index < screens.length; ++index) {
            var screen = screens[index]
            rects.push({
                "x": screen.virtualX,
                "y": screen.virtualY,
                "width": screen.width,
                "height": screen.height
            })
        }
        return rects
    }

    // One scale for the whole world. Per-monitor DPI would mean per-character
    // margins and speeds, which the state does not model.
    readonly property real spriteScale: spriteScaleOverride > 0
        ? spriteScaleOverride
        : Math.max(1, Math.min(3, Math.round(
            (screens.length > 0 ? screens[0].height : 1080) / 540
        )))

    property PopulousSimulation simulation: PopulousSimulation {
        characterCount: host.previewMode ? 10 : host.characterCount
        spriteScale: host.previewMode ? 1 : host.spriteScale
        randomSeed: host.randomSeed
        armageddonSeconds: host.armageddonSeconds
        worldRects: host.screenRects
    }

    // One window per monitor, unless we are drawing a preview thumbnail.
    property Instantiator windows: Instantiator {
        model: host.previewMode ? [] : host.screens

        delegate: Window {
            id: screenWindow

            required property var modelData

            x: modelData.virtualX
            y: modelData.virtualY
            width: modelData.width
            height: modelData.height
            color: "black"
            visible: true
            title: "Populous Screen Saver"
            // Running for real means covering everything, including the task
            // bar and whatever had focus. Windowed mode keeps a normal frame so
            // the host can be developed without taking over the desktop.
            flags: host.fullScreen
                ? Qt.Window | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint
                : Qt.Window
            visibility: host.fullScreen ? Window.FullScreen : Window.Windowed

            PopulousView {
                anchors.fill: parent

                simulation: host.simulation
                footprintsEnabled: host.footprintsEnabled
                // World coordinates are the virtual desktop, so each window
                // offsets by its own position and characters line up across
                // the seams.
                viewportX: screenWindow.modelData.virtualX
                viewportY: screenWindow.modelData.virtualY
            }

            DismissArea {
                anchors.fill: parent
                enabled: host.fullScreen
            }

            Shortcut {
                sequences: ["Esc"]
                onActivated: Qt.quit()
            }
        }
    }

    // Created in every mode, shown by C++ only after it has been reparented
    // into the HWND the settings dialog supplies. Showing it first would make
    // it a top-level window, and reparenting one of those is unreliable.
    property Window previewWindow: Window {
        width: 640
        height: 480
        color: "black"
        visible: false
        flags: Qt.FramelessWindowHint

        PopulousView {
            anchors.fill: parent

            simulation: host.simulation
            footprintsEnabled: host.footprintsEnabled
        }
    }
}
