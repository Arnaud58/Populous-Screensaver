import QtQuick
import org.kde.plasma.plasmoid

import "Animations.js" as Animations
import "Simulation.js" as Simulation

WallpaperItem {
    id: wallpaper

    property var animationManifest: Animations.manifest
    property string loadError: ""
    property int characterCount: 24
    property real spriteScale: Math.max(1, Math.min(3, Math.round(height / 540)))

    Rectangle {
        anchors.fill: parent
        color: "black"
    }

    Repeater {
        model: wallpaper.animationManifest ? wallpaper.characterCount : 0

        delegate: Character {
            required property int index

            manifest: wallpaper.animationManifest
            spriteScale: wallpaper.spriteScale
        }
    }

    Text {
        anchors.centerIn: parent
        visible: wallpaper.loadError.length > 0
        color: "#ff8080"
        text: wallpaper.loadError
        font.pixelSize: 16
    }
}
