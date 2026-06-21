/**
 * P99 Buff Lines Scraper
 *
 * Page structure (inside <div class="stackguide">):
 *   <h2> major category  (Attribute Enhancing, AC Buffs, …)
 *   <h3> stat            (Agility, Strength, AC, …)
 *   <table> summary table — skip
 *   <h4> buff line       (Agility (Primary), AC (Slot 1), …)
 *   <ul>/<li> entries
 *
 * Each <li> example:
 *   +9 (+25) <a>Niv's Melody</a> (Group: <a>Bard</a> 47, Click: <a>Breath of Harmony</a>)
 *   +15 <a>Song of the Deep Seas</a> (Group Proc: <a>Nature's Melody</a>, <a>Siren Song, Dagger of the Sea</a>)
 *   +9 <a>Shield of Flame</a> (<a>Magician</a> 20, Click: <a>Blazing Vambraces</a>, Proc: <a>Charred Black Staff</a>)
 */

import * as fs from 'fs'
import * as path from 'path'
import { load as cheerioLoad, type CheerioAPI, type AnyNode, type Element } from 'cheerio'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InstrumentFamily = 'singing' | 'percussion' | 'string' | 'brass' | 'wind'

export interface BuffLine {
  name: string
  stat: string
  exceptions?: string[]
}

