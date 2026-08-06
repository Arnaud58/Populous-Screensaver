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
        trailLayer.pendingMarks = []
        trailLayer.clearRequested = true
        trailLayer.requestPaint()
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
            trailLayer.pendingMarks.push({
                "x": x,
                "y": y,
                "size": footprint.size || 2,
                "sourceX": footprint.sourceX,
                "sourceY": footprint.sourceY,
                "spriteScale": footprint.spriteScale || 1,
                "state13": footprint.state13 === true,
                "blendAmount": footprint.blendAmount === undefined
                    ? 100 : footprint.blendAmount
            })
        }
        trailLayer.requestPaint()
    }

    // Copies the simulation state into the visual items. This is the whole
    // state-to-view boundary: the simulation never touches a QML item, so any
    // number of views can render the same characters.
    function sync() {
        var states = simulation ? simulation.characters : []

        syncStates(states, characters)
        syncStates(simulation ? simulation.entities : [], entities)
        syncBolts()
    }

    // Lightning is the one effect with no sprite: the original draws it with
    // line primitives, so it is collected here and stroked onto a canvas rather
    // than handed to the sprite delegate.
    function syncBolts() {
        var found = []
        var all = simulation ? simulation.entities : []
        for (var index = 0; index < all.length; ++index) {
            if (all[index].kind === "lightning" && all[index].paths) {
                found.push(all[index])
            }
        }
        // Repaint while bolts exist, and once more to clear the last one.
        if (found.length > 0 || boltLayer.bolts.length > 0) {
            boltLayer.bolts = found
            boltLayer.requestPaint()
        }
    }

    function syncStates(states, repeater) {
        for (var index = 0; index < states.length; ++index) {
            var item = repeater.itemAt(index)
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

    // A readable copy of the atlas lets the trail pass reproduce GetPixel on
    // the actor's old sprite before applying FUN_00413f20's integer blend.
    // It is kept outside the viewport; the visible Character items still use
    // the normal Image path.
    Canvas {
        id: spriteSampler
        x: -10000
        y: -10000
        width: 640
        height: 1277
        renderTarget: Canvas.Image
        renderStrategy: Canvas.Immediate
        property url atlasSource: Qt.resolvedUrl("../images/sprites.png")
        property bool ready: false

        Component.onCompleted: loadImage(atlasSource)
        onImageLoaded: requestPaint()
        onPaint: {
            var context = getContext("2d")
            context.clearRect(0, 0, width, height)
            context.drawImage(atlasSource, 0, 0)
            ready = true
            trailLayer.requestPaint()
        }
    }

    Canvas {
        id: trailLayer

        anchors.fill: parent
        property var pendingMarks: []
        property bool clearRequested: false

        onPaint: {
            var context = getContext("2d")
            if (clearRequested) {
                context.clearRect(0, 0, width, height)
                clearRequested = false
            }
            if (!spriteSampler.ready) {
                return
            }
            for (var index = 0; index < pendingMarks.length; ++index) {
                var mark = pendingMarks[index]
                var left = Math.round(mark.x)
                var top = Math.round(mark.y)
                if (mark.sourceX < 0 || mark.sourceY < 0) {
                    continue
                }
                var pixels = context.getImageData(
                    left, top, mark.size, mark.size
                )
                var sampler = spriteSampler.getContext("2d")
                for (var py = 0; py < mark.size; ++py) {
                    for (var px = 0; px < mark.size; ++px) {
                        var source = sampler.getImageData(
                            Math.floor(mark.sourceX + px / mark.spriteScale),
                            Math.floor(mark.sourceY + py / mark.spriteScale), 1, 1
                        ).data
                        var offset = (py * mark.size + px) * 4
                        var alpha = source[3] / 255
                        var red = Math.round(source[0] * alpha
                            + pixels[offset] * (1 - alpha))
                        var green = Math.round(source[1] * alpha
                            + pixels[offset + 1] * (1 - alpha))
                        var blue = Math.round(source[2] * alpha
                            + pixels[offset + 2] * (1 - alpha))
                        pixels[offset] = Simulation.blendFootprintChannel(
                            red, 0, mark.blendAmount, false,
                            mark.state13, "red"
                        )
                        pixels[offset + 1] = Simulation.blendFootprintChannel(
                            green, 0, mark.blendAmount, false,
                            mark.state13, "green"
                        )
                        pixels[offset + 2] = Simulation.blendFootprintChannel(
                            blue, 0, mark.blendAmount, false,
                            mark.state13, "blue"
                        )
                        pixels[offset + 3] = 255
                    }
                }
                context.putImageData(pixels, left, top)
            }
            pendingMarks = []
        }
    }

    Repeater {
        id: characters

        model: view.simulation ? view.simulation.characters.length : 0

        delegate: Character { }
    }

    Repeater {
        id: entities

        model: view.simulation ? view.simulation.entities.length : 0

        delegate: Character { }
    }

    // Drawn above everything, because a bolt crosses the whole battle.
    Canvas {
        id: boltLayer

        anchors.fill: parent
        z: 10000
        visible: bolts.length > 0

        property var bolts: []

        onPaint: {
            var context = getContext("2d")
            context.clearRect(0, 0, width, height)
            context.lineCap = "round"
            context.lineJoin = "round"

            for (var bolt = 0; bolt < bolts.length; ++bolt) {
                var paths = bolts[bolt].paths
                for (var path = 0; path < paths.length; ++path) {
                    var points = paths[path]
                    if (!points || points.length < 2) {
                        continue
                    }
                    // Twice over: a wide blue halo, then a thin white core.
                    // That is what the capture shows — white with a blue tinge,
                    // not a flat stroke.
                    for (var pass = 0; pass < 2; ++pass) {
                        context.beginPath()
                        context.moveTo(
                            points[0].x - view.viewportX,
                            points[0].y - view.viewportY
                        )
                        for (var point = 1; point < points.length; ++point) {
                            context.lineTo(
                                points[point].x - view.viewportX,
                                points[point].y - view.viewportY
                            )
                        }
                        context.lineWidth = pass === 0 ? 3 : 1
                        context.strokeStyle = pass === 0 ? "#5580ff" : "#ffffff"
                        context.stroke()
                    }
                }
            }
        }
    }
}
