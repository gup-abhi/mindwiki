# MindWiki brand assets

**Concept — "M-graph":** the letter **M** drawn as a knowledge graph — four nodes
joined by edges form the strokes, with an amber node at the centre (a single
focal thought / entry). It says the whole name at once: the **M** of MindWiki and
the node-and-edge graph that *is* the product. Modern, geometric, scales to a
favicon.

## Files
| File | Use |
|------|-----|
| `mindwiki-icon.svg` | Square app-icon tile (deep-green, light graph). Source of truth. |
| `mindwiki-icon-1024.png` | Flattened 1024×1024 app icon (no alpha, full-bleed green) — App Store / Play / `app.json`. |
| `mindwiki-mark.svg` | Transparent mark (deep-green graph, amber node) for light backgrounds. |
| `mindwiki-mark-1024.png` | Rendered transparent mark. |
| `mindwiki-logo.svg` | Horizontal lockup: mark + "MindWiki" wordmark. Headers, landing, README. |
| `mindwiki-logo.png` | Rendered lockup. |

SVGs are the source — regenerate PNGs from them.

## Colors (from the app theme, `src/theme/colors.ts`)
| Token | Hex | Role |
|-------|-----|------|
| primary | `#2F4739` | tile / mark / "Mind" wordmark |
| accentText | `#3C6450` | "Wiki" wordmark |
| edge (on dark) | `#9FC4AC` | graph edges on the tile |
| node (on dark) | `#F4EFE7` | graph nodes on the tile |
| graphBehavior | `#E0BE72` | amber focal node (deeper `#D8A53C` on light) |
| bg | `#FBF8F4` | cream background |

Type: **Lora** (serif), 600 weight — the app's display font.

## Regenerate PNGs
```bash
cd branding
# app icon (full-bleed, no alpha — OS rounds the corners)
convert -background "#2F4739" -density 600 mindwiki-icon.svg -flatten -resize 1024x1024 mindwiki-icon-1024.png
# transparent mark
convert -background none -density 600 mindwiki-mark.svg -resize 1024x mindwiki-mark-1024.png
# lockup
convert -background "#FBF8F4" -density 600 mindwiki-logo.svg -resize 1100x mindwiki-logo.png
```

## Not done yet
- Wire into Expo: `app.json` `icon` + Android `adaptiveIcon` (foreground = the
  graph mark, background `#2F4739`) + splash. (Ask and I'll set it up.)
- Monochrome one-color variant for stamps/embossing.
