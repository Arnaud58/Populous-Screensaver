// Headless tests for core/js/Simulation.js.
//
// The simulation is deliberately free of QML, rendering, clock access and
// ambient randomness, so it runs under plain Node. Run with:
//
//     node --test "tests/**/*.test.mjs"

import { readFileSync } from "node:fs"
import test from "node:test"
import assert from "node:assert/strict"
import {
    SCENARIOS,
    generateScenario
} from "../tools/generate-golden.mjs"

const EXPORTS = [
    "directions",
    "tribes",
    "tuning",
    "createRandom",
    "createCharacter",
    "createSimulation",
    "populate",
    "createWorld",
    "worldContains",
    "worldAllows",
    "clampIntoWorld",
    "stepSimulation",
    "animationId",
    "directionForVector",
    "setDirection",
    "initializeCharacter",
    "stepCharacter",
    "avoidCollisions",
    "createSpatialIndex",
    "nearbyCharacters",
    "tribeColor",
    "randomDirection",
    "randomTribe",
    "randomWanderInterval"
]

function loadPragmaLibrary(relativePath, exports) {
    const source = readFileSync(
        new URL(relativePath, import.meta.url),
        "utf8"
    ).replace(/^\s*\.pragma\s+library\s*$/m, "")

    return new Function(`${source}\nreturn { ${exports.join(", ")} };`)()
}

const Simulation = loadPragmaLibrary("../core/js/Simulation.js", EXPORTS)
const { manifest } = loadPragmaLibrary("../core/js/Animations.js", ["manifest"])
const STEP = Simulation.tuning.stepSeconds

// A character built the way a host builds one, then nudged into a known state.
// It carries the real manifest, so the frames driving edge margins are the ones
// a host actually renders rather than an invented constant.
function makeCharacter(overrides = {}) {
    const state = Simulation.createCharacter(
        manifest.animations,
        overrides.spriteScale === undefined ? 1 : overrides.spriteScale
    )

    Object.assign(state, {
        worldX: 100,
        worldY: 100,
        speed: 60,
        // Far enough away that it does not fire during short tests.
        wanderRemainingMs: 1e9,
        initialized: true
    })

    if (overrides.tribe !== undefined) {
        state.tribe = overrides.tribe
    }
    // Resolves the frames for the requested heading; east unless overridden.
    Simulation.setDirection(
        state,
        overrides.directionX === undefined ? 1 : overrides.directionX,
        overrides.directionY === undefined ? 0 : overrides.directionY
    )

    return Object.assign(state, overrides)
}

// The frame a character is displaying, which is what its edge margins follow.
function frameOf(state) {
    return state.frames[state.frameIndex % state.frames.length]
}

const WORLD = Simulation.createWorld([{ x: 0, y: 0, width: 1000, height: 1000 }])
const rect = (x, y, width, height) => ({ x, y, width, height })

function neverWander(random) {
    return random
}

// --- Random source -------------------------------------------------------

test("the same seed replays the same sequence", () => {
    const a = Simulation.createRandom(12345)
    const b = Simulation.createRandom(12345)

    for (let i = 0; i < 1000; ++i) {
        assert.equal(a.nextUint32(), b.nextUint32())
    }
})

test("different seeds diverge", () => {
    const a = Simulation.createRandom(1)
    const b = Simulation.createRandom(2)
    const first = Array.from({ length: 50 }, () => a.nextUint32())
    const second = Array.from({ length: 50 }, () => b.nextUint32())

    assert.notDeepEqual(first, second)
})

test("the random source stays inside its ranges", () => {
    const random = Simulation.createRandom(99)

    for (let i = 0; i < 5000; ++i) {
        const value = random.nextUint32()
        assert.ok(Number.isInteger(value))
        assert.ok(value >= 0 && value <= 0xffffffff)

        const float = random.nextFloat()
        assert.ok(float >= 0 && float < 1)

        const integer = random.nextInt(8)
        assert.ok(Number.isInteger(integer))
        assert.ok(integer >= 0 && integer < 8)
    }
})

