.pragma library

// Reference implementation of the simulation rules. See spec/simulation.md.
//
// Every function here operates on a duck-typed character state: an object
// carrying the fields listed in makeCharacterFields below. A QML Item with
// those properties qualifies, and so does a plain object, which is what lets
// this file run headless under Node for testing and makes it the direct
// source for the planned C port.
//
// Three constraints hold throughout, and all three exist for the C port:
//
//   - no clock access: the caller passes elapsed time in;
//   - no callbacks: callers learn what happened from return values;
//   - no ambient randomness: every draw comes from an explicit seeded source,
//     so a given seed replays exactly.

var directions = [
    { id: "south", dx: 0, dy: 1 },
    { id: "south_east", dx: 1, dy: 1 },
    { id: "east", dx: 1, dy: 0 },
    { id: "north_east", dx: 1, dy: -1 },
    { id: "north", dx: 0, dy: -1 },
    { id: "north_west", dx: -1, dy: -1 },
    { id: "west", dx: -1, dy: 0 },
    { id: "south_west", dx: -1, dy: 1 }
]

var tribes = ["blue", "red", "yellow", "green"]

var tribeColors = {
    neutral: "#b9b0a2",
    blue: "#45d7ff",
    red: "#ff5545",
    yellow: "#ffe35a",
    green: "#62e85c"
}

// Numeric rules, gathered so that spec/simulation.md, this file and the C port
// have one place to agree with. Distances are unscaled world pixels; the
// caller supplies the sprite scale through the character state.
var tuning = {
    speedMin: 30,
    speedMax: 48,
    spawnMarginX: 24,
    spawnInsetX: 48,
    spawnMarginTop: 40,
    spawnInsetY: 64,
    bottomMargin: 4,
    footprintSpacing: 12,
    collisionDistance: 14,
    collisionCooldownMs: 350,
    wanderIntervalMinMs: 2000,
    wanderIntervalMaxMs: 7000,
    avoidanceIntervalMs: 100,
    fallbackMarginX: 12,
    fallbackMarginTop: 24,
    fallbackFrameDurationMs: 120,
    // The simulation advances in fixed slices, independent of how often the
    // host manages to call it. Anything longer than maxAccumulatedSeconds is
    // dropped rather than caught up, so a stalled host cannot teleport
    // characters or lock the loop up trying to catch up.
    stepSeconds: 1 / 60,
    maxAccumulatedSeconds: 0.25,
    minWorldSize: 64
}

// --- Random source -------------------------------------------------------
//
// mulberry32. Chosen because it is five lines, has no state beyond one 32-bit
// word, and maps to C without ambiguity: every operation below is an explicit
// unsigned 32-bit one. Math.imul is a 32-bit multiply keeping the low word,
// which is what a uint32_t multiply does in C.

