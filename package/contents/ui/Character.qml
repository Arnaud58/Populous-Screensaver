import QtQuick

import "Simulation.js" as Simulation

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

    x: worldX
    y: worldY
    z: worldY
    width: 0
    height: 0

    function selectAnimation() {
        var id = Simulation.animationId(tribe, directionId)
        animation = manifest && manifest.animations ? manifest.animations[id] : null
        frameIndex = 0
        updateFrame()
    }

    function setDirection(dx, dy) {
        var direction = Simulation.directionForVector(dx, dy)
        directionX = direction.dx
        directionY = direction.dy
        directionId = direction.id
        selectAnimation()
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
        if (!parent || parent.width < 64 || parent.height < 64) {
            return
        }
        tribe = Simulation.randomTribe()
        var direction = Simulation.randomDirection()
        worldX = 24 + Math.random() * Math.max(1, parent.width - 48)
        worldY = 40 + Math.random() * Math.max(1, parent.height - 64)
        speed = (30 + Math.random() * 18) * spriteScale
        previousTick = Date.now()
        setDirection(direction.dx, direction.dy)
        initialized = true
    }

    function advance() {
        if (!animation || !parent) {
            return
        }
        var now = Date.now()
        var elapsedSeconds = Math.min(0.05, Math.max(0, now - previousTick) / 1000)
        previousTick = now

        var length = Math.sqrt(directionX * directionX + directionY * directionY)
        var normalizedX = length > 0 ? directionX / length : 0
        var normalizedY = length > 0 ? directionY / length : 0
        var nextX = worldX + normalizedX * speed * elapsedSeconds
        var nextY = worldY + normalizedY * speed * elapsedSeconds
        var marginX = frame ? frame.width * spriteScale / 2 : 12
        var marginTop = frame ? frame.height * spriteScale : 24
        var newDirectionX = directionX
        var newDirectionY = directionY

        if (nextX < marginX || nextX > parent.width - marginX) {
            newDirectionX = -newDirectionX
            nextX = Math.max(marginX, Math.min(parent.width - marginX, nextX))
        }
        if (nextY < marginTop || nextY > parent.height - 4) {
            newDirectionY = -newDirectionY
            nextY = Math.max(marginTop, Math.min(parent.height - 4, nextY))
        }
        if (newDirectionX !== directionX || newDirectionY !== directionY) {
            setDirection(newDirectionX, newDirectionY)
        }

        worldX = nextX
        worldY = nextY
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
}
