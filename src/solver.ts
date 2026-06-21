/**
 * P99 Buff Optimizer Solver
 *
 * Per spec Section 5.3:
 * 1. Persistent layer: best non-bard value per buff line (spells + owned clicks)
 * 2. Bard layer: optimal 4-song rotation per in-group Bard (greedy, sequential)
 */

import { INSTRUMENT_OPTIONS, PERCENT_STATS } from './types'
import type {
  GameData,
  CharacterSlot,
  AdditionalRaidClass,
  RaidRole,
  BuffLineResult,
  BardRotationResult,
  BardRotationSong,
  SolverResult,
  Spell,
  SpellSlot,
  EnabledResists,
  EnabledAbsorbs,
  SelectedInstruments,
  InstrumentFamily,
} from './types'

// ---------------------------------------------------------------------------
// Stat weight overrides — applied on top of role weights for bard scoring
// ---------------------------------------------------------------------------

// Stats that are always excluded from rotation regardless of role
const STAT_LOW_WEIGHT: Record<string, number> = {
  'Speed':        0.05,  // Selo's — movement speed, useless in combat
  'Charisma':     0.05,  // merchant prices / charm resist only
  'Wisdom':       0,     // mana pool only; not a combat stat
  'Intelligence': 0,     // same as Wisdom
}

// Weight applied to a resist stat when the user has toggled it on.
// Set well above any role-weighted stat so resist songs are always chosen first.
const RESIST_ENABLED_WEIGHT = 6

// Resist stat names → their EnabledResists key
const RESIST_STAT_MAP: Record<string, keyof EnabledResists> = {
  'Fire Resistance': 'fire',
  'Cold Resistance': 'cold',
  'Magic Resistance': 'magic',
  'Disease Resistance': 'disease',
  'Poison Resistance': 'poison',
}

// Damage absorb stat names → their EnabledAbsorbs key
// When disabled, these stats score 0 so absorb songs are excluded from rotation.
const ABSORB_STAT_MAP: Record<string, keyof EnabledAbsorbs> = {
  'Damage Absorption':        'physical',
  'Damage Absorption, Magic': 'magic',
}

// ---------------------------------------------------------------------------
// Level scaling
// ---------------------------------------------------------------------------

function getLeveledValue(slot: SpellSlot, casterLevel: number): number {
  if (slot.valueAtMin == null || slot.minLevel == null || slot.maxLevel == null) return slot.value
  if (casterLevel <= slot.minLevel) return slot.valueAtMin
  if (casterLevel >= slot.maxLevel) return slot.value
  return Math.round(
    slot.valueAtMin + (slot.value - slot.valueAtMin) *
    (casterLevel - slot.minLevel) / (slot.maxLevel - slot.minLevel)
  )
}

