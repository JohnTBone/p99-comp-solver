# Build Spec: EverQuest P99 Group Comp Buff Optimizer

## 1. Goal

Build a web app that, given **any** party composition of up to 6 characters (each an arbitrary class + level, picked independently — e.g. Cleric, Druid, Shadow Knight, Enchanter), narrows down the buffs actually available to that specific group and runs a solver to find the optimal combination of buffs to maximize stat coverage. This is a general-purpose **comp builder**, not a bard-specific tool — bard is just one class among many that the solver needs to handle, with its rotation mechanic treated as a special case rather than the whole premise.

The primary use case — and the one the solver should be optimized for first — is the **single-party leveling experience**: a group of varying classes/levels that changes frequently as players join and leave. A secondary mode supports **raid scenarios**, where a bard's group has a specific role (caster support, tank support, or melee support) and buffs from outside the immediate 6-person group are relevant. See Section 7.

## 2. Domain Mechanics (encode these precisely — this is the hard part)

### 2.1 Buff lines (the core rule)
EverQuest groups beneficial spell/item effects into **buff lines**. Only the *strongest currently-active* effect within a line applies to a character — weaker ones are overwritten or simply don't stack. A single spell can have multiple numbered "slots," each independently belonging to a *different* buff line. Validated example:

- **Chant of Battle** (Bard): Slot 1 -> AC line, Slot 2 -> Strength (Anthem) line, Slot 3 -> Dexterity (Power) line
- **Anthem De Arms** (Bard): Slot 1 -> Attack Speed line, Slot 2 -> Strength (Anthem) line
- **Verses of Victory** (Bard): Attack Speed, AGI, AC, STR lines
- **Speed of the Shissar** (Enchanter): Attack Speed, AGI, Stamina-usage, AC lines

Casting both Chant of Battle and Anthem De Arms gives AC + Attack Speed + DEX + STR, but **only one STR value applies** (whichever is higher), since both put STR in the "Strength (Anthem)" line. A second, independent STR boost requires a spell with STR in a *different* line.

### 2.2 Buff line naming nuance — IMPORTANT
Some stats (notably AC, Attack, Damage Shield, HP Regen, Mana Regen) are subdivided not by descriptive name but by **slot number, and sometimes by "layer"** — e.g. `AC (Slot 1)`, `AC (Layer 2, Slot 1)`. A "Layer 2" slot is a *separate* line from the equivalent "Layer 1" slot number. **The buff line ID must be the full heading text**, not just the stat name.

Other stats (STR, DEX, AGI, CHA, INT, WIS, STA) use descriptive line names instead (e.g. "Strength (Primary)", "Strength (Anthem)", "Strength (Power)"). Same rule: only the best value within each named line counts.

At least one documented exception exists where two spells that *should* share a line actually stack due to a dev bug (Focus of Spirit + Mortal Deftness, DEX, order-dependent). Preserve any such footnotes from the source rather than silently "correcting" them.

### 2.3 Bard rotation mechanic (applies only when a Bard is in the party)
- Bard song cast time: **~3 seconds**, uniform across virtually all songs.
- Bard song duration: most songs last 3 server ticks, which works out to **roughly 12-18 seconds** depending on tick alignment (commonly cited as ~18s for planning purposes).
- Net effect: a skilled bard can reliably keep **4 songs continuously active** via a repeating cast rotation ("twisting"). 5 is sometimes claimed as achievable in edge cases but isn't reliable — use 4 as the design constant.
- If the comp has 0 bards, this mechanic is irrelevant. If it has 2 bards, each bard independently gets a 4-song rotation, and the solver should try not to have them duplicate the exact same song choices when a different pick would cover more ground (see Section 5.3).
- This 4-song cap applies only to spells cast through the normal twist rotation. Instant-cast clicks (Section 6.1) don't consume any of this budget — a bard with an eligible owned click effectively gets it in addition to their 4 songs, not instead of one.

