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
    // Large enough for a scale-3 character's avoidance radius. Queries still
    // expand over several cells when a host supplies a larger sprite scale.
    spatialCellSize: 42,
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

// --- World geometry ------------------------------------------------------
//
// The world is a *list* of rectangles, not one rectangle: the union of the
// screens it spans. A single-screen host passes a list of one, so there is no
// separate single-screen mode.
//
// Monitors of different heights leave dead zones inside the bounding box. On
// a 1920x1200 next to two 1920x1080 there is a 3840x120 strip along the
// bottom that belongs to no screen, and a character wandering into it would
// simply vanish. Validity is therefore membership of the union, never of the
// bounding box.

function createWorld(rects) {
    var usable = []
    var index

    for (index = 0; index < rects.length; ++index) {
        var rect = rects[index]
        if (!rect || rect.width <= 0 || rect.height <= 0) {
            continue
        }
        usable.push({
            x: rect.x === undefined ? 0 : rect.x,
            y: rect.y === undefined ? 0 : rect.y,
            width: rect.width,
            height: rect.height
        })
    }

    var bounds = { x: 0, y: 0, width: 0, height: 0 }
    if (usable.length > 0) {
        var minX = usable[0].x
        var minY = usable[0].y
        var maxX = usable[0].x + usable[0].width
        var maxY = usable[0].y + usable[0].height
        for (index = 1; index < usable.length; ++index) {
            minX = Math.min(minX, usable[index].x)
            minY = Math.min(minY, usable[index].y)
            maxX = Math.max(maxX, usable[index].x + usable[index].width)
            maxY = Math.max(maxY, usable[index].y + usable[index].height)
        }
        bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    }

    return { rects: usable, bounds: bounds }
}

function worldContains(world, x, y) {
    for (var index = 0; index < world.rects.length; ++index) {
        var rect = world.rects[index]
        if (x >= rect.x && x <= rect.x + rect.width
                && y >= rect.y && y <= rect.y + rect.height) {
            return true
        }
    }
    return false
}

// Whether a character may stand at (x, y) without its sprite hanging off the
// outside of the world.
//
// The margins are probed rather than applied per rectangle, which is what
// keeps the boundary between two screens open. A probe that crosses an
// internal edge lands in the neighbouring rectangle and is still inside the
// union, so the character walks through; a probe that crosses an outer edge
// leaves the union, so the character turns. Insetting each rectangle instead
// would build an invisible wall down every screen seam.
function worldAllows(world, x, y, margins) {
    return worldContains(world, x, y)
        && worldContains(world, x - margins.x, y)
        && worldContains(world, x + margins.x, y)
        && worldContains(world, x, y - margins.top)
        && worldContains(world, x, y + margins.bottom)
}

// Pulls a character back to the nearest legal spot.
//
// A position can be illegal without anyone doing anything wrong: the spawn
// inset is smaller than the top margin of a tall sprite, the sprite scale
// changes with the window, a screen is unplugged. Without this, such a
// character fails every move, reverses on the spot and is stuck for good.
function clampIntoWorld(world, x, y, margins) {
    var best = { x: x, y: y }
    var bestDistance = Infinity

    for (var index = 0; index < world.rects.length; ++index) {
        var rect = world.rects[index]
        var lowX = rect.x + margins.x
        var highX = rect.x + rect.width - margins.x
        var lowY = rect.y + margins.top
        var highY = rect.y + rect.height - margins.bottom
        // A rectangle narrower than its own margins collapses to its middle
        // rather than inverting the clamp.
        var candidateX = lowX > highX
            ? (rect.x + rect.width / 2)
            : Math.max(lowX, Math.min(highX, x))
        var candidateY = lowY > highY
            ? (rect.y + rect.height / 2)
            : Math.max(lowY, Math.min(highY, y))

        var differenceX = candidateX - x
        var differenceY = candidateY - y
        var distance = differenceX * differenceX + differenceY * differenceY
        if (distance < bestDistance) {
            bestDistance = distance
            best = { x: candidateX, y: candidateY }
        }
    }

    return best
}

function worldHasUsableRect(world) {
    for (var index = 0; index < world.rects.length; ++index) {
        if (world.rects[index].width >= tuning.minWorldSize
                && world.rects[index].height >= tuning.minWorldSize) {
            return true
        }
    }
    return false
}

