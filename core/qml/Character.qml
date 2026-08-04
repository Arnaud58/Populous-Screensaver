import QtQuick

import "Simulation.js" as Simulation

// Renders one character and drives it through the rules in Simulation.js.
// This item holds no rule of its own: it owns the state, the manifest lookup
// and the sprite, and calls into the simulation for everything else.
Item {
    id: character

    required property var manifest
    property string tribe: "blue"
    property string directionId: "south"
    property real directionX: 0
    property real directionY: 1
    property real worldX: 0
    property real worldY: 0
    property real speed: 38
    property real spriteScale: 2
    property int frameIndex: 0
    property var animation: null
    property var frame: null
    property double previousTick: 0
    property bool initialized: false
    property int characterIndex: -1
    property int characterCount: 0
    property var characterProvider: null
    property double lastCollisionAt: 0
    property real distanceSinceFootprint: 0

    signal footprintRequested(
        real groundX,
        real groundY,
        real directionX,
        real directionY,
        string tribe,
        real footprintScale
    )

    x: worldX
    y: worldY
    z: worldY
    width: 0
    height: 0

    // The world the simulation runs in. Today it is the parent item; phase 4
    // replaces this with an explicit region spanning several viewports.
    function worldGeometry() {
        return { "width": parent.width, "height": parent.height }
    }

    // Frame-derived distances the simulation needs but must not compute
    // itself, since they depend on the sprite rather than on the rules.
    function stepMetrics() {
        return {
            "marginX": frame ? frame.width * spriteScale / 2 : 12,
            "marginTop": frame ? frame.height * spriteScale : 24,
            "footprintSpacing": Simulation.tuning.footprintSpacing * spriteScale
        }
    }

    function selectAnimation() {
        var id = Simulation.animationId(tribe, directionId)
        animation = manifest && manifest.animations ? manifest.animations[id] : null
        frameIndex = 0
        updateFrame()
    }

    function updateFrame() {
        if (!animation || !animation.frames || animation.frames.length === 0) {
            frame = null
            return
        }
        frameIndex %= animation.frames.length
        frame = animation.frames[frameIndex]
    }

    function initialize() {
        if (!parent) {
            return
        }
        if (!Simulation.initializeCharacter(
                character, worldGeometry(), spriteScale, Date.now())) {
            return
        }
        selectAnimation()
        initialized = true
    }

    function advance() {
        if (!animation || !parent) {
            return
        }

        var result = Simulation.stepCharacter(
            character, worldGeometry(), Date.now(), stepMetrics()
        )

        if (result.directionChanged) {
            selectAnimation()
        }
        if (result.footprint) {
            footprintRequested(
                result.footprint.groundX,
                result.footprint.groundY,
                result.footprint.directionX,
                result.footprint.directionY,
                result.footprint.tribe,
                spriteScale
            )
        }
    }

    function avoidCollisions() {
        if (!initialized || !characterProvider) {
            return
        }

        var others = []
        for (var index = 0; index < characterCount; ++index) {
            if (index === characterIndex) {
                continue
            }
            var other = characterProvider(index)
            if (other && other.initialized) {
                others.push(other)
            }
        }

        if (Simulation.avoidCollisions(character, others, Date.now(), spriteScale)) {
            selectAnimation()
        }
    }

    function wander() {
        if (!initialized) {
            return
        }
        if (Simulation.wander(character)) {
            selectAnimation()
        }
        wanderTimer.interval = Simulation.randomWanderInterval()
    }

    onManifestChanged: selectAnimation()

    Image {
        id: sprite

        visible: character.frame !== null
        source: Qt.resolvedUrl("../images/sprites.png")
        sourceClipRect: character.frame
            ? Qt.rect(
                character.frame.x,
                character.frame.y,
                character.frame.width,
                character.frame.height
            )
            : Qt.rect(0, 0, 1, 1)
        x: character.frame ? -character.frame.anchorX * character.spriteScale : 0
        y: character.frame ? -character.frame.anchorY * character.spriteScale : 0
        width: character.frame ? character.frame.width * character.spriteScale : 1
        height: character.frame ? character.frame.height * character.spriteScale : 1
        fillMode: Image.Stretch
        smooth: false
        mipmap: false
        cache: true
    }

    Timer {
        interval: character.animation
            ? character.animation.frameDurationMs
            : 120
        running: character.animation !== null
        repeat: true
        onTriggered: {
            character.frameIndex += 1
            character.updateFrame()
        }
    }

    Timer {
        interval: 16
        running: !character.initialized
        repeat: true
        onTriggered: character.initialize()
    }

    Timer {
        interval: 16
        running: character.animation !== null && character.initialized
        repeat: true
        onTriggered: character.advance()
    }

    Timer {
        interval: 100
        running: character.animation !== null && character.initialized
        repeat: true
        onTriggered: character.avoidCollisions()
    }

    Timer {
        id: wanderTimer

        interval: Simulation.randomWanderInterval()
        running: character.animation !== null && character.initialized
        repeat: true
        onTriggered: character.wander()
    }
}