### 2.4 Persistent (non-rotation) buffs
Every other buff-capable class's group buffs are "cast once, lasts many minutes" — no rotation accounting needed. The solver just needs to know, for each buff line, the best value any non-bard party member can currently provide. Target type matters: most useful group buffs are "Group," but some are "Self-only" and shouldn't be counted as benefiting the party. The source data generally annotates this inline (e.g. "(Group)" or "(Self-only: Class Level)") — parse and preserve it.

### 2.5 Target type, precisely
Three target types matter throughout this spec, and they behave differently depending on whether the provider is in the bard's own group or not:
- **Self:** only benefits the caster/clicker. Never counts as a buff source for anyone else, ever.
- **Single:** can be freely directed at any one individual, regardless of what group that individual is in.
- **Group:** applies automatically to the **caster's own group** — not the targeted individual's group, regardless of who is targeted. A Group-type buff cannot be "aimed" across group boundaries.

Within a single group this distinction rarely matters (caster and beneficiary already share a group, so either type works). It becomes critical once a buff provider is outside the group entirely — see Section 7.3.

## 3. Primary Data Source & Extraction Strategy

**Primary source:** https://wiki.project1999.com/Buff_Lines

This page is organized exactly the way the data model needs it: top-level sections by stat, sub-sections by named/numbered buff line, and each line lists every spell occupying it across **all classes**, with magnitude, class, and minimum level. Because multi-effect spells appear once per stat section they touch, **parsing the whole page and grouping every entry by spell name reconstructs each spell's complete multi-slot signature** for every class in the game, without scraping dozens of individual spell or class pages separately. Recommended approach:

