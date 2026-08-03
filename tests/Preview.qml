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
        source: Qt.resolvedUrl("../package/contents/ui/main.qml")

        onStatusChanged: {
            if (status === Loader.Error) {
                console.error("Unable to load the Populous wallpaper")
            }
        }
    }
}
