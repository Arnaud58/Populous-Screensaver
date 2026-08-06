import QtCore
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window

// The `/c` dialog. Same four settings as the Plasma configuration page, stored
// through QSettings so they land in the registry rather than in a file beside
// the executable.
Window {
    id: dialog

    width: 420
    height: 320
    minimumWidth: 380
    minimumHeight: 300
    visible: true
    title: "Populous Screen Saver settings"
    flags: Qt.Dialog

    Settings {
        id: settings

        category: "General"

        property int characterCount: 200
        property int spriteScale: 0
        property int armageddonSeconds: 120
        property bool footprintsEnabled: true
        property int randomSeed: 0
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 18
        spacing: 14

        GridLayout {
            Layout.fillWidth: true
            columns: 2
            columnSpacing: 14
            rowSpacing: 12

            Label { text: "Characters" }

            SpinBox {
                id: characterCount

                Layout.fillWidth: true
                from: 10
                to: 1000
                value: settings.characterCount
            }

            Label { text: "Armageddon every (s)" }

            SpinBox {
                id: armageddonSeconds

                Layout.fillWidth: true
                from: 60
                to: 500
                value: settings.armageddonSeconds
            }

            Label { text: "Sprite size" }

            ComboBox {
                id: spriteScale

                Layout.fillWidth: true
                model: ["Automatic", "1×", "2×", "3×"]
                currentIndex: settings.spriteScale
            }

            Label { text: "Footprints" }

            CheckBox {
                id: footprints

                text: "Leave trails"
                checked: settings.footprintsEnabled
            }

            Label { text: "Random seed" }

            SpinBox {
                id: randomSeed

                Layout.fillWidth: true
                from: 0
                to: 2147483647
                editable: true
                value: settings.randomSeed
            }
        }

        Label {
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            opacity: 0.7
            font.pixelSize: 12
            text: "A seed of 0 gives a different run every time. Any other "
                + "value replays the same world exactly."
        }

        Item { Layout.fillHeight: true }

        RowLayout {
            Layout.fillWidth: true
            spacing: 10

            Item { Layout.fillWidth: true }

            Button {
                text: "Cancel"
                onClicked: Qt.quit()
            }

            Button {
                text: "OK"
                highlighted: true
                onClicked: {
                    settings.characterCount = characterCount.value
                    settings.armageddonSeconds = armageddonSeconds.value
                    settings.spriteScale = spriteScale.currentIndex
                    settings.footprintsEnabled = footprints.checked
                    settings.randomSeed = randomSeed.value
                    settings.sync()
                    Qt.quit()
                }
            }
        }
    }
}
