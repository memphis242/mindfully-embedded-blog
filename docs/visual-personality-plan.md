# MindfullyEmbedded Visual Personality Plan

## Core Identity

- Tone: technical + human.
- Theme: dark mode only.
- Typography: JetBrains Mono for all text roles.
- Subtext directly under `h1` headings should be concise and visually tuned to stay on one line on desktop widths (wrapping on smaller screens is acceptable).
- Visual style: simple cartoon-like illustrations that are professional and clean, not childish.

## Color System

MindfullyEmbedded uses Astronaut Blues/Reds as the primary UI palette and SOLARVILLE yellows/oranges as accents.

### Primary Surfaces and Text (Astronaut)

- `--bg-base`: #0f1d24
- `--bg-elev-1`: #162a34
- `--bg-elev-2`: #223b47
- `--text-main`: #e8f0f4
- `--text-muted`: #aacddd
- `--border`: #364a53
- `--danger-accent`: #dd4f39

### Accent/Highlight (SOLARVILLE)

- `--accent-main`: #e8b43d
- `--accent-strong`: #d48409
- `--accent-deep`: #be6000
- `--accent-outline`: #c64e00

## Motion and Atmosphere

- A tall section-specific background image must pan at a slower speed than page content.
- Parallax intensity is subtle and never reduces readability.
- Reduced-motion users should get no parallax movement.

## Section Motifs

- Home/Articles: signal traces, stars, and technical diagrams.
- Portfolio: cartoon shelf scene and device/tool icons.
- Bio: profile silhouette, timeline marks, and circuit motifs.
- Success Stories: growth arrows, checkpoints, and collaboration motifs.

## Portfolio System

- Portfolio index is a single responsive cartoon display shelf.
- Each project item has a representative icon/thumbnail and links to a dedicated detail page.
- Project detail pages place required hero media directly under the title (image or YouTube embed).

## Accessibility and Usability

- Dark mode contrast should remain comfortably readable.
- Focus styles are visible for keyboard navigation.
- Decorative imagery must not interfere with body text legibility.
- Motion must respect `prefers-reduced-motion`.
