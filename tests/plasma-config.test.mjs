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
    ArmageddonSeconds: "120",
    SpriteScale: "0",
    FootprintsEnabled: "true",
    RandomSeed: "0"
}

// The configuration page and the wallpaper each carry their own bound, and
// nothing links them. When they disagreed the page offered up to 1000
// characters while the wallpaper quietly clamped to 100, so a setting could be
// saved and have no effect at all.
// Each entry is a bounded setting: the id of its spin box on the configuration
// page, the ceiling that page offers, and the floor and ceiling the wallpaper
// clamps to. Every new bounded setting belongs here.
const boundedSettings = [
    { id: "characterCount", property: "characterCount", floor: "1", ceiling: "1000" },
    { id: "armageddonSeconds", property: "armageddonSeconds", floor: "60", ceiling: "500" }
]

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

for (const setting of boundedSettings) {
    test(`the ${setting.id} offered and the value honoured agree`, () => {
        const offered = configUi.match(new RegExp(
            String.raw`id:\s*${setting.id}[\s\S]*?to:\s*(\d+)`
        ))
        assert.notEqual(offered, null,
            `the configuration page declares no upper bound for ${setting.id}`)
        assert.equal(offered[1], setting.ceiling,
            `the ${setting.id} spin box no longer matches the expected ceiling`)

        const honoured = hostUi.match(new RegExp(
            String.raw`${setting.property}:[\s\S]*?`
                + String.raw`Math\.max\(\s*(\d+),[\s\S]*?Math\.min\(\s*(\d+)`
        ))
        assert.notEqual(honoured, null,
            `the wallpaper does not clamp ${setting.property}`)
        assert.equal(honoured[1], setting.floor,
            `the wallpaper clamps ${setting.property} above what the page offers`)
        assert.equal(honoured[2], setting.ceiling,
            `the wallpaper clamps ${setting.property} below what the page offers`)
    })
}
