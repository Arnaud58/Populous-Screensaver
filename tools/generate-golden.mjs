#!/usr/bin/env node

import { readFile, mkdir, writeFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { dirname, join, resolve } from "node:path"

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SIMULATION_PATH = join(PROJECT, "core/js/Simulation.js")
const ANIMATIONS_PATH = join(PROJECT, "core/js/Animations.js")
const GOLDEN_DIR = join(PROJECT, "tests/golden")
const HOST_STEP_SECONDS = 1 / 60

const SIMULATION_EXPORTS = [
    "tuning",
    "createSimulation",
    "createWorld",
    "populate",
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
let animationsPromise = null

async function loadPragmaLibrary(path, exports) {
    const source = await readFile(path, "utf8")
    const plainSource = source.replace(/^\s*\.pragma\s+library\s*$/m, "")
    return new Function(`${plainSource}\nreturn { ${exports.join(", ")} };`)()
}

async function loadSimulation() {
    if (!simulationModulePromise) {
        simulationModulePromise = loadPragmaLibrary(SIMULATION_PATH, SIMULATION_EXPORTS)
    }
    return simulationModulePromise
}

// The traces use the real manifest, so the frame sizes driving edge margins are
// the ones a host actually renders. Before 0.9.0 this file invented a fixed
// 20x26 frame, and the traces therefore never matched the QML targets.
async function loadAnimations() {
    if (!animationsPromise) {
        animationsPromise = loadPragmaLibrary(ANIMATIONS_PATH, ["manifest"])
            .then(module => module.manifest.animations)
    }
    return animationsPromise
}

function rounded(value) {
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error(`Cannot serialize non-finite number: ${value}`)
        }
        const fixed = Number(value.toFixed(6))
        // JSON has no negative zero: it writes -0 as 0 and reads it back as 0.
        // Left alone, a freshly generated snapshot would never equal the same
        // snapshot read from disk, and the trace would fail on a clean tree.
        // Same trap as the undefined fields dropped below.
        return fixed === 0 ? 0 : fixed
    }
    if (Array.isArray(value)) {
        return value.map(rounded)
    }
    if (value && typeof value === "object") {
        // Undefined entries are dropped rather than kept, because JSON drops
        // them too. Keeping them would make a freshly generated snapshot
        // unequal to the same snapshot read back from disk, and the entity
        // snapshot has genuinely optional fields: an effect has no soul phase
        // and a soul has no effect kind.
        return Object.fromEntries(
            Object.entries(value)
                .filter(([, entry]) => entry !== undefined)
                .map(([key, entry]) => [key, rounded(entry)])
        )
    }
    return value
}

function characterSnapshot(character) {
    return {
        id: character.id,
        entity: character.entity,
        action: character.action,
        behaviour: character.behaviour,
        tribe: character.tribe,
        directionId: character.directionId,
        directionX: character.directionX,
        directionY: character.directionY,
        headingX: character.headingX,
        headingY: character.headingY,
        worldX: character.worldX,
        worldY: character.worldY,
        slotIndex: character.slotIndex,
        targetSlot: character.targetSlot,
        spawnRectIndex: character.spawnRectIndex,
        speed: character.speed,
        spriteScale: character.spriteScale,
        frameIndex: character.frameIndex,
        animationElapsedMs: character.animationElapsedMs,
        footprintElapsedMs: character.footprintElapsedMs,
        footprintSide: character.footprintSide,
        collisionCooldownMs: character.collisionCooldownMs,
        wanderRemainingMs: character.wanderRemainingMs,
        legacyState: character.legacyState,
        legacySubstate: character.legacySubstate,
        legacyTimerTicks: character.legacyTimerTicks,
        legacyMod11: character.legacyMod11,
        legacyMod2: character.legacyMod2,
        legacyFrameCounter: character.legacyFrameCounter,
        legacyTurnTicks: character.legacyTurnTicks,
        legacyTurnRadians: character.legacyTurnRadians,
        formationSlot: character.formationSlot,
        health: character.health,
        targetId: character.targetId,
        actionRemainingMs: character.actionRemainingMs,
        castCooldownMs: character.castCooldownMs,
        castLaunched: character.castLaunched,
        enteringWorld: character.enteringWorld,
        initialized: character.initialized
    }
}

function entitySnapshot(entity) {
    return {
        id: entity.id,
        entity: entity.entity,
        kind: entity.kind,
        action: entity.action,
        behaviour: entity.behaviour,
        tribe: entity.tribe,
        worldX: entity.worldX,
        worldY: entity.worldY,
        velocityX: entity.velocityX,
        velocityY: entity.velocityY,
        spriteScale: entity.spriteScale,
        frameIndex: entity.frameIndex,
        animationElapsedMs: entity.animationElapsedMs,
        phaseRemainingMs: entity.phaseRemainingMs,
        lifetimeRemainingMs: entity.lifetimeRemainingMs,
        accelerationRemainingMs: entity.accelerationRemainingMs
    }
}

export async function generateScenario(scenario) {
    const Simulation = await loadSimulation()
    const animations = await loadAnimations()
    const world = Simulation.createWorld(scenario.worldRects)
    const simulation = Simulation.createSimulation(
        scenario.seed,
        animations,
        { combatEnabled: true }
    )
    Simulation.populate(simulation, scenario.characterCount, scenario.spriteScale)

    // A zero-duration call performs deterministic initialisation without
    // consuming a simulation step, giving the fixture an explicit step 0.
    Simulation.stepSimulation(simulation, world, 0)

    const snapshots = []
    let events = []
    const capture = step => {
        snapshots.push(rounded({
            step,
            accumulatedSeconds: simulation.accumulatedSeconds,
            avoidanceElapsedMs: simulation.avoidanceElapsedMs,
            characters: simulation.characters.map(characterSnapshot),
            characterSlots: simulation.characterSlots.map(character =>
                character ? character.id : null),
            entities: simulation.entities.map(entitySnapshot),
            events
        }))
        events = []
    }

    capture(0)
    for (let step = 1; step <= scenario.steps; ++step) {
        events.push(...Simulation.stepSimulation(
            simulation,
            world,
            HOST_STEP_SECONDS
        ))
        if (step % scenario.snapshotIntervalSteps === 0) {
            capture(step)
        }
    }

    return {
        formatVersion: 3,
        scenario: {
            id: scenario.id,
            seed: scenario.seed,
            characterCount: scenario.characterCount,
            spriteScale: scenario.spriteScale,
            steps: scenario.steps,
            stepSeconds: rounded(HOST_STEP_SECONDS),
            simulationStepSeconds: rounded(Simulation.tuning.stepSeconds),
            snapshotIntervalSteps: scenario.snapshotIntervalSteps,
            worldRects: scenario.worldRects
        },
        snapshots
    }
}

export function serializeGolden(golden) {
    return JSON.stringify(golden, null, 2) + "\n"
}

// The traces are compared as text, so a checkout that rewrote their line
// endings would report every scenario out of date while the simulation is
// byte-identical. Git stores them with LF and hands them to a Windows working
// tree as CRLF, so on Windows the check failed permanently — which is worse
// than useless for a regression guard: it teaches you to ignore it.
function normalizeNewlines(text) {
    return text.replace(/\r\n/g, "\n")
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
        if (normalizeNewlines(expected) !== normalizeNewlines(serialized)) {
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