1. Fetch and parse the *complete* Buff_Lines page (it's long — get the full content, not just the TOC).
2. Walk every stat section, every named/numbered line. For each leaf entry extract: spell/item name, base value, "with max instrument" value if shown (bard songs only), providing class(es) + minimum level if shown, and any inline annotation ("Group", "Self-only", "Click:", "Proc:", "Consumable:", "Worn:").
3. Build buffLines.json: id = exact section heading text, stat = parent category.
4. Build spells.json by aggregating same-named spell entries into one record with multiple slots, each with a targetType per Section 2.5.
5. Route "Click:" entries and "Proc:" entries to two **separate** extraction pipelines (see Section 6). "Consumable:" (potions) can be deferred. "Worn:" (passive gear bonuses) can be skipped for v1.
6. Preserve any explicit stacking-exception footnotes as an exceptions field on the relevant buff line.
7. Separately fetch https://wiki.project1999.com/Bard to cross-check the bard song list and catch any songs not well-represented in Buff_Lines.
8. Use the constants from Section 2.3 (3s cast / 18s duration / 4-song cap) as the default timing for all bard songs rather than scraping per-song timing.
9. **Item-level scraping pass (required, not optional):** for every distinct item referenced by a "Click:" or "Proc:" annotation in step 2, fetch that item's own wiki page and extract the fields described in Section 6, including target type (self/single/group) per Section 2.5 — don't assume "group" by default.

If the wiki blocks fetching or a page is too large to parse reliably in one pass, fall back to fetching in sections, or ask me for a saved local copy of the page HTML.

## 4. Data Model

```jsonc
// buffLines.json
{
  "ac_layer2_slot1": { "name": "AC (Layer 2, Slot 1)", "stat": "AC" },
  "strength_anthem": { "name": "Strength (Anthem)", "stat": "Strength" },
  "mana_regen_primary": { "name": "Mana Regeneration (Primary)", "stat": "Mana Regen" }
  // exact names/categories depend on what's actually on the scraped page — don't assume these exact strings
}

// spells.json
{
  "chant_of_battle": {
    "name": "Chant of Battle",
    "sourceUrl": "https://wiki.project1999.com/Chant_of_Battle",
    "classes": [{ "class": "Bard", "level": 1 }],
    "targetType": "group",
    "castTimeSec": 3,
    "durationSec": 18,
    "isBardSong": true,
    "slots": [
      { "buffLineId": "ac_layer2_slot1", "value": 6, "valueWithInstrument": 16 },
      { "buffLineId": "strength_anthem", "value": 20, "valueWithInstrument": 56 }
    ]
  }
}

// clicks.json — player-activated, on-demand, reliable
{
  "blazing_vambraces": {
    "name": "Shield of Flame",
    "itemName": "Blazing Vambraces",
    "itemUrl": "https://wiki.project1999.com/Blazing_Vambraces",
    "requiredLevel": 45,
    "classRestriction": ["Warrior", "Cleric", "Paladin", "Shadow Knight", "Bard"],
    "targetType": "single",
    "slots": [ { "buffLineId": "...", "value": 0 } ]
  },
  "breath_of_harmony": {
    "name": "Niv's Melody of Preservation",
    "itemName": "Breath of Harmony",
    "itemUrl": "https://wiki.project1999.com/Breath_of_Harmony",
    "requiredLevel": 50,
    "classRestriction": ["Bard"],
    "targetType": "group",
    "slots": [ { "buffLineId": "...", "value": 0 } ]
  }
}

// procs.json — combat-triggered, NOT on-demand, excluded from the main solver by default
{
  "charred_black_staff": {
    "name": "Shield of Flame",
    "itemName": "Charred Black Staff",
    "itemUrl": "https://wiki.project1999.com/Charred_Black_Staff",
    "classRestriction": ["Necromancer", "Wizard", "Magician", "Enchanter"],
    "requiredLevel": null,
    "levelKnown": false,
    "targetType": "self",
    "triggerCondition": "melee hit while wielding",
    "notes": "Proc trigger level/rate undocumented on the wiki as of research date.",
    "slots": [ { "buffLineId": "...", "value": 0 } ]
  }
}

// roleWeights.json — config only, not hardcoded into solver logic (see Section 7.4)
{
  "none": {},
  "casterGroup": { "Mana Regen": 5, "default": 1 },
  "tankGroup": { "AC": 3, "Strength": 2, "Attack Speed": 2, "default": 1 },
  "meleeGroup": { "Strength": 3, "Dexterity": 3, "Attack Speed": 3, "Agility": 2, "default": 1 }
}
```

Note: per-item click **ownership** (whether a given character actually has a given clicky item) is user-entered runtime state, not part of the static game data above — see Section 5.1. It should persist alongside saved comp presets (e.g. in localStorage).

## 5. App Functionality

### 5.1 Comp Builder UI
- 6 character slots. Each slot independently: class dropdown (full class roster + "Empty") + level input (1-60).
- No special "designate the bard" step — the solver automatically detects which slots are Bard and applies the rotation mechanic to just those.
- **Clicks are toggled per-item, not behind a single blanket switch.** Once a slot's class + level is set, show an expandable "Available Clicks" list scoped to that character: every click item whose classRestriction includes that class (items the class could never use under any circumstance simply aren't shown — no value in listing them). Each row shows the item name, the effect it grants, and its required level, with an individual checkbox the user toggles on if they actually own/have that item. **Default: unchecked — ownership is never assumed just because a character is eligible.** If the character's level is below the click's required level, the checkbox is disabled and visually greyed out — the row still displays (so the user can see what's coming as they level), but it can't be toggled on until the level requirement is met. Only items that are both checked AND level-eligible become candidate buff sources for the solver. A master "Show clicks" toggle can hide/show this whole UI section for users who don't want to deal with it, but doesn't bulk-enable anything — inclusion is always per-item.
- **"Include combat procs (experimental)"** — a single global toggle (procs remain a purely informational, non-interactive list with no ownership tracking, since they never feed the solver — see Section 6.2).
- A **"Raid Role Override"** selector (default: "None / Leveling Group"; see Section 7).

### 5.2 Resolution
- For each filled slot, filter the spell database to spells castable at that class/level.
- For clicks: present every class-eligible click for that slot regardless of level (Section 5.1), lock/grey out level-ineligible rows, and only pass checked + level-eligible items into the solver's candidate pool.
- For procs (if the global toggle is on): filter procs.json by class/level eligibility and route results to the separate informational list (Section 6.2); for levelKnown = false entries, always show them with the level marked unverified rather than excluding them.

### 5.3 Solver
- **Persistent layer:** for every buff line, take the best value among all available non-bard spells, owned-and-eligible clicks, and — in raid mode — eligible additional-raid-class buffs restricted to single-target-only sources for those external entries (Section 7.3) — across the whole group. This is a simple max; there's no scarcity here, so nothing competes for a slot.
- **Bard layer (only for slots where class = Bard):** for each such bard, enumerate combinations of up to 4 available songs and score each combination by total marginal value added over the current baseline. With multiple bards, process sequentially against a running baseline (a practical greedy solution, not a guaranteed joint optimum — state this explicitly).
- **Role weighting (raid mode only):** when a Raid Role Override is active, the bard-layer scoring step multiplies each buff line's marginal value by that line's configured weight for the active role (Section 7.4) before summing. The persistent layer is unaffected by role weighting, since nothing there is mutually exclusive.
- Combine persistent + bard-rotation results into one final buff plan per buff line. Procs are never part of this combined plan.

### 5.4 Output
- A per-buff-line table: buff line, winning value, source (spell, click, in-group character, or additional raid class), and type (persistent vs. bard-rotation).
- For each bard slot: the recommended 4-song rotation with a short rationale per song.
- Top 2-3 alternative bard rotations with scores; allow "locking" a song into the rotation regardless of score.
- If procs are toggled on, a separate "Conditional Proc Buffs (not included in optimization)" section.
- If raid mode is active, clearly distinguish in-group buff sources from additional-raid-class buff sources in the output, since the latter aren't occupying one of the 6 group slots.

## 6. Clicks vs. Procs

### 6.1 Clicks (player-activated, on-demand)
Reliable, like a spell — if a character is eligible *and the user has marked the item as owned* (Section 5.1), treat it as available. For each click item: fetch its own wiki page, extract its **class restriction**, the **click's required level** (capture the effect/click level specifically, which can differ from any separate level-to-equip), and its **target type** (self/single/group, Section 2.5) — don't assume "group" by default.

**Worked examples (validation cases):**
- Blazing Vambraces clicks Shield of Flame, requires level 45, usable by Warrior, Cleric, Paladin, Shadow Knight, or Bard, and is a **single-target** effect (confirmed against the live item page — no Group/Self-only annotation, which is the default for single-target on this wiki) — it can be clicked on any one individual regardless of group.
- Breath of Harmony is a **group-target** click: a level-50, Bard-only weapon (Must Equip) that triggers Niv's Melody of Preservation, whose own description confirms it explicitly — "a melody that offers **your group** protection from spell damage as well as increasing their strength and health regeneration." Clicking it only buffs the clicker's own group, regardless of who's targeted. (Worth noting: Niv's Melody of Preservation is also a normal Bard spell learnable at level 47 — the click just lets a Bard fit it in without spending a 3-second cast slot in their rotation, which is a nice example of why clicks and spells both need to be tracked as independent candidate sources for the same buff line rather than treated as redundant.)

