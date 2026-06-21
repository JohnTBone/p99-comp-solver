// ---------------------------------------------------------------------------
// Instrument types
// ---------------------------------------------------------------------------

export type InstrumentFamily = 'singing' | 'percussion' | 'string' | 'brass' | 'wind'

export interface InstrumentOption {
  id: string
  name: string
  mod: number
}

export const INSTRUMENT_OPTIONS: Record<InstrumentFamily, InstrumentOption[]> = {
  singing: [
    { id: 'singing_none',             name: 'No Modifier (×1.0)',               mod: 10 },
    { id: 'singing_short_sword',      name: 'Singing Short Sword (×1.8)',        mod: 18 },
  ],
  percussion: [
    { id: 'percussion_none',          name: 'No Modifier (×1.0)',               mod: 10 },
    { id: 'hand_drum',                name: 'Hand Drum (×1.8)',                  mod: 18 },
    { id: 'percussion_sss',           name: 'Singing Short Sword (×1.8)',        mod: 18 },
    { id: 'mahlins_mystical_bongos',  name: "Mahlin's Mystical Bongos (×2.1)",  mod: 21 },
    { id: 'mistmoore_battle_drums',   name: 'Mistmoore Battle Drums (×2.1)',     mod: 21 },
    { id: 'nostrolo_tambourine',      name: 'Nostrolo Tambourine (×2.2)',        mod: 22 },
    { id: 'sharkskin_drum',           name: 'Sharkskin Drum (×2.2)',             mod: 22 },
    { id: 'walrus_skin_drum',         name: 'Walrus Skin Drum (×2.3)',           mod: 23 },
    { id: 'selos_drums_of_the_march', name: "Selo's Drums of the March (×2.4)", mod: 24 },
    { id: 'drums_of_the_beast',       name: 'Drums of the Beast (×2.6)',         mod: 26 },
  ],
  string: [
    { id: 'string_none',                     name: 'No Modifier (×1.0)',                    mod: 10 },
    { id: 'string_sss',                      name: 'Singing Short Sword (×1.8)',             mod: 18 },
    { id: 'lute',                            name: 'Lute (×2.0)',                            mod: 20 },
    { id: 'mandolin',                        name: 'Mandolin (×2.0)',                        mod: 20 },
    { id: 'gypsy_lute',                      name: 'Gypsy Lute (×2.1)',                      mod: 21 },
    { id: 'lute_of_the_gypsy_princess',      name: 'Lute of the Gypsy Princess (×2.1)',      mod: 21 },
    { id: 'mystical_lute',                   name: 'Mystical Lute (×2.1)',                   mod: 21 },
    { id: 'lute_of_the_howler',              name: 'Lute of the Howler (×2.2)',              mod: 22 },
    { id: 'kelins_seven_stringed_lute',      name: "Kelin's Seven Stringed Lute (×2.4)",    mod: 24 },
    { id: 'lyendllns_lute',                  name: "Lyendlln's Lute (×2.4)",                mod: 24 },
    { id: 'lyrans_mystical_lute',            name: "Lyran's Mystical Lute (×2.5)",          mod: 25 },
  ],
  brass: [
    { id: 'brass_none',                         name: 'No Modifier (×1.0)',                       mod: 10 },
    { id: 'alluring_horn',                       name: 'Alluring Horn (×1.8)',                     mod: 18 },
    { id: 'brass_sss',                           name: 'Singing Short Sword (×1.8)',               mod: 18 },
    { id: 'horn',                                name: 'Horn (×2.0)',                              mod: 20 },
    { id: 'conch_shell_horn',                    name: 'Conch Shell Horn (×2.1)',                  mod: 21 },
    { id: 'efreeti_war_horn',                    name: 'Efreeti War Horn (×2.2)',                  mod: 22 },
    { id: 'verlekarnorms_horn_of_disaster',      name: "Verlekarnorm's Horn of Disaster (×2.2)",  mod: 22 },
    { id: 'mcvaxius_horn_of_war',               name: "McVaxius' Horn of War (×2.3)",             mod: 23 },
    { id: 'denons_horn_of_disaster',             name: "Denon's Horn of Disaster (×2.4)",         mod: 24 },
    { id: 'immaculate_shell_horn',               name: 'Immaculate Shell Horn (×2.4)',             mod: 24 },
  ],
  wind: [
    { id: 'wind_none',                      name: 'No Modifier (×1.0)',                  mod: 10 },
    { id: 'wind_sss',                       name: 'Singing Short Sword (×1.8)',           mod: 18 },
    { id: 'wooden_flute',                   name: 'Wooden Flute (×1.8)',                  mod: 18 },
    { id: 'minotaur_horn',                  name: 'Minotaur Horn (×2.0)',                 mod: 20 },
    { id: 'scorpion_pincer',                name: 'Scorpion Pincer (×2.0)',               mod: 20 },
    { id: 'brahhms_horn',                   name: "Brahhms Horn (×2.1)",                  mod: 21 },
    { id: 'faun_flute',                     name: 'Faun Flute (×2.1)',                    mod: 21 },
    { id: 'agilmentes_flute_of_flight',     name: "Agilmente's Flute of Flight (×2.2)",  mod: 22 },
    { id: 'ervajs_flute_of_flight',         name: "Ervaj's Flute of Flight (×2.2)",      mod: 22 },
    { id: 'unicorn_horn',                   name: 'Unicorn Horn (×2.2)',                  mod: 22 },
    { id: 'lyssas_darkwood_piccolo',        name: "Lyssa's Darkwood Piccolo (×2.4)",     mod: 24 },
    { id: 'flute_of_the_sacred_glade',      name: 'Flute of the Sacred Glade (×2.5)',    mod: 25 },
  ],
}

