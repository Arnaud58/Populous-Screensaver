import QtQuick

Item {
    id: footprint

    required property real groundX
    required property real groundY
    required property real directionX
    required property real directionY
    required property color tribeColor
    required property real spriteScale

    x: groundX - width / 2
    y: groundY - height / 2
    width: 7 * spriteScale
    height: 7 * spriteScale
    rotation: Math.atan2(directionY, directionX) * 180 / Math.PI - 90
    opacity: 0.72

    Rectangle {
        x: footprint.spriteScale
        y: 0
        width: Math.max(1, 2 * footprint.spriteScale)
        height: Math.max(2, 3 * footprint.spriteScale)
        color: footprint.tribeColor
    }

    Rectangle {
        x: 4 * footprint.spriteScale
        y: 4 * footprint.spriteScale
        width: Math.max(1, 2 * footprint.spriteScale)
        height: Math.max(2, 3 * footprint.spriteScale)
        color: footprint.tribeColor
    }

    SequentialAnimation {
        running: true

        PauseAnimation {
            duration: 900
        }

        NumberAnimation {
            target: footprint
            property: "opacity"
            to: 0
            duration: 2600
            easing.type: Easing.InQuad
        }

        ScriptAction {
            script: footprint.destroy()
        }
    }
}
