#!/usr/bin/env node

import { readFile, mkdir, writeFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { dirname, join, resolve } from "node:path"

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SIMULATION_PATH = join(PROJECT, "core/js/Simulation.js")
const GOLDEN_DIR = join(PROJECT, "tests/golden")

const SIMULATION_EXPORTS = [
    "tuning",
    "createSimulation",
    "createWorld",
    "stepSimulation"
]

export const SCENARIOS = [
    {
        id: "single-screen",
        filename: "single-screen.json",
        seed: 1998,
        characterCount: 24,
        spriteScale: 1,
        steps: 600,
        snapshotIntervalSteps: 60,
        worldRects: [
            { x: 0, y: 0, width: 1280, height: 720 }
        ]
    },
    {
        id: "three-screens",
        filename: "three-screens.json",
        seed: 1998,
        characterCount: 24,
        spriteScale: 2,
        steps: 600,
        snapshotIntervalSteps: 60,
        worldRects: [
            { x: 0, y: 0, width: 1920, height: 1200 },
            { x: 1920, y: 0, width: 1920, height: 1080 },
            { x: 3840, y: 0, width: 1920, height: 1080 }
        ]
    }
]

let simulationModulePromise = null

async function loadSimulation() {
    if (!simulationModulePromise) {
        simulationModulePromise = readFile(SIMULATION_PATH, "utf8").then(source => {
            const plainSource = source.replace(/^\s*\.pragma\s+library\s*$/m, "")
            return new Function(
                `${plainSource}\nreturn { ${SIMULATION_EXPORTS.join(", ")} };`
            )()
        })
    }
    return simulationModulePromise
}

function makeCharacter(spriteScale) {
    return {
        tribe: "blue",
        directionId: "south",
        directionX: 0,
        directionY: 1,
        worldX: 0,
        worldY: 0,
        speed: 0,
        spriteScale,
        frameIndex: 0,
        animationElapsedMs: 0,
        distanceSinceFootprint: 0,
        collisionCooldownMs: 0,
        wanderRemainingMs: 0,
        initialized: false,
        frameWidth: 20,
        frameHeight: 26,
        frameCount: 4,
        frameDurationMs: 120
    }
}

function rounded(value) {
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error(`Cannot serialize non-finite number: ${value}`)
        }
        return Number(value.toFixed(6))
    }
    if (Array.isArray(value)) {
        return value.map(rounded)
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, rounded(entry)])
        )
    }
    return value
}

function characterSnapshot(character) {
    return {
        tribe: character.tribe,
        directionId: character.directionId,
        directionX: character.directionX,
        directionY: character.directionY,
        worldX: character.worldX,
        worldY: character.worldY,
        speed: character.speed,
        spriteScale: character.spriteScale,
        frameIndex: character.frameIndex,
        animationElapsedMs: character.animationElapsedMs,
        distanceSinceFootprint: character.distanceSinceFootprint,
        collisionCooldownMs: character.collisionCooldownMs,
        wanderRemainingMs: character.wanderRemainingMs,
        initialized: character.initialized
    }
}

export async function generateScenario(scenario) {
    const Simulation = await loadSimulation()
    const world = Simulation.createWorld(scenario.worldRects)
    const simulation = Simulation.createSimulation(scenario.seed)
    simulation.characters = Array.from(
        { length: scenario.characterCount },
        () => makeCharacter(scenario.spriteScale)
    )

    // A zero-duration call performs deterministic initialisation without
    // consuming a simulation step, giving the fixture an explicit step 0.
    Simulation.stepSimulation(simulation, world, 0)

    const snapshots = []
    let footprints = []
    const capture = step => {
        snapshots.push(rounded({
            step,
            accumulatedSeconds: simulation.accumulatedSeconds,
            avoidanceElapsedMs: simulation.avoidanceElapsedMs,
            characters: simulation.characters.map(characterSnapshot),
            footprints
        }))
        footprints = []
    }

    capture(0)
    for (let step = 1; step <= scenario.steps; ++step) {
        footprints.push(...Simulation.stepSimulation(
            simulation,
            world,
            Simulation.tuning.stepSeconds
        ))
        if (step % scenario.snapshotIntervalSteps === 0) {
            capture(step)
        }
    }

    return {
        formatVersion: 1,
        scenario: {
            id: scenario.id,
            seed: scenario.seed,
            characterCount: scenario.characterCount,
            spriteScale: scenario.spriteScale,
            steps: scenario.steps,
            stepSeconds: rounded(Simulation.tuning.stepSeconds),
            snapshotIntervalSteps: scenario.snapshotIntervalSteps,
            worldRects: scenario.worldRects
        },
        snapshots
    }
}

export function serializeGolden(golden) {
    return JSON.stringify(golden, null, 2) + "\n"
}

async function run(mode) {
    if (mode !== "--write" && mode !== "--check") {
        throw new Error("Usage: node tools/generate-golden.mjs [--write|--check]")
    }

    if (mode === "--write") {
        await mkdir(GOLDEN_DIR, { recursive: true })
    }

    let failed = false
    for (const scenario of SCENARIOS) {
        const output = join(GOLDEN_DIR, scenario.filename)
        const serialized = serializeGolden(await generateScenario(scenario))

        if (mode === "--write") {
            await writeFile(output, serialized, "utf8")
            console.log(`wrote ${output}`)
            continue
        }

        let expected
        try {
            expected = await readFile(output, "utf8")
        } catch (error) {
            console.error(`missing ${output}`)
            failed = true
            continue
        }
        if (expected !== serialized) {
            console.error(`out of date: ${output}`)
            failed = true
        } else {
            console.log(`ok ${output}`)
        }
    }

    if (failed) {
        process.exitCode = 1
    }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    run(process.argv[2] || "--check").catch(error => {
        console.error(error.message)
        process.exitCode = 1
    })
}
