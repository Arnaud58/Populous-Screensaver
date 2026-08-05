#!/usr/bin/env node

// Read the combat floats directly from the original PE image. This keeps the
// evidence reproducible without checking Ghidra's large generated project or
// pseudo-C into Git.

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

function sectionForVirtualAddress(address) {
    const pe = image.readUInt32LE(0x3c)
    if (image.toString("ascii", pe, pe + 4) !== "PE\0\0") {
        throw new Error(`${executable} is not a PE executable`)
    }
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
        const rawOffset = image.readUInt32LE(entry + 20)
        if (address >= virtualAddress
                && address < virtualAddress + Math.max(virtualSize, rawSize)) {
            return rawOffset + address - virtualAddress
        }
    }
    throw new Error(`Virtual address 0x${address.toString(16)} is outside the PE`)
}

function floatAt(address) {
    return image.readFloatLE(sectionForVirtualAddress(address))
}

const constants = {
    sourceSha256: sha256,
    originalTickMs: 30,
    acquisitionDistanceSquared: floatAt(0x004212a0),
    acquisitionDistance: Math.sqrt(floatAt(0x004212a0)),
    attackDistanceSquared: floatAt(0x004212a4),
    attackDistance: Math.sqrt(floatAt(0x004212a4)),
    pursuitPixelsPerTick: 2,
    attackTicks: 4,
    hitTicks: 3,
    hitRecoilPixelsPerTick: Math.abs(floatAt(0x00421298)),
    fatalDamageThreshold: 5,
    soulPoseTicks: 3,
    soulInitialPixelsPerTick: 2,
    soulMaximumPixelsPerTick: Math.abs(floatAt(0x00421290)),
    soulAccelerationPixelsPerTick: floatAt(0x00421294),
    soulMaximumTicks: 200
}

console.log(JSON.stringify(constants, null, 2))
