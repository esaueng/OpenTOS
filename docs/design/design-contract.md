# OpenTOS Visual Design Contract

Approved references:

- `setup-workspace.png` — desktop study authoring
- `results-workspace.png` — desktop outcome comparison
- `mobile-results.png` — mobile review companion

## Product shell

- True cool white and light-gray application chrome around a deep graphite viewport.
- Compact, high-legibility sans-serif UI text with a monospaced treatment for measurements and identifiers.
- One-pixel neutral borders, small radii, minimal shadows, and no decorative gradients or glass effects.
- Desktop setup uses a quiet top bar, a 218–240 px workflow rail, a dominant 3D canvas, a 318–344 px inspector, and a 74–88 px readiness bar.
- Desktop results use a table-first outcome rail, a dominant comparison viewport, a verification inspector, and a directly labeled mass-versus-safety plot.
- Mobile is a review companion with one natural document scroll. Geometry authoring remains desktop-only.

## Semantic color roles

- `--accent`: selection, active navigation, and primary actions.
- `--preserved`: preserved interfaces.
- `--fixed`: fixed supports.
- `--obstacle`: keep-out regions and cautions.
- `--load`: load vectors and destructive warnings.
- `--success`: verified or complete states.
- `--preview`: unverified preview states.
- Status is always encoded with text and shape as well as color.

## Locked copy and information architecture

- Brand: `OpenTOS`
- Project: `Connecting Rod Study`
- Primary navigation: `Projects`, `Setup`, `Results`
- Setup steps: `Model`, `Regions`, `Loads`, `Objectives`, `Manufacturing`, `Review & Run`
- Canvas tools: `Select`, `Paint`, `Orbit`, `Section`
- Region legend: `Preserved`, `Fixed`, `Obstacle`, `Load`
- Context assistant: `Study Copilot`
- Results list: `OUT-01` through `OUT-04`
- Results controls: `Outcome`, `Original`, `Overlay`, `Stress`, `Displacement`
- Results sections: `Constraint checks`, `Solver provenance`, `Study Copilot`
- Results plot: `Mass vs. safety factor`
- Export actions: `Download STL`, `Export report`

## Component families

- `AppHeader`, `PrimaryNav`, `WorkflowRail`, `CanvasToolbar`, `ViewportLegend`
- `Inspector`, `InspectorSection`, `PropertyTable`, `ReadinessBar`
- `OutcomeTable`, `OutcomeViewer`, `MetricModeControl`, `TradeoffPlot`
- `ConstraintChecks`, `SolverProvenance`, `CopilotPanel`, `ExportBar`
- `MobileResultHeader`, `MobileOutcomeStrip`, and native disclosure sections

## Interaction contract

- React owns routing, selection, filters, inspector state, and accessible summaries.
- Three.js owns mesh rendering, camera control, picking, overlays, and disposal.
- SVG owns the tradeoff marks and scales; the outcome table is the complete non-visual fallback.
- Desktop state is URL-addressable with `view`, `outcome`, and `metric` search parameters.
- Hover is never required. Outcomes are selectable with pointer, keyboard, or touch.
- Clicking empty canvas clears selection only when the gesture was not a drag.
- Reduced motion disables auto-rotation and animated chart transitions.

## Intentional deviations from generated imagery

- Generated screenshots contain illustrative solver names, timestamps, identifiers, and measurements. The implementation must display real runtime provenance and outcome values only.
- No third-party solver branding is permitted unless that adapter actually produced the result.
- The mobile result strip may collapse to a compact list below 390 px, but the main viewer and current selection must remain visible first.
- Generated toolbar glyphs are references for metaphor and weight; production icons remain code-native SVG.

## Acceptance checks

- Desktop reference viewport: 1536 × 1024.
- Mobile reference viewport: 390 × 844.
- Match shell proportions, hierarchy, palette, typography density, border treatment, and canvas prominence.
- Keep the first desktop viewport fully usable at 1280 × 800.
- Preserve one natural scroll on mobile without nested scroll traps.
- Verify setup, results, mobile, keyboard, reduced-motion, loading, empty, failure, preview, and verified states.
