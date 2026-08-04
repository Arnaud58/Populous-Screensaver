import QtQuick
import org.kde.plasma.plasmoid

// Plasma host shell. Plasma instantiates one of these per screen, so each
// screen currently runs its own world. Phase 4 gives PopulousWorld a region
// that can span several viewports.
WallpaperItem {
    id: wallpaper

    PopulousWorld {
        anchors.fill: parent
    }
}
