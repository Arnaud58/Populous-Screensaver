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

// Tribe 0 in the original. Unaligned characters are what shamans convert, and
// the atlas is the evidence for what they can do: the neutral brave has a walk
// and a stand block and nothing else — no kick, no hit, no soul. It therefore
// neither fights nor dies, and exists only to be converted.
var unalignedTribe = "neutral"

// The draw at spawn. Ordinary characters are **always** born unaligned: no
// member of a tribe ever appears spontaneously, and conversion is the only way
// into one. The single-entry list keeps the draw in the sequence, so the spawn
// contract stays the same for every class.
var spawnTribes = [unalignedTribe]

// Which corner of the world each tribe belongs to, as fractions of the
// bounding box. A tribe's shaman stands there.
var tribeCorners = {
    blue: { x: 0, y: 0 },
    red: { x: 1, y: 0 },
    yellow: { x: 1, y: 1 },
    green: { x: 0, y: 1 }
}

// Public state vocabulary. Strings keep traces readable and map directly to
// enums in the future C port.
var entityTypes = {
    brave: "brave",
    shaman: "shaman",
    firewarrior: "firewarrior",
    soul: "soul",
    effect: "effect"
}

var actions = {
    walk: "walk",
    stand: "stand",
    idle: "idle",
    kick: "kick",
    cast: "cast",
    punch: "punch",
    scratch: "scratch",
    wave: "wave",
    hit: "hit",
    rise: "rise",
    depart: "depart"
}

var behaviours = {
    wander: "wander",
    pursue: "pursue",
    attack: "attack",
    hit: "hit",
    seek: "seek",
    cast: "cast",
    recover: "recover",
    muster: "muster",
    rise: "rise",
    depart: "depart",
    fly: "fly",
    fade: "fade"
}

// Effect kinds, matching the numeric selectors of the original's effect
// factory. See research/original-state-map.md for the mapping.
// The global phases of a run. The original drives six numeric states from its
// second Windows timer; these are the same count, named for what the capture
// shows each one doing rather than for anything in the code.
var armageddonModes = {
    normal: "normal",
    gather: "gather",
    battle: "battle",
    celebration: "celebration",
    celebrationRestore: "celebration_restore",
    restore: "restore"
}

var effectKinds = {
    conversion: "conversion",
    conversionRing: "conversion_ring",
    flash: "flash",
    burst: "burst",
    fire: "fire",
    fireTrail: "fire_trail",
    fireImpact: "fire_impact",
    ring: "ring",
    lightning: "lightning"
}

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
    // Brave state 0 stores a speed of exactly 2 px per original 30 ms tick.
    // Other states override this value when the disassembly says so.
    speedMin: 2 * 1000 / 30,
    speedMax: 2 * 1000 / 30,
    spawnMarginX: 24,
    spawnInsetX: 48,
    spawnMarginTop: 40,
    spawnInsetY: 64,
    bottomMargin: 4,
    // FUN_00413f20 writes one footprint every other original tick while the
    // character is moving. A normal mark covers 2 x 2 pixels.
    footprintIntervalMs: 2 * 30,
    footprintSize: 2,
    collisionDistance: 14,
    collisionCooldownMs: 350,
    idleDecisionThreshold: 12000,
    groupDecisionThreshold: 27001,
    directCombatThreshold: 16385,
    targetGateThreshold: 16384,
    groupLaunchThreshold: 32700,
    roamWaitMinTicks: 10,
    roamWaitSpanTicks: 30,
    neutralRoamLockMinTicks: 20,
    neutralRoamLockSpanTicks: 30,
    scratchTicks: 15,
    formationWaitTicks: 100,
    groupFollowerLimit: 15,
    groupTargetDistanceSquared: 125000,
    avoidanceIntervalMs: 100,
    // Large enough for a scale-3 character's avoidance radius. Queries still
    // expand over several cells when a host supplies a larger sprite scale.
    spatialCellSize: 42,
    fallbackMarginX: 12,
    fallbackMarginTop: 24,
    fallbackFrameDurationMs: 120,
    // Original timer and combat values recovered from vfunc_00410590. The
    // engine remains 60 Hz; tick values are converted to milliseconds/speeds.
    originalTickMs: 30,
    combatAcquireDistance: 250,
    combatAttackDistance: 14,
    combatPursuitSpeed: 2 * 1000 / 30,
    combatAttackDurationMs: 4 * 30,
    combatImpactMs: 0,
    combatHitDurationMs: 3 * 30,
    combatHitRecoilSpeed: 10 * 1000 / 30,
    characterHealth: 6,
    soulPoseDurationMs: 3 * 30,
    soulInitialRiseSpeed: 2 * 1000 / 30,
    soulAccelerationSpeedStep: 1 * 1000 / 30,
    soulAccelerationIntervalMs: 2 * 30,
    soulMaximumRiseSpeed: 20 * 1000 / 30,
    soulLifetimeMs: 200 * 30,
    // Shaman state 3 enters state 5 inside 100 px. State 5 lasts 20 original
    // ticks and returns to idle with a 30-tick timer; there is no extra charge.
    shamanCastDistance: 100,
    shamanCastDurationMs: 20 * 30,
    shamanCastCooldownMs: 30 * 30,
    conversionSpeed: 10 * 1000 / 30,
    conversionRadius: 80,
    conversionRingSparks: 16,
    conversionTravelMs: 12 * 30,
    conversionLifetimeMs: 19 * 30,
    firewarriorConversionChance: 2767 / 32768,
    fireCastDistance: 500,
    fireSpeed: 10 * 1000 / 30,
    fireImpactRadius: 15,
    fireImpactDamage: 2,
    fireLifetimeMs: 31 * 30,
    fireTrailIntervalMs: 2 * 30,
    // The one recovered value in this group: state 14 lasts 8 to 10 ticks.
    firewarriorRecoveryMinMs: 8 * 30,
    firewarriorRecoveryMaxMs: 10 * 30,
    // FUN_00401020 creates the four shamans at (50, 50) and the three mirrored
    // positions width/height minus 50. This is an unscaled world-space inset.
    shamanCornerInset: 50,
    shamanHomeRadius: 30,
    rallyInset: 190,
    formationSlotsPerTribe: 200,
    formationColumns: 8,
    formationSpacing: 20,
    formationHalfWidth: 75,
    formationStartYDivisor: 6,
    formationTranslationDivisor: 3,
    // Armageddon. FUN_00401cd0 spends 201 original ticks in global state 1,
    // placing one table entry per tick, then remains in state 2 until fewer
    // than two tribes still have a non-shaman combatant.
    armageddonIntervalMs: 120000,
    armageddonIntervalMinMs: 60000,
    armageddonIntervalMaxMs: 500000,
    armageddonGatherTicks: 201,
    armageddonRestoreTicks: 2,
    armageddonCelebrationHoldTicks: 40,
    armageddonCelebrationRestoreTicks: 10,
    celebrationPathStartDelayTicks: 7,
    celebrationPathNearSquared: 56,
    armageddonCentreRadius: 70,
    // A shaman in the battle throws at another tribe's shaman rather than
    // converting, alternating fire and lightning.
    shamanBattleCooldownMinMs: 40 * 30,
    shamanBattleCooldownMaxMs: 69 * 30,
    // Lightning, measured at 145.4 s: two or three near-parallel jagged paths
    // spanning 784 px inside a 61 px envelope, held for a quarter of a second.
    lightningDurationMs: 250,
    lightningPathsMin: 2,
    lightningPathsMax: 3,
    lightningPoints: 15,
    lightningSpread: 30,
    // The simulation advances in fixed slices, independent of how often the
    // host manages to call it. Anything longer than maxAccumulatedSeconds is
    // dropped rather than caught up, so a stalled host cannot teleport
    // characters or lock the loop up trying to catch up.
    // The executable advances the complete world from a 30 ms Windows timer.
    stepSeconds: 30 / 1000,
    maxAccumulatedSeconds: 0.25,
    minWorldSize: 64
}

// --- Random source -------------------------------------------------------
//
// Exact Microsoft C runtime generator used at FUN_00417dd0/FUN_00417de0.

