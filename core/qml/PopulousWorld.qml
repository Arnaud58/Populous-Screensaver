import QtQuick

import "Animations.js" as Animations

// The engine as a single drop-in item: one simulation, one view onto it.
//
// This is what a host wants when it has one window — the Plasma wallpaper and
// the preview both use it. A host with several windows instead creates one
// PopulousSimulation and one PopulousView per window, which is the only reason
// the two are separable at all.
Item {
    id: world

    property var animationManifest: Animations.manifest
    property string loadError: ""
    property int characterCount: 24
    property int spriteScaleOverride: 0
    property bool footprintsEnabled: true
    readonly property real automaticSpriteScale:
        Math.max(1, Math.min(3, Math.round(height / 540)))
    readonly property real spriteScale:
        spriteScaleOverride > 0 ? spriteScaleOverride : automaticSpriteScale

    // 0 draws a seed from the clock, so each run differs. Any other value
    // replays exactly, which is what the golden traces rely on.
    property int randomSeed: 0

    // The screens this world spans, in world coordinates. Null means "just this
    // item", which is what a single-screen host wants.
    property var worldRects: null

    readonly property alias simulation: simulationHost

    function currentRects() {
        if (worldRects && worldRects.length > 0) {
            return worldRects
        }
        return [{ "x": 0, "y": 0, "width": width, "height": height }]
    }

    PopulousSimulation {
        id: simulationHost

        animationManifest: world.animationManifest
        characterCount: world.characterCount
        spriteScale: world.spriteScale
        randomSeed: world.randomSeed
        worldRects: world.currentRects()
    }

    PopulousView {
        anchors.fill: parent

        simulation: simulationHost
        footprintsEnabled: world.footprintsEnabled
    }

    Text {
        anchors.centerIn: parent
        visible: world.loadError.length > 0
        color: "#ff8080"
        text: world.loadError
        font.pixelSize: 16
    }
}
