import QtQuick
import org.kde.plasma.plasmoid

// Plasma instantiates one host per screen, so each screen runs its own world.
// The future standalone Qt host will pass multiple rectangles to the shared
// engine when it needs one continuous multi-monitor world.
WallpaperItem {
    id: wallpaper

    PopulousWorld {
        anchors.fill: parent
        // The ceiling has to match the configuration page's spin box, or the
        // page offers a number the wallpaper silently refuses to honour.
        characterCount: Math.max(
            10,
            Math.min(
                200,
                wallpaper.configuration
                    && wallpaper.configuration.CharacterCount !== undefined
                    ? wallpaper.configuration.CharacterCount
                    : 150
            )
        )
        spriteScaleOverride: Math.max(
            0,
            Math.min(
                3,
                wallpaper.configuration
                    && wallpaper.configuration.SpriteScale !== undefined
                    ? wallpaper.configuration.SpriteScale
                    : 0
            )
        )
        // Same rule as the character count: the ceiling has to match the
        // configuration page's spin box, or the page offers a number the
        // wallpaper silently refuses to honour.
        armageddonSeconds: Math.max(
            60,
            Math.min(
                500,
                wallpaper.configuration
                    && wallpaper.configuration.ArmageddonSeconds !== undefined
                    ? wallpaper.configuration.ArmageddonSeconds
                    : 120
            )
        )
        footprintsEnabled: wallpaper.configuration
            && wallpaper.configuration.FootprintsEnabled !== undefined
            ? wallpaper.configuration.FootprintsEnabled
            : true
        randomSeed: Math.max(
            0,
            wallpaper.configuration
                && wallpaper.configuration.RandomSeed !== undefined
                ? wallpaper.configuration.RandomSeed
                : 0
        )
    }
}