test("a zero seed still produces a usable stream", () => {
    const random = Simulation.createRandom(0)
    const values = new Set()

    for (let i = 0; i < 100; ++i) {
        values.add(random.nextUint32())
    }
    assert.ok(values.size > 90)
})

// --- Helpers -------------------------------------------------------------

test("every direction round-trips through directionForVector", () => {
    for (const direction of Simulation.directions) {
        const resolved = Simulation.directionForVector(direction.dx, direction.dy)
        assert.equal(resolved.id, direction.id)
    }
})

test("animation ids match the manifest naming", () => {
    assert.equal(
        Simulation.animationId("yellow", "north_west"),
        "brave.yellow.walk.north_west"
    )
})

// The simulation keeps its own direction table; the manifest carries a vector
// on every compiled animation. If the two ever drift apart, characters move
// along one vector while displaying the sprite for another — they moonwalk,
// and nothing else in the suite would notice.
//
// Whether the atlas order itself is right is a question about pixels, not
// code: check research/direction-check.png, which draws each animation beside
// the arrow it travels along.
test("the manifest agrees with the simulation on every direction vector", () => {
    const ids = Object.keys(manifest.animations)
    assert.ok(ids.length > 0)

    let directional = 0

    for (const id of ids) {
        const animation = manifest.animations[id]

        // Effects have no facing at all. Their ids must then carry no
        // direction either, or a lookup by direction would find them.
        if (animation.direction === null) {
            assert.ok(
                !Simulation.directions.some((one) => id.endsWith("." + one.id)),
                `${id}: has no direction but its id ends with one`
            )
            continue
        }

        directional += 1
        const { dx, dy } = animation.direction
        const resolved = Simulation.directionForVector(dx, dy)

        assert.equal(
            resolved.id,
            animation.direction.id,
            `${id}: manifest says (${dx}, ${dy}) is ${animation.direction.id}, ` +
                `the simulation says ${resolved.id}`
        )
        assert.ok(
            id.endsWith("." + animation.direction.id),
            `${id}: animation id does not end with its own direction`
        )
    }

    assert.ok(directional > 0, "the manifest holds no directional animation")
})

test("every direction of every tribe is present in the manifest", () => {
    for (const tribe of Simulation.tribes) {
        for (const direction of Simulation.directions) {
            const id = Simulation.animationId(tribe, direction.id)
            assert.ok(manifest.animations[id], `missing animation ${id}`)
            assert.equal(manifest.animations[id].frames.length, 4)
        }
    }
})

test("setting a direction restarts the walk cycle", () => {
    const character = makeCharacter({ frameIndex: 3, animationElapsedMs: 80 })

    Simulation.setDirection(character, 0, 1)

    assert.equal(character.directionId, "south")
    assert.equal(character.frameIndex, 0)
    assert.equal(character.animationElapsedMs, 0)
})

// --- Stepping a character ------------------------------------------------

test("a character walks along its direction at its speed", () => {
    const character = makeCharacter()
    const random = Simulation.createRandom(1)

    Simulation.stepCharacter(character, WORLD, STEP, random)

    assert.ok(Math.abs(character.worldX - (100 + 60 * STEP)) < 1e-9)
    assert.equal(character.worldY, 100)
})

test("diagonal movement is normalised to the same speed as cardinal", () => {
    const random = Simulation.createRandom(1)
    const cardinal = makeCharacter()
    const diagonal = makeCharacter({ directionId: "south_east", directionY: 1 })

    Simulation.stepCharacter(cardinal, WORLD, STEP, random)
    Simulation.stepCharacter(diagonal, WORLD, STEP, random)

    const cardinalDistance = Math.hypot(cardinal.worldX - 100, cardinal.worldY - 100)
    const diagonalDistance = Math.hypot(diagonal.worldX - 100, diagonal.worldY - 100)

    assert.ok(Math.abs(cardinalDistance - diagonalDistance) < 1e-9)
})