function createRandom(seed) {
    var state = (seed >>> 0) || 1

    function nextUint32() {
        state = (state + 0x6d2b79f5) >>> 0
        var t = Math.imul(state ^ (state >>> 15), 1 | state) >>> 0
        t = ((t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t) >>> 0
        return (t ^ (t >>> 14)) >>> 0
    }

    return {
        seed: state,
        nextUint32: nextUint32,
        // Uniform in [0, 1).
        nextFloat: function () {
            return nextUint32() / 4294967296
        },
        // Uniform integer in [0, bound).
        nextInt: function (bound) {
            return Math.floor((nextUint32() / 4294967296) * bound)
        },
        pick: function (items) {
            return items[Math.floor((nextUint32() / 4294967296) * items.length)]
        }
    }
}

// --- Helpers -------------------------------------------------------------

function animationId(tribe, directionId) {
    return "brave." + tribe + ".walk." + directionId
}

function directionForVector(dx, dy) {
    var horizontal = dx < 0 ? -1 : (dx > 0 ? 1 : 0)
    var vertical = dy < 0 ? -1 : (dy > 0 ? 1 : 0)

    for (var index = 0; index < directions.length; ++index) {
        var candidate = directions[index]
        if (candidate.dx === horizontal && candidate.dy === vertical) {
            return candidate
        }
    }
    return directions[0]
}

function randomDirection(random) {
    return random.pick(directions)
}

function randomTribe(random) {
    return random.pick(tribes)
}

function randomWanderInterval(random) {
    var span = tuning.wanderIntervalMaxMs - tuning.wanderIntervalMinMs
    return tuning.wanderIntervalMinMs + random.nextInt(span + 1)
}

function tribeColor(tribe) {
    return tribeColors[tribe] || "#d0d0d0"
}

// Applies a direction to a character and restarts its walk cycle. Returns the
// resolved direction so the caller can tell which of the eight it snapped to.
function setDirection(state, dx, dy) {
    var direction = directionForVector(dx, dy)
    state.directionX = direction.dx
    state.directionY = direction.dy
    state.directionId = direction.id
    state.frameIndex = 0
    state.animationElapsedMs = 0
    return direction
}

// --- Character rules -----------------------------------------------------

// Populates a character with a random tribe, direction, position and speed.
// Returns false when the world is too small to place anything, which is how a
// shell waits for its layout to settle.
function initializeCharacter(state, world, random) {
    if (!world || world.width < tuning.minWorldSize || world.height < tuning.minWorldSize) {
        return false
    }

    var direction = randomDirection(random)
    state.tribe = randomTribe(random)
    state.worldX = tuning.spawnMarginX
        + random.nextFloat() * Math.max(1, world.width - tuning.spawnInsetX)
    state.worldY = tuning.spawnMarginTop
        + random.nextFloat() * Math.max(1, world.height - tuning.spawnInsetY)
    state.speed = (tuning.speedMin + random.nextFloat() * (tuning.speedMax - tuning.speedMin))
        * state.spriteScale
    state.distanceSinceFootprint = 0
    state.collisionCooldownMs = 0
    state.wanderRemainingMs = randomWanderInterval(random)
    setDirection(state, direction.dx, direction.dy)
    state.initialized = true
    return true
}

// Edge margins depend on the sprite currently displayed, so they are derived
// from the frame size the renderer keeps on the state.
function marginX(state) {
    return state.frameWidth > 0
        ? state.frameWidth * state.spriteScale / 2
        : tuning.fallbackMarginX
}

function marginTop(state) {
    return state.frameHeight > 0
        ? state.frameHeight * state.spriteScale
        : tuning.fallbackMarginTop
}

// Advances the walk animation by one slice.
function advanceAnimation(state, stepMs) {
    var duration = state.frameDurationMs > 0
        ? state.frameDurationMs
        : tuning.fallbackFrameDurationMs

    if (state.frameCount <= 0) {
        return
    }

    state.animationElapsedMs += stepMs
    while (state.animationElapsedMs >= duration) {
        state.animationElapsedMs -= duration
        state.frameIndex = (state.frameIndex + 1) % state.frameCount
    }
}

// Advances a character by exactly one fixed slice: movement, edge bouncing,
// footprint decision, walk animation, wander countdown and collision cooldown.
//
// Returns { directionChanged, footprint }. footprint is null or a descriptor
// the caller turns into a visual.
function stepCharacter(state, world, stepSeconds, random) {
    var stepMs = stepSeconds * 1000
    var directionChanged = false

    var length = Math.sqrt(
        state.directionX * state.directionX + state.directionY * state.directionY
    )
    var normalizedX = length > 0 ? state.directionX / length : 0
    var normalizedY = length > 0 ? state.directionY / length : 0
    var nextX = state.worldX + normalizedX * state.speed * stepSeconds
    var nextY = state.worldY + normalizedY * state.speed * stepSeconds
    var newDirectionX = state.directionX
    var newDirectionY = state.directionY

    var minX = marginX(state)
    var maxX = world.width - minX
    var minY = marginTop(state)
    var maxY = world.height - tuning.bottomMargin

    if (nextX < minX || nextX > maxX) {
        newDirectionX = -newDirectionX
        nextX = Math.max(minX, Math.min(maxX, nextX))
    }
    if (nextY < minY || nextY > maxY) {
        newDirectionY = -newDirectionY
        nextY = Math.max(minY, Math.min(maxY, nextY))
    }

    if (newDirectionX !== state.directionX || newDirectionY !== state.directionY) {
        setDirection(state, newDirectionX, newDirectionY)
        directionChanged = true
    }

    var traveledX = nextX - state.worldX
    var traveledY = nextY - state.worldY
    state.distanceSinceFootprint += Math.sqrt(
        traveledX * traveledX + traveledY * traveledY
    )

    var spacing = tuning.footprintSpacing * state.spriteScale
    var footprint = null
    if (state.distanceSinceFootprint >= spacing) {
        state.distanceSinceFootprint %= spacing
        footprint = {
            groundX: state.worldX,
            groundY: state.worldY - 1,
            directionX: normalizedX,
            directionY: normalizedY,
            tribe: state.tribe,
            spriteScale: state.spriteScale
        }
    }

    state.worldX = nextX
    state.worldY = nextY

    advanceAnimation(state, stepMs)

    if (state.collisionCooldownMs > 0) {
        state.collisionCooldownMs = Math.max(0, state.collisionCooldownMs - stepMs)
    }

    state.wanderRemainingMs -= stepMs
    if (state.wanderRemainingMs <= 0) {
        var wandered = randomDirection(random)
        setDirection(state, wandered.dx, wandered.dy)
        state.wanderRemainingMs = randomWanderInterval(random)
        directionChanged = true
    }

    return { directionChanged: directionChanged, footprint: footprint }
}

// Turns a character away from the first neighbour it is closing in on.
// others is an array of character states, which may include this one.
// Returns true when the direction changed.
function avoidCollisions(state, others) {
    if (state.collisionCooldownMs > 0) {
        return false
    }

    var collisionDistance = tuning.collisionDistance * state.spriteScale
    var collisionDistanceSquared = collisionDistance * collisionDistance

    for (var index = 0; index < others.length; ++index) {
        var other = others[index]
        if (!other || other === state || !other.initialized) {
            continue
        }

        var differenceX = state.worldX - other.worldX
        var differenceY = state.worldY - other.worldY
        var distanceSquared = differenceX * differenceX + differenceY * differenceY
        if (distanceSquared <= 0 || distanceSquared >= collisionDistanceSquared) {
            continue
        }

        var movingTowardOther =
            state.directionX * differenceX + state.directionY * differenceY < 0
        if (movingTowardOther) {
            setDirection(state, differenceX, differenceY)
            state.collisionCooldownMs = tuning.collisionCooldownMs
            return true
        }
    }

    return false
}

// --- Driver --------------------------------------------------------------

// The whole simulation: its random source, its characters and the leftover
// time not yet consumed by a fixed step. A host shell creates one, fills in
// characters, and calls stepSimulation with real elapsed time.
function createSimulation(seed) {
    return {
        random: createRandom(seed),
        characters: [],
        accumulatedSeconds: 0,
        avoidanceElapsedMs: 0
    }
}

// Runs as many fixed steps as the elapsed time allows. Returns the footprints
// dropped across every step, in order, for the caller to render.
function stepSimulation(simulation, world, elapsedSeconds) {
    var footprints = []
    var characters = simulation.characters
    var index

    for (index = 0; index < characters.length; ++index) {
        if (!characters[index].initialized) {
            initializeCharacter(characters[index], world, simulation.random)
        }
    }

    simulation.accumulatedSeconds = Math.min(
        tuning.maxAccumulatedSeconds,
        simulation.accumulatedSeconds + Math.max(0, elapsedSeconds)
    )

    while (simulation.accumulatedSeconds >= tuning.stepSeconds) {
        simulation.accumulatedSeconds -= tuning.stepSeconds

        for (index = 0; index < characters.length; ++index) {
            var state = characters[index]
            if (!state.initialized) {
                continue
            }
            var result = stepCharacter(state, world, tuning.stepSeconds, simulation.random)
            if (result.footprint) {
                footprints.push(result.footprint)
            }
        }

        simulation.avoidanceElapsedMs += tuning.stepSeconds * 1000
        if (simulation.avoidanceElapsedMs >= tuning.avoidanceIntervalMs) {
            simulation.avoidanceElapsedMs -= tuning.avoidanceIntervalMs
            for (index = 0; index < characters.length; ++index) {
                if (characters[index].initialized) {
                    avoidCollisions(characters[index], characters)
                }
            }
        }
    }

    return footprints
}
