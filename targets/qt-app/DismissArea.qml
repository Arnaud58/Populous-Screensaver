import QtQuick

// Quits the screen saver on real user input.
//
// Two guards, both needed on Windows. A burst of mouse movement arrives right
// after launch — the pointer has not moved, the system is simply telling us
// where it is — so input is ignored for a moment. And a mouse resting on a
// slightly noisy surface reports tiny movements forever, so the pointer has to
// travel a real distance before it counts.
Item {
    id: dismissArea

    property int gracePeriodMs: 1200
    property int movementThreshold: 12

    property bool armed: false
    property real originX: -1
    property real originY: -1

    focus: enabled
    activeFocusOnTab: false

    function dismiss() {
        if (armed) {
            Qt.quit()
        }
    }

    Keys.onPressed: function (event) {
        event.accepted = true
        dismiss()
    }

    Timer {
        interval: dismissArea.gracePeriodMs
        running: dismissArea.enabled
        onTriggered: dismissArea.armed = true
    }

    MouseArea {
        anchors.fill: parent
        enabled: dismissArea.enabled
        hoverEnabled: true
        acceptedButtons: Qt.AllButtons
        cursorShape: Qt.BlankCursor

        onPressed: dismissArea.dismiss()
        onWheel: dismissArea.dismiss()

        onPositionChanged: function (mouse) {
            if (dismissArea.originX < 0) {
                dismissArea.originX = mouse.x
                dismissArea.originY = mouse.y
                return
            }
            if (Math.abs(mouse.x - dismissArea.originX) > dismissArea.movementThreshold
                    || Math.abs(mouse.y - dismissArea.originY) > dismissArea.movementThreshold) {
                dismissArea.dismiss()
            }
        }
    }
}