**Why this matters for the bard rotation specifically:** because clicking an item happens outside the normal spell-casting system, it never consumes any of the bard's 3-second-cast / 4-song rotation budget (Section 2.3). A bard who owns an instant-click song effectively gets it "for free" alongside their 4 twisted songs, rather than needing to spend one of those 4 slots on it. **This is already the correct emergent behavior of the architecture as specified** — clicks live in the persistent layer (Section 5.3), entirely separate from the bard-layer's 4-song combinatorial search — so no special-casing is needed in the solver; just don't accidentally route clicks through the rotation logic during implementation.

**Confirmed via the P99 community (forum thread specifically cataloguing this exact question, corroborated by an experienced bard-guide author), Breath of Harmony is currently the *only* known instant-click, non-proc Bard song item** — worth verifying freshly during the actual scrape rather than assuming this is permanently exhaustive, but treat it as reliable current-state guidance. **Watch for look-alikes that aren't actually clicks:** Singing Short Sword (Dance of the Blade) and Nature's Melody / Siren Song, Dagger of the Sea (Song of the Deep Seas) all show "Casting Time: Instant" on their item pages too, but all three are tagged `(Combat, ...)` — they're **procs**, triggered probabilistically by a melee hit, not something a bard can click on demand. They do *not* grant a "free 5th slot" the way Breath of Harmony does, and must not be treated as reliable rotation-filling sources — this is precisely the kind of misclassification the parsing tip in Section 6.3 exists to prevent.