export type SelectedInstruments = Record<InstrumentFamily, string>

export const PERCENT_STATS = new Set(['Haste', 'Speed'])

// ---------------------------------------------------------------------------
// Data types (mirror the JSON schema from the scraper)
// ---------------------------------------------------------------------------

export interface BuffLine {
  name: string
  stat: string
  exceptions?: string[]
}

export interface SpellSlot {
  buffLineId: string
  value: number                 // value at maxLevel (or flat value if no scaling)
  valueAtMin?: number           // value at minLevel when scaling exists
  minLevel?: number             // level at which min value applies
  maxLevel?: number             // level at which value caps (may be < 60, e.g. Selo's caps at 50)
  valueWithInstrument?: number  // max-level instrument value (flag + magnitude)
}

export interface ClassEntry {
  class: string
  level: number
}

export interface Spell {
  name: string
  sourceUrl: string
  classes: ClassEntry[]
  targetType: 'self' | 'single' | 'group'
  castTimeSec?: number
  durationSec?: number
  isBardSong: boolean
  instrumentSkill?: InstrumentFamily | null
  slots: SpellSlot[]
}

export interface ClickItem {
  name: string
  itemName: string
  itemUrl: string
  requiredLevel: number | null
  levelKnown: boolean
  classRestriction: string[]
  targetType: 'self' | 'single' | 'group'
  slots: SpellSlot[]
  notes?: string
}

export interface ProcItem {
  name: string
  itemName: string
  itemUrl: string
  classRestriction: string[]
  requiredLevel: number | null
  levelKnown: boolean
  targetType: 'self' | 'single' | 'group'
  triggerCondition: string
  notes?: string
  slots: SpellSlot[]
}

export interface RoleWeights {
  none: Record<string, number>
  casterGroup: Record<string, number>
  tankGroup: Record<string, number>
  meleeGroup: Record<string, number>
}

// ---------------------------------------------------------------------------
// App state types
// ---------------------------------------------------------------------------

export const EQ_CLASSES = [
  'Bard', 'Cleric', 'Druid', 'Enchanter', 'Magician',
  'Monk', 'Necromancer', 'Paladin', 'Ranger', 'Rogue',
  'Shadow Knight', 'Shaman', 'Warrior', 'Wizard',
] as const

export type EQClass = (typeof EQ_CLASSES)[number]

export interface CharacterSlot {
  id: number
  class: EQClass | ''
  level: number  // 1–60
  // Map of click item slug → owned (true = owned and level-eligible)
  ownedClicks: Record<string, boolean>
}

export type RaidRole = 'none' | 'casterGroup' | 'tankGroup' | 'meleeGroup'

export interface AdditionalRaidClass {
  id: string
  class: EQClass | ''
  level: number
  ownedClicks: Record<string, boolean>
}

export interface EnabledResists {
  fire: boolean
  cold: boolean
  magic: boolean
  disease: boolean
  poison: boolean
}

export interface EnabledAbsorbs {
  physical: boolean
  magic: boolean
}

export interface AppState {
  slots: CharacterSlot[]
  raidRole: RaidRole
  additionalRaidClasses: AdditionalRaidClass[]
  showClicks: boolean
  showProcs: boolean
  enabledResists: EnabledResists
  enabledAbsorbs: EnabledAbsorbs
  selectedInstruments: SelectedInstruments
  instrumentsEnabled: Record<InstrumentFamily, boolean>
}

// ---------------------------------------------------------------------------
// Solver result types
// ---------------------------------------------------------------------------

export type SourceType = 'spell' | 'click' | 'proc' | 'bardRotation'

export interface BuffLineResult {
  buffLineId: string
  buffLineName: string
  stat: string
  value: number
  valueWithInstrument?: number
  instrumentFamily?: InstrumentFamily
  scalingStatus?: 'min' | 'max'
  sourceName: string
  sourceType: SourceType
  providerClass: string
  providerSlot: number | null  // null = additional raid class
  targetType: 'self' | 'single' | 'group'
}

export interface BardRotationSong {
  spellId: string
  spellName: string
  rationale: string
  score: number
  instrumentFamily?: InstrumentFamily
  slotsContributed: Array<{ buffLineId: string; value: number; valueWithInstrument?: number; scalingStatus?: 'min' | 'max' }>
}

export interface BardRotationResult {
  slotIndex: number
  songs: BardRotationSong[]       // chosen rotation (up to 4)
  alternatives: BardRotationSong[][] // top 2 alternates (up to 2)
  lockedSongs: string[]           // song ids locked by user
}

export interface SolverResult {
  buffLines: BuffLineResult[]
  bardRotations: BardRotationResult[]
  eligibleProcs: Array<{
    procItem: ProcItem
    procKey: string
    providerSlot: number
  }>
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Data bundle (loaded from JSON files)
// ---------------------------------------------------------------------------

export interface GameData {
  buffLines: Record<string, BuffLine>
  spells: Record<string, Spell>
  clicks: Record<string, ClickItem>
  procs: Record<string, ProcItem>
  roleWeights: RoleWeights
}
