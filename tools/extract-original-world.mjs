#!/usr/bin/env node

// Extract the world/formation/footprint constants directly from the original
// PE. Integer immediates are also reported with the function address where
// objdump/Ghidra shows them, so this small JSON is a reproducible evidence map.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { createHash } from "node:crypto"

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const executable = resolve(
    process.argv[2] || `${project}/original/Populous Screen Saver.scr`
)
const image = readFileSync(executable)
const expectedSha256 = "a25f7f7d219018fcf1888891738a706dff5f39f72de103a21dde3945f7097e0b"
const sha256 = createHash("sha256").update(image).digest("hex")
if (sha256 !== expectedSha256) {
    throw new Error(
        `Unexpected executable SHA-256: ${sha256} (expected ${expectedSha256})`
    )
}

function fileOffset(address) {
    const pe = image.readUInt32LE(0x3c)
    const sectionCount = image.readUInt16LE(pe + 6)
    const optionalSize = image.readUInt16LE(pe + 20)
    const optional = pe + 24
    const imageBase = image.readUInt32LE(optional + 28)
    const table = optional + optionalSize
    for (let index = 0; index < sectionCount; ++index) {
        const entry = table + index * 40
        const virtualSize = image.readUInt32LE(entry + 8)
        const virtualAddress = imageBase + image.readUInt32LE(entry + 12)
        const rawSize = image.readUInt32LE(entry + 16)
        if (address >= virtualAddress
                && address < virtualAddress + Math.max(virtualSize, rawSize)) {
            return image.readUInt32LE(entry + 20) + address - virtualAddress
        }
    }
    throw new Error(`Virtual address 0x${address.toString(16)} is outside the PE`)
}

function floatAt(address) {
    return image.readFloatLE(fileOffset(address))
}

const extracted = {
    sourceSha256: sha256,
    functions: {
        buildFormationTables: "0x004010c0",
        startArmageddon: "0x00401bd0",
        updateWorld: "0x00401cd0",
        updateBrave: "0x00410590",
        updateFootprint: "0x00413f20"
    },
    movement: {
        originalTickMs: 30,
        roamPixelsPerTick: 2,
        edgeInsetPixels: floatAt(0x0042128c),
        turnRadiansPerTick: 0.1,
        turnTicks: 20,
        idleTicksMin: 10,
        idleTicksMax: 39
    },
    formation: {
        slotsPerTribe: 200,
        columns: 8,
        spacingPixels: Math.abs(floatAt(0x00421214)),
        halfWidthPixels: floatAt(0x00421210),
        startYDivisor: 6,
        xTranslationHeightFraction: [
            floatAt(0x004211fc),
            floatAt(0x00421204),
            floatAt(0x00421204),
            floatAt(0x004211fc)
        ],
        rotationRadians: [
            floatAt(0x004211f8),
            floatAt(0x00421200),
            floatAt(0x00421208),
            floatAt(0x0042120c)
        ]
    },
    armageddon: {
        gatherTicks: 201,
        battleEndCondition: "fewer than two tribes remain",
        ordinaryRestoreTicks: 2
    },
    footprints: {
        cadenceTicks: 2,
        normalWidthPixels: 2,
        normalHeightPixels: 2,
        state13WidthPixels: 4,
        state13HeightPixels: 4,
        blackBackgroundScalePerSettingUnit: floatAt(0x00421378),
        imageBlendNumerator: floatAt(0x00421380),
        settingMinimum: 0,
        settingMaximum: 100,
        settingDefault: 100
    }
}

console.log(JSON.stringify(extracted, null, 2))
