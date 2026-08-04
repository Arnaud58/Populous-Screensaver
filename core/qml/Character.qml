import QtQuick

import "Simulation.js" as Simulation

// Renders one character. It holds no rule, no timer and no logic: the
// simulation writes the plain properties below, and everything visual is a
// binding derived from them.
//
// The properties up to `initialized` are the duck-typed character state that
// Simulation.js operates on. Keep them in sync with spec/simulation.md.
Item {
    id: character

    required property var manifest

    // Simulation state, written by Simulation.js.
    property string tribe: "blue"
    property string directionId: "south"
    property real directionX: 0
    property real directionY: 1
    property real worldX: 0
    property real worldY: 0
    property real speed: 38
    property real spriteScale: 2
    property int frameIndex: 0
    property real animationElapsedMs: 0
    property real distanceSinceFootprint: 0
    property real collisionCooldownMs: 0
    property real wanderRemainingMs: 0
    property bool initialized: false

    // Rendering, derived. The simulation reads frameWidth and frameHeight to
    // size its edge margins, but never writes them.
    readonly property var animation: manifest && manifest.animations
        ? manifest.animations[Simulation.animationId(tribe, directionId)]
        : null
    readonly property int frameCount: animation && animation.frames
        ? animation.frames.length
        : 0
    readonly property real frameDurationMs: animation && animation.frameDurationMs
        ? animation.frameDurationMs
        : Simulation.tuning.fallbackFrameDurationMs
    readonly property var frame: frameCount > 0
        ? animation.frames[frameIndex % frameCount]
        : null
    readonly property real frameWidth: frame ? frame.width : 0
    readonly property real frameHeight: frame ? frame.height : 0

    x: worldX
    y: worldY
    z: worldY
    width: 0
    height: 0
    visible: initialized

    function resetState() {
        initialized = false
        tribe = "blue"
        directionId = "south"
        directionX = 0
        directionY = 1
        worldX = 0
        worldY = 0
        speed = 0
        frameIndex = 0
        animationElapsedMs = 0
        distanceSinceFootprint = 0
        collisionCooldownMs = 0
        wanderRemainingMs = 0
    }

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
}