test("a character bounces off the right edge and is clamped inside", () => {
    const world = Simulation.createWorld([rect(0, 0, 200, 200)])
    const character = makeCharacter({ worldX: 199, speed: 600 })
    const random = Simulation.createRandom(1)
    // Captured before the step: turning west re-resolves the frames.
    const margin = frameOf(character).width * character.spriteScale / 2

    const result = Simulation.stepCharacter(character, world, STEP, random)

    assert.equal(result.directionChanged, true)
    assert.equal(character.directionId, "west")
    assert.equal(character.worldX, 200 - margin)
})

test("a character bounces off the bottom edge using the ground margin", () => {
    const world = Simulation.createWorld([rect(0, 0, 200, 200)])
    const character = makeCharacter({
        directionId: "south",
        directionX: 0,
        directionY: 1,
        worldY: 199,
        speed: 600
    })
    const random = Simulation.createRandom(1)

    const result = Simulation.stepCharacter(character, world, STEP, random)

    assert.equal(result.directionChanged, true)
    assert.equal(character.directionId, "north")
    assert.equal(character.worldY, 200 - Simulation.tuning.bottomMargin)
})

test("the walk animation advances on its own frame duration", () => {
    const character = makeCharacter()
    const random = Simulation.createRandom(1)
    const stepsPerFrame = Math.ceil(character.frameDurationMs / (STEP * 1000))

    for (let i = 0; i < stepsPerFrame; ++i) {
        Simulation.stepCharacter(character, WORLD, STEP, random)
    }
    assert.equal(character.frameIndex, 1)
})

test("the walk animation wraps around its frame count", () => {
    const character = makeCharacter()
    const random = Simulation.createRandom(1)
    const stepsPerCycle =
        Math.ceil((character.frameDurationMs * character.frameCount) / (STEP * 1000))

    for (let i = 0; i < stepsPerCycle; ++i) {
        Simulation.stepCharacter(character, WORLD, STEP, random)
    }
    assert.ok(character.frameIndex >= 0 && character.frameIndex < character.frameCount)
})

test("a footprint is dropped once the spacing has been walked", () => {
    const character = makeCharacter({ speed: 120, spriteScale: 1 })
    const random = Simulation.createRandom(1)
    const spacing = Simulation.tuning.footprintSpacing

    let footprint = null
    let travelled = 0
    for (let i = 0; i < 200 && !footprint; ++i) {
        const before = character.worldX
        footprint = Simulation.stepCharacter(character, WORLD, STEP, random).footprint
        travelled += character.worldX - before
    }

    assert.notEqual(footprint, null)
    assert.ok(travelled >= spacing)
    assert.equal(footprint.tribe, "blue")
    assert.equal(footprint.directionX, 1)
    assert.equal(footprint.spriteScale, 1)
    // The footprint is left one pixel above the ground point, and the
    // character walks due east, so its Y never moves.
    assert.equal(footprint.groundY, 99)
})

test("wandering fires when its countdown runs out", () => {
    const character = makeCharacter({ wanderRemainingMs: STEP * 1000 })
    const random = Simulation.createRandom(7)

    const result = Simulation.stepCharacter(character, WORLD, STEP, random)

    assert.equal(result.directionChanged, true)
    assert.ok(character.wanderRemainingMs >= Simulation.tuning.wanderIntervalMinMs)
    assert.ok(character.wanderRemainingMs <= Simulation.tuning.wanderIntervalMaxMs)
})

// --- Avoidance -----------------------------------------------------------

test("a character turns away from a neighbour it is closing in on", () => {
    const character = makeCharacter()
    const ahead = makeCharacter({ worldX: 105 })

    assert.equal(Simulation.avoidCollisions(character, [ahead]), true)
    assert.equal(character.directionId, "west")
    assert.equal(character.collisionCooldownMs, Simulation.tuning.collisionCooldownMs)
})

