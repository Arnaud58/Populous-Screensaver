import QtQuick

// Renders one character. It holds no state of its own, no rule and no timer:
// PopulousView copies the four values below out of the simulation on every
// tick, and everything visual is a binding derived from them.
//
// Positions are already viewport-relative when they arrive here, so the same
// simulation can feed one window per monitor.
Item {
    id: character

    property real worldX: 0
    property real worldY: 0
    property real spriteScale: 2

    // A frame of the compiled manifest, or null when the character is not
    // visible in this viewport. The simulation resolves it; nothing here
    // consults the manifest.
    property var frame: null

    x: worldX
    y: worldY
    z: worldY
    width: 0
    height: 0
    visible: frame !== null

    Image {
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