Within a single group, both single and group target types work fine for any member, since caster and beneficiary already share a group. This distinction only becomes consequential when the click's owner is outside the group entirely — see Section 7.3.

### 6.2 Procs (combat-triggered, NOT on-demand)
Triggers probabilistically from a melee hit while wielding the item — not player-activated, contingent on actually meleeing with that specific weapon equipped, and frequently **undocumented** for trigger level/rate. Procs must not be folded into the same pool as clicks/spells and must not feed the solver's optimization. For each: extract class restriction, target type (don't assume self-only — verify per item; **confirmed example of a group-target proc:** "Song of the Deep Seas" is documented on Buff_Lines as a Group Proc, sourced from items including Nature's Melody and Siren Song, so self-only is not a safe default assumption), and required level if stated. **If the level genuinely can't be found, store `requiredLevel: null, levelKnown: false` — do not guess.** Surface "Level requirement unknown" in the UI. Show eligible procs only in the separate, non-optimized list.

**Worked example (validation case):** Charred Black Staff procs Shield of Flame (self-only), requires a melee hit while wielding, usable by Necromancer, Wizard, Magician, or Enchanter — confirmed against the item's own wiki page, which lists the effect as "(Combat, Casting Time: Instant)" with no level shown anywhere on the page, i.e. genuinely undocumented rather than just hard to find.

### 6.3 Process requirement
Every item encountered via a Click: or Proc: annotation must have its own page individually reviewed — don't infer class/level/target-type eligibility from the spell-line context it appeared under (confirmed necessary: the Buff_Lines page itself often lists several items together under one line, e.g. "Click: Blazing Vambraces, Singing Steel Bracer, Charred Black Staff," with no per-item level breakdown at all — that data only exists on each item's own page). **Parsing tip:** each item's own wiki page states its effect type directly in parentheses next to the effect name — `(Must Equip, Casting Time: ...)` or `(Any Slot, Casting Time: ...)` both indicate a Click; `(Combat, Casting Time: ...)` indicates a Proc; `(Worn)` indicates a passive, non-activated bonus (skip per Section 3 step 5). This tag is a reliable, directly-stated classification signal sitting right on the page you're already fetching for level/class data — cross-check it against the Buff_Lines page's Click:/Proc: prefix rather than relying on either alone. If an item page is ambiguous or missing data, flag it for my review rather than guessing.

## 7. Raid Role Overrides

### 7.1 Purpose
In a raid, a bard is typically assigned to one of three group archetypes, each with a different song priority:
- **Caster Group** (Cleric, Druid, Shaman, Wizard, Necromancer, Magician, Enchanter): mana regeneration is the bard's designated role.
- **Tank Group** (Warrior, Shadow Knight, Paladin, sometimes Ranger): defensive stats are the priority, with melee stats as a secondary concern.
- **Melee Group** (Rogue, Monk, etc.): offensive/damage stats are favored.

This only matters for the bard's constrained 4-song choice — it has no effect on the persistent layer, since nothing there is mutually exclusive (Section 5.3). If a raid role is selected but there's no bard in the group, note this in the UI ("No bard in this group — role override has no effect") rather than silently doing nothing.

The default mode, **"None / Leveling Group,"** uses uniform weighting and is the primary, most-used mode — build and validate this first (Section 10). Raid overrides are an additive layer on top, not a replacement for the default solver.

