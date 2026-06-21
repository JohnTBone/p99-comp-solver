import { useState, useEffect, useCallback } from 'react'
import { loadGameData } from './data'
import { solve } from './solver'
import type {
  GameData,
  AppState,
  CharacterSlot,
  SolverResult,
  RaidRole,
  AdditionalRaidClass,
  EQClass,
  ClickItem,
  EnabledResists,
  EnabledAbsorbs,
  InstrumentFamily,
  SelectedInstruments,
} from './types'
import { EQ_CLASSES, INSTRUMENT_OPTIONS, PERCENT_STATS } from './types'
import './App.css'

// ---------------------------------------------------------------------------
// Default state
// ---------------------------------------------------------------------------

function makeDefaultSlot(id: number): CharacterSlot {
  return { id, class: '', level: 50, ownedClicks: {} }
}

const DEFAULT_RESISTS: EnabledResists = {
  fire: false, cold: false, magic: false, disease: false, poison: false,
}

const DEFAULT_ABSORBS: EnabledAbsorbs = {
  physical: false, magic: false,
}

const DEFAULT_INSTRUMENTS: SelectedInstruments = {
  singing: 'singing_none',
  percussion: 'percussion_none',
  string: 'string_none',
  brass: 'brass_none',
  wind: 'wind_none',
}

const DEFAULT_INSTRUMENTS_ENABLED: Record<InstrumentFamily, boolean> = {
  singing: true, percussion: true, string: true, brass: true, wind: true,
}

const DEFAULT_STATE: AppState = {
  slots: Array.from({ length: 6 }, (_, i) => makeDefaultSlot(i)),
  raidRole: 'none',
  additionalRaidClasses: [],
  showClicks: true,
  showProcs: false,
  enabledResists: DEFAULT_RESISTS,
  enabledAbsorbs: DEFAULT_ABSORBS,
  selectedInstruments: DEFAULT_INSTRUMENTS,
  instrumentsEnabled: DEFAULT_INSTRUMENTS_ENABLED,
}

const STORAGE_KEY = 'p99-buff-optimizer-state'

// Validate and migrate stored instrument selection to string ids.
// Old format stored a numeric mod value; new format stores the option id.
function migrateInstruments(raw: unknown): SelectedInstruments {
  const families: InstrumentFamily[] = ['singing', 'percussion', 'string', 'brass', 'wind']
  const result = { ...DEFAULT_INSTRUMENTS }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    for (const f of families) {
      const v = obj[f]
      if (typeof v === 'string' && INSTRUMENT_OPTIONS[f].some(o => o.id === v)) {
        result[f] = v
      }
      // numeric (legacy) or invalid → keep family default
    }
  }
  return result
}

function loadSavedState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw) as Partial<AppState>
    // Merge with defaults to handle new fields
    return {
      ...DEFAULT_STATE,
      ...parsed,
      slots: parsed.slots?.map((s, i) => ({ ...makeDefaultSlot(i), ...s }))
        ?? DEFAULT_STATE.slots,
      enabledResists: { ...DEFAULT_RESISTS, ...parsed.enabledResists },
      enabledAbsorbs: { ...DEFAULT_ABSORBS, ...(parsed.enabledAbsorbs ?? {}) },
      selectedInstruments: migrateInstruments(parsed.selectedInstruments),
      instrumentsEnabled: { ...DEFAULT_INSTRUMENTS_ENABLED, ...parsed.instrumentsEnabled },
    }
  } catch {
    return DEFAULT_STATE
  }
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------