test("a character ignores a neighbour it is moving away from", () => {
    const character = makeCharacter()
    const behind = makeCharacter({ worldX: 95 })

    assert.equal(Simulation.avoidCollisions(character, [behind]), false)
})

test("a character ignores a neighbour beyond the collision distance", () => {
    const character = makeCharacter()
    const far = makeCharacter({ worldX: 100 + Simulation.tuning.collisionDistance + 1 })

    assert.equal(Simulation.avoidCollisions(character, [far]), false)
})

test("avoidance respects its cooldown", () => {
    const character = makeCharacter({ collisionCooldownMs: 1 })
    const ahead = makeCharacter({ worldX: 105 })

    assert.equal(Simulation.avoidCollisions(character, [ahead]), false)
    assert.equal(character.directionId, "east")
})

test("a character never avoids itself", () => {
    const character = makeCharacter()

    assert.equal(Simulation.avoidCollisions(character, [character]), false)
})

test("the collision cooldown drains over time", () => {
    const character = makeCharacter({ collisionCooldownMs: STEP * 1000 })
    const random = Simulation.createRandom(1)

    Simulation.stepCharacter(character, WORLD, STEP, random)

    assert.equal(character.collisionCooldownMs, 0)
})

test("the spatial index finds neighbours across a cell boundary", () => {
    const character = makeCharacter({ worldX: 41, worldY: 41 })
    const diagonalNeighbour = makeCharacter({ worldX: 43, worldY: 43 })
    const far = makeCharacter({ worldX: 500, worldY: 500 })
    const characters = [character, diagonalNeighbour, far]
    const index = Simulation.createSpatialIndex(characters, 42)
    const nearby = Simulation.nearbyCharacters(character, index, 14)

    assert.deepEqual(nearby, [character, diagonalNeighbour])
})

test("spatial candidates preserve master character order", () => {
    const first = makeCharacter({ worldX: 43, worldY: 43 })
    const character = makeCharacter({ worldX: 41, worldY: 41 })
    const third = makeCharacter({ worldX: 39, worldY: 39 })
    const characters = [first, character, third]
    const index = Simulation.createSpatialIndex(characters, 42)

    assert.deepEqual(
        Simulation.nearbyCharacters(character, index, 14),
        characters
    )
})

test("spatial avoidance makes the same first-neighbour decision as a full scan", () => {
    const exhaustiveCharacter = makeCharacter()
    const spatialCharacter = makeCharacter()
    const firstAhead = makeCharacter({ worldX: 105, worldY: 105 })
    const secondAhead = makeCharacter({ worldX: 105, worldY: 95 })
    const exhaustiveCharacters = [exhaustiveCharacter, firstAhead, secondAhead]
    const spatialCharacters = [spatialCharacter, firstAhead, secondAhead]

    Simulation.avoidCollisions(exhaustiveCharacter, exhaustiveCharacters)
    const index = Simulation.createSpatialIndex(spatialCharacters, 42)
    const nearby = Simulation.nearbyCharacters(spatialCharacter, index, 14)
    Simulation.avoidCollisions(spatialCharacter, nearby)

    assert.equal(spatialCharacter.directionId, exhaustiveCharacter.directionId)
    assert.equal(spatialCharacter.directionX, exhaustiveCharacter.directionX)
    assert.equal(spatialCharacter.directionY, exhaustiveCharacter.directionY)
})

// --- Initialisation ------------------------------------------------------

test("initialisation refuses a world smaller than the minimum", () => {
    const character = makeCharacter({ initialized: false })
    const tooSmall = Simulation.tuning.minWorldSize - 1
    const random = Simulation.createRandom(1)
    const world = Simulation.createWorld([rect(0, 0, tooSmall, tooSmall)])

    assert.equal(Simulation.initializeCharacter(character, world, random), false)
    assert.equal(character.initialized, false)
})

