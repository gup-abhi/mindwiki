# MindWiki UI Design System

## Purpose

This is the canonical visual and interaction contract for MindWiki. It keeps future screens coherent while protecting the product's privacy-first, reflective, and non-coercive character.

The visual direction is **Quiet Editorial**: warm, calm, readable, and precise. It refines the existing cream, sage, Lora, and Nunito foundation rather than replacing it with a new UI framework or a generic dashboard aesthetic.

## Scope and non-goals

This document governs:

- Visual hierarchy, layout, typography, color, surfaces, and elevation
- Shared component behavior and accessibility
- Navigation, safe areas, motion, and status communication
- Screen composition and visual QA

It does not change:

- Routes, route parameters, stores, hooks, services, or data models
- The four-tab information architecture
- Encryption, sync, recovery, crisis, or account behavior
- The privacy boundary around authored journal content

Every redesign slice must preserve existing business behavior and test IDs unless a deliberate accessibility correction requires an updated semantic label.

## Quiet Editorial principles

1. **Make the next helpful action obvious.** Prefer one primary action over a grid of competing cards.
2. **Let content breathe.** Use the existing 4-point spacing scale and restrained surfaces instead of decoration or density.
3. **Use typography to create hierarchy.** Lora is for reflective reading and authored content; Nunito is for controls, navigation, labels, and status.
4. **Reveal progressively.** Show the essential context first; expose detail when the user asks for it.
5. **Make calm feel intentional.** Use warm paper neutrals, restrained teal interaction, gentle borders, and low elevation. Avoid visual noise.
6. **Make state truthful.** Saved, queued, processing, failed, and complete are different states and must not be visually conflated.
7. **Keep knowledge transparent.** Use the indigo knowledge roles only for evidence-backed or explicitly tentative generated knowledge, and keep it visually distinct from user-authored content and pending work.
8. **Design for return, not compulsion.** The product should be easy to leave and reassuring to return to.
9. **Keep personalization inspectable.** Defaults and suggestions must be editable and grounded in local evidence.

### Color position

MindWiki uses a warm-paper background with restrained teal for general interaction and an indigo family for generated-knowledge provenance. This is a hierarchy and transparency decision, not a claim that a hue universally produces a psychological effect. Color associations are contextual and culturally learned; readability, contrast, dark-mode legibility, and a clear non-color distinction take priority.

The first system/Home slice was informed by familiar content-first patterns in Day One, Apple Journal, and Stoic, alongside caution from Rosebud, Finch, Headspace, Calm, and Reflectly about separating user words, prompts, generated interpretation, and attention-oriented rewards. The resulting thesis is: **a private writing room with a transparent knowledge layer**.

Research references:

