import QtQuick
import org.kde.plasma.plasmoid

import "Animations.js" as Animations
import "Simulation.js" as Simulation

// Plasma host shell. It owns the world geometry, the single simulation loop
// and the trail layer, and nothing else: every rule lives in Simulation.js.
//
// Plasma instantiates one of these per screen, so each screen currently runs
// its own world. Phase 4 replaces worldGeometry() with a region that can span
// several viewports.
WallpaperItem {
    id: wallpaper

    property var animationManifest: Animations.manifest
    property string loadError: ""
    property int characterCount: 24
    property real spriteScale: Math.max(1, Math.min(3, Math.round(height / 540)))

    // 0 draws a seed from the clock, so each run differs. Any other value
    // replays exactly, which is what the golden traces rely on.
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

        model: wallpaper.animationManifest ? wallpaper.characterCount : 0

        delegate: Character {
            manifest: wallpaper.animationManifest
            spriteScale: wallpaper.spriteScale
        }
    }

    // The only timer in the whole engine. It paces the loop but does not
    // decide how much time is simulated: stepSimulation consumes the elapsed
    // time in fixed slices.
    Timer {
        interval: 16
        running: wallpaper.simulation !== null && wallpaper.animationManifest !== null
        repeat: true
        onTriggered: wallpaper.tick()
    }

    Text {
        anchors.centerIn: parent
        visible: wallpaper.loadError.length > 0
        color: "#ff8080"
        text: wallpaper.loadError
        font.pixelSize: 16
    }
}