export interface SpellSlot {
  buffLineId: string
  value: number
  valueAtMin?: number
  minLevel?: number
  maxLevel?: number
  valueWithInstrument?: number
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WIKI_BASE = 'https://wiki.project1999.com'
const BUFF_LINES_URL = `${WIKI_BASE}/Buff_Lines`
const RATE_LIMIT_MS = 350
const BARD_CAST_TIME_SEC = 3
const BARD_DURATION_SEC = 18

// ---------------------------------------------------------------------------
// Class lookups
// ---------------------------------------------------------------------------

const CLASS_ABBR: Record<string, string> = {
  WAR: 'Warrior', CLR: 'Cleric', PAL: 'Paladin', RNG: 'Ranger',
  SHD: 'Shadow Knight', DRU: 'Druid', MNK: 'Monk', BRD: 'Bard',
  ROG: 'Rogue', SHM: 'Shaman', NEC: 'Necromancer', WIZ: 'Wizard',
  MAG: 'Magician', ENC: 'Enchanter', BST: 'Beastlord', BER: 'Berserker',
  SK: 'Shadow Knight',
}

const ALL_CLASSES = new Set([
  'Warrior', 'Cleric', 'Paladin', 'Ranger', 'Shadow Knight',
  'Druid', 'Monk', 'Bard', 'Rogue', 'Shaman', 'Necromancer',
  'Wizard', 'Magician', 'Enchanter', 'Beastlord', 'Berserker',
])

function resolveClass(raw: string): string {
  const t = raw.trim()
  return CLASS_ABBR[t.toUpperCase()] ?? CLASS_ABBR[t] ?? t
}

function isEQClass(name: string): boolean {
  return ALL_CLASSES.has(resolveClass(name.trim()))
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

async function fetchHtml(url: string): Promise<string> {
  console.log(`  GET ${url}`)
  const res = await fetch(url, {
    headers: { 'User-Agent': 'P99BuffOptimizer/1.0 (educational tool)' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// ---------------------------------------------------------------------------
// <li> entry parsing — state-machine over child nodes
// ---------------------------------------------------------------------------

interface LiEntry {
  spellName: string
  spellUrl: string
  value: number
  valueWithInstrument?: number
  targetType: 'self' | 'single' | 'group'
  classes: ClassEntry[]
  clickItems: Array<{ name: string; url: string }>
  procItems: Array<{ name: string; url: string }>
}

type ItemState = 'main' | 'click' | 'proc'

function parseLiElement($: CheerioAPI, li: Element): LiEntry | null {
  // Collect child nodes as a typed sequence
  type N = { kind: 'text'; content: string } | { kind: 'link'; text: string; href: string }
  const nodes: N[] = []

  function walk(node: AnyNode) {
    if (node.type === 'text') {
      nodes.push({ kind: 'text', content: (node as { data: string }).data ?? '' })
    } else if (node.type === 'tag') {
      const el = node as Element
      if (el.name === 'a') {
        const href = $(el).attr('href') ?? ''
        const text = $(el).text()
        nodes.push({ kind: 'link', text, href })
      } else {
        // Recurse into other tags (e.g. <br>, <span>)
        $(el).contents().each((_, child) => walk(child))
      }
    }
  }
  $(li).contents().each((_, child) => walk(child))

  // Build full text for the value pattern
  const fullText = nodes.map(n => n.kind === 'text' ? n.content : n.text).join('')

  // Must start with +N or have +N after whitespace
  const valueMatch = fullText.trim().match(/^\+(\d+)(?:\s*\(\+(\d+)\))?/)
  if (!valueMatch) return null
  const value = parseInt(valueMatch[1], 10)
  const valueWithInstrument = valueMatch[2] ? parseInt(valueMatch[2], 10) : undefined

  // State machine
  let state: ItemState = 'main'
  let targetType: 'self' | 'single' | 'group' = 'single'
  let spellLink: { text: string; href: string } | null = null
  let pendingClassLink: { className: string } | null = null

  const classes: ClassEntry[] = []
  const clickItems: Array<{ name: string; url: string }> = []
  const procItems: Array<{ name: string; url: string }> = []

  for (const node of nodes) {
    if (node.kind === 'text') {
      const t = node.content

      // Attribute level to pending class link
      if (pendingClassLink) {
        const m = t.match(/^\s*(\d+)/)
        if (m) {
          const level = parseInt(m[1], 10)
          if (!classes.some(c => c.class === pendingClassLink!.className)) {
            classes.push({ class: pendingClassLink.className, level })
          }
        }
        pendingClassLink = null
      }

      // Detect annotation transitions — check in order of priority
      if (/Group\s+Proc:\s*/i.test(t)) {
        targetType = 'group'
        state = 'proc'
      } else if (/\bProc:\s*/i.test(t)) {
        state = 'proc'
        // Don't change targetType here — proc item target type is determined
        // separately in addProcItem (defaults to 'self', unless entry.targetType='group')
      } else if (/\bClick:\s*/i.test(t)) {
        state = 'click'
      } else if (/\bGroup:\s*/i.test(t)) {
        targetType = 'group'
        // Stay in 'main' state — class links follow in the main area
      } else if (/\bGroup\b(?!\s*:)/i.test(t) && /\(Group\)/i.test(t)) {
        // Standalone (Group) annotation
        targetType = 'group'
      } else if (/Self-only:\s*/i.test(t)) {
        targetType = 'self'
        // Stay in 'main' state
      } else if (/Consumable:\s*/i.test(t)) {
        // Skip consumable items — don't change state for now,
        // but suppress following links until we leave this "section"
        state = 'main'  // treat as end of useful content
      } else if (/Worn:\s*/i.test(t)) {
        state = 'main'
      }
    } else {
      // Link node
      const linkText = node.text.trim()
      const href = node.href
      const fullUrl = href.startsWith('http') ? href : `${WIKI_BASE}${href}`

      if (!spellLink) {
        // First link is always the spell/effect name
        spellLink = { text: linkText, href: fullUrl }
        continue
      }

      if (state === 'click') {
        clickItems.push({ name: linkText, url: fullUrl })
      } else if (state === 'proc') {
        procItems.push({ name: linkText, url: fullUrl })
      } else {
        // state === 'main': class links or ignored
        if (isEQClass(linkText)) {
          pendingClassLink = { className: resolveClass(linkText) }
        }
        // Non-class links in main state (rare) are ignored
      }
    }
  }

  // Flush pending class with no trailing level text
  if (pendingClassLink && !classes.some(c => c.class === pendingClassLink!.className)) {
    classes.push({ class: pendingClassLink.className, level: 1 })
  }

  if (!spellLink) return null

  // Skip if no useful data
  if (classes.length === 0 && clickItems.length === 0 && procItems.length === 0) return null

  return {
    spellName: spellLink.text,
    spellUrl: spellLink.href,
    value,
    valueWithInstrument,
    targetType,
    classes,
    clickItems,
    procItems,
  }
}

// ---------------------------------------------------------------------------
// Main buff lines page parser
// ---------------------------------------------------------------------------

interface RawBuffLine {
  id: string
  name: string
  stat: string
  entries: LiEntry[]
  exceptions: string[]
}

async function parseBuffLinesPage(): Promise<{
  buffLines: Record<string, BuffLine>
  rawLines: RawBuffLine[]
}> {
  console.log('\n=== Fetching Buff_Lines page ===')
  const html = await fetchHtml(BUFF_LINES_URL)
  const $ = cheerioLoad(html)

  const buffLines: Record<string, BuffLine> = {}
  const rawLines: RawBuffLine[] = []

  let currentStat = ''
  let currentLineName = ''
  let currentLineId = ''
  let currentEntries: LiEntry[] = []
  let currentExceptions: string[] = []

  function flushLine() {
    if (!currentLineId) return
    if (!buffLines[currentLineId]) {
      const bl: BuffLine = { name: currentLineName, stat: currentStat }
      if (currentExceptions.length > 0) bl.exceptions = [...currentExceptions]
      buffLines[currentLineId] = bl
    }
    if (currentEntries.length > 0) {
      rawLines.push({
        id: currentLineId,
        name: currentLineName,
        stat: currentStat,
        entries: [...currentEntries],
        exceptions: [...currentExceptions],
      })
    }
    currentEntries = []
    currentExceptions = []
  }

  const stackguide = $('.stackguide')
  if (!stackguide.length) throw new Error('Could not find .stackguide on the page')

  stackguide.children().each((_i, elem) => {
    if (elem.type !== 'tag') return
    const tag = (elem as Element).name

    if (tag === 'h2') {
      flushLine()
      currentStat = $(elem).find('.mw-headline').text().trim()
      currentLineName = ''
      currentLineId = ''
      return
    }
    if (tag === 'h3') {
      flushLine()
      currentStat = $(elem).find('.mw-headline').text().trim()
      currentLineName = ''
      currentLineId = ''
      return
    }
    if (tag === 'h4') {
      flushLine()
      const headline = $(elem).find('.mw-headline')
      currentLineName = headline.text().trim()
      // Use the wiki anchor id (already unique per page) rather than the display
      // text, which repeats across stat sections (e.g. "Psalm" appears under
      // Disease, Magic, and Poison Resistance).
      const anchorId = headline.attr('id') ?? ''
      currentLineId = anchorId ? slugify(anchorId) : slugify(currentLineName)
      return
    }
    if (tag === 'table') return  // skip summary tables

    if (tag === 'ul' && currentLineId) {
      $(elem).children('li').each((_j, li) => {
        const entry = parseLiElement($, li as Element)
        if (entry) currentEntries.push(entry)
      })
      return
    }

    if (tag === 'p' && currentLineId) {
      const text = $(elem).text().trim()
      if (/stack|exception|bug|note/i.test(text) && text.length < 600) {
        currentExceptions.push(text)
      }
    }
  })

  flushLine()
  return { buffLines, rawLines }
}

// ---------------------------------------------------------------------------
// Item page parsing
// ---------------------------------------------------------------------------

interface ItemPageData {
  classRestriction: string[]
  requiredLevel: number | null
  levelKnown: boolean
  targetType: 'self' | 'single' | 'group'
  activationType: 'click' | 'proc' | 'worn' | 'unknown'
  effectName: string
  notes?: string
}

function parseItemPage(html: string): ItemPageData {
  const $ = cheerioLoad(html)
  const pageText = $('#mw-content-text').text()

  let effectName = ''
  let activationType: 'click' | 'proc' | 'worn' | 'unknown' = 'unknown'
  let requiredLevel: number | null = null
  let levelKnown = false

  // "Effect: SpellName (Must Equip, Casting Time: Instant) at Level 45"
  // "Effect: SpellName (Any Slot/Can Equip, Casting Time: Instant) at Level 45"
  // "Effect: SpellName (Combat, Casting Time: Instant)"
  // "Effect: SpellName (Worn)"
  const effectLine = pageText.match(
    /Effect:\s*([^\n(]+?)\s*\(([^)]+)\)(?:[^\n]*at\s+[Ll]evel\s+(\d+))?/
  )
  if (effectLine) {
    effectName = effectLine[1].trim()
    const tag = effectLine[2].toLowerCase()
    if (tag.includes('worn')) {
      activationType = 'worn'
    } else if (tag.includes('combat')) {
      activationType = 'proc'
    } else if (
      tag.includes('must equip') || tag.includes('any slot') ||
      tag.includes('can equip') || tag.includes('casting time')
    ) {
      activationType = 'click'
    }
    if (effectLine[3]) {
      requiredLevel = parseInt(effectLine[3], 10)
      levelKnown = true
    }
  }

  // Fallback level from "at Level X" or "Required level of X"
  if (!levelKnown) {
    const m = pageText.match(/(?:at\s+[Ll]evel|[Rr]equired\s+level\s+of)\s+(\d+)/)
    if (m) { requiredLevel = parseInt(m[1], 10); levelKnown = true }
  }

  // Class restrictions — "Class: WAR CLR PAL SHD BRD"
  const classRestriction: string[] = []
  const classLine = pageText.match(/\bClass(?:es)?:\s*([A-Z]{2,3}(?:[ \t]+[A-Z]{2,3})*)/)
  if (classLine) {
    const tokens = classLine[1].match(/[A-Z]{2,3}/g) ?? []
    for (const t of tokens) {
      const full = CLASS_ABBR[t]
      if (full) classRestriction.push(full)
    }
  }

  // Target type
  let targetType: 'self' | 'single' | 'group' = 'single'
  const targetLine = pageText.match(/\bTarget(?:ing)?:\s*(Group|Self|Single|AE)/i)
  if (targetLine) {
    const t = targetLine[1].toLowerCase()
    targetType = t === 'group' ? 'group' : t === 'self' ? 'self' : 'single'
  } else if (/\byour\s+group\b/i.test(pageText)) {
    targetType = 'group'
  } else if (/\bself[- ]only\b/i.test(pageText)) {
    targetType = 'self'
  }

  return { classRestriction, requiredLevel, levelKnown, targetType, activationType, effectName }
}

// ---------------------------------------------------------------------------
// Spell page scaling parser
// ---------------------------------------------------------------------------

interface ScalingEntry {
  valueAtMin: number
  minLevel: number
  valueAtMax: number
  maxLevel: number
}

function parseSpellScaling(html: string): ScalingEntry[] {
  const $ = cheerioLoad(html)
  const pageText = $('#mw-content-text').text()
  const entries: ScalingEntry[] = []
  // Matches: "by 5 (L1) to 20 (L60)" or "by 65% (L5) to 65% (L50)"
  const pattern = /by\s+(\d+)%?\s+\(L(\d+)\)\s+to\s+(\d+)%?\s+\(L(\d+)\)/gi
  let m: RegExpExecArray | null
  while ((m = pattern.exec(pageText)) !== null) {
    entries.push({
      valueAtMin: parseInt(m[1], 10),
      minLevel:   parseInt(m[2], 10),
      valueAtMax: parseInt(m[3], 10),
      maxLevel:   parseInt(m[4], 10),
    })
  }
  return entries
}

// ---------------------------------------------------------------------------
// Build output datasets
// ---------------------------------------------------------------------------

async function buildDatasets(rawLines: RawBuffLine[]) {
  const spells: Record<string, Spell> = {}
  const clicks: Record<string, ClickItem> = {}
  const procs: Record<string, ProcItem> = {}

  // Gather unique items to scrape
  const itemsToFetch = new Map<string, { url: string; annotationType: 'click' | 'proc' }>()
  for (const line of rawLines) {
    for (const e of line.entries) {
      for (const item of e.clickItems)
        itemsToFetch.set(item.name, { url: item.url, annotationType: 'click' })
      for (const item of e.procItems)
        itemsToFetch.set(item.name, { url: item.url, annotationType: 'proc' })
    }
  }

  // Scrape item pages
  console.log(`\n=== Scraping ${itemsToFetch.size} item pages ===`)
  const itemCache = new Map<string, ItemPageData>()

  for (const [name, { url }] of itemsToFetch) {
    await sleep(RATE_LIMIT_MS)
    try {
      const html = await fetchHtml(url)
      const data = parseItemPage(html)
      itemCache.set(name, data)
      console.log(`    ✓ ${name}: ${data.activationType}, lvl=${data.requiredLevel ?? '?'}, target=${data.targetType}, classes=[${data.classRestriction.join(', ')}]`)
    } catch (err) {
      console.warn(`    ✗ ${name}: ${err}`)
      const fallback = itemsToFetch.get(name)!.annotationType
      itemCache.set(name, {
        classRestriction: [],
        requiredLevel: null,
        levelKnown: false,
        targetType: 'single',
        activationType: fallback,
        effectName: '',
        notes: `Page fetch failed: ${err}`,
      })
    }
  }

  // Build records
  for (const line of rawLines) {
    for (const entry of line.entries) {
      const slot: SpellSlot = {
        buffLineId: line.id,
        value: entry.value,
        ...(entry.valueWithInstrument != null ? { valueWithInstrument: entry.valueWithInstrument } : {}),
      }

      // Process click items (as annotated on Buff_Lines page)
      for (const item of entry.clickItems) {
        const pd = itemCache.get(item.name)
        if (pd?.activationType === 'worn') continue

        // Trust item page for activation type
        const isActuallyProc = pd?.activationType === 'proc'

        if (isActuallyProc) {
          // Buff_Lines says "Click:" but item page says proc — put in procs
          addProcItem(procs, item, entry, pd, slot)
        } else {
          // It's a click (or unknown — treat as click)
          addClickItem(clicks, item, entry, pd, slot)
        }
      }

      // Process proc items (as annotated on Buff_Lines page)
      for (const item of entry.procItems) {
        const pd = itemCache.get(item.name)
        if (pd?.activationType === 'worn') continue

        const isActuallyClick = pd?.activationType === 'click'

        if (isActuallyClick) {
          addClickItem(clicks, item, entry, pd, slot)
        } else {
          addProcItem(procs, item, entry, pd, slot)
        }
      }

      // Spell entry (has class entries)
      if (entry.classes.length > 0) {
        const spellSlug = slugify(entry.spellName)
        const isBard = entry.classes.some(c => c.class === 'Bard')

        if (!spells[spellSlug]) {
          spells[spellSlug] = {
            name: entry.spellName,
            sourceUrl: entry.spellUrl,
            classes: [],
            targetType: entry.targetType,
            isBardSong: isBard,
            ...(isBard ? { castTimeSec: BARD_CAST_TIME_SEC, durationSec: BARD_DURATION_SEC } : {}),
            slots: [],
          }
        }

        for (const cls of entry.classes) {
          if (!spells[spellSlug].classes.some(c => c.class === cls.class)) {
            spells[spellSlug].classes.push(cls)
          }
        }
        // Upgrade targetType: if any buff line entry annotates this spell as 'group',
        // upgrade the spell's targetType (many group spells only have 'Group:' on some lines)
        if (entry.targetType === 'group' && spells[spellSlug].targetType !== 'group') {
          spells[spellSlug].targetType = 'group'
        }
        if (isBard) {
          spells[spellSlug].isBardSong = true
          spells[spellSlug].castTimeSec = BARD_CAST_TIME_SEC
          spells[spellSlug].durationSec = BARD_DURATION_SEC
        }

        // Add or upgrade slot (keep highest value per buff line)
        const existing = spells[spellSlug].slots.find(s => s.buffLineId === slot.buffLineId)
        if (!existing) {
          spells[spellSlug].slots.push(slot)
        } else if (slot.value > existing.value) {
          existing.value = slot.value
          if (slot.valueWithInstrument != null) existing.valueWithInstrument = slot.valueWithInstrument
        }
      }
    }
  }

  return { spells, clicks, procs }
}

function addClickItem(
  clicks: Record<string, ClickItem>,
  item: { name: string; url: string },
  entry: LiEntry,
  pd: ItemPageData | undefined,
  slot: SpellSlot,
) {
  const slug = slugify(item.name)
  if (!clicks[slug]) {
    clicks[slug] = {
      name: pd?.effectName || entry.spellName,
      itemName: item.name,
      itemUrl: item.url,
      requiredLevel: pd?.requiredLevel ?? null,
      levelKnown: pd?.levelKnown ?? false,
      classRestriction: pd?.classRestriction.length
        ? pd.classRestriction
        : entry.classes.map(c => c.class),
      // For click items: prefer the Buff_Lines entry's targetType (captures Group: prefix)
      // over the item page's generic detection (which often returns 'single')
      targetType: entry.targetType !== 'single' ? entry.targetType : (pd?.targetType ?? 'single'),
      slots: [],
      ...(pd?.notes ? { notes: pd.notes } : {}),
    }
  }
  if (!clicks[slug].slots.some(s => s.buffLineId === slot.buffLineId)) {
    clicks[slug].slots.push(slot)
  }
  // Upgrade targetType if we learn it's group from any entry
  if (entry.targetType === 'group') clicks[slug].targetType = 'group'
}

function addProcItem(
  procs: Record<string, ProcItem>,
  item: { name: string; url: string },
  entry: LiEntry,
  pd: ItemPageData | undefined,
  slot: SpellSlot,
) {
  const slug = slugify(item.name)
  // Proc target type: use 'self' by default (procs only affect wielder)
  // unless the Buff_Lines entry specifically says 'group' ("Group Proc:")
  const procTargetType: 'self' | 'single' | 'group' =
    entry.targetType === 'group' ? 'group' :
    (pd?.targetType === 'group' ? 'group' : 'self')

  if (!procs[slug]) {
    procs[slug] = {
      name: pd?.effectName || entry.spellName,
      itemName: item.name,
      itemUrl: item.url,
      classRestriction: pd?.classRestriction.length
        ? pd.classRestriction
        : entry.classes.map(c => c.class),
      requiredLevel: pd?.requiredLevel ?? null,
      levelKnown: pd?.levelKnown ?? false,
      targetType: procTargetType,
      triggerCondition: 'melee hit while wielding',
      ...(pd?.notes ? { notes: pd.notes } : {}),
      slots: [],
    }
  }
  if (!procs[slug].slots.some(s => s.buffLineId === slot.buffLineId)) {
    procs[slug].slots.push(slot)
  }
  // Upgrade to group if we learn it from any entry
  if (procTargetType === 'group') procs[slug].targetType = 'group'
}

// ---------------------------------------------------------------------------
// Role weights
// ---------------------------------------------------------------------------

function buildRoleWeights() {
  // Weights are multipliers on marginal buff value used by the bard rotation scorer.
  // WIS, INT, Speed, and Charisma are handled as near-zero overrides in solver.ts
  // (STAT_LOW_WEIGHT) and are intentionally omitted here.
  // Resist stats are 0 by default and user-toggled to RESIST_ENABLED_WEIGHT (6)
  // in solver.ts — omit them from these tables entirely.
  return {
    // "None" role: sensible defaults for a typical mixed group.
    // Haste and regen are always welcome; melee stats moderately so.
    none: {
      'Haste':                   4,
      'Mana Regeneration':       3,
      'HP Regeneration':         3,
      'Damage Absorption':       2,
      'Damage Absorption, Magic': 2,
      'AC':                      2,
      'Strength':                2,
      'Attack (ATK)':            2,
      'Dexterity':               1.5,
      'Agility':                 1,
      'default':                 1,
    },
    // Caster-heavy group: mana and HP regen dominate; melee stats much less useful.
    casterGroup: {
      'Mana Regeneration':        6,
      'HP Regeneration':          4,
      'Damage Absorption, Magic': 3,
      'Damage Absorption':        2,
      'AC':                       2,
      'Haste':                    1.5,
      'Attack (ATK)':             0.5,
      'Strength':                 0.5,
      'Dexterity':                0.5,
      'default':                  1,
    },
    // Tank group: AC and haste are king; survivability stats elevated.
    tankGroup: {
      'Haste':                    4,
      'AC':                       4,
      'Damage Absorption':        3,
      'HP Regeneration':          3,
      'Strength':                 2.5,
      'Mana Regeneration':        2,
      'Damage Absorption, Magic': 2,
      'Attack (ATK)':             1.5,
      'Dexterity':                1.5,
      'Agility':                  1.5,
      'default':                  1,
    },
    // Pure melee DPS group: haste first, then offensive stats.
    meleeGroup: {
      'Haste':             5,
      'Strength':          3,
      'Dexterity':         3,
      'Attack (ATK)':      2.5,
      'Damage Absorption': 2,
      'HP Regeneration':   2,
      'Mana Regeneration': 1.5,
      'AC':                1.5,
      'Agility':           1.5,
      'default':           0.8,
    },
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('P99 Buff Lines Scraper\n')
  const outDir = path.join(process.cwd(), 'public', 'data')
  fs.mkdirSync(outDir, { recursive: true })

  const { buffLines, rawLines } = await parseBuffLinesPage()

  let spellEntries = 0, clickEntries = 0, procEntries = 0
  for (const line of rawLines) {
    for (const e of line.entries) {
      if (e.classes.length > 0) spellEntries++
      clickEntries += e.clickItems.length
      procEntries += e.procItems.length
    }
  }
  console.log(`\nParsed ${Object.keys(buffLines).length} buff lines`)
  console.log(`Entries: ${spellEntries} spell, ${clickEntries} click, ${procEntries} proc`)

  // Print stat groups
  console.log('\n=== Stat categories ===')
  const statGroups: Record<string, number> = {}
  for (const bl of Object.values(buffLines)) {
    statGroups[bl.stat] = (statGroups[bl.stat] ?? 0) + 1
  }
  for (const [stat, count] of Object.entries(statGroups)) {
    console.log(`  ${stat}: ${count} lines`)
  }

  const { spells, clicks, procs } = await buildDatasets(rawLines)
  const roleWeights = buildRoleWeights()

  console.log(`\nFinal: ${Object.keys(spells).length} spells, ${Object.keys(clicks).length} clicks, ${Object.keys(procs).length} procs`)

  // -------------------------------------------------------------------------
  // Scrape all spell pages: instrument skill (bard songs) + level scaling
  // -------------------------------------------------------------------------

  function parseInstrumentSkill(html: string): InstrumentFamily | null {
    const $ = cheerioLoad(html)
    let skillValue: string | null = null

    $('td').each((_i, el) => {
      if ($(el).text().trim() === 'Skill') {
        const next = $(el).next('td')
        if (next.length) {
          skillValue = next.text().trim()
          return false
        }
      }
    })

    if (!skillValue) return null
    const s = skillValue.toLowerCase()
    if (s === 'singing') return 'singing'
    if (s === 'brass') return 'brass'
    if (s === 'stringed' || s === 'string') return 'string'
    if (s === 'wind' || s === 'woodwind') return 'wind'
    if (s === 'percussion') return 'percussion'
    return null
  }

  // Collect all unique spell pages to fetch (deduplicated by URL)
  const spellPagesByUrl = new Map<string, string[]>()  // url → slugs
  for (const [slug, spell] of Object.entries(spells)) {
    const url = spell.sourceUrl
    if (!spellPagesByUrl.has(url)) spellPagesByUrl.set(url, [])
    spellPagesByUrl.get(url)!.push(slug)
  }

  console.log(`\n=== Scraping ${spellPagesByUrl.size} spell pages (instrument skill + level scaling) ===`)
  for (const [url, slugs] of spellPagesByUrl) {
    await sleep(RATE_LIMIT_MS)
    try {
      const html = await fetchHtml(url)
      const scalingEntries = parseSpellScaling(html)

      for (const slug of slugs) {
        const spell = spells[slug]

        // Instrument skill — bard songs only
        if (spell.isBardSong && spell.slots.some(s => s.valueWithInstrument != null)) {
          spell.instrumentSkill = parseInstrumentSkill(html)
        }

        // Level scaling — apply to any slot whose max value matches a parsed entry
        for (const entry of scalingEntries) {
          for (const slot of spell.slots) {
            if (slot.value === entry.valueAtMax && entry.valueAtMin !== entry.valueAtMax) {
              slot.valueAtMin = entry.valueAtMin
              slot.minLevel   = entry.minLevel
              slot.maxLevel   = entry.maxLevel
            }
          }
        }

        const instrNote = spell.isBardSong ? ` instr=${spell.instrumentSkill ?? 'null'}` : ''
        const scalingNote = scalingEntries.length > 0 ? ` scaling=${scalingEntries.length}` : ''
        console.log(`    ✓ ${spell.name}${instrNote}${scalingNote}`)
      }
    } catch (err) {
      for (const slug of slugs) {
        console.warn(`    ✗ ${spells[slug].name}: ${err}`)
        if (spells[slug].isBardSong) spells[slug].instrumentSkill = null
      }
    }
  }

  const write = (name: string, data: unknown) => {
    const p = path.join(outDir, name)
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8')
    console.log(`Wrote ${p}`)
  }

  write('buffLines.json', buffLines)
  write('spells.json', spells)
  write('clicks.json', clicks)
  write('procs.json', procs)
  write('roleWeights.json', roleWeights)

  // Validation
  console.log('\n=== Validation ===')

  // Test 1: Chant of Battle — 3 slots (DEX, STR, AC)
  const cob = spells['chant_of_battle']
  console.log(`Chant of Battle: ${cob ? cob.slots.map(s => s.buffLineId).join(', ') : 'NOT FOUND'}`)

  // Test: Anthem De Arms — STR + Attack Speed
  const ada = spells['anthem_de_arms']
  console.log(`Anthem De Arms: ${ada ? ada.slots.map(s => s.buffLineId).join(', ') : 'NOT FOUND'}`)

  // Test: Blazing Vambraces — click, single, WAR CLR PAL SHD BRD, lvl 45
  const bv = clicks['blazing_vambraces']
  console.log(`Blazing Vambraces: ${bv ? `classes=[${bv.classRestriction.join(',')}] lvl=${bv.requiredLevel} target=${bv.targetType}` : 'NOT FOUND'}`)

  // Test: Charred Black Staff — proc, self, NEC WIZ MAG ENC, lvl unknown
  const cbs = procs['charred_black_staff']
  console.log(`Charred Black Staff: ${cbs ? `classes=[${cbs.classRestriction.join(',')}] lvl=${cbs.requiredLevel ?? 'unknown'} target=${cbs.targetType}` : 'NOT FOUND'}`)

  // Test: Breath of Harmony — click, GROUP, Bard, lvl 50
  const boh = clicks['breath_of_harmony']
  console.log(`Breath of Harmony: ${boh ? `target=${boh.targetType} lvl=${boh.requiredLevel} classes=[${boh.classRestriction.join(',')}]` : 'NOT FOUND'}`)

  // Test: Singing Short Sword — must be in PROCS not clicks
  const sssClick = clicks['singing_short_sword']
  const sssProc = procs['singing_short_sword']
  console.log(`Singing Short Sword: clicks=${sssClick ? 'YES (WRONG)' : 'no'}, procs=${sssProc ? 'YES (correct)' : 'no'}`)

  // Test: Song of the Deep Seas — group proc target type
  const natMelody = procs['natures_melody']
  console.log(`Nature's Melody proc: ${natMelody ? `target=${natMelody.targetType}` : 'NOT FOUND'}`)

  // Test: Siren Song, Dagger of the Sea — should be one item not two
  const sirenDagger = procs['siren_song_dagger_of_the_sea']
  console.log(`Siren Song/Dagger: ${sirenDagger ? 'found as one item (correct)' : 'NOT FOUND'}`)

  // Sample bard songs
  console.log('\n=== Sample: Bard songs (first 10) ===')
  Object.values(spells)
    .filter(s => s.isBardSong)
    .slice(0, 10)
    .forEach(s => {
      const slots = s.slots.map(sl =>
        `${sl.buffLineId}(${sl.value}${sl.valueWithInstrument ? '/'+sl.valueWithInstrument : ''})`
      ).join(', ')
      console.log(`  "${s.name}" [${s.classes.map(c => `${c.class} ${c.level}`).join(', ')}] ${s.targetType} → ${slots}`)
    })

  console.log('\nDone!')
}

main().catch(err => { console.error(err); process.exit(1) })