### 7.2 Role selector
A single selector: `None / Leveling Group` (default) | `Caster Group` | `Tank Group` | `Melee Group`.

### 7.3 Additional Raid Classes
Selecting any override other than the default reveals an **"Additional Raid Classes"** input: an open-ended, add/remove list (no 6-slot limit) where the user enters class + level for any other casters present in the broader raid who aren't in the bard's own 6-person group but could potentially still buff it.

**How reachability actually works (Section 2.5 applies directly here, and this is independently confirmed — not just inferred from the items above):** a Group-type buff always lands on the *caster's own group*, regardless of who they target — it cannot be aimed across group boundaries. This matches how live-EQ players describe even Mass Group Buff behavior ("it's a group spell, it doesn't matter who you target") and is the whole reason raid groups need a buffer physically present (or a single-target version of a buff) to cover each group separately. So a raid member who isn't in the bard's group gets nothing from their Group-type spells or clicks no matter who they target with them. The only way an outside raid member can help is with a **single-target** effect (spell or click), which can be freely directed at any individual regardless of group.

Concrete worked example (validation case): an "additional raid class" entry with a level-45+ eligible class who owns Blazing Vambraces (single-target, confirmed) can have that click counted as a real source for the bard's group. The same logic applies to Breath of Harmony (group-target, confirmed, Bard-only at level 50): a second Bard entered as an additional raid class, even if they own and click it, never contributes Niv's Melody of Preservation to the bard's group — it only ever buffs their own, different group.

Accordingly, for additional raid class entries:
- Only `targetType: "single"` spells and clicks count as candidate buff sources for the bard's group.
- `targetType: "group"` and `targetType: "self"` are always excluded for these entries, regardless of class/level eligibility — not deprioritized, excluded outright, since they mechanically cannot reach the group.
- Group-type clicks can still be shown in an additional raid class entry's click list (greyed out, unselectable, same visual pattern as a level-locked item) with a short note such as "Group-only effect — won't reach this group," rather than being hidden entirely.
- In-group members are unaffected by this rule — both single and group target types work normally for them.
- Additional raid classes still require a level input even though they're "extra," since spell/click availability is level-gated the same as anyone else, and some raid encounters have a hard participant level restriction (e.g. certain P99 raid targets cap around level 52).
- Additional raid class entries never contribute a bard rotation, even if the class entered is itself Bard — rotation only applies to bards physically in the 6-person group.