- [Day One](https://dayoneapp.com/) and [Day One features](https://dayoneapp.com/features/)
- [Apple Journal announcement](https://www.apple.com/newsroom/2023/12/apple-launches-journal-app-for-reflecting-on-everyday-moments/)
- [Stoic](https://www.stoicroutine.com/), [Rosebud](https://rosebud.app/), [Finch](https://finchcare.com/), [Headspace](https://www.headspace.com/), [Calm](https://www.calm.com/), and [Reflectly](https://reflectly.app/)
- [WCAG 2.2 contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), and [use of color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)
- [Elliot & Maier, Color Psychology](https://doi.org/10.1146/annurev-psych-010213-115035)
- [Jonauskaite et al., color-emotion associations](https://doi.org/10.1177/0956797620948810)
- [Apple dark mode guidance](https://developer.apple.com/design/human-interface-guidelines/dark-mode) and [Material dark theme guidance](https://m2.material.io/design/color/dark-theme.html)

### Explicit anti-patterns

Do not add:

- Fake progress, fake activity, fake results, or fabricated certainty
- Countdown timers, fake scarcity, or urgency around reflection, payment, or retention
- Loss-framed copy that pressures a user to continue
- Unexplained badges, red dots, rankings, or streak shame
- Notifications or accessibility labels containing authored journal text
- Raw journal text in route parameters, logs, network payloads, or telemetry
- Motion that hides state, delays action, or overwhelms a reduced-motion user

## Product navigation

The permanent bottom navigation has four labeled destinations, in this order:

1. **Home** — current state, recent entries, and the next helpful action
2. **You** — wiki pages, patterns, and Connections
3. **Reflect** — private companion conversations and guided paths
4. **Settings** — account, privacy, sync, recovery, models, and preferences

Navigation rules:

- Keep tabs as stable top-level destinations, not transient actions.
- Keep labels visible; icon-only navigation is not the default.
- Use familiar Ionicons and short, unambiguous labels.
- Communicate selection with more than color: icon treatment, label treatment, and accessibility state.
- Make the complete tab cell interactive. Target at least 44pt on iOS and 48dp on Android.
- Respect top and bottom safe areas, including gesture/home indicators.
- Do not add badges unless they represent a meaningful, current, resolvable state. A badge must not be a re-engagement hook.
- A creation action may be prominent, but it must not masquerade as a selected navigation destination.

## Semantic token contract

Use the existing theme contract in `src/theme/`:

- `colors.ts` — semantic light/dark color roles
- `typography.ts` — Lora content styles and Nunito UI styles
- `spacing.ts` — 4-point spacing and radius scales
- `shadows.ts` — calm low/medium/high elevation
- `theme.ts` and `ThemeProvider.tsx` — active theme and persistence

### Token rules

- Read semantic roles such as `bg`, `surface`, `textPrimary`, `textSecondary`, `textMuted`, `accent`, `primary`, `border`, `divider`, `success`, and `danger` through `useTheme()` or `useThemedStyles()`.
- Light and dark themes must expose the same token keys.
- Add a token only when an existing semantic role cannot express a real cross-screen state. Never add a screen-specific color token.
- Do not use raw color literals in migrated screens. Mood and graph colors remain centralized domain tokens.
- Use spacing and radii tokens rather than local numeric recipes.
- Use elevation sparingly. A surface does not need a shadow merely because it is a card.
- Verify contrast in both themes. Do not use opacity as a substitute for measuring contrast.

### Typography rules

- **Lora:** journal content, wiki content, reflective body copy, and long-form reading.
- **Nunito:** buttons, labels, navigation, metadata, status, filters, and system feedback.
- Preserve dynamic font scaling. Never solve a wrapping problem by disabling accessibility font scaling.
- If a label does not fit at an accessible size, shorten the label or reduce the number of peers.

## Primitive contracts

Reuse the existing primitives before creating a new one:

- `Button` — primary, secondary, ghost, and destructive actions; loading is reserved for real active work.
- `Card` — grouped or actionable surface; not a default wrapper for every block.
- `Chip` — editable choice or filter; not a notification badge.
- `Divider` — quiet structural separation.
- `EmptyState` — clear explanation plus the next useful action when possible.
- `IconButton` — icon-only action with a required accessible label and a full-size target.
- `ListRow` — full-row navigation or settings item with consistent title/subtitle/accessory hierarchy.
- `ProgressBar` — only for real persisted or active progress.
- `Screen` — safe area, background, status bar, keyboard-safe scrolling, and reduced-motion-aware entry behavior.
- `Text` — semantic type variant and theme color role.
- `TextField` — shared input styling, labels/errors, sensitive-writing safeguards, and Android multiline behavior.

### Interactive state requirements

Every interactive control must:

- Have a native role where available.
- Have an accessible name that does not expose authored content.
- Expose selected, expanded, disabled, busy, or checked state when applicable.
- Keep the entire visual control inside the target, not just a small icon.
- Remain understandable without color alone.
- Preserve a visible focus/pressed state without relying on animation.

## Motion and haptics

Motion is optional communication, never a requirement for comprehension.

- Use `useReducedMotion()` and provide an immediate static equivalent.
- Keep press feedback brief and subtle; do not animate a control when reduced motion is enabled.
- Do not add animation to compensate for unclear hierarchy.
- Do not use long horizontal transitions between peer tabs; they imply a back-stack relationship.
- Preserve existing Android/Fabric safeguards: input-heavy screens may use `animated={false}` and multiline fields must not fight the parent scroll responder.
- Haptics may confirm an intentional action, but must not be the only feedback.

## Screen composition recipes

### Screen header

Use a clear title, optional one-line context, and at most one adjacent action. Keep the title hierarchy consistent across sibling screens.

### Primary action block

One visually dominant action with a concrete label. Explain what will happen before asking for a commitment. Keep secondary paths quieter.

### Section heading

Use a short Nunito label or heading with consistent spacing. Do not turn every content fragment into a titled card.

### Quiet surface

Use `Card` or a surface background to group related content. Keep borders, radius, and elevation restrained. Avoid stacking several high-emphasis surfaces in one viewport.

### List and detail

Use `ListRow` for peer destinations and preserve a stable scanning rhythm. Use a stronger title, readable body, and clear source/status metadata in detail views.

### Segmented control

Use for a small set of peer views within one screen, such as Reflect Start/History/Paths or You Pages/Patterns/Map. It must have a full target, selected accessibility state, and a selected treatment that survives grayscale viewing.

### Empty state

Say what is empty, why it matters, and what the user can do next. Never imply that an empty state is a failure or use it to manufacture urgency.

### Status block

Use explicit language and distinct treatment for:

- Saved locally
- Waiting to process
- Processing now
- Ready
- Could not complete

A status block must not claim a wiki change until that change is actually evidenced.

## Privacy and content safety UI rules

- Treat journal and wiki content as sensitive everywhere, including accessibility, screenshots, notifications, crash reports, and route state.
- Prefer generic notification copy such as “A quiet moment to check in, if it would help.”
- Keep privacy explanations plain and progressive: local processing, encrypted sync, and recovery responsibilities should be understandable before commitment.
- Make “not now,” cancel, and back paths equally available where consent or optional capability is involved.
- Do not imply diagnosis, treatment, or certainty.
- Crisis support must remain clear and accessible without making ordinary distress feel like an emergency.

## Migration ledger

Update this table as each phase ships. “Device status” must reflect actual iOS and Android verification, not test-only confidence.

| Surface | Current concern | Phase | Tests | Device status | Rollback condition |
| --- | --- | ---: | --- | --- | --- |
| Theme and primitives | Warm-paper/teal system with indigo knowledge roles; shared target/motion/selected-state contracts hardened | 1 | Theme + UI suites | Pending physical-device verification | Existing component behavior or contrast contract regresses |
| Bottom tabs | Four labeled destinations with full-cell targets, semantic selection, and safe-area-aware quiet surface | 2 | Tab/layout suite | Pending physical-device verification | Route order, labels, or tab state changes |
| Home | Capture-first hierarchy with transparent pending/confirmed knowledge states | 3 | Home + Home component suites | Pending physical-device verification | Existing entry/path/status behavior changes or pending work looks confirmed |
| Reflect | Private companion start state and conversation surfaces refined with semantic borders, quiet surfaces, and full-size feeling chips | 4 | Query + composer + motion suites | Pending physical-device verification | Composer/history/back/crisis behavior changes |
| You | Pages, Patterns, and Map refined with transparent knowledge, evidence, and graph hierarchy | 5 | You + wiki/graph suites | Pending physical-device verification | Focus, opaque IDs, category navigation, chart, or node behavior changes |
| Settings | Long card stack mixes security and preferences | 6 | Settings suite | Pending physical-device verification | Sync/logout/delete/recovery behavior changes |

Reflect preserves a clear visual distinction between authored messages, companion synthesis, source provenance, pending work, and crisis support. User bubbles use the interaction teal; assistant replies use a quiet bordered surface; source affordances remain inspectable and pending states do not imply a confirmed wiki change.

Reflect migration status: automated query, composer, and reduced-motion suites pass. iOS and Android/Fabric verification remains pending.

You preserves a clear distinction between generated knowledge, evidence-backed patterns, and graph relationships. Pages remain navigational, patterns remain grounded in local mood/entry data, and Map labels describe connections rather than diagnoses or certainty.

You migration status: automated You, wiki, graph-route, and segmented-control suites pass. iOS and Android/Fabric verification remains pending.

Settings keeps preferences, security state, sync/recovery status, and destructive account actions visually distinct while preserving their existing privacy and confirmation flows.

Settings migration status: automated Settings suite passes. iOS and Android/Fabric verification remains pending.

| Auth and recovery | Credential inputs now share themed field semantics; recovery phrase hierarchy and targets refined | 7 | Auth, recovery, pairing, and layout suites | Pending physical-device verification | Auth/recovery/pairing behavior, privacy, or Fabric input behavior changes |
| Remaining routes | Onboarding/support, journal, guided paths, Trends, Wiki/graph, pairing, and safety surfaces now use the shared semantic recipes and interaction contracts | 8 | Focused route suites + full suite (all pass) | Pending physical-device verification | Privacy, route behavior, native scanner, or safety behavior changes |

## SPARC and TDD workflow

For every migration slice:

1. **SPEC** — define visible states, actions, edge cases, and non-goals.
2. **PSEUDO** — describe state and interaction flow before editing.
3. **ARCH** — identify the existing primitive, hook, and route boundary to reuse.
4. **TDD** — add or update focused failing tests for semantics and behavior.
5. **IMPL** — make the smallest UI change that satisfies the contract.
6. **REFINE** — check accessibility, privacy, reduced motion, font scaling, light/dark themes, and device behavior.

Run Jest only through:

```bash
bash .claude/scripts/run-jest.sh <focused test paths>
```

Then run `yarn tsc` and `yarn lint`. Before a phase is marked complete, run the full wrapped suite.

## Visual and device QA

Use the development-only design preview (`src/components/dev/DesignPreview.tsx`) with static, non-sensitive fixtures. Do not add Storybook, screenshot dependencies, analytics, or generated screenshot artifacts.

Review representative screens on physical iOS and Android/Fabric devices in:

- Light and dark themes
- Default and enlarged font scales
- Reduced-motion enabled
- Keyboard-open Entry, Auth, and Reflect states
- Top and bottom safe-area/gesture-navigation conditions
- One-handed use and full-row/touch target behavior
- Tab switching and back navigation
- Privacy-cover/backgrounding behavior

## Acceptance checklist for future UI work

Before merging a new UI feature, confirm:

- [ ] It uses semantic theme tokens and existing primitives where possible.
- [ ] It has one clear next action and no unnecessary attention hooks.
- [ ] All progress/status language corresponds to real state.
- [ ] Selected, disabled, expanded, and busy states are accessible and not color-only.
- [ ] Touch targets are at least 44pt iOS / 48dp Android.
- [ ] Dynamic type/font scaling does not clip or hide controls.
- [ ] Reduced motion has a static equivalent.
- [ ] Safe areas and keyboard behavior are verified.
- [ ] Authored journal text is absent from routes, logs, notifications, telemetry, and accessibility labels.
- [ ] Light/dark themes are reviewed.
- [ ] Focused Jest tests ran through the wrapper, followed by TypeScript and lint.
- [ ] Physical-device verification is recorded in the migration ledger when the change touches native layout, motion, input, or navigation.