test("initialisation places a character inside the world at a valid speed", () => {
    const random = Simulation.createRandom(2024)

    for (let attempt = 0; attempt < 200; ++attempt) {
        const character = makeCharacter({ initialized: false, spriteScale: 2 })

        assert.equal(Simulation.initializeCharacter(character, WORLD, random), true)
        assert.equal(character.initialized, true)

        assert.ok(character.worldX >= Simulation.tuning.spawnMarginX)
        assert.ok(character.worldX <= WORLD.bounds.width)
        assert.ok(character.worldY >= Simulation.tuning.spawnMarginTop)
        assert.ok(character.worldY <= WORLD.bounds.height)
        assert.ok(character.speed >= Simulation.tuning.speedMin * 2)
        assert.ok(character.speed <= Simulation.tuning.speedMax * 2)
        assert.ok(Simulation.tribes.includes(character.tribe))
        assert.ok(character.wanderRemainingMs >= Simulation.tuning.wanderIntervalMinMs)
    }
})

// --- The driver ----------------------------------------------------------

function runSimulation(seed, seconds, characterCount = 6) {
    const simulation = Simulation.createSimulation(seed)
    simulation.characters = Array.from({ length: characterCount }, () =>
        makeCharacter({ initialized: false, wanderRemainingMs: 0 })
    )

    const footprints = []
    // Deliberately irregular slices: the fixed step must absorb them.
    const slices = [0.016, 0.021, 0.008, 0.033, 0.016]
    let elapsed = 0
    let index = 0
    while (elapsed < seconds) {
        const slice = slices[index++ % slices.length]
        footprints.push(...Simulation.stepSimulation(simulation, WORLD, slice))
        elapsed += slice
    }

    return {
        positions: simulation.characters.map(c => [c.worldX, c.worldY, c.directionId]),
        footprintCount: footprints.length
    }
}

test("the same seed produces the same run", () => {
    const first = runSimulation(2026, 5)
    const second = runSimulation(2026, 5)

    assert.deepEqual(first.positions, second.positions)
    assert.equal(first.footprintCount, second.footprintCount)
})

test("a different seed produces a different run", () => {
    const first = runSimulation(2026, 5)
    const second = runSimulation(1998, 5)

    assert.notDeepEqual(first.positions, second.positions)
})

test("irregular host timing costs at most one step of quantisation", () => {
    // The same amount of real time delivered in different slice patterns must
    // simulate the same distance, give or take the step not yet consumed.
    // Both patterns stay under maxAccumulatedSeconds, so neither is clamped.
    function run(sliceSizes) {
        const simulation = Simulation.createSimulation(4242)
        simulation.characters = [makeCharacter({ speed: 60 })]
        for (const slice of sliceSizes) {
            Simulation.stepSimulation(simulation, WORLD, slice)
        }
        return simulation.characters[0].worldX - 100
    }

    const inOnePiece = run([0.2])
    const inSmallPieces = run(Array.from({ length: 20 }, () => 0.01))
    const inUnevenPieces = run([0.004, 0.05, 0.017, 0.129])
    const oneStepOfMovement = 60 * Simulation.tuning.stepSeconds

    assert.ok(Math.abs(inOnePiece - inSmallPieces) <= oneStepOfMovement + 1e-9)
    assert.ok(Math.abs(inOnePiece - inUnevenPieces) <= oneStepOfMovement + 1e-9)
    // Sanity: 0.2 s at 60 px/s is about 12 px, not zero and not a whole run.
    assert.ok(inOnePiece > 10 && inOnePiece < 13)
})

test("a stalled host is clamped instead of catching up", () => {
    const simulation = Simulation.createSimulation(1)
    simulation.characters = [makeCharacter({ speed: 60 })]

    Simulation.stepSimulation(simulation, WORLD, 10)

    const maxDistance = 60 * Simulation.tuning.maxAccumulatedSeconds
    assert.ok(simulation.characters[0].worldX - 100 <= maxDistance + 1e-9)
})