function getScalingStatus(slot: SpellSlot, casterLevel: number): 'min' | 'max' | undefined {
  if (slot.valueAtMin == null || slot.minLevel == null || slot.maxLevel == null) return undefined
  if (casterLevel <= slot.minLevel) return 'min'
  if (casterLevel >= slot.maxLevel) return 'max'
  return undefined
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

function spellEligibleForChar(spell: Spell, cls: string, level: number): boolean {
  return spell.classes.some(
    ce => (ce.class === cls || ce.class === 'All') && level >= ce.level
  )
}

function clickEligibleForClass(classRestriction: string[], cls: string): boolean {
  return classRestriction.length === 0 || classRestriction.includes(cls)
}

function clickLevelEligible(requiredLevel: number | null): boolean {
  // Level is checked per-slot separately
  return requiredLevel !== null  // true = there IS a level req (to be compared by caller)
}
void clickLevelEligible  // suppress unused

// ---------------------------------------------------------------------------
// Role weight
// ---------------------------------------------------------------------------

function getSongStatWeight(
  stat: string,
  role: RaidRole,
  roleWeights: GameData['roleWeights'],
  enabledResists: EnabledResists,
  enabledAbsorbs: EnabledAbsorbs,
): number {
  // Always-low stats override everything
  if (stat in STAT_LOW_WEIGHT) return STAT_LOW_WEIGHT[stat]

  // Resist stats: 0 unless toggled — always highest priority when enabled
  const resistKey = RESIST_STAT_MAP[stat]
  if (resistKey !== undefined) return enabledResists[resistKey] ? RESIST_ENABLED_WEIGHT : 0

  // Absorb stats: 0 when disabled, otherwise use normal role weight below
  const absorbKey = ABSORB_STAT_MAP[stat]
  if (absorbKey !== undefined && !enabledAbsorbs[absorbKey]) return 0

  // All roles (including 'none') use their roleWeights table
  const weights = roleWeights[role] as Record<string, number>
  return weights[stat] ?? weights['default'] ?? 1
}

// ---------------------------------------------------------------------------
// Solver entry point
// ---------------------------------------------------------------------------

export function solve(
  data: GameData,
  slots: CharacterSlot[],
  additionalRaidClasses: AdditionalRaidClass[],
  raidRole: RaidRole,
  showProcs: boolean,
  enabledResists: EnabledResists,
  enabledAbsorbs: EnabledAbsorbs,
  selectedInstruments: SelectedInstruments,
  instrumentsEnabled: Record<InstrumentFamily, boolean>,
): SolverResult {
  const { buffLines, spells, clicks, procs } = data
  const warnings: string[] = []

  const filledSlots = slots.filter(s => s.class !== '')
  const inGroupBards = filledSlots.filter(s => s.class === 'Bard')

  if (raidRole !== 'none' && inGroupBards.length === 0) {
    warnings.push('No Bard in this group — Raid Role override has no effect on song selection.')
  }

  // -------------------------------------------------------------------------
  // Persistent layer
  // -------------------------------------------------------------------------

  const persistentBest: Map<string, BuffLineResult> = new Map()

  function updateBest(candidate: BuffLineResult) {
    const current = persistentBest.get(candidate.buffLineId)
    if (!current || candidate.value > current.value) {
      persistentBest.set(candidate.buffLineId, candidate)
    }
  }

  // 1. Non-bard spells from in-group characters
  for (const slot of filledSlots) {
    if (!slot.class || slot.class === 'Bard') continue
    for (const spell of Object.values(spells)) {
      if (spell.isBardSong) continue
      if (spell.targetType === 'self') continue
      if (!spellEligibleForChar(spell, slot.class, slot.level)) continue
      for (const spellSlot of spell.slots) {
        const scalingStatus = getScalingStatus(spellSlot, slot.level)
        updateBest({
          buffLineId: spellSlot.buffLineId,
          buffLineName: buffLines[spellSlot.buffLineId]?.name ?? spellSlot.buffLineId,
          stat: buffLines[spellSlot.buffLineId]?.stat ?? '',
          value: getLeveledValue(spellSlot, slot.level),
          ...(scalingStatus ? { scalingStatus } : {}),
          sourceName: spell.name,
          sourceType: 'spell',
          providerClass: slot.class,
          providerSlot: slot.id,
          targetType: spell.targetType,
        })
      }
    }
  }

  // 2. Owned + level-eligible click items from in-group characters
  for (const slot of filledSlots) {
    if (!slot.class) continue
    for (const [clickKey, clickItem] of Object.entries(clicks)) {
      if (!clickEligibleForClass(clickItem.classRestriction, slot.class)) continue
      if (!slot.ownedClicks[clickKey]) continue
      const lvlOk = clickItem.requiredLevel === null || slot.level >= clickItem.requiredLevel
      if (!lvlOk) continue
      for (const spellSlot of clickItem.slots) {
        updateBest({
          buffLineId: spellSlot.buffLineId,
          buffLineName: buffLines[spellSlot.buffLineId]?.name ?? spellSlot.buffLineId,
          stat: buffLines[spellSlot.buffLineId]?.stat ?? '',
          value: spellSlot.value,
          sourceName: `${clickItem.itemName} (${clickItem.name})`,
          sourceType: 'click',
          providerClass: slot.class,
          providerSlot: slot.id,
          targetType: clickItem.targetType,
        })
      }
    }
  }

  // 3. Additional raid classes (single-target only, per spec 7.3)
  if (raidRole !== 'none') {
    for (const raidChar of additionalRaidClasses) {
      if (!raidChar.class) continue

      for (const spell of Object.values(spells)) {
        if (spell.isBardSong) continue
        if (spell.targetType !== 'single') continue
        if (!spellEligibleForChar(spell, raidChar.class, raidChar.level)) continue
        for (const spellSlot of spell.slots) {
          const scalingStatus = getScalingStatus(spellSlot, raidChar.level)
          updateBest({
            buffLineId: spellSlot.buffLineId,
            buffLineName: buffLines[spellSlot.buffLineId]?.name ?? spellSlot.buffLineId,
            stat: buffLines[spellSlot.buffLineId]?.stat ?? '',
            value: getLeveledValue(spellSlot, raidChar.level),
            ...(scalingStatus ? { scalingStatus } : {}),
            sourceName: `${spell.name} (raid: ${raidChar.class})`,
            sourceType: 'spell',
            providerClass: raidChar.class,
            providerSlot: null,
            targetType: spell.targetType,
          })
        }
      }

      for (const [clickKey, clickItem] of Object.entries(clicks)) {
        if (clickItem.targetType !== 'single') continue
        if (!clickEligibleForClass(clickItem.classRestriction, raidChar.class)) continue
        if (!raidChar.ownedClicks[clickKey]) continue
        const lvlOk = clickItem.requiredLevel === null || raidChar.level >= clickItem.requiredLevel
        if (!lvlOk) continue
        for (const spellSlot of clickItem.slots) {
          updateBest({
            buffLineId: spellSlot.buffLineId,
            buffLineName: buffLines[spellSlot.buffLineId]?.name ?? spellSlot.buffLineId,
            stat: buffLines[spellSlot.buffLineId]?.stat ?? '',
            value: spellSlot.value,
            sourceName: `${clickItem.itemName} (raid: ${raidChar.class})`,
            sourceType: 'click',
            providerClass: raidChar.class,
            providerSlot: null,
            targetType: clickItem.targetType,
          })
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Bard layer (greedy sequential per spec 5.3)
  // -------------------------------------------------------------------------

  const bardRotations: BardRotationResult[] = []
  const currentBest = new Map(persistentBest)

  for (const bardSlot of inGroupBards) {
    const rotation = optimizeBardRotation(bardSlot, data, currentBest, raidRole, enabledResists, enabledAbsorbs, selectedInstruments, instrumentsEnabled)
    bardRotations.push(rotation)

    // Update running baseline with this bard's chosen songs.
    // Use the effective (instrument) value for comparison so subsequent
    // bards score against the real in-game value.
    for (const song of rotation.songs) {
      for (const c of song.slotsContributed) {
        const bl = buffLines[c.buffLineId]
        const effectiveValue = c.valueWithInstrument ?? c.value
        const existing = currentBest.get(c.buffLineId)
        if (!existing || effectiveValue > existing.value) {
          currentBest.set(c.buffLineId, {
            buffLineId: c.buffLineId,
            buffLineName: bl?.name ?? c.buffLineId,
            stat: bl?.stat ?? '',
            value: c.value,
            ...(c.valueWithInstrument != null ? { valueWithInstrument: c.valueWithInstrument } : {}),
            ...(song.instrumentFamily != null ? { instrumentFamily: song.instrumentFamily } : {}),
            ...(c.scalingStatus ? { scalingStatus: c.scalingStatus } : {}),
            sourceName: song.spellName,
            sourceType: 'bardRotation',
            providerClass: 'Bard',
            providerSlot: bardSlot.id,
            targetType: 'group',
          })
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Combine persistent + bard results
  // -------------------------------------------------------------------------

  const allResults = new Map(persistentBest)
  for (const [k, v] of currentBest) {
    if (v.sourceType === 'bardRotation') allResults.set(k, v)
  }

  const buffLineResults = Array.from(allResults.values())
    .filter(r => r.value > 0)
    .sort((a, b) => a.stat.localeCompare(b.stat) || a.buffLineName.localeCompare(b.buffLineName))

  // -------------------------------------------------------------------------
  // Procs (informational only)
  // -------------------------------------------------------------------------

  const eligibleProcs: SolverResult['eligibleProcs'] = []
  if (showProcs) {
    for (const slot of filledSlots) {
      if (!slot.class) continue
      for (const [procKey, procItem] of Object.entries(procs)) {
        const eligible = procItem.classRestriction.length === 0 ||
          procItem.classRestriction.includes(slot.class)
        if (!eligible) continue
        const levelOk = procItem.requiredLevel === null || slot.level >= procItem.requiredLevel
        if (!levelOk && procItem.levelKnown) continue
        eligibleProcs.push({ procItem, procKey, providerSlot: slot.id })
      }
    }
  }

  return { buffLines: buffLineResults, bardRotations, eligibleProcs, warnings }
}

// ---------------------------------------------------------------------------
// Bard rotation optimizer
// ---------------------------------------------------------------------------

const MAX_SONGS = 4

function optimizeBardRotation(
  bardSlot: CharacterSlot,
  data: GameData,
  baseline: Map<string, BuffLineResult>,
  raidRole: RaidRole,
  enabledResists: EnabledResists,
  enabledAbsorbs: EnabledAbsorbs,
  selectedInstruments: SelectedInstruments,
  instrumentsEnabled: Record<InstrumentFamily, boolean>,
): BardRotationResult {
  const { spells, buffLines, roleWeights } = data

  function getModForFamily(family: InstrumentFamily): number {
    if (!instrumentsEnabled[family]) return 10
    const id = selectedInstruments[family]
    const opt = INSTRUMENT_OPTIONS[family].find(o => o.id === id)
    return opt?.mod ?? 10
  }

  function getEffectiveSlotValue(slot: SpellSlot, instrumentSkill: InstrumentFamily | null | undefined, casterLevel: number): number {
    const baseValue = getLeveledValue(slot, casterLevel)
    if (slot.valueWithInstrument == null || !instrumentSkill) return baseValue
    const mod = getModForFamily(instrumentSkill)
    return Math.round(baseValue * (mod / 10))
  }

  // All eligible bard songs for this bard
  const eligibleSongs = Object.entries(spells).filter(([, s]) => {
    if (!s.isBardSong) return false
    if (s.targetType === 'self') return false
    return spellEligibleForChar(s, 'Bard', bardSlot.level)
  })

  type Contribution = { buffLineId: string; value: number; valueWithInstrument?: number; scalingStatus?: 'min' | 'max' }

  function scoreSong(
    spell: Spell,
    currentBaseline: Map<string, BuffLineResult>,
  ): { score: number; contributions: Contribution[] } {
    let score = 0
    const contributions: Contribution[] = []
    for (const slot of spell.slots) {
      const baseValue = getLeveledValue(slot, bardSlot.level)
      const effective = getEffectiveSlotValue(slot, spell.instrumentSkill, bardSlot.level)
      const baselineValue = currentBaseline.get(slot.buffLineId)?.value ?? 0
      const marginal = Math.max(0, effective - baselineValue)
      if (marginal > 0) {
        const stat = buffLines[slot.buffLineId]?.stat ?? ''
        const weight = getSongStatWeight(stat, raidRole, roleWeights, enabledResists, enabledAbsorbs)
        score += marginal * weight
        const scalingStatus = getScalingStatus(slot, bardSlot.level)
        contributions.push({
          buffLineId: slot.buffLineId,
          value: baseValue,
          ...(effective !== baseValue ? { valueWithInstrument: effective } : {}),
          ...(scalingStatus ? { scalingStatus } : {}),
        })
      }
    }
    return { score, contributions }
  }

  // Build rotation greedily
  type RotEntry = { spellId: string; spell: Spell; score: number; contributions: Contribution[] }
  const rotation: RotEntry[] = []
  const addedIds = new Set<string>()
  const workingBaseline = new Map(baseline)

  function applyToBaseline(contributions: Contribution[], spellName: string) {
    for (const c of contributions) {
      const bl = buffLines[c.buffLineId]
      // Store the effective (instrument) value in the working baseline so
      // subsequent songs are scored against the real in-game value.
      const effectiveValue = c.valueWithInstrument ?? c.value
      const existing = workingBaseline.get(c.buffLineId)
      if (!existing || effectiveValue > existing.value) {
        workingBaseline.set(c.buffLineId, {
          buffLineId: c.buffLineId,
          buffLineName: bl?.name ?? c.buffLineId,
          stat: bl?.stat ?? '',
          value: effectiveValue,   // effective value used for scoring future songs
          sourceName: spellName,
          sourceType: 'bardRotation',
          providerClass: 'Bard',
          providerSlot: bardSlot.id,
          targetType: 'group',
        })
      }
    }
  }

  while (rotation.length < MAX_SONGS) {
    let bestEntry: RotEntry | null = null
    for (const [spellId, spell] of eligibleSongs) {
      if (addedIds.has(spellId)) continue
      const { score, contributions } = scoreSong(spell, workingBaseline)
      if (!bestEntry || score > bestEntry.score) {
        bestEntry = { spellId, spell, score, contributions }
      }
    }
    if (!bestEntry || bestEntry.score <= 0) break
    rotation.push(bestEntry)
    addedIds.add(bestEntry.spellId)
    applyToBaseline(bestEntry.contributions, bestEntry.spell.name)
  }

  function instrLabel(family: InstrumentFamily | null | undefined): string {
    if (!family) return 'instr'
    const id = selectedInstruments[family]
    const opt = INSTRUMENT_OPTIONS[family].find(o => o.id === id)
    // Strip the trailing "(×N.N)" multiplier suffix to get just the instrument name
    return opt ? opt.name.replace(/\s*\(×[\d.]+\)\s*$/, '') : 'instr'
  }

  function formatContribution(
    c: Contribution,
    family: InstrumentFamily | null | undefined,
  ): string {
    const bl = buffLines[c.buffLineId]
    const name = bl?.name ?? c.buffLineId
    const pct = PERCENT_STATS.has(bl?.stat ?? '')
    const scaleTag = c.scalingStatus ? ` (${c.scalingStatus})` : ''
    const baseStr = pct ? `${c.value}%` : `+${c.value}`
    const instrStr = c.valueWithInstrument != null
      ? ` (${pct ? `${c.valueWithInstrument}%` : `+${c.valueWithInstrument}`} w/${instrLabel(family)})`
      : ''
    return `${name} ${baseStr}${scaleTag}${instrStr}`
  }

  // Top 2 alternatives (songs not in chosen rotation, scored against original baseline)
  const alternatives: BardRotationSong[][] = []
  for (const [spellId, spell] of eligibleSongs) {
    if (addedIds.has(spellId)) continue
    if (alternatives.length >= 2) break
    const { score, contributions } = scoreSong(spell, baseline)
    if (score > 0) {
      alternatives.push([{
        spellId,
        spellName: spell.name,
        score,
        rationale: contributions.map(c => formatContribution(c, spell.instrumentSkill)).join(', '),
        slotsContributed: contributions,
      }])
    }
  }

  return {
    slotIndex: bardSlot.id,
    songs: rotation.map(r => ({
      spellId: r.spellId,
      spellName: r.spell.name,
      score: r.score,
      rationale: r.contributions.length
        ? r.contributions.map(c => formatContribution(c, r.spell.instrumentSkill)).join(', ')
        : 'No marginal improvement over baseline',
      ...(r.spell.instrumentSkill != null ? { instrumentFamily: r.spell.instrumentSkill } : {}),
      slotsContributed: r.contributions,
    })),
    alternatives,
    lockedSongs: [],
  }
}
