import { readFileSync } from "node:fs"
import test from "node:test"
import assert from "node:assert/strict"

const schema = readFileSync(
    new URL("../targets/plasma/contents/config/main.xml", import.meta.url),
    "utf8"
)
const configUi = readFileSync(
    new URL("../targets/plasma/contents/ui/config.qml", import.meta.url),
    "utf8"
)

const hostUi = readFileSync(
    new URL("../targets/plasma/contents/ui/main.qml", import.meta.url),
    "utf8"
)

const expected = {
    CharacterCount: "200",
    SpriteScale: "0",
    FootprintsEnabled: "true",
    RandomSeed: "0"
}

// The configuration page and the wallpaper each carry their own bound, and
// nothing links them. When they disagreed the page offered up to 1000
// characters while the wallpaper quietly clamped to 100, so a setting could be
// saved and have no effect at all.
const characterCountCeiling = "1000"

test("Plasma configuration accepts the host integration properties", () => {
    assert.match(configUi, /property\s+var\s+configDialog\b/)
    assert.match(configUi, /property\s+var\s+wallpaperConfiguration\b/)
})

for (const [name, defaultValue] of Object.entries(expected)) {
    test(`Plasma configuration declares ${name}`, () => {
        const entry = schema.match(
            new RegExp(`<entry\\s+name="${name}"[\\s\\S]*?</entry>`)
        )
        assert.notEqual(entry, null, `missing KConfig entry ${name}`)
        assert.match(entry[0], new RegExp(`<default>${defaultValue}</default>`))
        assert.match(configUi, new RegExp(`cfg_${name}\\b`))
    })
}

test("the character count offered and the count honoured agree", () => {
    const offered = configUi.match(/id:\s*characterCount[\s\S]*?to:\s*(\d+)/)
    assert.notEqual(offered, null, "the configuration page declares no upper bound")
    assert.equal(
        offered[1],
        characterCountCeiling,
        "the configuration page's spin box no longer matches the expected ceiling"
    )

    const honoured = hostUi.match(/characterCount:[\s\S]*?Math\.min\(\s*(\d+)/)
    assert.notEqual(honoured, null, "the wallpaper does not clamp the character count")
    assert.equal(
        honoured[1],
        characterCountCeiling,
        "the wallpaper clamps the character count below what the page offers"
    )
})
