// Headless tests for core/js/Simulation.js.
//
// The simulation is deliberately free of QML, rendering and clock access, so
// it runs under plain Node. Run with:
//
//     node --test tests/
//
// Determinism is not tested yet: the rules still draw from Math.random().
// Phase 2 step 2 replaces that with a seeded PRNG, and these tests gain a
// reproducibility case then.

import { readFileSync } from "node:fs"
import test from "node:test"
import assert from "node:assert/strict"

const EXPORTS = [
    "directions",
    "tribes",
    "tuning",
    "animationId",
    "directionForVector",
    "setDirection",
    "initializeCharacter",
    "stepCharacter",
    "avoidCollisions",
    "wander",
    "tribeColor",
    "randomDirection",
    "randomTribe",
    "randomWanderInterval"
]

function loadSimulation() {
    const source = readFileSync(
        new URL("../core/js/Simulation.js", import.meta.url),
        "utf8"
    ).replace(/^\s*\.pragma\s+library\s*$/m, "")

    return new Function(`${source}\nreturn { ${EXPORTS.join(", ")} };`)()
}

const Simulation = loadSimulation()

// A character state carrying exactly the fields Character.qml exposes as
// properties. This is the duck typing the extraction relies on.
function makeCharacter(overrides = {}) {
    return {
        tribe: "blue",
        directionId: "east",
        directionX: 1,
        directionY: 0,
        worldX: 100,
        worldY: 100,
        speed: 100,
        previousTick: 0,
        distanceSinceFootprint: 0,
        lastCollisionAt: 0,
        ...overrides
    }
}

const WORLD = { width: 1000, height: 1000 }
const METRICS = { marginX: 10, marginTop: 26, footprintSpacing: 24 }

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

test("a character walks along its direction at its speed", () => {
    const character = makeCharacter()
    // 10 ms at 100 px/s is 1 px.
    Simulation.stepCharacter(character, WORLD, 10, METRICS)

    assert.equal(character.worldX, 101)
    assert.equal(character.worldY, 100)
    assert.equal(character.previousTick, 10)
})

test("diagonal movement is normalised to the same speed as cardinal", () => {
    const cardinal = makeCharacter()
    const diagonal = makeCharacter({ directionId: "south_east", directionY: 1 })

    Simulation.stepCharacter(cardinal, WORLD, 100, METRICS)
    Simulation.stepCharacter(diagonal, WORLD, 100, METRICS)

    const cardinalDistance = Math.hypot(cardinal.worldX - 100, cardinal.worldY - 100)
    const diagonalDistance = Math.hypot(diagonal.worldX - 100, diagonal.worldY - 100)

    assert.ok(Math.abs(cardinalDistance - diagonalDistance) < 1e-9)
})

test("a long stall is clamped to maxStepSeconds", () => {
    const character = makeCharacter()
    // Ten seconds of stall must advance no more than 0.05 s of movement.
    Simulation.stepCharacter(character, WORLD, 10_000, METRICS)

    assert.equal(character.worldX, 100 + 100 * Simulation.tuning.maxStepSeconds)
})

test("a character bounces off the right edge and is clamped inside", () => {
    const world = { width: 200, height: 200 }
    const character = makeCharacter({ worldX: 195 })

    const result = Simulation.stepCharacter(character, world, 100, METRICS)

    assert.equal(result.directionChanged, true)
    assert.equal(character.directionId, "west")
    assert.equal(character.worldX, world.width - METRICS.marginX)
})

test("a character bounces off the bottom edge using the ground margin", () => {
    const world = { width: 200, height: 200 }
    const character = makeCharacter({
        directionId: "south",
        directionX: 0,
        directionY: 1,
        worldY: 195
    })

    const result = Simulation.stepCharacter(character, world, 100, METRICS)

    assert.equal(result.directionChanged, true)
    assert.equal(character.directionId, "north")
    assert.equal(character.worldY, world.height - Simulation.tuning.bottomMargin)
})