**Known simplification:** the solver treats a buff line as "covered" once any eligible single-target or group-eligible-in-group source exists, without modeling whether a single-target effect would realistically need to be re-cast on each of the 6 members individually to cover the whole group (in reality it lands on whichever one person it's cast on). This is an acceptable v1 simplification — worth a brief note in the UI/tooltip rather than a full per-member simulation.

### 7.4 Weighting mechanism
Define role weights as **external config data** (roleWeights.json, Section 4), not hardcoded logic — a mapping from stat category (using whatever category names actually exist in the scraped buffLines.json `stat` field — verify against real data rather than assuming exact names) to a multiplier per role. The bard-layer scoring step multiplies each candidate song's marginal value-per-line by the active role's weight for that line's stat category (default weight 1 for unlisted categories) before summing to choose the best 4-song combo. Consider exposing the active weights in a small settings panel as a stretch goal.

## 8. Validation / Test Cases

1. Chant of Battle + Anthem De Arms together: AC, DEX, and Attack-Speed-relevant lines all apply as expected; only the higher of the two STR values applies.
2. Adding Verses of Victory: adds Attack Speed and AGI (new lines); AC and STR get evaluated against whatever's already best.
3. Comp test (no bard): Cleric + Druid + Shadow Knight + Enchanter — sensible per-line buff plan using only persistent spells, no bard-rotation section shown.
4. Mixed comp: the above four plus a Bard and a second support class — bard's rotation optimized against the other five characters' persistent buffs, verified against actual scraped numbers.
5. Clicks toggle, Shield of Flame case: a level-45+ Warrior/Cleric/Paladin/Shadow Knight/Bard with Blazing Vambraces checked as owned shows it as an eligible source; the same character under level 45 sees the row greyed out and unselectable.
6. Procs toggle, Shield of Flame case: Charred Black Staff only ever appears in the separate, non-optimized proc list, only for Necromancer/Wizard/Magician/Enchanter, with level requirement explicitly marked unknown.
7. Raid override, Caster Group: a bard grouped with casters, role set to Caster Group, shifts the bard's recommended rotation toward mana-regeneration lines (verify against actual scraped data — don't assume specific song names ahead of time) compared to the same comp under "None / Leveling Group."
8. Additional raid classes, spell case: with Caster Group selected and a Shaman entered as an additional raid class, only the Shaman's single-target buffs appear as available sources; the Shaman's Group-type buffs never appear as a source for the bard's group, and the Shaman never occupies a group slot card.
9. No bard, role override selected: the UI surfaces a note that the override has no effect, rather than silently changing nothing with no explanation.
10. Per-item click toggle: a class-eligible click below a character's level appears in the list but its checkbox is disabled/greyed; raising the level above the requirement makes it selectable; leaving an eligible click unchecked excludes it from the solver, checking it includes it.
11. Class-ineligible clicks never appear in a character's click list at all (vs. level-ineligible ones, which appear greyed out).
12. Raid click reachability: Blazing Vambraces, owned by a level-eligible additional raid class entry, becomes a real includable source for the bard's group. Breath of Harmony, owned by a second Bard entered as an additional raid class entry (level 50+), never becomes includable for the bard's group regardless of ownership — Niv's Melody of Preservation only works that way when sourced from a Bard physically in the group.
13. Click doesn't consume rotation budget: an in-group Bard at level 50+ with Breath of Harmony owned and checked should have Niv's Melody of Preservation covered by the click in the persistent layer, and the bard's recommended 4-song rotation should be optimized as if that buff line were already handled — i.e. it should freely pick 4 *other* songs rather than "wasting" a rotation slot on a song the click already covers.

## 9. Tech Stack

Suggest a simple client-side single-page app — no backend required:
- Vite + React + TypeScript
- All buff/spell/click/proc/role-weight data bundled as static JSON (built once via the scraping step above, then committed to the repo and manually correctable)
- localStorage for saving comp presets, including per-item click ownership state

(Plain HTML/CSS/vanilla JS with no build step is also fine if you'd rather keep it minimal — optimize for something you can actually get running quickly.)

## 10. Process Notes for Claude Code

- Start with a working vertical slice: scrape and parse the full Buff_Lines page, get the data model solid and validated against Section 8's test cases, then build the UI on top of it. Don't build UI against fake/placeholder data.
- Build the comp builder and persistent-layer solver first (works for any non-bard comp, spells only), then layer in the bard rotation mechanic.
- Clicks and procs come next — build clicks (including the per-item ownership UI) before procs, since clicks feed the solver directly and procs are informational-only.
- **Raid role overrides and additional raid classes are the last layer to build**, since the single-party leveling solver (default mode) is the primary value of this app and should be fully solid before adding raid-specific complexity on top of it.
- If any stacking rule, slot/layer interpretation, item class restriction, target type, proc detail, or buff-line stat category naming is ambiguous or undocumented, ask me rather than guessing — fabricating a proc level, a target type, or a stat category that doesn't actually exist in the data defeats the point of the app.

## 11. Stretch Goals (not required for v1)
- Let the user manually pick which specific spells a character actually has memorized, the same way clicks already require explicit ownership.
- Account for the ~15-buff-slot cap per character.
- Community parse data to fill in undocumented proc rates/levels, clearly sourced and dated, rather than wiki-only data.
- True joint optimization across multiple bards instead of sequential greedy.
- Editable role-weight config exposed directly in the UI (settings panel) rather than only in a JSON file.
- Optional raid level cap field that warns (doesn't block) if an entered character exceeds it.
- Per-item ownership tracking extended to procs, purely for informational completeness (procs still wouldn't feed the solver).
