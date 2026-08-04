import QtQuick

import "Animations.js" as Animations
import "Simulation.js" as Simulation

// The engine, ready to be dropped into any host.
//
// It owns the black background, the characters, the trail layer and the one
// simulation loop. A host supplies nothing but a size: the Plasma wallpaper
// anchors it to a WallpaperItem, the preview and the future screen saver
// anchor it to a Window.
//
// Every rule lives in Simulation.js. This file only paces it and renders it.
Item {
    id: world

    property var animationManifest: Animations.manifest
    property string loadError: ""
    property int characterCount: 24
    property real spriteScale: Math.max(1, Math.min(3, Math.round(height / 540)))

    // 0 draws a seed from the clock, so each run differs. Any other value
    // replays exactly, which is what the golden traces will rely on.
    property int randomSeed: 0

    property var simulation: null
    property double previousTick: 0

    function worldGeometry() {
        return { "width": width, "height": height }
    }

    function collectCharacters() {
        var list = []
        for (var index = 0; index < characterCount; ++index) {
            var item = characters.itemAt(index)
            if (item) {
                list.push(item)
            }
        }
        return list
    }

    function createFootprint(footprint) {
        footprintComponent.createObject(trailLayer, {
            "groundX": footprint.groundX,
            "groundY": footprint.groundY,
            "directionX": footprint.directionX,
            "directionY": footprint.directionY,
            "tribeColor": Simulation.tribeColor(footprint.tribe),
            "spriteScale": footprint.spriteScale
        })
    }

    function tick() {
        if (!simulation) {
            return
        }

        if (simulation.characters.length !== characterCount) {
            simulation.characters = collectCharacters()
        }

        var now = Date.now()
        var elapsedSeconds = (now - previousTick) / 1000
        previousTick = now

        var footprints = Simulation.stepSimulation(
            simulation, worldGeometry(), elapsedSeconds
        )
        for (var index = 0; index < footprints.length; ++index) {
            createFootprint(footprints[index])
        }
    }

    Component.onCompleted: {
        simulation = Simulation.createSimulation(randomSeed || Date.now())
        previousTick = Date.now()
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

        model: world.animationManifest ? world.characterCount : 0

        delegate: Character {
            manifest: world.animationManifest
            spriteScale: world.spriteScale
        }
    }

    // The only timer in the whole engine. It paces the loop but does not
    // decide how much time is simulated: stepSimulation consumes the elapsed
    // time in fixed slices.
    Timer {
        interval: 16
        running: world.simulation !== null && world.animationManifest !== null
        repeat: true
        onTriggered: world.tick()
    }

    Text {
        anchors.centerIn: parent
        visible: world.loadError.length > 0
        color: "#ff8080"
        text: world.loadError
        font.pixelSize: 16
    }
}
