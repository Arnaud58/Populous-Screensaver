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

    function characterAt(index) {
        return characters.itemAt(index)
    }

    function createFootprint(groundX, groundY, directionX, directionY, tribe, footprintScale) {
        footprintComponent.createObject(trailLayer, {
            "groundX": groundX,
            "groundY": groundY,
            "directionX": directionX,
            "directionY": directionY,
            "tribeColor": Simulation.tribeColor(tribe),
            "spriteScale": footprintScale
        })
    }

    Rectangle {
        anchors.fill: parent
        color: "black"
    }

    Item {
        id: trailLayer

        anchors.fill: parent
    }

    Component {
        id: footprintComponent

        Footprint { }
    }

    Repeater {
        id: characters

        model: wallpaper.animationManifest ? wallpaper.characterCount : 0

        delegate: Character {
            required property int index

            manifest: wallpaper.animationManifest
            spriteScale: wallpaper.spriteScale
            characterIndex: index
            characterCount: wallpaper.characterCount
            characterProvider: wallpaper.characterAt

            onFootprintRequested: function(groundX, groundY, directionX, directionY, tribe, footprintScale) {
                wallpaper.createFootprint(
                    groundX,
                    groundY,
                    directionX,
                    directionY,
                    tribe,
                    footprintScale
                )
            }
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
