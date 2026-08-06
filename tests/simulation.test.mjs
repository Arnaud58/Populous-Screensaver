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
    "spawnTribes",
    "unalignedTribe",
    "effectKinds",
    "entityTypes",
    "actions",
    "behaviours",
    "tuning",
    "createRandom",
    "createCharacter",
    "createEffect",
    "lightningPaths",
    "createSimulation",
    "populate",
    "createWorld",
    "originalFormationSlot",
    "worldContains",
    "worldAllows",
    "clampIntoWorld",
    "stepSimulation",
    "animationId",
    "stateAnimationId",
    "setAction",
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

test("combat tuning matches the recovered 30 ms original counters", () => {
    assert.equal(Simulation.tuning.combatAcquireDistance, 250)
    assert.equal(Simulation.tuning.combatAttackDistance, 14)
    assert.equal(Simulation.tuning.combatPursuitSpeed, 200 / 3)
    assert.equal(Simulation.tuning.combatAttackDurationMs, 120)
    assert.equal(Simulation.tuning.combatImpactMs, 0)
    assert.equal(Simulation.tuning.combatHitDurationMs, 90)
    assert.equal(Simulation.tuning.combatHitRecoilSpeed, 1000 / 3)
    assert.equal(Simulation.tuning.characterHealth, 6)
    assert.equal(Simulation.tuning.soulPoseDurationMs, 90)
    assert.equal(Simulation.tuning.soulLifetimeMs, 6000)
})

test("spell tuning matches the recovered original counters and constants", () => {
    assert.equal(Simulation.tuning.shamanCastDistance, 100)
    assert.equal(Simulation.tuning.shamanCastDurationMs, 600)
    assert.equal(Simulation.tuning.shamanCastCooldownMs, 900)
    assert.equal(Simulation.tuning.conversionSpeed, 1000 / 3)
    assert.equal(Simulation.tuning.conversionRadius, 80)
    assert.equal(Simulation.tuning.conversionTravelMs, 360)
    assert.equal(Simulation.tuning.conversionLifetimeMs, 570)
    assert.equal(Simulation.tuning.firewarriorConversionChance, 2767 / 32768)
    assert.equal(Simulation.tuning.fireCastDistance, 500)
    assert.equal(Simulation.tuning.fireSpeed, 1000 / 3)
    assert.equal(Simulation.tuning.fireImpactRadius, 15)
    assert.equal(Simulation.tuning.fireImpactDamage, 2)
    assert.equal(Simulation.tuning.fireLifetimeMs, 930)
    assert.equal(Simulation.tuning.shamanBattleCooldownMinMs, 1200)
    assert.equal(Simulation.tuning.shamanBattleCooldownMaxMs, 2070)
})

