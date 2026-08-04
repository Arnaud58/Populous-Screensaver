.pragma library

// Reference implementation of the simulation rules. See spec/simulation.md.
//
// Every function here operates on a duck-typed character state: an object
// carrying tribe, directionId, directionX, directionY, worldX, worldY, speed,
// previousTick, distanceSinceFootprint and lastCollisionAt. A QML Item with
// those properties qualifies, and so does a plain object, which is what lets
// this file run headless under Node for testing and makes it the direct
// source for the planned C port.
//
// Nothing here touches QML, rendering or the clock: the caller passes the
// current time in. Callers are told what changed through return values rather
// than through callbacks.

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

// Numeric rules, gathered so that spec/simulation.md and the C port have one
// place to agree with. Distances are unscaled world pixels; the caller applies
// the sprite scale.
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
    maxStepSeconds: 0.05,
    minWorldSize: 64
}

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

function randomDirection() {
    return directions[Math.floor(Math.random() * directions.length)]
}

function randomTribe() {
    return tribes[Math.floor(Math.random() * tribes.length)]
}

function randomWanderInterval() {
    var span = tuning.wanderIntervalMaxMs - tuning.wanderIntervalMinMs
    return tuning.wanderIntervalMinMs + Math.floor(Math.random() * (span + 1))
}

function tribeColor(tribe) {
    return tribeColors[tribe] || "#d0d0d0"
}

// Applies a direction to a character. Returns the resolved direction so the
// caller can tell which of the eight it snapped to.
function setDirection(state, dx, dy) {
    var direction = directionForVector(dx, dy)
    state.directionX = direction.dx
    state.directionY = direction.dy
    state.directionId = direction.id
    return direction
}

// Populates a character with a random tribe, direction, position and speed.
// Returns false when the world is too small to place anything, which is how
// a shell waits for its layout to settle.
function initializeCharacter(state, world, spriteScale, now) {
    if (!world || world.width < tuning.minWorldSize || world.height < tuning.minWorldSize) {
        return false
    }

    var direction = randomDirection()
    state.tribe = randomTribe()
    state.worldX = tuning.spawnMarginX
        + Math.random() * Math.max(1, world.width - tuning.spawnInsetX)
    state.worldY = tuning.spawnMarginTop
        + Math.random() * Math.max(1, world.height - tuning.spawnInsetY)
    state.speed = (tuning.speedMin + Math.random() * (tuning.speedMax - tuning.speedMin))
        * spriteScale
    state.previousTick = now
    state.distanceSinceFootprint = 0
    state.lastCollisionAt = 0
    setDirection(state, direction.dx, direction.dy)
    return true
}

// Advances a character by the time elapsed since its previous step, bouncing
// it off the world edges and deciding whether it drops a footprint.
//
// metrics carries the frame-derived distances the caller computed:
// marginX, marginTop and footprintSpacing, all already scaled.
//
// Returns { directionChanged, footprint }. footprint is null or a descriptor
// the caller turns into a visual.
function stepCharacter(state, world, now, metrics) {
    var elapsedSeconds = Math.min(
        tuning.maxStepSeconds,
        Math.max(0, now - state.previousTick) / 1000
    )
    state.previousTick = now

    var length = Math.sqrt(
        state.directionX * state.directionX + state.directionY * state.directionY
    )
    var normalizedX = length > 0 ? state.directionX / length : 0
    var normalizedY = length > 0 ? state.directionY / length : 0
    var nextX = state.worldX + normalizedX * state.speed * elapsedSeconds
    var nextY = state.worldY + normalizedY * state.speed * elapsedSeconds
    var newDirectionX = state.directionX
    var newDirectionY = state.directionY

    var maxX = world.width - metrics.marginX
    var maxY = world.height - tuning.bottomMargin

    if (nextX < metrics.marginX || nextX > maxX) {
        newDirectionX = -newDirectionX
        nextX = Math.max(metrics.marginX, Math.min(maxX, nextX))
    }
    if (nextY < metrics.marginTop || nextY > maxY) {
        newDirectionY = -newDirectionY
        nextY = Math.max(metrics.marginTop, Math.min(maxY, nextY))
    }

    var directionChanged = false
    if (newDirectionX !== state.directionX || newDirectionY !== state.directionY) {
        setDirection(state, newDirectionX, newDirectionY)
        directionChanged = true
    }

    var traveledX = nextX - state.worldX
    var traveledY = nextY - state.worldY
    state.distanceSinceFootprint += Math.sqrt(
        traveledX * traveledX + traveledY * traveledY
    )

    var footprint = null
    if (state.distanceSinceFootprint >= metrics.footprintSpacing) {
        state.distanceSinceFootprint %= metrics.footprintSpacing
        footprint = {
            groundX: state.worldX,
            groundY: state.worldY - 1,
            directionX: normalizedX,
            directionY: normalizedY,
            tribe: state.tribe
        }
    }

    state.worldX = nextX
    state.worldY = nextY

    return { directionChanged: directionChanged, footprint: footprint }
}

// Turns a character away from the first neighbour it is closing in on.
// others is an array of character states excluding this one. Returns true when
// the direction changed, so the caller can refresh the animation.
function avoidCollisions(state, others, now, spriteScale) {
    if (now - state.lastCollisionAt < tuning.collisionCooldownMs) {
        return false
    }

    var collisionDistance = tuning.collisionDistance * spriteScale
    var collisionDistanceSquared = collisionDistance * collisionDistance

    for (var index = 0; index < others.length; ++index) {
        var other = others[index]
        if (!other || other === state) {
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
            state.lastCollisionAt = now
            return true
        }
    }

    return false
}

// Picks a new random direction. Always reported as a change, matching the
// original behaviour where a redundant pick still restarts the walk cycle.
function wander(state) {
    var direction = randomDirection()
    setDirection(state, direction.dx, direction.dy)
    return true
}