test("a footprint is dropped once the spacing has been walked", () => {
    const character = makeCharacter()
    const metrics = { ...METRICS, footprintSpacing: 10 }

    // 5 px per step at 100 px/s clamped to 0.05 s.
    const first = Simulation.stepCharacter(character, WORLD, 1000, metrics)
    assert.equal(first.footprint, null)

    const second = Simulation.stepCharacter(character, WORLD, 2000, metrics)
    assert.notEqual(second.footprint, null)
    assert.equal(second.footprint.tribe, "blue")
    assert.equal(second.footprint.directionX, 1)
    // The footprint is left where the character was, not where it lands.
    assert.equal(second.footprint.groundX, 105)
    // Footprints sit one pixel above the ground point.
    assert.equal(second.footprint.groundY, 99)
    assert.equal(character.distanceSinceFootprint, 0)
})

test("a character turns away from a neighbour it is closing in on", () => {
    const character = makeCharacter()
    const ahead = makeCharacter({ worldX: 105 })

    const turned = Simulation.avoidCollisions(character, [ahead], 1000, 1)

    assert.equal(turned, true)
    assert.equal(character.directionId, "west")
    assert.equal(character.lastCollisionAt, 1000)
})

test("a character ignores a neighbour it is moving away from", () => {
    const character = makeCharacter()
    const behind = makeCharacter({ worldX: 95 })

    assert.equal(Simulation.avoidCollisions(character, [behind], 1000, 1), false)
})

test("a character ignores a neighbour beyond the collision distance", () => {
    const character = makeCharacter()
    const far = makeCharacter({ worldX: 100 + Simulation.tuning.collisionDistance + 1 })

    assert.equal(Simulation.avoidCollisions(character, [far], 1000, 1), false)
})

test("avoidance respects its cooldown", () => {
    const character = makeCharacter({ lastCollisionAt: 1000 })
    const ahead = makeCharacter({ worldX: 105 })
    const stillCoolingDown = 1000 + Simulation.tuning.collisionCooldownMs - 1

    assert.equal(
        Simulation.avoidCollisions(character, [ahead], stillCoolingDown, 1),
        false
    )
    assert.equal(character.directionId, "east")
})

test("a character never avoids itself", () => {
    const character = makeCharacter()

    assert.equal(Simulation.avoidCollisions(character, [character], 1000, 1), false)
})

test("initialisation refuses a world smaller than the minimum", () => {
    const character = makeCharacter()
    const tooSmall = Simulation.tuning.minWorldSize - 1

    assert.equal(
        Simulation.initializeCharacter(
            character, { width: tooSmall, height: tooSmall }, 1, 0
        ),
        false
    )
})

test("initialisation places a character inside the world at a valid speed", () => {
    for (let attempt = 0; attempt < 200; ++attempt) {
        const character = makeCharacter()
        const spriteScale = 2

        assert.equal(
            Simulation.initializeCharacter(character, WORLD, spriteScale, 42),
            true
        )

        assert.ok(character.worldX >= Simulation.tuning.spawnMarginX)
        assert.ok(character.worldX <= WORLD.width)
        assert.ok(character.worldY >= Simulation.tuning.spawnMarginTop)
        assert.ok(character.worldY <= WORLD.height)
        assert.ok(character.speed >= Simulation.tuning.speedMin * spriteScale)
        assert.ok(character.speed <= Simulation.tuning.speedMax * spriteScale)
        assert.ok(Simulation.tribes.includes(character.tribe))
        assert.equal(character.previousTick, 42)
    }
})

test("wander always reports a change so the walk cycle restarts", () => {
    const character = makeCharacter()

    for (let attempt = 0; attempt < 50; ++attempt) {
        assert.equal(Simulation.wander(character), true)
        assert.ok(Simulation.directions.some(d => d.id === character.directionId))
    }
})

test("wander intervals stay inside their configured range", () => {
    for (let attempt = 0; attempt < 500; ++attempt) {
        const interval = Simulation.randomWanderInterval()
        assert.ok(interval >= Simulation.tuning.wanderIntervalMinMs)
        assert.ok(interval <= Simulation.tuning.wanderIntervalMaxMs)
    }
})
