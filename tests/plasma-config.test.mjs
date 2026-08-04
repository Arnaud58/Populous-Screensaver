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

const expected = {
    CharacterCount: "24",
    SpriteScale: "0",
    FootprintsEnabled: "true",
    RandomSeed: "0"
}

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
