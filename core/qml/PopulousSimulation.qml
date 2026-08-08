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
    property int characterCount: 150
    property real spriteScale: 2

    // 0 draws a seed from the clock, so each run differs. Any other value
    // replays exactly, which is what the golden traces rely on.
    property int randomSeed: 0

    // Seconds between Armageddons. The simulation clamps it to the range the
    // configuration pages offer, so a host cannot ask for a value it then
    // silently fails to honour.
    property int armageddonSeconds: 120

    // The screens this world spans, in world coordinates. A single-screen host
    // passes one rectangle; a multi-monitor host passes one per monitor and the
    // world becomes continuous across them, with the gaps between mismatched
    // screens treated as out of bounds.
    property var worldRects: []

    readonly property alias characters: internal.characters
    readonly property alias entities: internal.entities
    property bool running: true

    // Emitted after each batch of fixed steps, once the character states have
    // been updated. Views redraw from it.
    signal stepped()

    // Emitted with the footprints dropped during that batch. Each view builds
    // its own visuals: QML items cannot be shared between windows.
    signal footprintsDropped(var footprints)

    // Complete deterministic event stream for future sound and effect layers.
    signal eventsEmitted(var events)

    // Emitted when the population is replaced, so views can drop stale visuals.
    signal restarted()

    QtObject {
        id: internal

        property var simulation: null
        property var characters: []
        property var entities: []
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
            animationManifest ? animationManifest.animations : null,
            {
                combatEnabled: true,
                armageddonIntervalMs: armageddonSeconds * 1000
            }
        )
        internal.characters = Simulation.populate(
            internal.simulation, characterCount, spriteScale
        )
        internal.entities = []
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

        var events = Simulation.stepSimulation(
            internal.simulation, internal.worldModel, elapsedSeconds
        )

        var footprints = []
        var populationChanged = false
        for (var index = 0; index < events.length; ++index) {
            if (events[index].type === "footprint") {
                footprints.push(events[index])
            } else if (events[index].type === "soul-spawned"
                    || events[index].type === "effect-spawned"
                    || events[index].type === "character-spawned"
                    || events[index].type === "character-removed"
                    || events[index].type === "entity-removed") {
                populationChanged = true
            }
        }
        if (populationChanged) {
            // New array identities notify QML Repeaters; the JS driver may
            // replace its character array when combatants die or spawn.
            internal.characters = internal.simulation.characters.slice()
        }
        if (populationChanged || internal.simulation.entities.length > 0
                || internal.entities.length > 0) {
            // High-volume conversion children intentionally emit no public
            // events, so an active effect pool is mirrored once per host tick.
            internal.entities = internal.simulation.entities.slice()
        }

        stepped()
        if (events.length > 0) {
            eventsEmitted(events)
        }
        if (footprints.length > 0) {
            footprintsDropped(footprints)
        }
    }

    onWorldRectsChanged: rebuildWorld()
    onRandomSeedChanged: restart()
    onArmageddonSecondsChanged: restart()
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
