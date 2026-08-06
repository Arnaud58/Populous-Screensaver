import QtQuick
import QtQuick.Controls
import org.kde.kirigami as Kirigami

Kirigami.FormLayout {
    id: root

    // Plasma injects these properties when the page is loaded from both the
    // desktop wallpaper dialog and the screen-locker appearance KCM.
    property var configDialog
    property var wallpaperConfiguration

    property alias cfg_CharacterCount: characterCount.value
    property int cfg_SpriteScale: 0
    property alias cfg_ArmageddonSeconds: armageddonSeconds.value
    property alias cfg_FootprintsEnabled: footprintsEnabled.checked
    property alias cfg_RandomSeed: randomSeed.value
    property alias formLayout: root

    SpinBox {
        id: characterCount

        from: 10
        to: 1000
        editable: true
        Kirigami.FormData.label: qsTr("Characters:")
    }

    ComboBox {
        id: spriteScale

        textRole: "label"
        valueRole: "value"
        model: [
            { "label": qsTr("Automatic"), "value": 0 },
            { "label": qsTr("1×"), "value": 1 },
            { "label": qsTr("2×"), "value": 2 },
            { "label": qsTr("3×"), "value": 3 }
        ]
        currentIndex: indexOfValue(root.cfg_SpriteScale)
        onActivated: root.cfg_SpriteScale = currentValue
        Kirigami.FormData.label: qsTr("Sprite size:")
    }

    SpinBox {
        id: armageddonSeconds

        from: 60
        to: 500
        editable: true
        Kirigami.FormData.label: qsTr("Armageddon every (s):")
    }

    CheckBox {
        id: footprintsEnabled

        text: qsTr("Show fading trails")
        Kirigami.FormData.label: qsTr("Footprints:")
    }

    SpinBox {
        id: randomSeed

        from: 0
        to: 2147483647
        editable: true
        Kirigami.FormData.label: qsTr("Seed (0 = random):")
    }
}
