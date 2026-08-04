import QtQuick
import QtQuick.Window

Window {
    id: previewWindow

    width: 1280
    height: 720
    visible: true
    color: "black"
    title: "Populous Screen Saver — development preview"

    Loader {
        id: wallpaperLoader

        anchors.fill: parent
        // The engine is assembled, not stored, so the preview loads a built
        // payload. Run tools/build-targets.py before opening this file.
        source: Qt.resolvedUrl(
            "../build/plasma/org.poptheme.populous/contents/ui/main.qml"
        )

        onStatusChanged: {
            if (status === Loader.Error) {
                console.error("Unable to load the Populous wallpaper")
            }
        }
    }
}