test("every combat and soul state resolves to a catalogued animation", () => {
    for (const tribe of Simulation.tribes) {
        for (const direction of Simulation.directions) {
            for (const action of [Simulation.actions.kick, Simulation.actions.hit]) {
                const character = makeCharacter({
                    tribe,
                    action,
                    directionId: direction.id
                })
                Simulation.setAction(character, Simulation.actions.walk)
                Simulation.setDirection(character, direction.dx, direction.dy)
                Simulation.setAction(character, action)
                assert.ok(character.frames && character.frames.length > 0)
            }
        }
        const character = makeCharacter({ tribe })
        const soul = {
            entity: Simulation.entityTypes.soul,
            tribe,
            action: Simulation.actions.rise,
            directionId: "south"
        }
        assert.ok(manifest.animations[Simulation.stateAnimationId(soul)])
        soul.action = Simulation.actions.depart
        assert.ok(manifest.animations[Simulation.stateAnimationId(soul)])
        assert.equal(character.entity, Simulation.entityTypes.brave)
    }
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

test("a 2x2 footprint is dropped every other original tick while moving", () => {
    const character = makeCharacter({ speed: 120, spriteScale: 1 })
    const random = Simulation.createRandom(1)

    let footprint = null
    for (let i = 0; i < 3; ++i) {
        footprint = Simulation.stepCharacter(character, WORLD, STEP, random).footprint
        assert.equal(footprint, null)
    }
    footprint = Simulation.stepCharacter(character, WORLD, STEP, random).footprint

    assert.notEqual(footprint, null)
    assert.equal(footprint.tribe, "blue")
    assert.equal(footprint.directionX, 1)
    assert.equal(footprint.spriteScale, 1)
    assert.equal(footprint.size, 2)
    assert.equal(footprint.groundY, 100)
    assert.equal(footprint.groundX, 113)
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
        assert.ok(Simulation.spawnTribes.includes(character.tribe))
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
        footprints.push(...Simulation.stepSimulation(simulation, WORLD, slice)
            .filter(event => event.type === "footprint"))
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
    // Combat off: this is about the driver's time slicing, and an aligned
    // character would otherwise march to its tribe's corner rather than along
    // the heading the fixture set.
    function run(sliceSizes) {
        const simulation = Simulation.createSimulation(
            4242, manifest.animations, { combatEnabled: false }
        )
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

test("combat follows pursue, kick, hit, soul and removal states", () => {
    const simulation = Simulation.createSimulation(
        1998,
        manifest.animations,
        { combatEnabled: true }
    )
    const attacker = makeCharacter({
        id: 1,
        tribe: "blue",
        worldX: 100,
        worldY: 100
    })
    const victim = makeCharacter({
        id: 2,
        tribe: "red",
        worldX: 110,
        worldY: 100,
        health: 1
    })
    simulation.characters = [attacker, victim]
    simulation.nextEntityId = 3

    const events = Simulation.stepSimulation(simulation, WORLD, STEP)
    assert.ok(events.some(event => event.type === "hit"
        && event.entityId === victim.id && event.health === 0))
    assert.ok(victim.worldX < 110)

    for (let step = 0; step < 80 && simulation.entities.length === 0; ++step) {
        events.push(...Simulation.stepSimulation(simulation, WORLD, STEP))
    }

    assert.equal(simulation.characters.length, 1)
    assert.equal(simulation.characters[0].id, attacker.id)
    assert.equal(simulation.entities.length, 1)
    assert.equal(simulation.entities[0].entity, Simulation.entityTypes.soul)
    assert.equal(
        Simulation.stateAnimationId(simulation.entities[0]),
        "soul.red.rise.east"
    )
    assert.ok(events.some(event => event.type === "attack-started"
        && event.entityId === attacker.id && event.targetId === victim.id))
    assert.ok(events.some(event => event.type === "soul-spawned"
        && event.characterId === victim.id))
    assert.ok(events.some(event => event.type === "character-removed"
        && event.entityId === victim.id))

    for (let step = 0; step < 200; ++step) {
        events.push(...Simulation.stepSimulation(simulation, WORLD, STEP))
    }
    assert.equal(simulation.entities.length, 0)
    assert.ok(events.some(event => event.type === "entity-removed"))
})

test("a death deterministically replenishes the configured population", () => {
    const simulation = Simulation.createSimulation(
        1998,
        manifest.animations,
        { combatEnabled: true }
    )
    Simulation.populate(simulation, 2, 1)
    simulation.characters = [
        makeCharacter({ id: 1, tribe: "blue", worldX: 100, worldY: 100 }),
        makeCharacter({
            id: 2,
            tribe: "red",
            worldX: 110,
            worldY: 100,
            health: 1
        })
    ]
    simulation.nextEntityId = 3

    const events = []
    for (let step = 0; step < 30
            && !events.some(event => event.type === "character-spawned"); ++step) {
        events.push(...Simulation.stepSimulation(simulation, WORLD, STEP))
    }

    assert.equal(simulation.characters.length, 2)
    const replacement = simulation.characters.find(character => character.id === 4)
    assert.ok(replacement)
    assert.equal(replacement.initialized, true)
    assert.equal(replacement.enteringWorld, true)
    assert.equal(replacement.tribe, Simulation.unalignedTribe)
    assert.ok(events.some(event => event.type === "character-spawned"
        && event.entityId === replacement.id))

    assert.equal(Simulation.worldContains(
        WORLD, replacement.worldX, replacement.worldY
    ), false)
})

test("combat can be disabled for focused walking scenarios", () => {
    const simulation = Simulation.createSimulation(
        1998,
        manifest.animations,
        { combatEnabled: false }
    )
    simulation.characters = [
        makeCharacter({ id: 1, tribe: "blue", worldX: 100 }),
        makeCharacter({ id: 2, tribe: "red", worldX: 105 })
    ]

    const events = Simulation.stepSimulation(simulation, WORLD, STEP)

    assert.equal(simulation.characters[0].behaviour, Simulation.behaviours.wander)
    assert.equal(events.some(event => event.type === "attack-started"), false)
})

// --- Conversion and spells -----------------------------------------------

// A simulation with an explicit cast of characters, bypassing populate so a
// scenario contains only what it is about.
function combatSimulation(states, seed = 1998) {
    const simulation = Simulation.createSimulation(
        seed,
        manifest.animations,
        { combatEnabled: true }
    )
    simulation.characters = states
    simulation.nextEntityId = states.length + 1
    return simulation
}

function runSteps(simulation, steps, until) {
    const events = []
    for (let step = 0; step < steps; ++step) {
        events.push(...Simulation.stepSimulation(simulation, WORLD, STEP))
        if (until && until(events)) {
            break
        }
    }
    return events
}

test("every conversion and spell state resolves to a catalogued animation", () => {
    const cases = [
        [Simulation.entityTypes.shaman, Simulation.tribes, ["idle", "walk", "cast"]],
        [Simulation.entityTypes.firewarrior, Simulation.tribes,
            ["walk", "stand", "punch", "hit"]],
        [Simulation.entityTypes.brave, [Simulation.unalignedTribe], ["walk"]]
    ]

    for (const [entity, entityTribes, entityActions] of cases) {
        for (const tribe of entityTribes) {
            for (const direction of Simulation.directions) {
                for (const action of entityActions) {
                    const state = makeCharacter({ tribe })
                    state.entity = entity
                    Simulation.setDirection(state, direction.dx, direction.dy)
                    Simulation.setAction(state, action)
                    assert.ok(
                        state.frames && state.frames.length > 0,
                        `${entity}/${tribe}/${action}/${direction.id} has no frames`
                    )
                }
            }
        }
    }
})

// The neutral brave carries no hit stream, so a firewarrior wearing brave
// colours is the only thing keeping that class renderable when it is struck.
test("a firewarrior falls back to the brave hit cells", () => {
    const state = makeCharacter({ tribe: "blue" })
    state.entity = Simulation.entityTypes.firewarrior
    Simulation.setAction(state, Simulation.actions.hit)

    assert.equal(Simulation.stateAnimationId(state), "brave.blue.hit.east")
    assert.ok(state.frames.length > 0)
})

test("every effect kind resolves to a catalogued animation", () => {
    const simulation = combatSimulation([])
    for (const kind of Object.values(Simulation.effectKinds)) {
        // Lightning is the exception, and deliberately so: the original draws
        // it with line primitives and the atlas holds no cells for it.
        if (kind === Simulation.effectKinds.lightning) {
            continue
        }
        const effect = Simulation.createEffect(simulation, {
            kind,
            worldX: 10,
            worldY: 10,
            spriteScale: 1,
            tribe: "blue"
        })
        assert.ok(effect.frames && effect.frames.length > 0, `${kind} has no frames`)
        assert.ok(effect.lifetimeRemainingMs > 0, `${kind} expires immediately`)
    }
})

test("lightning carries a path instead of an animation", () => {
    const simulation = combatSimulation([])
    const bolt = Simulation.createEffect(simulation, {
        kind: Simulation.effectKinds.lightning,
        worldX: 100,
        worldY: 100,
        spriteScale: 1,
        lifetimeMs: Simulation.tuning.lightningDurationMs
    })
    assert.equal(bolt.animationKey, null)
    assert.equal(bolt.frameCount, 0)
    assert.ok(bolt.lifetimeRemainingMs > 0, "the bolt expires immediately")
})

// An unaligned character has no kick, no hit and no soul in the atlas. It is
// therefore neither an attacker nor a target, and asserting that here is what
// stops a future rule from quietly asking it for frames it does not have.
test("an unaligned character neither attacks nor is attacked", () => {
    const neutral = makeCharacter({
        id: 1,
        tribe: Simulation.unalignedTribe,
        worldX: 100,
        speed: 0
    })
    const aligned = makeCharacter({ id: 2, tribe: "red", worldX: 105, speed: 0 })
    const simulation = combatSimulation([neutral, aligned])

    const events = runSteps(simulation, 60)

    assert.equal(events.some(event => event.type === "attack-started"), false)
    assert.equal(events.some(event => event.type === "hit"), false)
    assert.equal(neutral.behaviour, Simulation.behaviours.wander)
    assert.equal(neutral.health, Simulation.tuning.characterHealth)
    assert.equal(aligned.health, Simulation.tuning.characterHealth)
})

test("a shaman is never a combat target", () => {
    const shaman = makeCharacter({ id: 1, tribe: "blue", worldX: 100, speed: 0 })
    shaman.entity = Simulation.entityTypes.shaman
    const enemy = makeCharacter({ id: 2, tribe: "red", worldX: 105, speed: 0 })
    const simulation = combatSimulation([shaman, enemy])

    const events = runSteps(simulation, 60)

    assert.equal(events.some(event => event.type === "attack-started"), false)
    assert.notEqual(enemy.behaviour, Simulation.behaviours.pursue)
    assert.notEqual(enemy.behaviour, Simulation.behaviours.attack)
    assert.equal(shaman.health, Simulation.tuning.characterHealth)
})

test("a shaman casts directly and converts an unaligned brave", () => {
    const shaman = makeCharacter({ id: 1, tribe: "blue", worldX: 100, speed: 0 })
    shaman.entity = Simulation.entityTypes.shaman
    const target = makeCharacter({
        id: 2,
        tribe: Simulation.unalignedTribe,
        worldX: 150,
        speed: 0
    })
    const simulation = combatSimulation([shaman, target])

    const events = runSteps(simulation, 400,
        list => list.some(event => event.type === "converted"))

    const order = events
        .filter(event => event.type === "behaviour-changed"
            && event.entityId === shaman.id)
        .map(event => event.to)
    assert.deepEqual(order.slice(0, 3), [
        Simulation.behaviours.seek,
        Simulation.behaviours.cast,
        Simulation.behaviours.seek
    ])

    const cast = events.find(event => event.type === "cast-started")
    assert.equal(cast.spell, "conversion")
    assert.equal(cast.sound, "convert_spell")

    const converted = events.find(event => event.type === "converted")
    assert.equal(converted.entityId, target.id)
    assert.equal(target.tribe, "blue")
    assert.ok(target.frames && target.frames.length > 0)
    assert.ok([Simulation.entityTypes.brave, Simulation.entityTypes.firewarrior]
        .includes(target.entity))
    // The conversion projectile is gone and its flash and burst took its place.
    assert.ok(events.some(event => event.type === "effect-spawned"
        && event.kind === Simulation.effectKinds.conversion))
    assert.ok(events.some(event => event.type === "effect-spawned"
        && event.kind === Simulation.effectKinds.flash))
})

test("a shaman acquires the nearest neutral anywhere in the world", () => {
    const shaman = makeCharacter({
        id: 1,
        tribe: "blue",
        worldX: 100,
        worldY: 100,
        speed: 0
    })
    shaman.entity = Simulation.entityTypes.shaman
    const target = makeCharacter({
        id: 2,
        tribe: Simulation.unalignedTribe,
        worldX: 900,
        worldY: 900,
        speed: 0
    })
    const simulation = combatSimulation([shaman, target])

    Simulation.stepSimulation(simulation, WORLD, STEP)

    assert.equal(shaman.behaviour, Simulation.behaviours.seek)
    assert.equal(shaman.targetId, target.id)
})

// Conversion is the only way a firewarrior enters the world, so if the split
// ever collapses to one class the world quietly loses the ranged one.
test("conversion produces both braves and firewarriors", () => {
    const produced = new Set()

    for (let seed = 1; seed <= 40 && produced.size < 2; ++seed) {
        const shaman = makeCharacter({ id: 1, tribe: "green", worldX: 100, speed: 0 })
        shaman.entity = Simulation.entityTypes.shaman
        const target = makeCharacter({
            id: 2,
            tribe: Simulation.unalignedTribe,
            worldX: 140,
            speed: 0
        })
        const simulation = combatSimulation([shaman, target], seed)

        runSteps(simulation, 400,
            list => list.some(event => event.type === "converted"))
        assert.equal(target.tribe, "green")
        produced.add(target.entity)
    }

    assert.deepEqual([...produced].sort(), ["brave", "firewarrior"])
})

test("a firewarrior throws fire instead of closing to melee", () => {
    const firewarrior = makeCharacter({
        id: 1,
        tribe: "blue",
        worldX: 100,
        speed: 0
    })
    firewarrior.entity = Simulation.entityTypes.firewarrior
    const victim = makeCharacter({ id: 2, tribe: "red", worldX: 200, speed: 0 })
    const simulation = combatSimulation([firewarrior, victim])

    const events = runSteps(simulation, 300,
        list => list.some(event => event.type === "hit"))

    const cast = events.find(event => event.type === "cast-started")
    assert.equal(cast.spell, "fire")
    assert.equal(cast.sound, "firecast")
    assert.equal(events.some(event => event.type === "attack-started"), false)

    // It struck without ever entering melee reach, which is 14 px.
    assert.ok(
        victim.worldX - firewarrior.worldX > Simulation.tuning.combatAttackDistance,
        "the firewarrior closed to melee instead of throwing fire"
    )
    assert.equal(
        victim.health,
        Simulation.tuning.characterHealth - Simulation.tuning.fireImpactDamage
    )
    assert.ok(events.some(event => event.type === "effect-spawned"
        && event.kind === Simulation.effectKinds.fire))
    assert.ok(events.some(event => event.type === "effect-spawned"
        && event.kind === Simulation.effectKinds.fireTrail))
    assert.ok(events.some(event => event.type === "effect-spawned"
        && event.kind === Simulation.effectKinds.ring))
})

test("a world allocates four shamans and its whole ordinary population", () => {
    const simulation = Simulation.createSimulation(1998, manifest.animations)
    Simulation.populate(simulation, 10, 1)

    assert.equal(simulation.characters.length, Simulation.tribes.length + 10)
    assert.deepEqual(
        simulation.characters.slice(0, Simulation.tribes.length).map(state => state.entity),
        Simulation.tribes.map(() => Simulation.entityTypes.shaman)
    )
    assert.deepEqual(
        simulation.characters.slice(0, Simulation.tribes.length).map(state => state.tribe),
        Simulation.tribes
    )
    assert.ok(simulation.characters.slice(Simulation.tribes.length)
        .every(state => state.enteringWorld))

    // Their tribe survives initialisation; the drawn one is discarded.
    Simulation.stepSimulation(simulation, WORLD, 0)
    assert.deepEqual(
        simulation.characters.slice(0, Simulation.tribes.length).map(state => state.tribe),
        Simulation.tribes
    )
})

test("ordinary characters initialize outside the screen and walk in", () => {
    const simulation = Simulation.createSimulation(1998, manifest.animations)
    Simulation.populate(simulation, 6, 1)
    Simulation.stepSimulation(simulation, WORLD, 0)

    const ordinary = simulation.characters
        .filter(state => state.entity !== Simulation.entityTypes.shaman)
    assert.equal(ordinary.length, 6)
    assert.ok(ordinary.every(state => state.initialized && state.enteringWorld))
    assert.ok(ordinary.every(state => !Simulation.worldContains(
        WORLD, state.worldX, state.worldY
    )))

    for (let step = 0; step < 4000
            && ordinary.some(state => state.enteringWorld); ++step) {
        Simulation.stepSimulation(simulation, WORLD, STEP)
    }
    assert.ok(ordinary.every(state => !state.enteringWorld))
    assert.ok(ordinary.every(state => Simulation.worldContains(
        WORLD, state.worldX, state.worldY
    )))
})

test("a conversion draws its ring at the radius the rule uses", () => {
    const shaman = makeCharacter({ id: 1, tribe: "blue", worldX: 400, worldY: 400,
        speed: 0 })
    shaman.entity = Simulation.entityTypes.shaman
    const target = makeCharacter({
        id: 2,
        tribe: Simulation.unalignedTribe,
        worldX: 460,
        worldY: 400,
        speed: 0
    })
    const simulation = combatSimulation([shaman, target])

    runSteps(simulation, 400,
        list => list.some(event => event.type === "converted"))

    const ring = simulation.entities
        .filter(entity => entity.kind === Simulation.effectKinds.conversionRing)
    assert.equal(ring.length, Simulation.tuning.conversionRingSparks)

    const centreX = ring.reduce((sum, spark) => sum + spark.worldX, 0) / ring.length
    const centreY = ring.reduce((sum, spark) => sum + spark.worldY, 0) / ring.length
    const radii = ring.map(spark => Math.hypot(
        spark.worldX - centreX,
        (spark.worldY - centreY) / 0.6
    ))
    for (const radius of radii) {
        assert.ok(
            Math.abs(radius - Simulation.tuning.conversionRadius) < 40,
            `a ring sparkle sits at ${radius.toFixed(1)} px, not on the ring`
        )
    }

    // Staggered start frames are what makes the ring look like it travels.
    assert.ok(new Set(ring.map(spark => spark.frameIndex)).size > 1)
})

// Nobody is born into a tribe. Every coloured character in the world got there
// by being converted, which is what makes the shamans the engine of the whole
// simulation rather than decoration.
test("ordinary characters are always born unaligned", () => {
    const random = Simulation.createRandom(2024)

    for (let attempt = 0; attempt < 200; ++attempt) {
        const character = makeCharacter({ initialized: false })
        Simulation.initializeCharacter(character, WORLD, random)
        assert.equal(character.tribe, Simulation.unalignedTribe)
    }
})

test("each shaman starts exactly 50 pixels from its original corner", () => {
    const world = Simulation.createWorld([rect(0, 0, 1920, 1152)])
    const simulation = Simulation.createSimulation(1998, manifest.animations)
    Simulation.populate(simulation, 20, 1)
    Simulation.stepSimulation(simulation, world, 0)

    const corners = {
        blue: [50, 50],
        red: [1870, 50],
        yellow: [1870, 1102],
        green: [50, 1102]
    }
    for (const shaman of simulation.characters.filter(
        state => state.entity === Simulation.entityTypes.shaman
    )) {
        const [cornerX, cornerY] = corners[shaman.tribe]
        assert.deepEqual(
            [shaman.worldX, shaman.worldY],
            [cornerX, cornerY],
            `unexpected ${shaman.tribe} shaman position`
        )
    }
})

test("ordinary play has no invented global muster or raid timer", () => {
    const world = Simulation.createWorld([rect(0, 0, 1920, 1152)])
    const party = []
    for (let index = 0; index < 7; ++index) {
        party.push(makeCharacter({
            id: index + 1,
            tribe: "blue",
            worldX: 900 + index * 6,
            worldY: 600
        }))
    }
    const simulation = combatSimulation(party)

    const events = []
    for (let step = 0; step < 60 * 20; ++step) {
        events.push(...Simulation.stepSimulation(simulation, world, STEP))
    }
    assert.equal(events.some(event => event.type === "raid-started"), false)
    assert.equal(events.some(event => event.type === "raid-ended"), false)
})

// --- Armageddon ----------------------------------------------------------

const BIG_WORLD = Simulation.createWorld([rect(0, 0, 1920, 1152)])

// Runs headlessly and records the phase timeline.
//
// The interval is the shortest the configuration pages allow. A quicker one
// would make the fixtures shorter but the simulation clamps it, and a fixture
// that quietly gets a different value than it asked for is worse than a slow
// one.
const ARMAGEDDON_AT = Simulation.tuning.armageddonIntervalMinMs / 1000
const GATHER_LENGTH = Simulation.tuning.armageddonGatherTicks
    * Simulation.tuning.originalTickMs / 1000

function runCycle(seconds, options = {}) {
    const simulation = Simulation.createSimulation(1998, manifest.animations, {
        combatEnabled: true,
        armageddonIntervalMs: Simulation.tuning.armageddonIntervalMinMs,
        ...options
    })
    Simulation.populate(simulation, 40, 1)

    const timeline = []
    const events = []
    const steps = Math.round(seconds / STEP)
    for (let step = 0; step < steps; ++step) {
        const emitted = Simulation.stepSimulation(simulation, BIG_WORLD, STEP)
        events.push(...emitted)
        for (const event of emitted) {
            if (event.type === "armageddon-started") {
                timeline.push("gather")
            } else if (event.type === "armageddon-phase") {
                timeline.push(event.phase)
            } else if (event.type === "armageddon-ended") {
                timeline.push("normal")
            }
        }
    }
    return { simulation, events, timeline }
}

test("the Armageddon interval is clamped to the range the pages offer", () => {
    const low = Simulation.createSimulation(1, manifest.animations,
        { armageddonIntervalMs: 1000 })
    const high = Simulation.createSimulation(1, manifest.animations,
        { armageddonIntervalMs: 9999999 })
    const missing = Simulation.createSimulation(1, manifest.animations)

    assert.equal(low.armageddon.intervalMs, Simulation.tuning.armageddonIntervalMinMs)
    assert.equal(high.armageddon.intervalMs, Simulation.tuning.armageddonIntervalMaxMs)
    assert.equal(missing.armageddon.intervalMs, Simulation.tuning.armageddonIntervalMs)
    assert.equal(Simulation.tuning.armageddonIntervalMs, 120000)
})

test("Armageddon goes directly from its 201-tick gather to battle", () => {
    const { timeline } = runCycle(ARMAGEDDON_AT + GATHER_LENGTH + 0.1)

    assert.deepEqual(timeline.slice(0, 2), ["gather", "battle"])
    assert.equal(timeline.includes("converge"), false)
    assert.equal(timeline.includes("resolve"), false)
})

test("formation slots reproduce the original rotated 8-column table", () => {
    const first = Simulation.originalFormationSlot(BIG_WORLD, "blue", 0)
    const second = Simulation.originalFormationSlot(BIG_WORLD, "blue", 1)
    const ninth = Simulation.originalFormationSlot(BIG_WORLD, "blue", 8)

    assert.ok(Math.abs((second.x - first.x) - 20 * Math.cos(-0.75)) < 1e-9)
    assert.ok(Math.abs((second.y - first.y) - 20 * Math.sin(-0.75)) < 1e-9)
    assert.ok(Math.abs((ninth.x - first.x) + 20 * Math.sin(-0.75)) < 1e-9)
    assert.ok(Math.abs((ninth.y - first.y) - 20 * Math.cos(-0.75)) < 1e-9)
})

test("Armageddon conscripts every unaligned character", () => {
    const { simulation, events } = runCycle(ARMAGEDDON_AT + 1)

    const started = events.find(event => event.type === "armageddon-started")
    assert.notEqual(started, undefined)
    assert.ok(started.conscripted > 0, "nobody was conscripted")
    assert.equal(simulation.armageddon.mode, "gather")

    for (const character of simulation.characters) {
        assert.notEqual(character.tribe, Simulation.unalignedTribe,
            `an unaligned ${character.entity} survived the draft`)
    }
})

test("the draft is random and deterministic rather than artificially balanced", () => {
    const simulation = Simulation.createSimulation(1998, manifest.animations, {
        combatEnabled: true,
        armageddonIntervalMs: Simulation.tuning.armageddonIntervalMinMs
    })
    Simulation.populate(simulation, 40, 1)
    Simulation.stepSimulation(simulation, BIG_WORLD, 0)
    simulation.characters = simulation.characters.filter(
        state => state.entity !== Simulation.entityTypes.shaman
    )
    for (let step = 0; step < Math.round((ARMAGEDDON_AT + 1) / STEP); ++step) {
        Simulation.stepSimulation(simulation, BIG_WORLD, STEP)
    }

    const assigned = simulation.characters.map(state => state.tribe)

    const replay = Simulation.createSimulation(1998, manifest.animations, {
        combatEnabled: true,
        armageddonIntervalMs: Simulation.tuning.armageddonIntervalMinMs
    })
    Simulation.populate(replay, 40, 1)
    Simulation.stepSimulation(replay, BIG_WORLD, 0)
    replay.characters = replay.characters.filter(
        state => state.entity !== Simulation.entityTypes.shaman
    )
    for (let step = 0; step < Math.round((ARMAGEDDON_AT + 1) / STEP); ++step) {
        Simulation.stepSimulation(replay, BIG_WORLD, STEP)
    }
    assert.deepEqual(replay.characters.map(state => state.tribe), assigned)
})

// Gathering is a truce. Without it the field empties before the battle starts,
// while the capture's formations assemble intact.
test("nobody fights while the formations are gathering", () => {
    const gatherEnds = ARMAGEDDON_AT + GATHER_LENGTH
    const { events } = runCycle(gatherEnds - 0.5)

    const started = events.findIndex(event => event.type === "armageddon-started")
    assert.notEqual(started, -1)
    const duringGather = events.slice(started)
    assert.equal(
        duringGather.some(event => event.type === "attack-started"), false,
        "a fight broke out during the gathering"
    )
})

test("battle ends conditionally and preserves its survivors", () => {
    const { simulation } = runCycle(ARMAGEDDON_AT + GATHER_LENGTH + 0.1)
    const survivors = simulation.characters.filter(
        state => state.entity !== Simulation.entityTypes.shaman
    )
    for (const character of survivors) {
        character.tribe = "blue"
    }
    const ending = []
    for (let step = 0; step < 10; ++step) {
        ending.push(...Simulation.stepSimulation(simulation, BIG_WORLD, STEP))
    }

    assert.ok(ending.some(event => event.type === "armageddon-phase"
        && event.phase === "restore"))
    assert.ok(ending.some(event => event.type === "armageddon-ended"))
    assert.equal(simulation.characters.filter(
        state => state.entity !== Simulation.entityTypes.shaman
    ).length, survivors.length)
})

// The shamans hold their corners and throw at each other over the melee, which
// is the only place lightning is ever used.
test("shamans throw fire and lightning during the battle", () => {
    const { events } = runCycle(ARMAGEDDON_AT + GATHER_LENGTH + 8)

    const shamanSpells = events.filter(event => event.type === "cast-started"
        && (event.spell === "lightning" || event.spell === "fire"))
    assert.ok(shamanSpells.length > 0, "no battle spell was ever cast")
    assert.ok(
        events.some(event => event.type === "cast-started"
            && event.spell === "lightning"),
        "lightning was never cast"
    )
    assert.ok(
        events.some(event => event.type === "effect-spawned"
            && event.kind === Simulation.effectKinds.lightning),
        "no lightning bolt reached the world"
    )
})

test("a lightning bolt spans its two ends inside a narrow envelope", () => {
    const simulation = combatSimulation([])
    const paths = Simulation.lightningPaths(simulation, 100, 100, 100, 900)

    assert.ok(paths.length >= Simulation.tuning.lightningPathsMin)
    assert.ok(paths.length <= Simulation.tuning.lightningPathsMax)

    for (const points of paths) {
        assert.equal(points.length, Simulation.tuning.lightningPoints)
        // Both ends are pinned: a bolt that missed its target at either end
        // would read as a stray scratch rather than a strike.
        assert.equal(Math.round(points[0].x), 100)
        assert.equal(Math.round(points[0].y), 100)
        assert.equal(Math.round(points[points.length - 1].x), 100)
        assert.equal(Math.round(points[points.length - 1].y), 900)

        const widest = Math.max(...points.map(point => Math.abs(point.x - 100)))
        assert.ok(widest <= Simulation.tuning.lightningSpread,
            `the bolt strays ${widest.toFixed(1)} px off its line`)
        assert.ok(widest > 0, "the bolt is a straight line, not a jagged one")
    }
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