function createRandom(seed) {
    var state = (seed >>> 0) || 1

    function nextOriginal() {
        state = (Math.imul(state, 214013) + 2531011) >>> 0
        return (state >>> 16) & 0x7fff
    }

    return {
        seed: state,
        nextOriginal: nextOriginal,
        // Retained for the public deterministic interface. The original only
        // exposes 15 random bits per call.
        nextUint32: function () {
            return nextOriginal()
        },
        // Uniform in [0, 1).
        nextFloat: function () {
            return nextOriginal() / 32768
        },
        // Uniform integer in [0, bound).
        nextInt: function (bound) {
            return Math.floor((nextOriginal() / 32768) * bound)
        },
        pick: function (items) {
            return items[Math.floor((nextOriginal() / 32768) * items.length)]
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

// The point in the world a tribe owns, `inset` pixels in from its corner of
// the bounding box.
//
// The bounding box corner of a multi-screen world can land in a dead zone
// belonging to no monitor, so the result is pulled back into the union the
// same way a stranded character is.
function tribeAnchor(world, tribe, inset) {
    var corner = tribeCorners[tribe]
    if (!corner || world.rects.length === 0) {
        return null
    }
    var bounds = world.bounds
    return clampIntoWorld(
        world,
        corner.x === 0 ? bounds.x + inset : bounds.x + bounds.width - inset,
        corner.y === 0 ? bounds.y + inset : bounds.y + bounds.height - inset,
        { x: inset / 2, top: inset / 2, bottom: tuning.bottomMargin }
    )
}

// Exact table built by FUN_004010c0: 200 points per tribe, eight columns at
// 20 px spacing, rotated around the screen centre and translated sideways by
// one third of the screen height. The original assumes one rectangular GDI
// surface; clampIntoWorld only adapts the resulting point to Plasma dead zones.
function originalFormationSlot(world, tribe, slot) {
    var tribeIndex = tribes.indexOf(tribe)
    if (tribeIndex < 0 || !world || world.rects.length === 0) {
        return null
    }

    var bounds = world.bounds
    var centreX = bounds.x + bounds.width / 2
    var centreY = bounds.y + bounds.height / 2
    var normalizedSlot = Math.max(0, Math.min(
        tuning.formationSlotsPerTribe - 1, slot
    ))
    var column = normalizedSlot % tuning.formationColumns
    var row = Math.floor(normalizedSlot / tuning.formationColumns)
    var x = centreX - tuning.formationHalfWidth
        + column * tuning.formationSpacing
    var y = bounds.y + bounds.height / tuning.formationStartYDivisor
        + row * tuning.formationSpacing
    var angles = [-0.75, 0.75, 2.3, -2.3]
    var translations = [-1, 1, 1, -1]
    var angle = angles[tribeIndex]
    var relativeX = x - centreX
    var relativeY = y - centreY
    var rotatedX = relativeX * Math.cos(angle) - relativeY * Math.sin(angle)
    var rotatedY = relativeX * Math.sin(angle) + relativeY * Math.cos(angle)

    return clampIntoWorld(
        world,
        centreX + rotatedX
            + translations[tribeIndex] * bounds.height
                / tuning.formationTranslationDivisor,
        centreY + rotatedY,
        { x: 0, top: 0, bottom: tuning.bottomMargin }
    )
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

function stateAnimationId(state) {
    // Effects name their own stream: several of them are directionless, and
    // some are tribe-coloured while others are not.
    if (state.animationKey) {
        return state.animationKey
    }
    if (state.entity === entityTypes.soul) {
        if (state.action === actions.depart) {
            return "soul." + state.tribe + ".depart"
        }
        return "soul." + state.tribe + ".rise." + state.directionId
    }
    if (state.action === actions.wave) {
        return "brave." + state.tribe + ".wave"
    }
    // Firewarriors have no hit stream of their own. The original deliberately
    // selects the brave hit cells for them, and the atlas carries no others.
    var entity = state.entity === entityTypes.firewarrior
            && state.action === actions.hit
        ? entityTypes.brave
        : state.entity
    return entity + "." + state.tribe + "." + state.action
        + "." + state.directionId
}

// Whether a character takes part in ordinary combat. Unaligned characters and
// shamans do not, and the atlas agrees: neither has a hit or a soul stream.
function isCombatant(state) {
    return (state.entity === entityTypes.brave
            || state.entity === entityTypes.firewarrior)
        && state.tribe !== unalignedTribe
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
    return random.pick(spawnTribes)
}

function randomWanderInterval(random) {
    return (Math.floor(
        random.nextOriginal() * tuning.roamWaitSpanTicks / 0x7fff
    ) + tuning.roamWaitMinTicks) * tuning.originalTickMs
}

function tribeColor(tribe) {
    return tribeColors[tribe] || "#d0d0d0"
}

// FUN_00413f20 blends the pixel already present in the GDI backing surface.
// Keep the integer truncation explicit: JavaScript's floating-point result is
// otherwise observably different for the state-13 red/green/blue transforms.
function truncateTowardZero(value) {
    return value < 0 ? Math.ceil(value) : Math.floor(value)
}

function blendFootprintChannel(current, background, amount, hasImage, state13,
        channel) {
    current = Math.max(0, Math.min(255, current | 0))
    background = Math.max(0, Math.min(255, background | 0))
    if (state13) {
        var delta = channel === "red" ? current - 255 : current
        return Math.max(0, Math.min(
            255, current + truncateTowardZero(delta / -10)
        ))
    }
    if (!hasImage) {
        return truncateTowardZero(current / (1 + amount * 0.002))
    }
    var divisor = 400 / (amount + 1)
    return Math.max(0, Math.min(
        255, current + truncateTowardZero((background - current) / divisor)
    ))
}

// Caches the frames of the animation matching the character's tribe and
// direction. The state then carries everything the rules need about its
// sprite, which is what lets several views render the same character without
// any of them owning its dimensions.
function resolveAnimation(state) {
    var animation = state.animations
        ? state.animations[stateAnimationId(state)]
        : null

    state.frames = animation && animation.frames ? animation.frames : null
    state.frameCount = state.frames ? state.frames.length : 0
    state.frameDurationMs = animation && animation.frameDurationMs > 0
        ? animation.frameDurationMs
        : tuning.fallbackFrameDurationMs
    state.animationLoop = !animation || animation.loop !== false
}

function setAction(state, action) {
    if (state.action === action) {
        return false
    }
    state.action = action
    state.frameIndex = 0
    state.animationElapsedMs = 0
    resolveAnimation(state)
    return true
}

function setBehaviour(state, behaviour, action) {
    var previous = state.behaviour
    state.behaviour = behaviour
    if (action) {
        setAction(state, action)
    }
    return previous
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
    var length = Math.sqrt(dx * dx + dy * dy)
    if (length > 0) {
        state.headingX = dx / length
        state.headingY = dy / length
    }
    var direction = directionForVector(dx, dy)
    state.directionX = direction.dx
    state.directionY = direction.dy
    state.directionId = direction.id
    state.frameIndex = 0
    state.animationElapsedMs = 0
    resolveAnimation(state)
    return direction
}

function rotateHeading(state, radians) {
    var x = state.headingX
    var y = state.headingY
    var cosine = Math.cos(radians)
    var sine = Math.sin(radians)
    state.headingX = x * cosine - y * sine
    state.headingY = x * sine + y * cosine
    var visual = directionForVector(state.headingX, state.headingY)
    if (visual.id !== state.directionId) {
        state.directionX = visual.dx
        state.directionY = visual.dy
        state.directionId = visual.id
        state.frameIndex = 0
        state.animationElapsedMs = 0
        resolveAnimation(state)
    }
}

function advanceLegacyCounters(state) {
    state.legacyMod11 += 1
    if (state.legacyMod11 > 10) {
        state.legacyMod11 = 0
    }
    state.legacyMod2 += 1
    if (state.legacyMod2 > 1) {
        state.legacyMod2 = 0
    }
    if (state.legacyTimerTicks > 0) {
        state.legacyTimerTicks -= 1
    }
}

// --- Character rules -----------------------------------------------------

// Builds a character state. `animations` is the `animations` object of the
// compiled manifest; the state keeps a reference so it can resolve its own
// frames whenever its tribe or direction changes.
function createCharacter(animations, spriteScale, entity, tribe) {
    var state = {
        id: 0,
        entity: entity || entityTypes.brave,
        action: actions.walk,
        behaviour: behaviours.wander,
        animations: animations,
        tribe: tribe || "blue",
        // A shaman belongs to its tribe for the whole run, so its tribe is not
        // drawn at initialisation.
        tribePinned: !!tribe,
        directionId: "south",
        directionX: 0,
        directionY: 1,
        headingX: 0,
        headingY: 1,
        worldX: 0,
        worldY: 0,
        speed: 0,
        spriteScale: spriteScale > 0 ? spriteScale : 1,
        frameIndex: 0,
        animationElapsedMs: 0,
        footprintElapsedMs: 0,
        footprintSide: -1,
        collisionCooldownMs: 0,
        wanderRemainingMs: 0,
        legacyState: 1,
        legacySubstate: 0,
        legacyTimerTicks: 0,
        legacyMod11: 0,
        legacyMod2: 0,
        legacyTurnTicks: 0,
        legacyTurnRadians: 0,
        formationSlot: -1,
        celebrationPathIndex: 0,
        celebrationFinished: false,
        health: tuning.characterHealth,
        targetId: 0,
        actionRemainingMs: 0,
        attackImpactDone: false,
        castCooldownMs: 0,
        castLaunched: false,
        castSpell: "conversion",
        // Ordinary characters are allocated immediately outside the world in
        // the original. The entry target and saved direction let them walk in
        // without the normal boundary rescue teleporting them into view.
        enteringWorld: false,
        entryTargetX: 0,
        entryTargetY: 0,
        entryDirectionX: 0,
        entryDirectionY: 1,
        initialized: false,
        frames: null,
        frameCount: 0,
        frameDurationMs: tuning.fallbackFrameDurationMs,
        animationLoop: true
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
    // The draw is consumed even for a pinned tribe, so that every character
    // costs the same sequence of values whatever its class. That keeps the
    // contract above true of the whole population rather than per entity type.
    var drawnTribe = randomTribe(random)
    if (!state.tribePinned) {
        state.tribe = drawnTribe
    }
    state.worldX = rect.x + tuning.spawnMarginX
        + random.nextFloat() * Math.max(1, rect.width - tuning.spawnInsetX)
    state.worldY = rect.y + tuning.spawnMarginTop
        + random.nextFloat() * Math.max(1, rect.height - tuning.spawnInsetY)
    state.speed = (tuning.speedMin + random.nextFloat() * (tuning.speedMax - tuning.speedMin))
        * state.spriteScale
    // A shaman belongs to its corner, not to a random spot. The draws above are
    // still consumed, so the sequence stays the same for every class.
    if (state.entity === entityTypes.shaman) {
        var corner = tribeAnchor(world, state.tribe, tuning.shamanCornerInset)
        if (corner) {
            state.worldX = corner.x
            state.worldY = corner.y
        }
    }
    state.footprintElapsedMs = 0
    state.footprintSide = -1
    state.collisionCooldownMs = 0
    state.wanderRemainingMs = 0
    state.legacyState = 1
    state.legacySubstate = 0
    state.legacyTimerTicks = 0
    state.legacyMod11 = Math.floor(random.nextOriginal() * 10 / 0x7fff)
    state.legacyMod2 = Math.floor(random.nextOriginal() * 2 / 0x7fff)
    state.legacyTurnTicks = 0
    state.legacyTurnRadians = 0
    state.formationSlot = -1
    state.celebrationPathIndex = 0
    state.celebrationFinished = false
    state.health = tuning.characterHealth
    state.targetId = 0
    state.actionRemainingMs = 0
    state.attackImpactDone = false
    state.castCooldownMs = 0
    state.castLaunched = false
    state.castSpell = "conversion"
    setBehaviour(state, behaviours.wander, actions.walk)
    setDirection(state, direction.dx, direction.dy)
    if (state.enteringWorld && state.entity !== entityTypes.shaman) {
        state.entryTargetX = state.worldX
        state.entryTargetY = state.worldY
        state.entryDirectionX = direction.dx
        state.entryDirectionY = direction.dy
        var middleX = rect.x + rect.width / 2
        var middleY = rect.y + rect.height / 2
        state.worldX += state.worldX <= middleX ? -rect.width / 2 : rect.width / 2
        state.worldY += state.worldY <= middleY ? -rect.height / 2 : rect.height / 2
        setDirection(
            state,
            state.entryTargetX - state.worldX,
            state.entryTargetY - state.worldY
        )
    }
    state.initialized = true
    return true
}

function createSoul(character, id) {
    var soul = {
        id: id,
        entity: entityTypes.soul,
        action: actions.rise,
        behaviour: behaviours.rise,
        animations: character.animations,
        tribe: character.tribe,
        directionId: character.directionId,
        directionX: 0,
        directionY: -1,
        worldX: character.worldX,
        worldY: character.worldY,
        speed: 0,
        spriteScale: character.spriteScale,
        frameIndex: 0,
        animationElapsedMs: 0,
        phaseRemainingMs: tuning.soulPoseDurationMs,
        lifetimeRemainingMs: 0,
        accelerationRemainingMs: 0,
        initialized: true,
        frames: null,
        frameCount: 0,
        frameDurationMs: tuning.fallbackFrameDurationMs,
        animationLoop: false
    }
    resolveAnimation(soul)
    return soul
}

// The stream each effect kind draws from, and whether it repeats. A travelling
// effect repeats because it outlives its own animation; a one-shot decoration
// plays through and is removed when it ends.
var effectStreams = {
    conversion: { key: "effect.sparkle", loop: true },
    conversion_ring: { key: "effect.sparkle", loop: false },
    flash: { key: "effect.flash", loop: false },
    burst: { key: null, loop: false },
    fire: { key: "effect.fire_trail", loop: true },
    fire_trail: { key: "effect.fire_trail", loop: false },
    fire_impact: { key: "effect.fire_impact", loop: false },
    ring: { key: "effect.ring", loop: false },
    // The one effect with no sprite at all: the original draws it with line
    // primitives, so it carries a path instead of an animation.
    lightning: { key: null, loop: false }
}

// Effects are entities without behaviour of their own beyond a velocity, a
// lifetime and — for the two projectiles — something to do on arrival. They
// share the character shape so a view can render them with the same delegate.
//
// A lifetime of zero means "as long as the animation lasts", which is what a
// one-shot decoration wants.
function createEffect(simulation, options, events) {
    var stream = effectStreams[options.kind]
    var animationKey = stream.key
        ? stream.key
        : (options.kind === effectKinds.lightning
            ? null
            : "particle." + options.tribe + ".burst")
    var effect = {
        id: simulation.nextEntityId++,
        entity: entityTypes.effect,
        kind: options.kind,
        action: options.kind,
        behaviour: options.velocityX || options.velocityY
            ? behaviours.fly
            : behaviours.fade,
        animations: simulation.animations,
        animationKey: animationKey,
        tribe: options.tribe || unalignedTribe,
        directionId: "south",
        directionX: 0,
        directionY: 0,
        worldX: options.worldX,
        worldY: options.worldY,
        velocityX: options.velocityX || 0,
        velocityY: options.velocityY || 0,
        speed: 0,
        spriteScale: options.spriteScale,
        sourceId: options.sourceId || 0,
        targetId: options.targetId || 0,
        lifetimeRemainingMs: options.lifetimeMs || 0,
        emitRemainingMs: options.emitIntervalMs || 0,
        emitIntervalMs: options.emitIntervalMs || 0,
        ageElapsedMs: 0,
        nextConversionScanMs: tuning.conversionTravelMs,
        frameIndex: 0,
        animationElapsedMs: 0,
        initialized: true,
        frames: null,
        frameCount: 0,
        frameDurationMs: tuning.fallbackFrameDurationMs,
        animationLoop: stream.loop
    }
    resolveAnimation(effect)
    // resolveAnimation reads the manifest's own loop flag, which is false for
    // every effect stream. A travelling effect overrides it.
    effect.animationLoop = stream.loop
    if (effect.lifetimeRemainingMs <= 0) {
        effect.lifetimeRemainingMs = effect.frameCount * effect.frameDurationMs
    }
    simulation.entities.push(effect)
    if (events) {
        events.push({
            type: "effect-spawned",
            entityId: effect.id,
            kind: effect.kind,
            tribe: effect.tribe,
            worldX: effect.worldX,
            worldY: effect.worldY
        })
    }
    return effect
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

// Advances the current animation by one slice.
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
        if (state.animationLoop) {
            state.frameIndex = (state.frameIndex + 1) % state.frameCount
        } else {
            state.frameIndex = Math.min(state.frameCount - 1, state.frameIndex + 1)
        }
    }
}

// Advances a character by exactly one fixed slice: movement, edge bouncing,
// footprint decision, walk animation, wander countdown and collision cooldown.
//
// Returns { directionChanged, footprint }. footprint is null or a descriptor
// the caller turns into a visual.
function stepCharacter(state, world, stepSeconds, random, speedOverride) {
    var stepMs = stepSeconds * 1000
    var directionChanged = false

    // Entry state recovered from the original offset-spawn path. It bypasses
    // edge rescue until the complete sprite has crossed into the world.
    if (state.enteringWorld) {
        var entryX = state.entryTargetX - state.worldX
        var entryY = state.entryTargetY - state.worldY
        var entryDistance = Math.sqrt(entryX * entryX + entryY * entryY)
        var entrySpeed = speedOverride > 0 ? speedOverride : state.speed
        var entryStep = entrySpeed * stepSeconds
        if (entryDistance > 0) {
            var entryRatio = Math.min(1, entryStep / entryDistance)
            state.worldX += entryX * entryRatio
            state.worldY += entryY * entryRatio
        }
        advanceAnimation(state, stepMs)

        var entryMargins = {
            x: marginX(state),
            top: marginTop(state),
            bottom: tuning.bottomMargin
        }
        if (worldAllows(world, state.worldX, state.worldY, entryMargins)) {
            state.enteringWorld = false
            setDirection(state, state.entryDirectionX, state.entryDirectionY)
            directionChanged = true
        }
        return { directionChanged: directionChanged, footprint: null }
    }

    var headingX = Number.isFinite(state.headingX)
        ? state.headingX : state.directionX
    var headingY = Number.isFinite(state.headingY)
        ? state.headingY : state.directionY
    var length = Math.sqrt(headingX * headingX + headingY * headingY)
    var normalizedX = length > 0 ? headingX / length : 0
    var normalizedY = length > 0 ? headingY / length : 0
    var movementSpeed = speedOverride > 0 ? speedOverride : state.speed
    var nextX = state.worldX + normalizedX * movementSpeed * stepSeconds
    var nextY = state.worldY + normalizedY * movementSpeed * stepSeconds
    var newDirectionX = normalizedX
    var newDirectionY = normalizedY

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
        nextX = state.worldX + normalizedX * movementSpeed * stepSeconds
        nextY = state.worldY + normalizedY * movementSpeed * stepSeconds
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

    if (newDirectionX !== normalizedX || newDirectionY !== normalizedY) {
        setDirection(state, newDirectionX, newDirectionY)
        directionChanged = true
    }

    var traveledX = nextX - state.worldX
    var traveledY = nextY - state.worldY
    var travelled = Math.sqrt(traveledX * traveledX + traveledY * traveledY)
    var footprint = null
    if (travelled > 0) {
        state.footprintElapsedMs += stepMs
    }
    var footprintStateAllowed = state.legacyState !== 7
        && state.legacyState !== 10 && state.legacyState !== 11
    if (state.footprintElapsedMs >= tuning.footprintIntervalMs
            && footprintStateAllowed) {
        state.footprintElapsedMs %= tuning.footprintIntervalMs
        state.footprintSide = -state.footprintSide
        // FUN_00413f20 writes before the current movement update. Its normal
        // offset is (-3*side*dx + 10, 3*side*dy), over [-1, 1) on both axes.
        var footprintSize = state.legacyState === 13
            ? tuning.footprintSize * 2 : tuning.footprintSize
        var frame = currentFrame(state)
        var baseX = state.worldX + 10
            - 3 * state.footprintSide * normalizedX
        var baseY = state.worldY
            + 3 * state.footprintSide * normalizedY
        var groundX = baseX - footprintSize / 2
        var groundY = baseY - footprintSize / 2
        footprint = {
            groundX: groundX,
            groundY: groundY,
            directionX: normalizedX,
            directionY: normalizedY,
            tribe: state.tribe,
            spriteScale: state.spriteScale,
            size: footprintSize,
            state13: state.legacyState === 13,
            blendAmount: 100,
            sourceX: frame
                ? frame.x + (groundX - state.worldX) / state.spriteScale
                    + frame.anchorX
                : -1,
            sourceY: frame
                ? frame.y + (groundY - state.worldY) / state.spriteScale
                    + frame.anchorY
                : -1
        }
    }

    state.worldX = nextX
    state.worldY = nextY

    advanceAnimation(state, stepMs)

    if (state.collisionCooldownMs > 0) {
        state.collisionCooldownMs = Math.max(0, state.collisionCooldownMs - stepMs)
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
// The configured seconds between Armageddons, clamped to the range the
// configuration pages offer. A host that asks for more than it advertises gets
// the ceiling rather than a value the simulation quietly ignores.
function armageddonInterval(options) {
    var requested = options && options.armageddonIntervalMs > 0
        ? options.armageddonIntervalMs
        : tuning.armageddonIntervalMs
    return Math.max(
        tuning.armageddonIntervalMinMs,
        Math.min(tuning.armageddonIntervalMaxMs, requested)
    )
}

function createSimulation(seed, animations, options) {
    return {
        random: createRandom(seed),
        animations: animations || null,
        characters: [],
        entities: [],
        desiredPopulation: 0,
        populationSpriteScale: 1,
        tribeState: {},
        formationReservations: {},
        combatEnabled: !options || options.combatEnabled !== false,
        armageddon: {
            mode: armageddonModes.normal,
            phaseRemainingMs: armageddonInterval(options),
            intervalMs: armageddonInterval(options),
            originalTickAccumulatorMs: 0,
            gatherIndex: 0,
            formationCounts: {},
            // FUN_004010c0 starts this at one; FUN_00401bd0 increments it
            // modulo eleven at the beginning of every Armageddon. State 3 is
            // therefore deliberately rare rather than the normal ending.
            cycleVariant: 1,
            globalMod51: 0,
            celebrationCompleted: 0,
            celebrationWinner: null
        },
        nextEntityId: 1,
        accumulatedSeconds: 0,
        avoidanceElapsedMs: 0
    }
}

// Starts a world with one shaman per tribe and `count` ordinary characters.
// The original allocates them all immediately, but places ordinary characters
// beyond both screen axes so only the shamans are initially visible.
//
// The shamans are additional rather than taken out of the count: the
// configured number is how many ordinary characters the user asked for, and a
// world with fewer than four of them would otherwise have no conversion at
// all. The original likewise treats its four as separate — its Armageddon
// controller recreates missing "corner entities" independently of the
// population target.
function populate(simulation, count, spriteScale) {
    simulation.characters = []
    simulation.desiredPopulation = count
    simulation.populationSpriteScale = spriteScale > 0 ? spriteScale : 1

    for (var index = 0; index < tribes.length; ++index) {
        var shaman = createCharacter(
            simulation.animations,
            spriteScale,
            entityTypes.shaman,
            tribes[index]
        )
        shaman.id = simulation.nextEntityId++
        simulation.characters.push(shaman)
    }
    for (var ordinary = 0; ordinary < count; ++ordinary) {
        var brave = createCharacter(
            simulation.animations,
            simulation.populationSpriteScale
        )
        brave.id = simulation.nextEntityId++
        brave.enteringWorld = true
        simulation.characters.push(brave)
    }
    return simulation.characters
}

function ordinaryPopulation(characters) {
    var count = 0
    for (var index = 0; index < characters.length; ++index) {
        if (characters[index].entity !== entityTypes.shaman) {
            count += 1
        }
    }
    return count
}

// Immediately allocates every missing ordinary character. It remains visually
// absent until initialisation offsets it beyond the screen and it walks in.
function topUpPopulation(simulation, world, events) {
    // Armageddon is not the moment to be handing out new characters.
    if (simulation.armageddon.mode !== armageddonModes.normal) {
        return
    }
    while (ordinaryPopulation(simulation.characters) < simulation.desiredPopulation) {
        var replacement = createCharacter(
            simulation.animations,
            simulation.populationSpriteScale
        )
        replacement.id = simulation.nextEntityId++
        replacement.enteringWorld = true
        initializeCharacter(replacement, world, simulation.random)
        simulation.characters.push(replacement)
        events.push({ type: "character-spawned", entityId: replacement.id })
    }
}

function findCharacter(simulation, id) {
    for (var index = 0; index < simulation.characters.length; ++index) {
        if (simulation.characters[index].id === id) {
            return simulation.characters[index]
        }
    }
    return null
}

function nearestHostile(simulation, state) {
    var maximum = tuning.combatAcquireDistance * state.spriteScale
    var bestDistance = maximum * maximum
    var best = null

    for (var index = 0; index < simulation.characters.length; ++index) {
        var candidate = simulation.characters[index]
        if (!candidate || candidate === state || !candidate.initialized
                || candidate.enteringWorld
                || candidate.tribe === state.tribe || candidate.health <= 0
                || !isCombatant(candidate)) {
            continue
        }
        var dx = candidate.worldX - state.worldX
        var dy = candidate.worldY - state.worldY
        var distance = dx * dx + dy * dy
        if (distance < bestDistance) {
            bestDistance = distance
            best = candidate
        }
    }
    return best
}

// The nearest character a shaman may convert: an unaligned brave, and nothing
// else. A shaman does not take an already aligned character from another tribe.
function nearestUnaligned(simulation, state) {
    // vfunc_00414650 scans the complete 200-character table and keeps the
    // nearest eligible neutral. Unlike brave combat, there is no distance
    // threshold attached to this search.
    var bestDistance = Infinity
    var best = null

    for (var index = 0; index < simulation.characters.length; ++index) {
        var candidate = simulation.characters[index]
        if (!candidate || !candidate.initialized || candidate.enteringWorld
                || candidate.entity !== entityTypes.brave
                || candidate.tribe !== unalignedTribe) {
            continue
        }
        var dx = candidate.worldX - state.worldX
        var dy = candidate.worldY - state.worldY
        var distance = dx * dx + dy * dy
        if (distance < bestDistance) {
            bestDistance = distance
            best = candidate
        }
    }
    return best
}

function transitionEvent(state, previous) {
    return {
        type: "behaviour-changed",
        entityId: state.id,
        from: previous,
        to: state.behaviour
    }
}

function beginPursuit(state, target, events) {
    state.legacyState = 2
    var previous = setBehaviour(state, behaviours.pursue, actions.walk)
    state.targetId = target.id
    if (previous !== state.behaviour) {
        events.push(transitionEvent(state, previous))
    }
}

function beginAttack(state, target, events) {
    state.legacyState = 6
    var previous = setBehaviour(state, behaviours.attack, actions.kick)
    state.targetId = target.id
    state.actionRemainingMs = tuning.combatAttackDurationMs
    state.attackImpactDone = false
    if (previous !== state.behaviour) {
        events.push(transitionEvent(state, previous))
    }
    events.push({
        type: "attack-started",
        entityId: state.id,
        targetId: target.id,
        sound: "punch"
    })
}

// --- Spells --------------------------------------------------------------

function aimedVelocity(state, target, speed) {
    var dx = target.worldX - state.worldX
    var dy = target.worldY - state.worldY
    var length = Math.sqrt(dx * dx + dy * dy)
    if (length <= 0) {
        return { x: 0, y: -speed }
    }
    return { x: dx / length * speed, y: dy / length * speed }
}

function distanceBetween(state, other) {
    var dx = other.worldX - state.worldX
    var dy = other.worldY - state.worldY
    return Math.sqrt(dx * dx + dy * dy)
}

function castDuration(state) {
    return tuning.shamanCastDurationMs
}

// `spell` is one of conversion, fire or lightning. A shaman converts in
// ordinary play and throws at another tribe's shaman during Armageddon; the
// three share the same three-frame cast animation, which is why the original
// needs no separate pose for them.
var castSounds = {
    conversion: "convert_spell",
    fire: "firecast",
    lightning: "lightning"
}

function beginCast(state, target, events, spell) {
    var previous = setBehaviour(state, behaviours.cast, actions.cast)
    state.targetId = target.id
    state.actionRemainingMs = castDuration(state)
    state.castLaunched = false
    state.castSpell = spell || "conversion"
    if (previous !== state.behaviour) {
        events.push(transitionEvent(state, previous))
    }
    events.push({
        type: "cast-started",
        entityId: state.id,
        targetId: target.id,
        spell: state.castSpell,
        sound: castSounds[state.castSpell]
    })
}

// The nearest shaman of another tribe, which is what a shaman throws at once
// the world is at war. Shamans never close to melee, so the whole exchange
// happens corner to corner across the screen.
function nearestEnemyShaman(simulation, state) {
    var best = null
    var bestDistance = Infinity
    for (var index = 0; index < simulation.characters.length; ++index) {
        var candidate = simulation.characters[index]
        if (candidate === state || candidate.entity !== entityTypes.shaman
                || candidate.tribe === state.tribe || !candidate.initialized) {
            continue
        }
        var distance = distanceBetween(state, candidate)
        if (distance < bestDistance) {
            bestDistance = distance
            best = candidate
        }
    }
    return best
}

function beginFireCast(state, target, events) {
    var previous = setBehaviour(state, behaviours.cast, actions.punch)
    state.targetId = target.id
    state.actionRemainingMs = castDuration(state)
    state.castLaunched = false
    if (previous !== state.behaviour) {
        events.push(transitionEvent(state, previous))
    }
    events.push({
        type: "cast-started",
        entityId: state.id,
        targetId: target.id,
        spell: "fire",
        sound: "firecast"
    })
}

// Turns an unaligned brave into a member of the casting shaman's tribe. A
// share of them arrive as firewarriors instead, which is the only way that
// class enters the world.
function convertCharacter(simulation, character, tribe, events) {
    var becomesFirewarrior =
        simulation.random.nextFloat() < tuning.firewarriorConversionChance

    character.tribe = tribe
    character.entity = becomesFirewarrior
        ? entityTypes.firewarrior
        : entityTypes.brave
    character.health = tuning.characterHealth
    character.targetId = 0
    character.castCooldownMs = 0
    character.legacyState = 0
    character.legacySubstate = 0
    setBehaviour(character, behaviours.wander, actions.walk)
    // The tribe and class both changed, and setBehaviour only re-resolves the
    // animation when the action changes — which it did not.
    resolveAnimation(character)

    createEffect(simulation, {
        kind: effectKinds.flash,
        worldX: character.worldX,
        worldY: character.worldY,
        spriteScale: character.spriteScale,
        tribe: tribe
    }, events)
    createEffect(simulation, {
        kind: effectKinds.burst,
        worldX: character.worldX,
        worldY: character.worldY,
        spriteScale: character.spriteScale,
        tribe: tribe
    }, events)

    events.push({
        type: "converted",
        entityId: character.id,
        tribe: tribe,
        entity: character.entity,
        sound: "convert"
    })
}

// The conversion projectile reaching its destination.
//
// A ring of sparkles blooms at the radius the spell reaches, and every
// unaligned brave inside it changes tribe — not only the one it was aimed at.
// The ring is the visible boundary of the zone, so it is drawn at exactly the
// radius the rule uses rather than at a decorative one.
//
// The sparkles are placed at once but started at staggered frames. That is
// what produces the travelling-around-the-circle look in the original without
// any per-sparkle delay to carry in the state.
function applyConversion(simulation, effect, events, decorate) {
    var radius = tuning.conversionRadius * effect.spriteScale
    var sparks = tuning.conversionRingSparks

    for (var spark = 0; decorate && spark < sparks; ++spark) {
        var angle = 2 * Math.PI * spark / sparks
        var ringSpark = createEffect(simulation, {
            kind: effectKinds.conversionRing,
            worldX: effect.worldX + Math.cos(angle) * radius,
            // The world is drawn in a shallow perspective, so the ring reads as
            // an ellipse on the ground rather than a circle facing the viewer.
            worldY: effect.worldY + Math.sin(angle) * radius * 0.6,
            spriteScale: effect.spriteScale,
            tribe: effect.tribe
        }, events)
        if (ringSpark.frameCount > 0) {
            ringSpark.frameIndex = spark % ringSpark.frameCount
        }
    }

    for (var index = 0; index < simulation.characters.length; ++index) {
        var character = simulation.characters[index]
        if (!character || !character.initialized
                || character.entity !== entityTypes.brave
                || character.tribe !== unalignedTribe) {
            continue
        }
        if (distanceBetween(effect, character) <= radius) {
            convertCharacter(simulation, character, effect.tribe, events)
        }
    }
}

// The fire projectile landing. It damages hostile combatants in its radius;
// shamans and unaligned characters are untouched, which is what the original's
// non-shaman test and the absence of a neutral hit stream both say.
function applyFireImpact(simulation, effect, events) {
    createEffect(simulation, {
        kind: effectKinds.fireImpact,
        worldX: effect.worldX,
        worldY: effect.worldY,
        spriteScale: effect.spriteScale
    }, events)
    createEffect(simulation, {
        kind: effectKinds.ring,
        worldX: effect.worldX,
        worldY: effect.worldY,
        spriteScale: effect.spriteScale
    }, events)

    var caster = findCharacter(simulation, effect.sourceId)
    var radius = tuning.fireImpactRadius * effect.spriteScale
    for (var index = 0; index < simulation.characters.length; ++index) {
        var character = simulation.characters[index]
        if (!character || !character.initialized || !isCombatant(character)
                || character.tribe === effect.tribe || character.health <= 0) {
            continue
        }
        if (distanceBetween(effect, character) > radius) {
            continue
        }
        for (var hit = 0; hit < tuning.fireImpactDamage; ++hit) {
            if (character.health > 0) {
                receiveHit(character, caster || character, events)
            }
        }
    }
}

// A shaman: seek an unaligned brave, pause, cast, then wait out its cooldown.
// It is never a combat target and has no hit or death states.
function launchShamanSpell(simulation, state, target, events) {
    if (state.castSpell === "lightning") {
        var bolt = createEffect(simulation, {
            kind: effectKinds.lightning,
            worldX: state.worldX,
            worldY: state.worldY,
            spriteScale: state.spriteScale,
            tribe: state.tribe,
            sourceId: state.id,
            lifetimeMs: tuning.lightningDurationMs
        }, events)
        bolt.paths = lightningPaths(
            simulation, state.worldX, state.worldY, target.worldX, target.worldY
        )
        return
    }

    var ranged = state.castSpell === "fire"
    var velocity = aimedVelocity(
        state,
        target,
        (ranged ? tuning.fireSpeed : tuning.conversionSpeed) * state.spriteScale
    )
    createEffect(simulation, {
        kind: ranged ? effectKinds.fire : effectKinds.conversion,
        worldX: state.worldX,
        worldY: state.worldY,
        velocityX: velocity.x,
        velocityY: velocity.y,
        spriteScale: state.spriteScale,
        tribe: state.tribe,
        sourceId: state.id,
        targetId: target.id,
        lifetimeMs: ranged ? tuning.fireLifetimeMs : tuning.conversionLifetimeMs,
        emitIntervalMs: ranged ? tuning.fireTrailIntervalMs : 0
    }, events)
}

function stepShaman(simulation, state, world, events) {
    var stepMs = tuning.stepSeconds * 1000

    if (state.castCooldownMs > 0) {
        state.castCooldownMs = Math.max(0, state.castCooldownMs - stepMs)
    }

    if (state.behaviour === behaviours.cast) {
        advanceAnimation(state, stepMs)
        state.actionRemainingMs = Math.max(0, state.actionRemainingMs - stepMs)
        if (state.actionRemainingMs <= 0) {
            var castTarget = findCharacter(simulation, state.targetId)
            if (!state.castLaunched && castTarget) {
                state.castLaunched = true
                launchShamanSpell(simulation, state, castTarget, events)
            }
            state.castCooldownMs = state.castSpell === "conversion"
                ? tuning.shamanCastCooldownMs
                : tuning.shamanBattleCooldownMinMs + simulation.random.nextInt(
                    tuning.shamanBattleCooldownMaxMs
                        - tuning.shamanBattleCooldownMinMs + 1
                )
            state.targetId = 0
            var done = setBehaviour(state, behaviours.seek, actions.walk)
            events.push(transitionEvent(state, done))
        }
        return null
    }

    var mode = simulation.armageddon.mode
    if (mode === armageddonModes.battle) {
        // The shamans do not join the melee. They hold their corners and throw
        // at each other over the top of it.
        if (state.castCooldownMs <= 0) {
            var enemy = nearestEnemyShaman(simulation, state)
            if (enemy) {
                setDirection(state, enemy.worldX - state.worldX,
                    enemy.worldY - state.worldY)
                beginCast(state, enemy, events,
                    simulation.random.nextFloat() < 0.7 ? "fire" : "lightning")
                return null
            }
        }
        var waiting = setBehaviour(state, behaviours.wander, actions.idle)
        if (waiting !== state.behaviour) {
            events.push(transitionEvent(state, waiting))
        }
        advanceAnimation(state, stepMs)
        return null
    }

    var target = state.castCooldownMs > 0
        ? null
        : nearestUnaligned(simulation, state)

    if (target) {
        if (state.behaviour !== behaviours.seek) {
            var began = setBehaviour(state, behaviours.seek, actions.walk)
            events.push(transitionEvent(state, began))
        }
        state.targetId = target.id
        var dx = target.worldX - state.worldX
        var dy = target.worldY - state.worldY
        if (Math.sqrt(dx * dx + dy * dy)
                <= tuning.shamanCastDistance * state.spriteScale) {
            setDirection(state, dx, dy)
            beginCast(state, target, events)
            return null
        }
        var heading = directionForVector(dx, dy)
        if (heading.id !== state.directionId) {
            setDirection(state, heading.dx, heading.dy)
        }
        state.wanderRemainingMs = Math.max(state.wanderRemainingMs, stepMs * 2)
    } else {
        // Nothing to convert, so it goes home. A shaman belongs to its corner
        // and drifts back to it rather than wandering off across the world.
        state.targetId = 0
        var home = tribeAnchor(world, state.tribe, tuning.shamanCornerInset)
        if (home) {
            var toX = home.x - state.worldX
            var toY = home.y - state.worldY
            if (Math.sqrt(toX * toX + toY * toY)
                    <= tuning.shamanHomeRadius * state.spriteScale) {
                var settled = setBehaviour(state, behaviours.wander, actions.idle)
                if (settled !== state.behaviour) {
                    events.push(transitionEvent(state, settled))
                }
                advanceAnimation(state, stepMs)
                return null
            }
            var walking = setBehaviour(state, behaviours.wander, actions.walk)
            if (walking !== state.behaviour) {
                events.push(transitionEvent(state, walking))
            }
            var homeward = directionForVector(toX, toY)
            if (homeward.id !== state.directionId) {
                setDirection(state, homeward.dx, homeward.dy)
            }
            state.wanderRemainingMs = Math.max(state.wanderRemainingMs, stepMs * 2)
        }
    }

    return stepCharacter(
        state,
        world,
        tuning.stepSeconds,
        simulation.random,
        target ? tuning.combatPursuitSpeed * state.spriteScale : 0
    )
}

function receiveHit(state, attacker, events) {
    state.legacyState = 7
    state.health = Math.max(0, state.health - 1)
    var previous = setBehaviour(state, behaviours.hit, actions.hit)
    state.targetId = attacker.id
    state.actionRemainingMs = tuning.combatHitDurationMs
    if (previous !== state.behaviour) {
        events.push(transitionEvent(state, previous))
    }
    events.push({
        type: "hit",
        entityId: state.id,
        attackerId: attacker.id,
        health: state.health
    })
}

function footprintEvent(footprint, entityId) {
    footprint.type = "footprint"
    footprint.entityId = entityId
    return footprint
}

// --- Armageddon ----------------------------------------------------------

// The 84 state-13 waypoints written by FUN_00402e90. The executable translates
// this 500 x 100 drawing around the screen centre, then appends one exit point
// twenty pixels from the right edge. Keeping the literal table here makes the
// celebration independently testable and avoids inventing a replacement path.
var celebrationPath = [
    [10,84],[23,16],[35,12],[46,14],[55,19],[58,32],[51,44],[39,53],
    [15,55],[96,35],[107,40],[113,52],[109,71],[98,79],[83,81],[71,71],
    [70,59],[73,48],[83,39],[95,37],[108,38],[124,48],[137,44],[131,109],
    [142,44],[157,36],[169,34],[178,41],[179,55],[174,68],[165,77],[151,80],
    [136,75],[205,19],[205,29],[198,69],[201,78],[214,80],[218,75],[243,33],
    [243,13],[243,33],[235,77],[256,77],[294,14],[287,8],[282,19],[282,75],
    [285,79],[330,35],[340,38],[348,43],[351,55],[347,68],[338,79],[325,82],
    [311,77],[307,64],[310,52],[317,43],[330,36],[339,37],[382,36],[377,33],
    [377,69],[379,78],[389,79],[399,77],[421,34],[424,14],[421,34],[414,74],
    [434,74],[465,31],[475,31],[495,31],[475,31],[465,31],[455,45],[464,54],
    [471,69],[471,77],[460,81],[450,81]
]

function celebrationPoint(world, index) {
    var bounds = world.bounds
    if (index >= celebrationPath.length) {
        var last = celebrationPath[celebrationPath.length - 1]
        return {
            x: bounds.x + bounds.width - 20,
            y: bounds.y + bounds.height / 2 - 50 + last[1]
        }
    }
    var point = celebrationPath[index]
    return {
        x: bounds.x + bounds.width / 2 - 250 + point[0],
        y: bounds.y + bounds.height / 2 - 50 + point[1]
    }
}

function beginArmageddon(simulation, events) {
    // FUN_00401bd0 assigns every still-neutral entry a random tribe. It does
    // not balance the four populations; the near-even capture was incidental.
    simulation.armageddon.cycleVariant =
        (simulation.armageddon.cycleVariant + 1) % 11
    var conscripted = 0
    for (var index = 0; index < simulation.characters.length; ++index) {
        var character = simulation.characters[index]
        if (character.entity !== entityTypes.brave
                || character.tribe !== unalignedTribe) {
            continue
        }
        character.tribe = simulation.random.pick(tribes)
        conscripted += 1
        character.health = tuning.characterHealth
        resolveAnimation(character)
        events.push({
            type: "conscripted",
            entityId: character.id,
            tribe: character.tribe
        })
    }

    simulation.armageddon.mode = armageddonModes.gather
    simulation.armageddon.phaseRemainingMs =
        tuning.armageddonGatherTicks * tuning.originalTickMs
    simulation.armageddon.originalTickAccumulatorMs = 0
    simulation.armageddon.gatherIndex = 0
    simulation.armageddon.formationCounts = {
        blue: 0, red: 0, yellow: 0, green: 0
    }
    events.push({ type: "armageddon-started", conscripted: conscripted })
}

function placeNextArmageddonCharacter(simulation, world) {
    var armageddon = simulation.armageddon
    if (armageddon.gatherIndex >= simulation.characters.length) {
        return
    }
    var character = simulation.characters[armageddon.gatherIndex++]
    if (!character || character.entity === entityTypes.shaman
            || tribes.indexOf(character.tribe) < 0) {
        return
    }
    var slot = armageddon.formationCounts[character.tribe]
    armageddon.formationCounts[character.tribe] = Math.min(
        tuning.formationSlotsPerTribe - 1, slot + 1
    )
    var point = originalFormationSlot(world, character.tribe, slot)
    if (point) {
        character.worldX = point.x
        character.worldY = point.y
    }
    character.health = tuning.characterHealth
    character.targetId = 0
    character.legacyState = 9
    character.legacySubstate = 4
    character.formationSlot = slot
    setBehaviour(character, behaviours.muster, actions.stand)
}

function fightingTribeCount(simulation) {
    var alive = {}
    for (var index = 0; index < simulation.characters.length; ++index) {
        var character = simulation.characters[index]
        if (character && character.initialized && character.health > 0
                && character.entity !== entityTypes.shaman
                && isCombatant(character)) {
            alive[character.tribe] = true
        }
    }
    return Object.keys(alive).length
}

function soleFightingTribe(simulation) {
    var winner = null
    for (var index = 0; index < simulation.characters.length; ++index) {
        var character = simulation.characters[index]
        if (!character || character.entity === entityTypes.shaman
                || !isCombatant(character) || character.health <= 0) {
            continue
        }
        if (winner !== null && winner !== character.tribe) {
            return null
        }
        winner = character.tribe
    }
    return winner
}

function beginArmageddonCelebration(simulation, world, winner, events) {
    var shamans = []
    for (var index = 0; index < simulation.characters.length; ++index) {
        var character = simulation.characters[index]
        if (character.entity === entityTypes.shaman) {
            shamans.push(character)
        } else {
            events.push({ type: "character-removed", entityId: character.id })
        }
    }
    simulation.characters = shamans
    simulation.entities = []
    simulation.armageddon.mode = armageddonModes.celebration
    simulation.armageddon.phaseRemainingMs =
        tuning.armageddonCelebrationHoldTicks * tuning.originalTickMs
    simulation.armageddon.celebrationCompleted = 0
    simulation.armageddon.celebrationWinner = winner

    var count = Math.floor(simulation.desiredPopulation / 2)
    for (index = 0; index < count; ++index) {
        var wave = createCharacter(
            simulation.animations, simulation.populationSpriteScale,
            entityTypes.brave, winner
        )
        wave.id = simulation.nextEntityId++
        wave.initialized = true
        wave.legacyState = 13
        wave.legacySubstate = 0
        wave.celebrationPathIndex = 0
        wave.celebrationFinished = false
        wave.worldX = world.bounds.x + index * -6
        wave.worldY = world.bounds.y + world.bounds.height / 2
        wave.speed = 2 * 1000 / tuning.originalTickMs
            * wave.spriteScale
        setDirection(wave, 0.75, 0.75)
        setBehaviour(wave, behaviours.muster, actions.wave)
        simulation.characters.push(wave)
        events.push({
            type: "celebration-character-spawned",
            entityId: wave.id,
            tribe: winner
        })
    }
    events.push({
        type: "armageddon-phase",
        phase: armageddonModes.celebration,
        winner: winner,
        population: count
    })
}

function resetCelebrationPaths(simulation) {
    simulation.armageddon.celebrationCompleted = 0
    for (var index = 0; index < simulation.characters.length; ++index) {
        var character = simulation.characters[index]
        if (character.legacyState === 13) {
            character.legacySubstate = 0
            character.celebrationPathIndex = 0
            character.celebrationFinished = false
        }
    }
}

function reservationTable(simulation, tribe) {
    if (!simulation.formationReservations[tribe]) {
        simulation.formationReservations[tribe] = new Array(
            tuning.formationSlotsPerTribe
        ).fill(false)
    }
    return simulation.formationReservations[tribe]
}

function reserveFormationSlot(simulation, state) {
    var table = reservationTable(simulation, state.tribe)
    for (var index = 0; index < table.length; ++index) {
        if (!table[index]) {
            table[index] = true
            state.formationSlot = index
            return index
        }
    }
    return -1
}

function releaseFormationSlot(simulation, state) {
    if (state.formationSlot < 0) {
        return
    }
    var table = reservationTable(simulation, state.tribe)
    if (state.formationSlot < table.length) {
        table[state.formationSlot] = false
    }
    state.formationSlot = -1
}

function tribeCounts(simulation) {
    var counts = { blue: 0, red: 0, yellow: 0, green: 0 }
    for (var index = 0; index < simulation.characters.length; ++index) {
        var state = simulation.characters[index]
        if (state && counts[state.tribe] !== undefined
                && state.entity !== entityTypes.shaman && state.health > 0) {
            counts[state.tribe] += 1
        }
    }
    return counts
}

function groupTargetTribe(simulation, ownTribe) {
    var counts = tribeCounts(simulation)
    var selected = null
    for (var index = 0; index < tribes.length; ++index) {
        var tribe = tribes[index]
        if (counts[tribe] > 0
                && (selected === null || counts[tribe] > counts[selected])) {
            selected = tribe
        }
    }
    if (selected !== ownTribe) {
        return selected
    }
    selected = null
    for (index = 0; index < tribes.length; ++index) {
        tribe = tribes[index]
        if (tribe !== ownTribe && counts[tribe] > 0
                && (selected === null || counts[tribe] < counts[selected])) {
            selected = tribe
        }
    }
    return selected
}

function nearestGroupTarget(simulation, state, targetTribe, bypassRandomGate) {
    var best = null
    var bestSquared = 0
    for (var index = 0; index < simulation.characters.length; ++index) {
        var candidate = simulation.characters[index]
        if (!candidate || candidate === state || candidate.tribe !== targetTribe
                || !isCombatant(candidate) || candidate.health <= 0
                || candidate.enteringWorld) {
            continue
        }
        var dx = candidate.worldX - state.worldX
        var dy = candidate.worldY - state.worldY
        var squared = dx * dx + dy * dy
        if ((best === null || squared < bestSquared)
                && squared < tuning.groupTargetDistanceSquared
                && (bypassRandomGate
                    || simulation.random.nextOriginal()
                        > tuning.targetGateThreshold)) {
            best = candidate
            bestSquared = squared
        }
    }
    return best
}

function beginLegacyPursuit(state, target, events, substate) {
    state.legacyState = 2
    state.legacySubstate = substate || 0
    if (target) {
        beginPursuit(state, target, events)
    } else {
        var previous = setBehaviour(state, behaviours.pursue, actions.walk)
        state.targetId = 0
        if (previous !== state.behaviour) {
            events.push(transitionEvent(state, previous))
        }
    }
}

function launchFormationGroup(simulation, leader, events) {
    var targetTribe = groupTargetTribe(simulation, leader.tribe)
    if (!targetTribe) {
        leader.legacyTimerTicks = 30
        return false
    }
    var target = nearestGroupTarget(simulation, leader, targetTribe)
    if (!target) {
        leader.legacyTimerTicks = 30
        return false
    }

    releaseFormationSlot(simulation, leader)
    beginLegacyPursuit(leader, target, events, 9)
    var followers = 0
    for (var index = 0; index < simulation.characters.length
            && followers < tuning.groupFollowerLimit; ++index) {
        var candidate = simulation.characters[index]
        if (!candidate || candidate === leader
                || candidate.entity !== entityTypes.brave
                || candidate.tribe !== leader.tribe
                || candidate.legacyState !== 9
                || candidate.legacySubstate !== 4) {
            continue
        }
        var followerTarget = nearestGroupTarget(simulation, candidate, targetTribe)
        if (!followerTarget) {
            continue
        }
        releaseFormationSlot(simulation, candidate)
        beginLegacyPursuit(candidate, followerTarget, events, 9)
        followers += 1
    }
    events.push({
        type: "war-party-launched",
        entityId: leader.id,
        tribe: leader.tribe,
        targetTribe: targetTribe,
        followers: followers
    })
    return true
}

function stepArmageddon(simulation, world, events) {
    var armageddon = simulation.armageddon
    var stepMs = tuning.stepSeconds * 1000

    if (armageddon.mode === armageddonModes.normal) {
        armageddon.phaseRemainingMs -= stepMs
        if (armageddon.phaseRemainingMs <= 0) {
            beginArmageddon(simulation, events)
        }
        return
    }

    if (armageddon.mode === armageddonModes.gather) {
        armageddon.phaseRemainingMs -= stepMs
        armageddon.originalTickAccumulatorMs += stepMs
        while (armageddon.originalTickAccumulatorMs >= tuning.originalTickMs) {
            armageddon.originalTickAccumulatorMs -= tuning.originalTickMs
            placeNextArmageddonCharacter(simulation, world)
        }
        if (armageddon.phaseRemainingMs <= 0) {
            armageddon.mode = armageddonModes.battle
            armageddon.phaseRemainingMs = 0
            events.push({ type: "armageddon-phase", phase: armageddon.mode })
        }
        return
    }

    if (armageddon.mode === armageddonModes.battle) {
        var remainingTribes = fightingTribeCount(simulation)
        if (remainingTribes < 2) {
            var winner = remainingTribes === 1
                ? soleFightingTribe(simulation) : null
            if (winner && armageddon.cycleVariant === 1) {
                beginArmageddonCelebration(
                    simulation, world, winner, events
                )
            } else {
                armageddon.mode = armageddonModes.restore
                armageddon.phaseRemainingMs =
                    tuning.armageddonRestoreTicks * tuning.originalTickMs
                events.push({ type: "armageddon-phase", phase: armageddon.mode })
            }
        }
        return
    }

    if (armageddon.mode === armageddonModes.celebration) {
        var expected = Math.floor(simulation.desiredPopulation / 2)
        if (armageddon.celebrationCompleted < expected) {
            return
        }
        armageddon.phaseRemainingMs -= stepMs
        if (armageddon.phaseRemainingMs <= 0) {
            armageddon.mode = armageddonModes.celebrationRestore
            armageddon.phaseRemainingMs = tuning.originalTickMs
            resetCelebrationPaths(simulation)
            events.push({
                type: "armageddon-phase",
                phase: armageddon.mode,
                winner: armageddon.celebrationWinner
            })
        }
        return
    }

    if (armageddon.mode === armageddonModes.celebrationRestore) {
        armageddon.phaseRemainingMs -= stepMs
        if (armageddon.phaseRemainingMs <= 0) {
            armageddon.mode = armageddonModes.restore
            armageddon.phaseRemainingMs =
                tuning.armageddonCelebrationRestoreTicks
                    * tuning.originalTickMs
            events.push({ type: "armageddon-phase", phase: armageddon.mode })
        }
        return
    }

    if (armageddon.mode === armageddonModes.restore) {
        armageddon.phaseRemainingMs -= stepMs
        if (armageddon.phaseRemainingMs > 0) {
            return
        }
        armageddon.mode = armageddonModes.normal
        armageddon.phaseRemainingMs = armageddon.intervalMs
        simulation.formationReservations = {}
        if (armageddon.celebrationWinner) {
            var ordinarySurvivors = []
            for (var remove = 0; remove < simulation.characters.length; ++remove) {
                var ending = simulation.characters[remove]
                if (ending.legacyState === 13) {
                    events.push({
                        type: "character-removed", entityId: ending.id
                    })
                } else {
                    ordinarySurvivors.push(ending)
                }
            }
            simulation.characters = ordinarySurvivors
            armageddon.celebrationWinner = null
        }
        for (var reset = 0; reset < simulation.characters.length; ++reset) {
            var survivor = simulation.characters[reset]
            survivor.targetId = 0
            if (survivor.entity !== entityTypes.shaman && survivor.health > 0) {
                setBehaviour(survivor, behaviours.wander, actions.walk)
            }
        }
        events.push({ type: "armageddon-ended" })
    }
}

// The bolt: two or three jagged paths between two points, generated once and
// then held still. It has no sprite, so the renderer draws these points with
// line primitives the way the original does.
function lightningPaths(simulation, fromX, fromY, toX, toY) {
    var count = tuning.lightningPathsMin
        + simulation.random.nextInt(
            tuning.lightningPathsMax - tuning.lightningPathsMin + 1
        )
    var spanX = toX - fromX
    var spanY = toY - fromY
    var length = Math.sqrt(spanX * spanX + spanY * spanY)
    // The jitter is applied across the bolt, not along it, which is what keeps
    // the whole thing inside a narrow envelope however long it is.
    var acrossX = length > 0 ? -spanY / length : 1
    var acrossY = length > 0 ? spanX / length : 0
    var paths = []

    for (var path = 0; path < count; ++path) {
        var points = []
        for (var point = 0; point < tuning.lightningPoints; ++point) {
            var along = point / (tuning.lightningPoints - 1)
            // The ends are pinned: a bolt that missed its target at either end
            // would read as a stray scratch rather than a strike.
            var edge = along === 0 || along === 1 ? 0 : 1
            var offset = (simulation.random.nextFloat() - 0.5)
                * tuning.lightningSpread * edge
            points.push({
                x: fromX + spanX * along + acrossX * offset,
                y: fromY + spanY * along + acrossY * offset
            })
        }
        paths.push(points)
    }
    return paths
}

// Armageddon placement is performed centrally, one table entry per original
// tick. Ordinary aligned characters do not continuously march to a corner:
// that was a modern approximation, not behaviour present in the executable.
function enterLegacyRoam(state, events) {
    state.legacyState = 0
    state.legacySubstate = 0
    var previous = setBehaviour(state, behaviours.wander, actions.walk)
    if (previous !== state.behaviour) {
        events.push(transitionEvent(state, previous))
    }
}

function enterLegacyWait(state, ticks, events) {
    state.legacyState = 1
    state.legacySubstate = 0
    state.legacyTimerTicks = ticks
    var previous = setBehaviour(state, behaviours.wander, actions.stand)
    if (previous !== state.behaviour) {
        events.push(transitionEvent(state, previous))
    }
}

function enterLegacyFormation(state, events) {
    state.legacyState = 9
    state.legacySubstate = 0
    state.formationSlot = -1
    state.targetId = 0
    var previous = setBehaviour(state, behaviours.muster, actions.walk)
    if (previous !== state.behaviour) {
        events.push(transitionEvent(state, previous))
    }
}

function stepCelebrationCharacter(simulation, state, world) {
    var armageddon = simulation.armageddon
    var stepMs = tuning.originalTickMs
    if (state.celebrationFinished) {
        advanceAnimation(state, stepMs)
        return null
    }
    // State 13 waits for the world's modulo-51 counter to reach seven. Global
    // state 4 bypasses that gate for its single final repaint/update.
    if (armageddon.mode !== armageddonModes.celebrationRestore
            && armageddon.globalMod51 < tuning.celebrationPathStartDelayTicks) {
        advanceAnimation(state, stepMs)
        return null
    }

    var point = celebrationPoint(world, state.celebrationPathIndex)
    var dx = point.x - state.worldX
    var dy = point.y - state.worldY
    var squared = dx * dx + dy * dy
    if (squared <= 28) {
        state.worldX = point.x
        state.worldY = point.y
        state.celebrationPathIndex += 1
        if (state.celebrationPathIndex > celebrationPath.length) {
            state.celebrationFinished = true
            state.legacySubstate = 4
            state.speed = 0
            setDirection(state, 0, 1)
            armageddon.celebrationCompleted += 1
            advanceAnimation(state, stepMs)
            return null
        }
        point = celebrationPoint(world, state.celebrationPathIndex)
        dx = point.x - state.worldX
        dy = point.y - state.worldY
        squared = dx * dx + dy * dy
    }
    setDirection(state, dx, dy)
    var pixelsPerTick = squared <= tuning.celebrationPathNearSquared ? 1 : 2
    return stepCharacter(
        state, world, tuning.stepSeconds, simulation.random,
        pixelsPerTick * 1000 / tuning.originalTickMs * state.spriteScale
    )
}

function stepLegacyRoam(simulation, state, world, events) {
    var random = simulation.random
    var stepMs = tuning.originalTickMs

    if (state.legacyState === 8) {
        advanceAnimation(state, stepMs)
        if (state.legacyTimerTicks <= 0) {
            if (state.legacySubstate === 9) {
                state.legacyState = 9
                state.legacySubstate = 4
                setBehaviour(state, behaviours.muster, actions.stand)
            } else {
                beginLegacyPursuit(state, null, events, 0)
            }
        }
        return null
    }

    if (state.legacyState === 9) {
        if (state.formationSlot < 0
                && reserveFormationSlot(simulation, state) < 0) {
            enterLegacyRoam(state, events)
            return null
        }
        if (state.legacySubstate === 4) {
            advanceAnimation(state, stepMs)
            if (state.legacyTimerTicks > 0) {
                return null
            }
            var groupGate = random.nextOriginal()
            if (groupGate >= tuning.groupDecisionThreshold
                    && state.legacyMod11 === 0) {
                state.legacyState = 8
                state.legacySubstate = 9
                state.legacyTimerTicks = tuning.scratchTicks
                setBehaviour(state, behaviours.wander, actions.scratch)
                return null
            }
            if (simulation.armageddon.mode === armageddonModes.battle) {
                var opponents = {
                    blue: "yellow", red: "green",
                    yellow: "blue", green: "red"
                }
                var battleTarget = nearestGroupTarget(
                    simulation, state, opponents[state.tribe], true
                )
                if (battleTarget) {
                    releaseFormationSlot(simulation, state)
                    beginLegacyPursuit(state, battleTarget, events, 0)
                }
                return null
            }
            if (random.nextOriginal() > tuning.groupLaunchThreshold
                    && state.legacyMod11 === 0
                    && simulation.armageddon.mode === armageddonModes.normal) {
                launchFormationGroup(simulation, state, events)
            }
            return null
        }

        var slot = originalFormationSlot(world, state.tribe, state.formationSlot)
        if (!slot) {
            releaseFormationSlot(simulation, state)
            enterLegacyRoam(state, events)
            return null
        }
        var slotX = slot.x - state.worldX
        var slotY = slot.y - state.worldY
        var slotSquared = slotX * slotX + slotY * slotY
        if (slotSquared <= 28) {
            state.legacySubstate = 4
            state.legacyTimerTicks = tuning.formationWaitTicks
            setBehaviour(state, behaviours.muster, actions.stand)
            advanceAnimation(state, stepMs)
            return null
        }
        setDirection(state, slotX, slotY)
        return stepCharacter(
            state, world, tuning.stepSeconds, random,
            tuning.combatPursuitSpeed * state.spriteScale
        )
    }

    if (state.legacyState === 1) {
        advanceAnimation(state, stepMs)
        if (state.legacyTimerTicks > 0
                || random.nextOriginal() < tuning.idleDecisionThreshold) {
            return null
        }
        if (state.tribe === unalignedTribe) {
            enterLegacyRoam(state, events)
            state.legacyTimerTicks = Math.floor(
                random.nextOriginal() * tuning.neutralRoamLockSpanTicks / 0x7fff
            ) + tuning.neutralRoamLockMinTicks
            return null
        }

        var actionGate = random.nextOriginal()
        if (actionGate < tuning.groupDecisionThreshold
                || state.legacyMod11 !== 0) {
            if (random.nextOriginal() < tuning.directCombatThreshold
                    || simulation.armageddon.mode === armageddonModes.battle) {
                beginLegacyPursuit(state, null, events, 0)
            } else {
                enterLegacyFormation(state, events)
            }
        } else {
            state.legacyState = 8
            state.legacySubstate = 0
            state.legacyTimerTicks = tuning.scratchTicks
            setBehaviour(state, behaviours.wander, actions.scratch)
        }
        return null
    }

    var moved = stepCharacter(state, world, tuning.stepSeconds, random)
    var wasTurning = state.legacyTurnTicks > 0
    if (wasTurning) {
        rotateHeading(state, state.legacyTurnRadians)
        state.legacyTurnTicks -= 1
    } else if (state.legacyMod11 === 0
            && random.nextOriginal() > 22000) {
        state.legacyTurnRadians = random.nextOriginal() < 0x4001 ? -0.1 : 0.1
        state.legacyTurnTicks = 20
    }
    if (!wasTurning && state.legacyTurnTicks === 0 && state.legacyTimerTicks === 0
            && random.nextOriginal() >= tuning.idleDecisionThreshold) {
        var waitTicks = Math.floor(
            random.nextOriginal() * tuning.roamWaitSpanTicks / 0x7fff
        ) + tuning.roamWaitMinTicks
        enterLegacyWait(state, waitTicks, events)
    }
    return moved
}

function acquireLegacyTarget(simulation, state) {
    if (state.legacyTimerTicks > 0 || state.legacyMod11 !== 0) {
        return null
    }
    var best = null
    var bestSquared = 0
    for (var index = 0; index < simulation.characters.length; ++index) {
        var candidate = simulation.characters[index]
        if (!candidate || candidate === state || !isCombatant(candidate)
                || candidate.tribe === state.tribe || candidate.health <= 0
                || candidate.enteringWorld) {
            continue
        }
        var dx = candidate.worldX - state.worldX
        var dy = candidate.worldY - state.worldY
        var squared = dx * dx + dy * dy
        if ((best === null || squared < bestSquared)
                && squared < tuning.combatAcquireDistance
                    * tuning.combatAcquireDistance
                && (simulation.armageddon.mode !== armageddonModes.normal
                    || simulation.random.nextOriginal()
                        > tuning.targetGateThreshold)) {
            best = candidate
            bestSquared = squared
        }
    }
    return best
}

// Routes a character to the rules of its class. Unaligned characters have no
// class behaviour at all: they wander until a shaman converts them.
function stepBehaviourCharacter(simulation, state, world, events) {
    if (state.enteringWorld) {
        return stepCharacter(state, world, tuning.stepSeconds, simulation.random)
    }
    if (state.entity === entityTypes.shaman) {
        return stepShaman(simulation, state, world, events)
    }
    if (state.entity === entityTypes.brave) {
        if (state.legacyState === 13) {
            return stepCelebrationCharacter(simulation, state, world)
        }
        if (state.legacyState === 2) {
            var legacyTarget = findCharacter(simulation, state.targetId)
            if (!legacyTarget || legacyTarget.health <= 0
                    || legacyTarget.tribe === state.tribe) {
                legacyTarget = acquireLegacyTarget(simulation, state)
                if (!legacyTarget) {
                    enterLegacyWait(state, 10, events)
                    state.targetId = 0
                    return null
                }
                beginPursuit(state, legacyTarget, events)
            }
            return stepCombatCharacter(simulation, state, world, events)
        }
        if (state.behaviour === behaviours.attack
                || state.behaviour === behaviours.hit) {
            return stepCombatCharacter(simulation, state, world, events)
        }
        return stepLegacyRoam(simulation, state, world, events)
    }
    if (!isCombatant(state)) {
        return stepCharacter(state, world, tuning.stepSeconds, simulation.random)
    }
    return stepCombatCharacter(simulation, state, world, events)
}

function stepCombatCharacter(simulation, state, world, events) {
    var stepMs = tuning.stepSeconds * 1000

    if (state.castCooldownMs > 0) {
        state.castCooldownMs = Math.max(0, state.castCooldownMs - stepMs)
    }

    // A firewarrior throwing fire, then its short recovery. Both are stationary.
    if (state.behaviour === behaviours.cast
            || state.behaviour === behaviours.recover) {
        advanceAnimation(state, stepMs)
        state.actionRemainingMs = Math.max(0, state.actionRemainingMs - stepMs)
        if (state.actionRemainingMs > 0) {
            return null
        }

        if (state.behaviour === behaviours.cast) {
            var fireTarget = findCharacter(simulation, state.targetId)
            if (!state.castLaunched && fireTarget && fireTarget.health > 0) {
                state.castLaunched = true
                var fireVelocity = aimedVelocity(
                    state, fireTarget, tuning.fireSpeed * state.spriteScale
                )
                createEffect(simulation, {
                    kind: effectKinds.fire,
                    worldX: state.worldX,
                    worldY: state.worldY,
                    velocityX: fireVelocity.x,
                    velocityY: fireVelocity.y,
                    spriteScale: state.spriteScale,
                    tribe: state.tribe,
                    sourceId: state.id,
                    targetId: fireTarget.id,
                    lifetimeMs: tuning.fireLifetimeMs,
                    emitIntervalMs: tuning.fireTrailIntervalMs
                }, events)
            }
            state.castCooldownMs = 0
            // Recovery is stationary, so it stands rather than walking on the
            // spot.
            var recovering = setBehaviour(state, behaviours.recover, actions.stand)
            state.actionRemainingMs = tuning.firewarriorRecoveryMinMs
                + simulation.random.nextInt(
                    tuning.firewarriorRecoveryMaxMs
                        - tuning.firewarriorRecoveryMinMs + 1
                )
            events.push(transitionEvent(state, recovering))
            return null
        }

        var resumed = setBehaviour(state, behaviours.wander, actions.walk)
        state.targetId = 0
        events.push(transitionEvent(state, resumed))
        return null
    }

    if (state.behaviour === behaviours.hit) {
        var recoilLength = Math.sqrt(
            state.directionX * state.directionX + state.directionY * state.directionY
        )
        if (recoilLength > 0) {
            var recoilX = state.worldX
                - state.directionX / recoilLength
                    * tuning.combatHitRecoilSpeed * state.spriteScale
                    * tuning.stepSeconds
            var recoilY = state.worldY
                - state.directionY / recoilLength
                    * tuning.combatHitRecoilSpeed * state.spriteScale
                    * tuning.stepSeconds
            var recoilMargins = {
                x: marginX(state),
                top: marginTop(state),
                bottom: tuning.bottomMargin
            }
            if (worldAllows(world, recoilX, recoilY, recoilMargins)) {
                state.worldX = recoilX
                state.worldY = recoilY
            }
        }
        advanceAnimation(state, stepMs)
        state.actionRemainingMs = Math.max(0, state.actionRemainingMs - stepMs)
        if (state.actionRemainingMs <= 0 && state.health > 0) {
            var retaliate = findCharacter(simulation, state.targetId)
            if (retaliate && retaliate.health > 0) {
                beginPursuit(state, retaliate, events)
            } else {
                var recovered = setBehaviour(state, behaviours.wander, actions.walk)
                state.legacyState = 0
                state.targetId = 0
                events.push(transitionEvent(state, recovered))
            }
        }
        return null
    }

    if (state.behaviour === behaviours.attack) {
        var attackTarget = findCharacter(simulation, state.targetId)
        advanceAnimation(state, stepMs)
        state.actionRemainingMs = Math.max(0, state.actionRemainingMs - stepMs)

        if (!state.attackImpactDone
                && state.actionRemainingMs <= tuning.combatAttackDurationMs
                    - tuning.combatImpactMs) {
            state.attackImpactDone = true
            if (attackTarget && attackTarget.health > 0) {
                receiveHit(attackTarget, state, events)
            }
        }

        if (state.actionRemainingMs <= 0) {
            if (attackTarget && attackTarget.health > 0) {
                beginPursuit(state, attackTarget, events)
            } else {
                var previous = setBehaviour(state, behaviours.wander, actions.walk)
                state.legacyState = 0
                state.targetId = 0
                events.push(transitionEvent(state, previous))
            }
        }
        return null
    }

    // Gathering is a truce. FUN_00401cd0 freezes each entry and places it from
    // the controller, so class behaviour must not move or acquire it here.
    var gathering = simulation.armageddon.mode === armageddonModes.gather
    if (gathering) {
        var held = setBehaviour(state, behaviours.muster, actions.stand)
        if (held !== state.behaviour) {
            events.push(transitionEvent(state, held))
        }
        advanceAnimation(state, stepMs)
        return null
    }

    var target = findCharacter(simulation, state.targetId)
    if (!target || target.health <= 0 || target.tribe === state.tribe) {
        target = nearestHostile(simulation, state)
        if (target) {
            beginPursuit(state, target, events)
        } else {
            state.targetId = 0
        }
    }

    if (target) {
        var dx = target.worldX - state.worldX
        var dy = target.worldY - state.worldY
        var distance = Math.sqrt(dx * dx + dy * dy)
        // A firewarrior never closes to melee: it throws fire from a distance.
        // A brave has no ranged option and must reach its target.
        var isFirewarrior = state.entity === entityTypes.firewarrior
        var reach = isFirewarrior
            ? tuning.fireCastDistance
            : tuning.combatAttackDistance
        if (distance <= reach * state.spriteScale
                && (!isFirewarrior || state.castCooldownMs <= 0)
                && (isFirewarrior || simulation.random.nextOriginal()
                    > tuning.targetGateThreshold)) {
            setDirection(state, dx, dy)
            if (isFirewarrior) {
                beginFireCast(state, target, events)
                return null
            }
            beginAttack(state, target, events)
            // The original increments damage and forces state 7 in the same
            // update that enters state 6; there is no delayed impact frame.
            receiveHit(target, state, events)
            state.attackImpactDone = true
            return null
        }
        var pursuitDirection = directionForVector(dx, dy)
        if (pursuitDirection.id !== state.directionId) {
            setDirection(state, pursuitDirection.dx, pursuitDirection.dy)
        }
        // Pursuit owns the heading. Prevent stepCharacter's wander timer from
        // consuming randomness or replacing it.
        state.wanderRemainingMs = Math.max(state.wanderRemainingMs, stepMs * 2)
    } else {
        var roaming = setBehaviour(state, behaviours.wander, actions.walk)
        if (roaming !== state.behaviour) {
            events.push(transitionEvent(state, roaming))
        }
    }

    return stepCharacter(
        state,
        world,
        tuning.stepSeconds,
        simulation.random,
        target ? tuning.combatPursuitSpeed * state.spriteScale : 0
    )
}

function finishDeaths(simulation, events) {
    var survivors = []
    for (var index = 0; index < simulation.characters.length; ++index) {
        var character = simulation.characters[index]
        if (character.health <= 0 && character.behaviour === behaviours.hit
                && character.actionRemainingMs <= 0) {
            var soul = createSoul(character, simulation.nextEntityId++)
            simulation.entities.push(soul)
            events.push({
                type: "soul-spawned",
                entityId: soul.id,
                characterId: character.id,
                tribe: character.tribe,
                worldX: character.worldX,
                worldY: character.worldY
            })
            events.push({ type: "character-removed", entityId: character.id })
        } else {
            survivors.push(character)
        }
    }

    simulation.characters = survivors
}

// Advances one effect. Returns false when it is finished, having applied
// whatever it was carrying.
//
// Conversion follows its recovered fixed-age phases. Fire ends when it reaches
// its target's impact radius or at tick 31. A decoration ends on its lifetime,
// which createEffect set to the length of its own animation.
function stepEffect(simulation, effect, events) {
    var stepMs = tuning.stepSeconds * 1000

    advanceAnimation(effect, stepMs)
    effect.ageElapsedMs += stepMs
    if (effect.kind !== effectKinds.conversion
            || effect.ageElapsedMs <= tuning.conversionTravelMs) {
        effect.worldX += effect.velocityX * tuning.stepSeconds
        effect.worldY += effect.velocityY * tuning.stepSeconds
    }
    effect.lifetimeRemainingMs -= stepMs

    if (effect.kind === effectKinds.conversion) {
        var decorated = false
        while (effect.ageElapsedMs >= effect.nextConversionScanMs
                && effect.nextConversionScanMs < tuning.conversionLifetimeMs) {
            applyConversion(simulation, effect, events, !decorated
                && effect.nextConversionScanMs === tuning.conversionTravelMs)
            decorated = true
            effect.nextConversionScanMs += tuning.originalTickMs
        }
        if (effect.lifetimeRemainingMs > 0) {
            return true
        }
        events.push({ type: "entity-removed", entityId: effect.id })
        return false
    }

    if (effect.emitIntervalMs > 0) {
        effect.emitRemainingMs -= stepMs
        if (effect.emitRemainingMs <= 0) {
            effect.emitRemainingMs += effect.emitIntervalMs
            createEffect(simulation, {
                kind: effectKinds.fireTrail,
                worldX: effect.worldX,
                worldY: effect.worldY,
                spriteScale: effect.spriteScale,
                tribe: effect.tribe
            }, events)
        }
    }

    var arrived = false
    if (effect.targetId !== 0) {
        var target = findCharacter(simulation, effect.targetId)
        var reach = tuning.fireImpactRadius
        if (target
                && distanceBetween(effect, target) <= reach * effect.spriteScale) {
            arrived = true
        }
    }

    if (!arrived && effect.lifetimeRemainingMs > 0) {
        return true
    }

    if (effect.kind === effectKinds.fire) {
        applyFireImpact(simulation, effect, events)
    }

    events.push({ type: "entity-removed", entityId: effect.id })
    return false
}

function stepEntities(simulation, world, events) {
    var survivors = []
    var stepMs = tuning.stepSeconds * 1000
    // createEffect appends to the same list, so children spawned during this
    // pass are stepped from the next one rather than mid-iteration.
    var count = simulation.entities.length
    for (var index = 0; index < count; ++index) {
        var entity = simulation.entities[index]
        if (entity.entity === entityTypes.effect) {
            if (stepEffect(simulation, entity, events)) {
                survivors.push(entity)
            }
            continue
        }
        if (entity.behaviour === behaviours.rise) {
            advanceAnimation(entity, stepMs)
            entity.phaseRemainingMs -= stepMs
            if (entity.phaseRemainingMs <= 0) {
                var previous = setBehaviour(entity, behaviours.depart, actions.depart)
                entity.speed = tuning.soulInitialRiseSpeed * entity.spriteScale
                entity.lifetimeRemainingMs = tuning.soulLifetimeMs
                entity.accelerationRemainingMs = tuning.soulAccelerationIntervalMs
                events.push(transitionEvent(entity, previous))
            }
            survivors.push(entity)
            continue
        }

        entity.worldY -= entity.speed * tuning.stepSeconds
        entity.lifetimeRemainingMs -= stepMs
        entity.accelerationRemainingMs -= stepMs
        while (entity.accelerationRemainingMs <= 0
                && entity.speed < tuning.soulMaximumRiseSpeed * entity.spriteScale) {
            entity.speed = Math.min(
                tuning.soulMaximumRiseSpeed * entity.spriteScale,
                entity.speed + tuning.soulAccelerationSpeedStep * entity.spriteScale
            )
            entity.accelerationRemainingMs += tuning.soulAccelerationIntervalMs
        }
        if (entity.lifetimeRemainingMs <= 0
                || entity.worldY < world.bounds.y) {
            events.push({ type: "entity-removed", entityId: entity.id })
        } else {
            survivors.push(entity)
        }
    }
    // Anything spawned during the pass, appended after the frozen count.
    for (index = count; index < simulation.entities.length; ++index) {
        survivors.push(simulation.entities[index])
    }
    simulation.entities = survivors
}

// Runs as many fixed steps as the elapsed time allows. Returns typed events in
// deterministic order. Renderers currently consume footprint events; combat,
// souls and the future audio layer use the same boundary.
function stepSimulation(simulation, world, elapsedSeconds) {
    var events = []
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

        if (simulation.combatEnabled) {
            simulation.armageddon.globalMod51 =
                (simulation.armageddon.globalMod51 + 1) % 51
        }

        for (index = 0; index < characters.length; ++index) {
            var state = characters[index]
            if (!state.initialized) {
                continue
            }
            advanceLegacyCounters(state)
            var result = simulation.combatEnabled
                ? stepBehaviourCharacter(simulation, state, world, events)
                : stepCharacter(state, world, tuning.stepSeconds, simulation.random)
            if (result && result.footprint) {
                events.push(footprintEvent(result.footprint, state.id))
            }
        }

        if (simulation.combatEnabled) {
            finishDeaths(simulation, events)
            topUpPopulation(simulation, world, events)
            stepArmageddon(simulation, world, events)
            stepEntities(simulation, world, events)
            characters = simulation.characters
        }

    }

    return events
}