// Picks a rectangle weighted by area, so characters spread evenly over the
// world rather than clustering on the smallest screen.
function pickRect(world, random) {
    var total = 0
    var index

    for (index = 0; index < world.rects.length; ++index) {
        total += world.rects[index].width * world.rects[index].height
    }

    var target = random.nextFloat() * total
    var running = 0
    for (index = 0; index < world.rects.length; ++index) {
        running += world.rects[index].width * world.rects[index].height
        if (target < running) {
            return world.rects[index]
        }
    }
    return world.rects[world.rects.length - 1]
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

// Caches the frames of the animation matching the character's tribe and
// direction. The state then carries everything the rules need about its
// sprite, which is what lets several views render the same character without
// any of them owning its dimensions.
function resolveAnimation(state) {
    var animation = state.animations
        ? state.animations[animationId(state.tribe, state.directionId)]
        : null

    state.frames = animation && animation.frames ? animation.frames : null
    state.frameCount = state.frames ? state.frames.length : 0
    state.frameDurationMs = animation && animation.frameDurationMs > 0
        ? animation.frameDurationMs
        : tuning.fallbackFrameDurationMs
}

// The frame currently displayed. Edge margins follow it rather than a constant,
// because a cycle changes width from frame to frame: south runs 17, 19, 17, 19.
function currentFrame(state) {
    if (!state.frames || state.frames.length === 0) {
        return null
    }
    return state.frames[state.frameIndex % state.frames.length]
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
    resolveAnimation(state)
    return direction
}

// --- Character rules -----------------------------------------------------

// Builds a character state. `animations` is the `animations` object of the
// compiled manifest; the state keeps a reference so it can resolve its own
// frames whenever its tribe or direction changes.
function createCharacter(animations, spriteScale) {
    var state = {
        animations: animations,
        tribe: "blue",
        directionId: "south",
        directionX: 0,
        directionY: 1,
        worldX: 0,
        worldY: 0,
        speed: 0,
        spriteScale: spriteScale > 0 ? spriteScale : 1,
        frameIndex: 0,
        animationElapsedMs: 0,
        distanceSinceFootprint: 0,
        collisionCooldownMs: 0,
        wanderRemainingMs: 0,
        initialized: false,
        frames: null,
        frameCount: 0,
        frameDurationMs: tuning.fallbackFrameDurationMs
    }
    resolveAnimation(state)
    return state
}

// Populates a character with a random tribe, direction, position and speed.
// Returns false when no screen is large enough to place anything, which is how
// a shell waits for its layout to settle.
//
// The draw order is part of the contract: rectangle, direction, tribe, x, y,
// speed, wander interval. The C port must consume the same values in the same
// order or the two implementations diverge from the first character.
function initializeCharacter(state, world, random) {
    if (!world || !worldHasUsableRect(world)) {
        return false
    }

    var rect = pickRect(world, random)
    var direction = randomDirection(random)
    state.tribe = randomTribe(random)
    state.worldX = rect.x + tuning.spawnMarginX
        + random.nextFloat() * Math.max(1, rect.width - tuning.spawnInsetX)
    state.worldY = rect.y + tuning.spawnMarginTop
        + random.nextFloat() * Math.max(1, rect.height - tuning.spawnInsetY)
    state.speed = (tuning.speedMin + random.nextFloat() * (tuning.speedMax - tuning.speedMin))
        * state.spriteScale
    state.distanceSinceFootprint = 0
    state.collisionCooldownMs = 0
    state.wanderRemainingMs = randomWanderInterval(random)
    setDirection(state, direction.dx, direction.dy)
    state.initialized = true
    return true
}

// Edge margins depend on the sprite currently displayed.
function marginX(state) {
    var frame = currentFrame(state)
    return frame ? frame.width * state.spriteScale / 2 : tuning.fallbackMarginX
}

function marginTop(state) {
    var frame = currentFrame(state)
    return frame ? frame.height * state.spriteScale : tuning.fallbackMarginTop
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

    var margins = {
        x: marginX(state),
        top: marginTop(state),
        bottom: tuning.bottomMargin
    }

    // Rescue a character standing somewhere it should not be before asking it
    // to move, otherwise every move below is refused and it never recovers.
    if (!worldAllows(world, state.worldX, state.worldY, margins)) {
        var rescued = clampIntoWorld(world, state.worldX, state.worldY, margins)
        state.worldX = rescued.x
        state.worldY = rescued.y
        nextX = state.worldX + normalizedX * state.speed * stepSeconds
        nextY = state.worldY + normalizedY * state.speed * stepSeconds
    }

    // Try the whole move, then each axis alone. Whichever axis is refused is
    // the one that hit a wall, so that is the one to reflect. Testing the axes
    // separately is what lets a character slide along an edge instead of
    // sticking to it, and it needs no special case for the concave corners a
    // multi-screen world has.
    var acceptedX = state.worldX
    var acceptedY = state.worldY

    if (worldAllows(world, nextX, nextY, margins)) {
        acceptedX = nextX
        acceptedY = nextY
    } else if (worldAllows(world, nextX, state.worldY, margins)) {
        acceptedX = nextX
        newDirectionY = -newDirectionY
    } else if (worldAllows(world, state.worldX, nextY, margins)) {
        acceptedY = nextY
        newDirectionX = -newDirectionX
    } else {
        newDirectionX = -newDirectionX
        newDirectionY = -newDirectionY
    }

    nextX = acceptedX
    nextY = acceptedY

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

// --- Spatial partition --------------------------------------------------

// Builds a uniform grid over the character ground points. Cells contain both
// the state and its index in the original array: sorting query results by that
// index preserves the old "first neighbour wins" rule and therefore seeded
// replay, while avoiding a full scan for every character.
function createSpatialIndex(characters, cellSize) {
    var size = cellSize > 0 ? cellSize : tuning.spatialCellSize
    var cells = Object.create(null)

    for (var index = 0; index < characters.length; ++index) {
        var state = characters[index]
        if (!state || !state.initialized) {
            continue
        }

        var cellX = Math.floor(state.worldX / size)
        var cellY = Math.floor(state.worldY / size)
        var key = cellX + "," + cellY
        if (!cells[key]) {
            cells[key] = []
        }
        cells[key].push({ index: index, state: state })
    }

    return { cellSize: size, cells: cells }
}

// Returns only characters from cells touched by the caller's avoidance
// radius. Results retain the master character-array order so collision
// decisions are byte-for-byte deterministic with the former exhaustive scan.
function nearbyCharacters(state, spatialIndex, radius) {
    var size = spatialIndex.cellSize
    var minimumX = Math.floor((state.worldX - radius) / size)
    var maximumX = Math.floor((state.worldX + radius) / size)
    var minimumY = Math.floor((state.worldY - radius) / size)
    var maximumY = Math.floor((state.worldY + radius) / size)
    var entries = []

    for (var cellY = minimumY; cellY <= maximumY; ++cellY) {
        for (var cellX = minimumX; cellX <= maximumX; ++cellX) {
            var cell = spatialIndex.cells[cellX + "," + cellY]
            if (!cell) {
                continue
            }
            for (var index = 0; index < cell.length; ++index) {
                entries.push(cell[index])
            }
        }
    }

    entries.sort(function (left, right) {
        return left.index - right.index
    })

    var result = []
    for (var entryIndex = 0; entryIndex < entries.length; ++entryIndex) {
        result.push(entries[entryIndex].state)
    }
    return result
}

// --- Driver --------------------------------------------------------------

// The whole simulation: its random source, the animation manifest its
// characters resolve frames from, its characters, and the leftover time not
// yet consumed by a fixed step.
//
// A host shell creates one, populates it, and calls stepSimulation with real
// elapsed time. It never owns the characters itself, which is what allows
// several windows to render one world.
function createSimulation(seed, animations) {
    return {
        random: createRandom(seed),
        animations: animations || null,
        characters: [],
        accumulatedSeconds: 0,
        avoidanceElapsedMs: 0
    }
}

// Replaces the population with `count` fresh characters.
function populate(simulation, count, spriteScale) {
    simulation.characters = []
    for (var index = 0; index < count; ++index) {
        simulation.characters.push(
            createCharacter(simulation.animations, spriteScale)
        )
    }
    return simulation.characters
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
            var spatialIndex = createSpatialIndex(characters, tuning.spatialCellSize)
            for (index = 0; index < characters.length; ++index) {
                if (characters[index].initialized) {
                    var collisionRadius =
                        tuning.collisionDistance * characters[index].spriteScale
                    avoidCollisions(
                        characters[index],
                        nearbyCharacters(characters[index], spatialIndex, collisionRadius)
                    )
                }
            }
        }
    }

    return footprints
}