test("the driver initialises characters that are not ready yet", () => {
    const simulation = Simulation.createSimulation(5)
    simulation.characters = [makeCharacter({ initialized: false })]

    Simulation.stepSimulation(simulation, WORLD, STEP)

    assert.equal(simulation.characters[0].initialized, true)
})

test("the driver leaves characters alone while the world is too small", () => {
    const simulation = Simulation.createSimulation(5)
    simulation.characters = [makeCharacter({ initialized: false })]

    Simulation.stepSimulation(simulation, Simulation.createWorld([rect(0, 0, 10, 10)]), STEP)

    assert.equal(simulation.characters[0].initialized, false)
})

test("characters stay inside the world over a long run", () => {
    const simulation = Simulation.createSimulation(31337)
    simulation.characters = Array.from({ length: 24 }, () =>
        makeCharacter({ initialized: false })
    )

    for (let i = 0; i < 600; ++i) {
        Simulation.stepSimulation(simulation, WORLD, 0.016)
    }

    for (const character of simulation.characters) {
        assert.ok(character.worldX >= 0 && character.worldX <= WORLD.bounds.width)
        assert.ok(character.worldY >= 0 && character.worldY <= WORLD.bounds.height)
        assert.ok(Number.isFinite(character.worldX))
        assert.ok(Number.isFinite(character.worldY))
    }
})

// --- Multi-screen worlds -------------------------------------------------

// The development machine: a 1920x1200 beside two 1920x1080, all top-aligned.
// The bottom 120 px under the two shorter screens belong to no monitor, and a
// character that wandered in there would be invisible.
const THREE_SCREENS = Simulation.createWorld([
    rect(0, 0, 1920, 1200),
    rect(1920, 0, 1920, 1080),
    rect(3840, 0, 1920, 1080)
])

const MARGINS = { x: 10, top: 26, bottom: 4 }

test("a world spanning several screens reports its bounding box", () => {
    assert.equal(THREE_SCREENS.rects.length, 3)
    assert.deepEqual(THREE_SCREENS.bounds, { x: 0, y: 0, width: 5760, height: 1200 })
})

test("degenerate rectangles are dropped", () => {
    const world = Simulation.createWorld([
        rect(0, 0, 100, 100),
        rect(0, 0, 0, 100),
        rect(0, 0, 100, -5),
        null
    ])

    assert.equal(world.rects.length, 1)
})

test("the dead zone between mismatched screens is outside the world", () => {
    // Same height, under the tall screen: real screen area.
    assert.equal(Simulation.worldContains(THREE_SCREENS, 1000, 1150), true)
    // Under the short ones: nothing there, though the bounding box covers it.
    assert.equal(Simulation.worldContains(THREE_SCREENS, 3000, 1150), false)
    assert.equal(Simulation.worldContains(THREE_SCREENS, 5000, 1150), false)
})

test("the seam between two screens is not a wall", () => {
    for (const x of [1910, 1915, 1920, 1925, 1930, 3835, 3845]) {
        assert.equal(
            Simulation.worldAllows(THREE_SCREENS, x, 500, MARGINS),
            true,
            `x=${x} should be walkable`
        )
    }
})

test("the outer boundary still keeps sprites inside", () => {
    assert.equal(Simulation.worldAllows(THREE_SCREENS, 5, 500, MARGINS), false)
    assert.equal(Simulation.worldAllows(THREE_SCREENS, 5755, 500, MARGINS), false)
    assert.equal(Simulation.worldAllows(THREE_SCREENS, 500, 10, MARGINS), false)
})

test("the lip above the dead zone counts as an outer edge", () => {
    // Deep inside the tall screen, below the short ones: fine.
    assert.equal(Simulation.worldAllows(THREE_SCREENS, 1000, 1150, MARGINS), true)
    // Close enough to the seam that the sprite would hang over the void.
    assert.equal(Simulation.worldAllows(THREE_SCREENS, 1915, 1150, MARGINS), false)
})