export default function App() {
  const [gameData, setGameData] = useState<GameData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [state, setState] = useState<AppState>(loadSavedState)
  const [result, setResult] = useState<SolverResult | null>(null)
  const [lockedSongs, setLockedSongs] = useState<Record<number, string[]>>({})

  // Load game data
  useEffect(() => {
    loadGameData()
      .then(setGameData)
      .catch(err => setLoadError(String(err)))
  }, [])

  // Persist state to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  // Run solver whenever state or data changes
  useEffect(() => {
    if (!gameData) return
    try {
      const r = solve(gameData, state.slots, state.additionalRaidClasses, state.raidRole, state.showProcs, state.enabledResists, state.enabledAbsorbs, state.selectedInstruments, state.instrumentsEnabled)
      setResult(r)
    } catch (err) {
      console.error('Solver error:', err)
    }
  }, [gameData, state])

  const updateSlot = useCallback((id: number, patch: Partial<CharacterSlot>) => {
    setState(prev => ({
      ...prev,
      slots: prev.slots.map(s => s.id === id ? { ...s, ...patch } : s),
    }))
  }, [])

  const toggleOwnedClick = useCallback((slotId: number, clickKey: string, owned: boolean) => {
    setState(prev => ({
      ...prev,
      slots: prev.slots.map(s => s.id === slotId
        ? { ...s, ownedClicks: { ...s.ownedClicks, [clickKey]: owned } }
        : s),
    }))
  }, [])

  const addRaidClass = useCallback(() => {
    setState(prev => ({
      ...prev,
      additionalRaidClasses: [
        ...prev.additionalRaidClasses,
        { id: crypto.randomUUID(), class: '', level: 60, ownedClicks: {} },
      ],
    }))
  }, [])

  const removeRaidClass = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      additionalRaidClasses: prev.additionalRaidClasses.filter(r => r.id !== id),
    }))
  }, [])

  const updateRaidClass = useCallback((id: string, patch: Partial<AdditionalRaidClass>) => {
    setState(prev => ({
      ...prev,
      additionalRaidClasses: prev.additionalRaidClasses.map(r =>
        r.id === id ? { ...r, ...patch } : r
      ),
    }))
  }, [])

  const resetParty = useCallback(() => {
    setState({
      ...DEFAULT_STATE,
      slots: Array.from({ length: 6 }, (_, i) => ({ id: i, class: '' as const, level: 1, ownedClicks: {} })),
    })
    setLockedSongs({})
  }, [])

  const toggleLockSong = useCallback((slotIndex: number, spellId: string) => {
    setLockedSongs(prev => {
      const current = prev[slotIndex] ?? []
      const next = current.includes(spellId)
        ? current.filter(id => id !== spellId)
        : [...current, spellId]
      return { ...prev, [slotIndex]: next }
    })
  }, [])

  if (loadError) {
    return (
      <div className="error-page">
        <h2>Failed to load game data</h2>
        <p>{loadError}</p>
        <p>Make sure you've run <code>npm run scrape</code> first.</p>
      </div>
    )
  }

  if (!gameData) {
    return <div className="loading">Loading game data…</div>
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>P99 Group Comp Buff Optimizer</h1>
        <p className="subtitle">EverQuest Project 1999 — find the optimal buff coverage for your group</p>
      </header>

      <div className="main-layout">
        <aside className="sidebar">
          <CompBuilder
            slots={state.slots}
            gameData={gameData}
            showClicks={state.showClicks}
            onUpdateSlot={updateSlot}
            onToggleOwnedClick={toggleOwnedClick}
            onToggleShowClicks={() => setState(p => ({ ...p, showClicks: !p.showClicks }))}
            onReset={resetParty}
          />

          <div className="section">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={state.showProcs}
                onChange={e => setState(p => ({ ...p, showProcs: e.target.checked }))}
              />
              Include combat procs (experimental — informational only)
            </label>
          </div>

          {state.slots.some(s => s.class === 'Bard') && (
            <InstrumentPanel
              selectedInstruments={state.selectedInstruments}
              instrumentsEnabled={state.instrumentsEnabled}
              onChange={patch => setState(p => ({ ...p, selectedInstruments: { ...p.selectedInstruments, ...patch } }))}
              onToggleEnabled={(family, enabled) => setState(p => ({
                ...p,
                instrumentsEnabled: { ...p.instrumentsEnabled, [family]: enabled },
              }))}
            />
          )}

          {state.slots.some(s => s.class === 'Bard') && (
            <SongPrioritySection
              enabledResists={state.enabledResists}
              enabledAbsorbs={state.enabledAbsorbs}
              onChangeResists={patch => setState(p => ({ ...p, enabledResists: { ...p.enabledResists, ...patch } }))}
              onChangeAbsorbs={patch => setState(p => ({ ...p, enabledAbsorbs: { ...p.enabledAbsorbs, ...patch } }))}
            />
          )}

          {state.slots.some(s => s.class === 'Bard') && (
            <RaidSection
              raidRole={state.raidRole}
              additionalRaidClasses={state.additionalRaidClasses}
              gameData={gameData}
              onSetRole={role => setState(p => ({ ...p, raidRole: role }))}
              onAddRaidClass={addRaidClass}
              onRemoveRaidClass={removeRaidClass}
              onUpdateRaidClass={updateRaidClass}
            />
          )}
        </aside>

        <main className="results">
          {result && (
            <Results
              result={result}
              gameData={gameData}
              slots={state.slots}
              raidRole={state.raidRole}
              selectedInstruments={state.selectedInstruments}
              lockedSongs={lockedSongs}
              onToggleLockSong={toggleLockSong}
            />
          )}
        </main>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CompBuilder
// ---------------------------------------------------------------------------

interface CompBuilderProps {
  slots: CharacterSlot[]
  gameData: GameData
  showClicks: boolean
  onUpdateSlot: (id: number, patch: Partial<CharacterSlot>) => void
  onToggleOwnedClick: (slotId: number, clickKey: string, owned: boolean) => void
  onToggleShowClicks: () => void
  onReset: () => void
}

function CompBuilder({ slots, gameData, showClicks, onUpdateSlot, onToggleOwnedClick, onToggleShowClicks, onReset }: CompBuilderProps) {
  return (
    <div className="section comp-builder">
      <div className="section-header">
        <h2>Party Composition</h2>
        <div className="header-actions">
          <button className="btn-link btn-reset" onClick={onReset}>Reset Party</button>
          <button className="btn-link" onClick={onToggleShowClicks}>
            {showClicks ? 'Hide clicks' : 'Show clicks'}
          </button>
        </div>
      </div>
      {slots.map(slot => (
        <CharacterSlotRow
          key={slot.id}
          slot={slot}
          gameData={gameData}
          showClicks={showClicks}
          onUpdate={patch => onUpdateSlot(slot.id, patch)}
          onToggleClick={(key, owned) => onToggleOwnedClick(slot.id, key, owned)}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CharacterSlotRow
// ---------------------------------------------------------------------------

interface CharSlotProps {
  slot: CharacterSlot
  gameData: GameData
  showClicks: boolean
  onUpdate: (patch: Partial<CharacterSlot>) => void
  onToggleClick: (clickKey: string, owned: boolean) => void
}

function CharacterSlotRow({ slot, gameData, showClicks, onUpdate, onToggleClick }: CharSlotProps) {
  const [expanded, setExpanded] = useState(false)

  // Get click items available to this class
  const availableClicks = slot.class
    ? Object.entries(gameData.clicks).filter(([, item]) =>
        item.classRestriction.length === 0 || item.classRestriction.includes(slot.class)
      ).sort(([, a], [, b]) => {
        // Sort by: owned first, then level eligible, then by required level
        const aOwned = slot.ownedClicks[Object.keys(gameData.clicks).find(k => gameData.clicks[k] === a) ?? ''] ? 1 : 0
        const bOwned = slot.ownedClicks[Object.keys(gameData.clicks).find(k => gameData.clicks[k] === b) ?? ''] ? 1 : 0
        if (aOwned !== bOwned) return bOwned - aOwned
        return (a.requiredLevel ?? 0) - (b.requiredLevel ?? 0)
      })
    : []

  return (
    <div className={`char-slot ${slot.class ? 'filled' : 'empty'}`}>
      <div className="char-slot-main">
        <select
          value={slot.class}
          onChange={e => onUpdate({ class: e.target.value as EQClass | '' })}
          className="class-select"
        >
          <option value="">— Empty —</option>
          {EQ_CLASSES.map(cls => (
            <option key={cls} value={cls}>{cls}</option>
          ))}
        </select>

        <div className="level-input">
          <input
            type="number"
            min={1}
            max={60}
            value={slot.level}
            disabled={!slot.class}
            onChange={e => {
              const v = Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 1))
              onUpdate({ level: v })
            }}
          />
          <span className="level-label">/ 60</span>
        </div>

        {showClicks && slot.class && availableClicks.length > 0 && (
          <button
            className="btn-link clicks-toggle"
            onClick={() => setExpanded(x => !x)}
          >
            Clicks ({availableClicks.filter(([key]) => slot.ownedClicks[key]).length}/{availableClicks.length})
            {expanded ? ' ▲' : ' ▼'}
          </button>
        )}
      </div>

      {showClicks && expanded && slot.class && (
        <ClicksPanel
          slot={slot}
          clicks={availableClicks}
          onToggle={onToggleClick}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ClicksPanel
// ---------------------------------------------------------------------------

interface ClicksPanelProps {
  slot: CharacterSlot
  clicks: Array<[string, ClickItem]>
  onToggle: (key: string, owned: boolean) => void
}

function ClicksPanel({ slot, clicks, onToggle }: ClicksPanelProps) {
  return (
    <div className="clicks-panel">
      <div className="clicks-header">
        <span>Item</span>
        <span>Effect</span>
        <span>Lvl</span>
        <span>Own</span>
      </div>
      {clicks.map(([key, item]) => {
        const levelOk = item.requiredLevel === null || slot.level >= item.requiredLevel
        const owned = slot.ownedClicks[key] ?? false
        return (
          <div key={key} className={`click-row ${!levelOk ? 'level-locked' : ''}`}>
            <span className="click-item-name">
              <a href={item.itemUrl} target="_blank" rel="noopener noreferrer">
                {item.itemName}
              </a>
            </span>
            <span className="click-effect">{item.name}</span>
            <span className="click-level">
              {item.requiredLevel !== null
                ? item.requiredLevel
                : (item.levelKnown ? '?' : '?')}
              {!levelOk && ' 🔒'}
            </span>
            <span className="click-own">
              <input
                type="checkbox"
                checked={owned}
                disabled={!levelOk}
                onChange={e => onToggle(key, e.target.checked)}
                title={!levelOk ? `Requires level ${item.requiredLevel ?? '?'}` : item.itemName}
              />
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Instrument Panel
// ---------------------------------------------------------------------------

const INSTRUMENT_FAMILY_ORDER: Array<{ family: InstrumentFamily; label: string }> = [
  { family: 'singing',    label: 'Singing'    },
  { family: 'brass',      label: 'Brass'      },
  { family: 'wind',       label: 'Wind'       },
  { family: 'string',     label: 'String'     },
  { family: 'percussion', label: 'Percussion' },
]

interface InstrumentPanelProps {
  selectedInstruments: SelectedInstruments
  instrumentsEnabled: Record<InstrumentFamily, boolean>
  onChange: (patch: Partial<SelectedInstruments>) => void
  onToggleEnabled: (family: InstrumentFamily, enabled: boolean) => void
}

function InstrumentPanel({ selectedInstruments, instrumentsEnabled, onChange, onToggleEnabled }: InstrumentPanelProps) {
  return (
    <div className="section instrument-panel">
      <h2>Bard Instruments</h2>
      <p className="help-text">
        Select each instrument and toggle it on/off to compare with and without.
      </p>
      {INSTRUMENT_FAMILY_ORDER.map(({ family, label }) => {
        const enabled = instrumentsEnabled[family]
        return (
          <div key={family} className={`instrument-row${enabled ? '' : ' disabled'}`}>
            <input
              type="checkbox"
              className="instrument-toggle"
              checked={enabled}
              onChange={e => onToggleEnabled(family, e.target.checked)}
              title={enabled ? `Disable ${label}` : `Enable ${label}`}
            />
            <label className="instrument-label">{label}</label>
            <select
              className="instrument-select"
              value={selectedInstruments[family]}
              onChange={e => onChange({ [family]: e.target.value })}
            >
              {INSTRUMENT_OPTIONS[family].map(opt => (
                <option key={opt.id} value={opt.id}>{opt.name}</option>
              ))}
            </select>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Resist Priority Section
// ---------------------------------------------------------------------------

const RESIST_LABELS: Array<{ key: keyof EnabledResists; label: string }> = [
  { key: 'fire',    label: 'FR (Fire)'    },
  { key: 'cold',    label: 'CR (Cold)'    },
  { key: 'magic',   label: 'MR (Magic)'   },
  { key: 'disease', label: 'DR (Disease)' },
  { key: 'poison',  label: 'PR (Poison)'  },
]

const ABSORB_LABELS: Array<{ key: keyof EnabledAbsorbs; label: string }> = [
  { key: 'physical', label: 'Absorb (Physical)' },
  { key: 'magic',    label: 'Absorb (Magic)'    },
]

interface SongPrioritySectionProps {
  enabledResists: EnabledResists
  enabledAbsorbs: EnabledAbsorbs
  onChangeResists: (patch: Partial<EnabledResists>) => void
  onChangeAbsorbs: (patch: Partial<EnabledAbsorbs>) => void
}

function SongPrioritySection({ enabledResists, enabledAbsorbs, onChangeResists, onChangeAbsorbs }: SongPrioritySectionProps) {
  return (
    <div className="section">
      <h2>Bard Song Priorities</h2>
      <p className="help-text">
        Absorb and resist songs are excluded by default — enable when situationally relevant.
      </p>
      <div className="resist-toggles">
        {ABSORB_LABELS.map(({ key, label }) => (
          <label key={key} className="toggle-row">
            <input
              type="checkbox"
              checked={enabledAbsorbs[key]}
              onChange={e => onChangeAbsorbs({ [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="priority-divider" />
      <div className="resist-toggles">
        {RESIST_LABELS.map(({ key, label }) => (
          <label key={key} className="toggle-row">
            <input
              type="checkbox"
              checked={enabledResists[key]}
              onChange={e => onChangeResists({ [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Raid Section
// ---------------------------------------------------------------------------

interface RaidSectionProps {
  raidRole: RaidRole
  additionalRaidClasses: AdditionalRaidClass[]
  gameData: GameData
  onSetRole: (role: RaidRole) => void
  onAddRaidClass: () => void
  onRemoveRaidClass: (id: string) => void
  onUpdateRaidClass: (id: string, patch: Partial<AdditionalRaidClass>) => void
}

function RaidSection({ raidRole, additionalRaidClasses, gameData, onSetRole, onAddRaidClass, onRemoveRaidClass, onUpdateRaidClass }: RaidSectionProps) {
  return (
    <div className="section raid-section">
      <h2>Bard Raid Group Role Override</h2>
      <select
        value={raidRole}
        onChange={e => onSetRole(e.target.value as RaidRole)}
        className="role-select"
      >
        <option value="none">None / Leveling Group</option>
        <option value="casterGroup">Caster Group</option>
        <option value="tankGroup">Tank Group</option>
        <option value="meleeGroup">Melee Group</option>
      </select>

      {raidRole !== 'none' && (
        <div className="additional-raid">
          <h3>Additional Raid Classes</h3>
          <p className="help-text">
            Other casters in the raid who can single-target buff this group.
            Group-type effects from outside your group cannot reach you.
          </p>
          {additionalRaidClasses.map(rc => (
            <div key={rc.id} className="raid-class-row">
              <select
                value={rc.class}
                onChange={e => onUpdateRaidClass(rc.id, { class: e.target.value as EQClass | '' })}
              >
                <option value="">— Class —</option>
                {EQ_CLASSES.map(cls => (
                  <option key={cls} value={cls}>{cls}</option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={60}
                value={rc.level}
                onChange={e => onUpdateRaidClass(rc.id, { level: Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 1)) })}
              />
              <button onClick={() => onRemoveRaidClass(rc.id)} className="btn-remove">✕</button>
            </div>
          ))}
          <button onClick={onAddRaidClass} className="btn-add">+ Add Raid Class</button>

          {/* Click ownership for raid classes */}
          {additionalRaidClasses.filter(rc => rc.class).map(rc => {
            const availableClicks = Object.entries(gameData.clicks).filter(([, item]) =>
              item.classRestriction.length === 0 || item.classRestriction.includes(rc.class)
            )
            if (availableClicks.length === 0) return null
            return (
              <div key={rc.id + '_clicks'} className="raid-clicks">
                <h4>{rc.class} clicks</h4>
                {availableClicks.map(([key, item]) => {
                  const levelOk = item.requiredLevel === null || rc.level >= item.requiredLevel
                  const isGroupType = item.targetType === 'group'
                  const owned = rc.ownedClicks[key] ?? false
                  return (
                    <div key={key} className={`click-row ${!levelOk || isGroupType ? 'level-locked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={owned}
                        disabled={!levelOk || isGroupType}
                        onChange={e => onUpdateRaidClass(rc.id, {
                          ownedClicks: { ...rc.ownedClicks, [key]: e.target.checked }
                        })}
                      />
                      <span>{item.itemName}</span>
                      <span className="click-effect">{item.name}</span>
                      {isGroupType && <span className="group-note">Group-only — won't reach this group</span>}
                      {!isGroupType && !levelOk && <span className="group-note">Req. lvl {item.requiredLevel ?? '?'}</span>}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function instrFamilyLabel(family?: InstrumentFamily): string {
  if (!family) return 'Singing'
  return family.charAt(0).toUpperCase() + family.slice(1)
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

interface ResultsProps {
  result: SolverResult
  gameData: GameData
  slots: CharacterSlot[]
  raidRole: RaidRole
  selectedInstruments: SelectedInstruments
  lockedSongs: Record<number, string[]>
  onToggleLockSong: (slotIndex: number, spellId: string) => void
}

function Results({ result, gameData, slots, raidRole, selectedInstruments, lockedSongs, onToggleLockSong }: ResultsProps) {
  // Group buff lines by stat
  const bystat: Record<string, typeof result.buffLines> = {}
  for (const bl of result.buffLines) {
    if (!bystat[bl.stat]) bystat[bl.stat] = []
    bystat[bl.stat].push(bl)
  }

  const hasBard = slots.some(s => s.class === 'Bard')

  return (
    <div className="results-panel">
      {result.warnings.map((w, i) => (
        <div key={i} className="warning-banner">{w}</div>
      ))}

      {result.buffLines.length === 0 && result.bardRotations.length === 0 && (
        <div className="empty-state">
          Add party members to see buff coverage.
        </div>
      )}

      {/* Bard rotations */}
      {result.bardRotations.length > 0 && (
        <div className="section">
          <h2>Bard Rotation{result.bardRotations.length > 1 ? 's' : ''}</h2>
          {hasBard && (
            <p className="help-text">
              {raidRole === 'none'
                ? 'Weights: Haste ×4, Mana/HP Regen ×3, AC/STR/ATK/Absorb ×2, DEX ×1.5'
                : raidRole === 'casterGroup'
                  ? 'Weights: Mana Regen ×6, HP Regen ×4, Magic Absorb ×3, Absorb/AC ×2, Haste ×1.5'
                  : raidRole === 'tankGroup'
                    ? 'Weights: Haste/AC ×4, Absorb/HP Regen ×3, STR ×2.5, Mana Regen ×2'
                    : 'Weights: Haste ×5, STR/DEX ×3, ATK ×2.5, Absorb/HP Regen ×2, AC/AGI ×1.5'}
              {' · WIS/INT/Speed/CHA excluded · Absorb/Resist follow Song Priorities panel'}
            </p>
          )}
          {result.bardRotations.map(rot => (
            <BardRotationCard
              key={rot.slotIndex}
              rotation={rot}
              slotNumber={rot.slotIndex + 1}
              gameData={gameData}
              lockedSongs={lockedSongs[rot.slotIndex] ?? []}
              onToggleLock={(id) => onToggleLockSong(rot.slotIndex, id)}
            />
          ))}
        </div>
      )}

      {/* Buff coverage table */}
      {result.buffLines.length > 0 && (
        <div className="section">
          <h2>Buff Coverage</h2>
          <p className="help-text">Scaling spell values are linearly interpolated from wiki min/max data — intermediate levels are approximate. <span className="scaling-tag">min</span> / <span className="scaling-tag">max</span> marks boundary levels.</p>
          {Object.entries(bystat).map(([stat, lines]) => (
            <div key={stat} className="stat-group">
              <h3 className="stat-header">{stat}</h3>
              <table className="buff-table">
                <colgroup>
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '30%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '12%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Buff Line</th>
                    <th>Value</th>
                    <th>Source</th>
                    <th>Provider</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(line => (
                    <tr key={line.buffLineId} className={`source-${line.sourceType}`}>
                      <td className="bl-name">{line.buffLineName}</td>
                      <td className="bl-value">
                        {PERCENT_STATS.has(line.stat) ? `${line.value}%` : `+${line.value}`}
                        {line.scalingStatus && <span className="scaling-tag">{line.scalingStatus}</span>}
                        {line.valueWithInstrument != null && line.instrumentFamily != null && (() => {
                          const id = selectedInstruments[line.instrumentFamily]
                          const opt = INSTRUMENT_OPTIONS[line.instrumentFamily].find(o => o.id === id)
                          const name = opt ? opt.name.replace(/\s*\(×[\d.]+\)\s*$/, '') : 'instr'
                          const pct = PERCENT_STATS.has(line.stat)
                          return <span className="instrument-val"> ({pct ? `${line.valueWithInstrument}%` : `+${line.valueWithInstrument}`} w/{name})</span>
                        })()}
                      </td>
                      <td className="bl-source">{line.sourceName}</td>
                      <td className="bl-provider">
                        {line.providerSlot !== null
                          ? `Slot ${line.providerSlot + 1} (${line.providerClass})`
                          : `Raid: ${line.providerClass}`}
                      </td>
                      <td className="bl-type">
                        <span className={`badge badge-${line.sourceType}`}>
                          {line.sourceType === 'bardRotation' ? 'bard ♪' : line.sourceType}
                        </span>
                        {line.sourceType === 'bardRotation' && (
                          <span className="bl-family">{instrFamilyLabel(line.instrumentFamily)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* Proc info */}
      {result.eligibleProcs.length > 0 && (
        <div className="section">
          <h2>Conditional Proc Buffs <span className="not-optimized">(not included in optimization)</span></h2>
          <p className="help-text">
            These proc on melee hits — not on-demand and not reliably available.
            Level requirements marked '?' are undocumented on the wiki.
          </p>
          <table className="buff-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Effect</th>
                <th>Provider</th>
                <th>Req. Lvl</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {result.eligibleProcs.map(({ procItem, procKey, providerSlot }) => (
                <tr key={procKey + providerSlot}>
                  <td>{procItem.itemName}</td>
                  <td>{procItem.name}</td>
                  <td>Slot {providerSlot + 1}</td>
                  <td>{procItem.requiredLevel ?? 'Unknown'}</td>
                  <td>{procItem.targetType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// BardRotationCard
// ---------------------------------------------------------------------------

interface BardRotationCardProps {
  rotation: import('./types').BardRotationResult
  slotNumber: number
  gameData: GameData
  lockedSongs: string[]
  onToggleLock: (spellId: string) => void
}

function BardRotationCard({ rotation, slotNumber, lockedSongs, onToggleLock }: BardRotationCardProps) {
  const lockedSet = new Set(lockedSongs)

  return (
    <div className="bard-rotation">
      <h3>Slot {slotNumber} Bard — Recommended 4-Song Rotation</h3>
      <p className="help-text">Click 🔒 to lock a song into the rotation regardless of score.</p>

      {rotation.songs.length === 0 && (
        <p className="empty-state">No songs improve over the current persistent baseline.</p>
      )}

      <div className="song-list">
        {rotation.songs.map((song, i) => (
          <div key={song.spellId} className={`song-row ${lockedSet.has(song.spellId) ? 'locked' : ''}`}>
            <span className="song-num">{i + 1}.</span>
            <span className="song-name">{song.spellName}</span>
            <span className="song-score">score: {song.score.toFixed(1)}</span>
            <span className="song-family">{instrFamilyLabel(song.instrumentFamily)}</span>
            <span className="song-rationale">{song.rationale}</span>
            <button
              className="btn-lock"
              title={lockedSet.has(song.spellId) ? 'Unlock this song' : 'Lock this song'}
              onClick={() => onToggleLock(song.spellId)}
            >
              {lockedSet.has(song.spellId) ? '🔒' : '🔓'}
            </button>
          </div>
        ))}
      </div>

      {rotation.alternatives.length > 0 && (
        <details className="alt-rotations">
          <summary>Alternative songs ({rotation.alternatives.length})</summary>
          {rotation.alternatives.map((alt, i) => (
            <div key={i} className="alt-rotation">
              {alt.map(s => (
                <div key={s.spellId} className="song-row alt">
                  <span className="song-name">{s.spellName}</span>
                  <span className="song-score">score: {s.score.toFixed(1)}</span>
                  <span className="song-family">{instrFamilyLabel(s.instrumentFamily)}</span>
                  <span className="song-rationale">{s.rationale}</span>
                </div>
              ))}
            </div>
          ))}
        </details>
      )}
    </div>
  )
}
