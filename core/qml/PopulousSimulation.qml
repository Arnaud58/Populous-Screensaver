import QtQuick

import "Animations.js" as Animations
import "Simulation.js" as Simulation

// Owns the simulation and paces it. Non-visual: it renders nothing and has no
// size, so several PopulousView instances — one per window — can watch the
// same one.
//
// Every rule lives in Simulation.js. This file only decides when to step it.
Item {
    id: simulationHost

    visible: false

    property var animationManifest: Animations.manifest
    property int characterCount: 24
    property real spriteScale: 2

    // 0 draws a seed from the clock, so each run differs. Any other value
    // replays exactly, which is what the golden traces rely on.
    property int randomSeed: 0

    // The screens this world spans, in world coordinates. A single-screen host
    // passes one rectangle; a multi-monitor host passes one per monitor and the
    // world becomes continuous across them, with the gaps between mismatched
    // screens treated as out of bounds.
    property var worldRects: []

    readonly property alias characters: internal.characters
    property bool running: true

    // Emitted after each batch of fixed steps, once the character states have
    // been updated. Views redraw from it.
    signal stepped()

    // Emitted with the footprints dropped during that batch. Each view builds
    // its own visuals: QML items cannot be shared between windows.
    signal footprintsDropped(var footprints)

    // Emitted when the population is replaced, so views can drop stale visuals.
    signal restarted()

    QtObject {
        id: internal

        property var simulation: null
        property var characters: []
        property var worldModel: null
        property double previousTick: 0
        property bool ready: false
    }

    function rebuildWorld() {
        internal.worldModel = Simulation.createWorld(worldRects || [])
    }

    function restart() {
        if (!internal.ready) {
            return
        }

        internal.simulation = Simulation.createSimulation(
            randomSeed || Date.now(),
            animationManifest ? animationManifest.animations : null
        )
        internal.characters = Simulation.populate(
            internal.simulation, characterCount, spriteScale
        )
        internal.previousTick = Date.now()
        restarted()
    }

    function tick() {
        if (!internal.simulation || !internal.worldModel) {
            return
        }

        var now = Date.now()
        var elapsedSeconds = (now - internal.previousTick) / 1000
        internal.previousTick = now

        var footprints = Simulation.stepSimulation(
            internal.simulation, internal.worldModel, elapsedSeconds
        )

        stepped()
        if (footprints.length > 0) {
            footprintsDropped(footprints)
        }
    }

    onWorldRectsChanged: rebuildWorld()
    onRandomSeedChanged: restart()
    onSpriteScaleChanged: restart()
    onCharacterCountChanged: {
        if (internal.ready) {
            Qt.callLater(restart)
        }
    }

    Component.onCompleted: {
        rebuildWorld()
        internal.ready = true
        restart()
    }

    // The only timer in the whole engine. It paces the loop but does not decide
    // how much time is simulated: stepSimulation consumes the elapsed time in
    // fixed slices.
    Timer {
        interval: 16
        running: simulationHost.running && internal.simulation !== null
        repeat: true
        onTriggered: simulationHost.tick()
    }
}