test("a character walks from one screen to the next", () => {
    const random = Simulation.createRandom(1)
    const character = makeCharacter({ worldX: 1850, worldY: 500, speed: 300 })

    for (let i = 0; i < 120; ++i) {
        Simulation.stepCharacter(character, THREE_SCREENS, STEP, random)
    }

    assert.ok(character.worldX > 1930, `stopped at x=${character.worldX}`)
    assert.equal(character.directionId, "east")
})

test("a character standing outside the world is pulled back in", () => {
    const random = Simulation.createRandom(1)
    // Dropped straight into the dead zone.
    const character = makeCharacter({ worldX: 3000, worldY: 1150 })

    Simulation.stepCharacter(character, THREE_SCREENS, STEP, random)

    assert.ok(
        Simulation.worldContains(THREE_SCREENS, character.worldX, character.worldY),
        `still outside at (${character.worldX}, ${character.worldY})`
    )
})

function runMultiScreen(seed, steps, characterCount = 40) {
    const simulation = Simulation.createSimulation(seed)
    simulation.characters = Array.from({ length: characterCount }, () =>
        makeCharacter({ initialized: false, wanderRemainingMs: 0, spriteScale: 2 })
    )
    const start = []
    for (let i = 0; i < steps; ++i) {
        Simulation.stepSimulation(simulation, THREE_SCREENS, 0.016)
        if (i === 0) {
            for (const c of simulation.characters) {
                start.push([c.worldX, c.worldY])
            }
        }
    }
    return { simulation, start }
}

test("no character ever ends up in the dead zone", () => {
    const { simulation } = runMultiScreen(7777, 1500)

    for (const character of simulation.characters) {
        assert.ok(
            Simulation.worldContains(
                THREE_SCREENS, character.worldX, character.worldY
            ),
            `outside the world at (${character.worldX}, ${character.worldY})`
        )
    }
})

test("characters keep moving instead of sticking to a boundary", () => {
    const { simulation, start } = runMultiScreen(31337, 1500)

    simulation.characters.forEach((character, index) => {
        const travelled = Math.hypot(
            character.worldX - start[index][0],
            character.worldY - start[index][1]
        )
        assert.ok(travelled > 1, `character ${index} barely moved (${travelled})`)
    })
})

test("spawning spreads characters over every screen", () => {
    const random = Simulation.createRandom(4242)
    const hit = new Set()

    for (let attempt = 0; attempt < 300; ++attempt) {
        const character = makeCharacter({ initialized: false })
        Simulation.initializeCharacter(character, THREE_SCREENS, random)
        THREE_SCREENS.rects.forEach((r, index) => {
            if (character.worldX >= r.x && character.worldX <= r.x + r.width
                    && character.worldY >= r.y && character.worldY <= r.y + r.height) {
                hit.add(index)
            }
        })
    }

    assert.deepEqual([...hit].sort(), [0, 1, 2])
})

test("a single-screen world is just the one-rectangle case", () => {
    const single = Simulation.createWorld([rect(0, 0, 800, 600)])

    assert.equal(single.rects.length, 1)
    assert.deepEqual(single.bounds, { x: 0, y: 0, width: 800, height: 600 })
    assert.equal(Simulation.worldAllows(single, 400, 300, MARGINS), true)
    assert.equal(Simulation.worldAllows(single, 797, 300, MARGINS), false)
})

// --- Golden traces ------------------------------------------------------

for (const scenario of SCENARIOS) {
    test(`golden trace: ${scenario.id}`, async () => {
        const expected = JSON.parse(readFileSync(
            new URL(`golden/${scenario.filename}`, import.meta.url),
            "utf8"
        ))
        const actual = await generateScenario(scenario)

        assert.deepEqual(actual, expected)
    })
}
