import QtQuick

import "Simulation.js" as Simulation

// Renders one viewport onto a simulation: black background, footprint trail and
// the characters visible in it.
//
// `viewportX` and `viewportY` are this view's top-left corner in world
// coordinates. A single-screen host leaves them at zero; the standalone screen
// saver gives each window its monitor's position in the virtual desktop, so one
// world spans them all.
Item {
    id: view

    required property var simulation
    property real viewportX: 0
    property real viewportY: 0
    property bool footprintsEnabled: true

    // How far outside the viewport a character is still drawn, so a sprite
    // straddling two monitors appears on both.
    readonly property real cullMargin: 64 * (simulation ? simulation.spriteScale : 1)

    function clearFootprints() {
        for (var index = trailLayer.children.length - 1; index >= 0; --index) {
            trailLayer.children[index].destroy()
        }
    }

    function addFootprints(footprints) {
        if (!footprintsEnabled) {
            return
        }
        for (var index = 0; index < footprints.length; ++index) {
            var footprint = footprints[index]
            var x = footprint.groundX - viewportX
            var y = footprint.groundY - viewportY
            if (x < -cullMargin || x > width + cullMargin
                    || y < -cullMargin || y > height + cullMargin) {
                continue
            }
            footprintComponent.createObject(trailLayer, {
                "groundX": x,
                "groundY": y,
                "directionX": footprint.directionX,
                "directionY": footprint.directionY,
                "tribeColor": Simulation.tribeColor(footprint.tribe),
                "spriteScale": footprint.spriteScale
            })
        }
    }

    // Copies the simulation state into the visual items. This is the whole
    // state-to-view boundary: the simulation never touches a QML item, so any
    // number of views can render the same characters.
    function sync() {
        var states = simulation ? simulation.characters : []

        for (var index = 0; index < states.length; ++index) {
            var item = characters.itemAt(index)
            if (!item) {
                continue
            }

            var state = states[index]
            var x = state.worldX - viewportX
            var y = state.worldY - viewportY
            var outside = x < -cullMargin || x > width + cullMargin
                || y < -cullMargin || y > height + cullMargin

            if (!state.initialized || outside || !state.frames) {
                item.frame = null
                continue
            }

            item.worldX = x
            item.worldY = y
            item.spriteScale = state.spriteScale
            item.frame = state.frames[state.frameIndex % state.frames.length]
        }
    }

    onFootprintsEnabledChanged: {
        if (!footprintsEnabled) {
            clearFootprints()
        }
    }

    Connections {
        target: view.simulation

        function onStepped() {
            view.sync()
        }

        function onFootprintsDropped(footprints) {
            view.addFootprints(footprints)
        }

        function onRestarted() {
            view.clearFootprints()
            view.sync()
        }
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

        model: view.simulation ? view.simulation.characterCount : 0

        delegate: Character { }
    }
}
