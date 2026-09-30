/**
 * dsh-glass-effect — client half (玻璃效果).
 *
 * Gives the app one family of glass surfaces: the floating surfaces
 * (composer, dialogs, menus) and the in-flow ones (cards, code blocks) share a
 * single translucent material instead of mixing flat fills with hairlines.
 *
 * Three levers, all stable in this app:
 *
 *   1. An injected stylesheet. Only `data-*` attributes, ARIA roles and the two
 *      literal class names this app ships (`md-code-block`) are selected —
 *      CSS-module class names are content-hashed and never referenced.
 *   2. A theme-token layer that owns EVERY fill: the elevation ladder
 *      (`--dsw-alias-bg-base`, `--dsw-alias-bg-layer-1/2/3`), the composer's
 *      own `--dsw-specific-input-major`, the markdown code-block pair,
 *      `--dsw-specific-tip` and `--dsw-specific-sidebar-fill` — plus
 *      `--dsw-mask-blur`. Token-level, so it reaches the components that
 *      expose no hook at all. The stylesheet hardcodes no colour of its own:
 *      every fill it names either references a `--dsw-*` token or is the
 *      ambient backdrop.
 *   3. An ambient backdrop on `body` (which propagates to the canvas), because
 *      translucency is meaningless on a flat fill: nothing sits behind these
 *      surfaces to refract.
 *
 * Elevation is COMPOSED, not replaced: `var(--dsw-elevation-soft|prominent)`
 * stays in every shadow stack and the glass rim is appended, so the shipped
 * hairline stroke and soft shadows survive.
 *
 * The whole treatment has ONE control: a preference row in
 * 设置 → 通用 → 外观 (directly under the light/dark/system cubes). Off means the
 * app is left exactly as shipped: every `data-lg-*` attribute is removed and the
 * token layer is RELEASED, so not one rule of this stylesheet can match.
 *
 * There are deliberately no keyboard shortcuts: the settings row is the only
 * switch, so there is exactly one place a state change can come from.
 */
window.__ModuleLoader__.load({
  id: 'dsh-glass-effect',
  // The factory receives the module table's `require`; without the parameter
  // the settings row's imports resolve to nothing.
  factory: function (require) {
    'use strict'

    /** Stylesheet identity: stable across reloads, removed on unload. */
    const TAG = 'dsh-glass-effect/client.css'

    /** Layer identity for the token override (one layer per source). */
    const LAYER_SOURCE = 'dsh-glass-effect'

    /**
     * Where the choices are remembered (per browser origin). The prefix is this
     * plugin's own name — package, folder, graph row, locale namespace and these
     * keys all read `dsh-glass-effect`/`glass-effect`, so nothing here carries a
     * name from an earlier revision.
     */
    const STORAGE_ENABLED = 'dsh-glass-effect-enabled'
    const STORAGE_LEVEL = 'dsh-glass-effect-level'
    const STORAGE_BACKDROP = 'dsh-glass-effect-backdrop'
    const STORAGE_DRAWER = 'dsh-glass-effect-drawer'

    /** The master switch starts ON: it preserves the look the user set up. */
    const DEFAULT_ENABLED = 1

    /** Frosted on first run: a clear-glass default is invisible on a flat canvas. */
    const DEFAULT_LEVEL = 2

    /** The backdrop is on by default: it is what makes the material read. */
    const DEFAULT_BACKDROP = 1

    /** The drawer is on by default: without a material its rounding is invisible. */
    const DEFAULT_DRAWER = 1

    /** Deepest glass level that still counts. */
    const MAX_LEVEL = 3

    /** Mask blur is a level >= this concern. */
    const MASK_BLUR_FROM = 2

    /** The mask already blurs 2px; this deepens it through the same token. */
    const MASK_BLUR = 'blur(10px) saturate(140%)'

    /* ------------------------------------------------------------------
     * The settings row: 设置 → 通用 → 外观 下方的一行总开关.
     *
     * `settings.general.item` passes NO owner props and projects NO label, so a
     * row draws its own copy. `order: 10.5` lands it directly under the shipped
     * Appearance row (id `appearance`, order 10), above font-size (11).
     * `locale` hands the component its `t`; `inject` hands it the plugin's own
     * state face.
     * ------------------------------------------------------------------ */
    const LOCALE_NS = 'glass-effect'
    const ROW_ID = 'glass-effect'
    const ROW_ORDER = 10.5

    /** Row copy, registered as this plugin's own locale namespace. */
    const MESSAGES = {
      zh: {
        'row.title': '玻璃效果',
        'row.description': '给输入框、弹窗、菜单、代码块等表面加上半透明玻璃材质；关闭即完全恢复原生外观',
      },
      en: {
        'row.title': 'Glass effect',
        'row.description': 'Translucent glass on the composer, dialogs, menus and code blocks; off restores the stock look',
      },
    }

    /** Module-table requests this bundle makes. `react` is a seed word. */
    const PRIMITIVES = '@deepseek-ai/dsh-client-ui-primitives'

    /* ------------------------------------------------------------------
     * Module-table imports. React is a shell seed word and ui-primitives is a
     * static UI library, so this bundle stays a classic script with no build.
     *
     * A failure here must NOT take the glass down: the settings row is a
     * convenience, and the plugin's actual job has to survive without it. The
     * row is simply skipped, loudly, if either import is unavailable.
     * ------------------------------------------------------------------ */
    let React
    let Switch
    try {
      React = require('react')
      Switch = require(PRIMITIVES).Switch
    } catch (error) {
      React = undefined
      Switch = undefined
    }

    /**
     * Settings row: the master switch for the whole treatment.
     *
     * The slot passes no owner props; `t` arrives because the registration
     * names this plugin's locale namespace, and the state face arrives from the
     * registration's `inject`. That face exposes a GETTER rather than a
     * snapshot, so a row that re-renders later cannot act on a stale value.
     *
     * @param props - composed slot props: `t` from locale, face from inject.
     * @returns the preference row element.
     */
    function GlassEffectRow(props) {
      const { t, isEnabled, setEnabled, subscribe } = props
      // Defensive: the row is a convenience. If the slot ever composes props
      // differently, degrade to "no row" instead of throwing inside the
      // settings panel — the glass itself must not depend on this contract.
      if (typeof isEnabled !== 'function' || typeof setEnabled !== 'function' || typeof subscribe !== 'function') {
        try {
          console.error('[dsh-glass-effect] settings row got no state face; row skipped')
        } catch (error) {
          // Logging is best-effort.
        }
        return null
      }
      const copy = typeof t === 'function'
        ? t
        : (key) => (MESSAGES.en[key] ?? key)
      const [on, setOn] = React.useState(function () { return isEnabled() })
      React.useEffect(function () {
        // Re-read on every notification instead of trusting an event payload:
        // the shortcut path changes the same value from outside this row.
        return subscribe(function () { setOn(isEnabled()) })
      }, [subscribe, isEnabled])
      return React.createElement('div', { className: 'lg-row' },
        React.createElement('div', { className: 'lg-row-text' },
          React.createElement('div', { className: 'lg-row-title' }, copy('row.title')),
          React.createElement('div', { className: 'lg-row-desc' }, copy('row.description'))
        ),
        React.createElement(Switch, {
          checked: on,
          onChange: function (next) { setEnabled(next ? 1 : 0) },
          // The primitive requires an accessible name and has no default.
          label: copy('row.title'),
        })
      )
    }

    /**
     * Gate every surface rule on the glass level being present and non-zero, so
     * a missing attribute can never paint half a theme.
     */
    const ON = 'body[data-lg-level]:not([data-lg-level="0"])'

    /**
     * The right sidebar's drawer treatment is its own gate: the panel is
     * visible whenever it is open, whether or not it holds anything, so the
     * choice between "rounded glass drawer" and "invisible reserved shell" has
     * to be the user's.
     */
    const DRAWER = 'body[data-lg-drawer="1"]'

    /**
     * The material, applied as tokens so components without any hook
     * (`data-*` / role / literal class) still join the same family. Fills live
     * HERE and nowhere else: the stylesheet only adds rims, blur and specular,
     * so there is exactly one place where a surface's colour is decided.
     *
     *   --dsw-alias-bg-base                 frame, conversation column, code banner wrap
     *   --dsw-alias-bg-layer-1/2/3          the elevation ladder: in-flow cards → nested → popovers
     *   --dsw-specific-input-major          the composer card's own fill token
     *   --dsw-alias-markdown-code-block     every code block body (+ its banner strip)
     *   --dsw-specific-tip                  task panel, queue dock
     *   --dsw-specific-sidebar-fill         the sidebar column
     *
     * Menus are NOT on the ladder in this version: `--dsw-specific-menu` is
     * `var(--dsw-menu-surface-fill)` and MenuSurface paints with that raw token,
     * so both are overridden separately below (read the 0.x source tree, not an
     * older checkout — this comment used to claim layer-3 and it misled a whole
     * debugging round).
     *
     * Alphas stay high enough that text contrast survives over the ambient
     * backdrop, and the ladder keeps a visible step between tiers so the app
     * does not collapse into one flat tone.
     */
    const BACKDROP_TOKENS = {
      '--dsw-alias-bg-base': { light: 'rgba(247, 250, 253, 0.50)', dark: 'rgba(18, 21, 26, 0.72)' },
      '--dsw-alias-bg-layer-1': { light: 'rgba(255, 255, 255, 0.46)', dark: 'rgba(38, 43, 51, 0.55)' },
      '--dsw-alias-bg-layer-2': { light: 'rgba(255, 255, 255, 0.48)', dark: 'rgba(46, 52, 61, 0.60)' },
      '--dsw-alias-bg-layer-3': { light: 'rgba(255, 255, 255, 0.72)', dark: 'rgba(56, 63, 73, 0.66)' },
      '--dsw-specific-input-major': { light: 'rgba(255, 255, 255, 0.44)', dark: 'rgba(38, 43, 51, 0.55)' },
      /* CONTENT, not decoration. Stock is FULLY OPAQUE here (bluish-50 / -900),
         so overriding it with a half-transparent value turned every code block,
         every diff card (the packaged build's tool card paints itself with this
         token) and the changed-file strips into windows. Near-opaque on purpose;
         the 2% that remains is the only glass left on a content surface. */
      '--dsw-alias-markdown-code-block': { light: 'rgba(236, 241, 248, 0.98)', dark: 'rgba(24, 28, 34, 0.98)' },
      '--dsw-alias-markdown-code-block-banner': { light: 'rgba(228, 235, 245, 0.98)', dark: 'rgba(31, 36, 43, 0.98)' },
      '--dsw-specific-tip': { light: 'rgba(240, 245, 251, 0.50)', dark: 'rgba(32, 37, 44, 0.55)' },
      '--dsw-specific-sidebar-fill': { light: 'rgba(243, 247, 252, 0.58)', dark: 'rgba(16, 19, 23, 0.80)' },
      /* Menu fills are NOT set here on purpose: every menu in the app keeps its
         own recipe (stock 0.58 light / 0.45 dark under blur(40px)), which is what
         the user wants for the sidebar account menu and every other popup. The
         ONE exception is scoped in the stylesheet to `[data-trigger-menu]` — the
         composer's slash and plus menus — which float over the conversation
         column this plugin makes translucent. See the rule and its comment. */
    }

    const CSS = `
/* ==========================================================================
   dsh-glass-effect
   Hooks used here: data-* attributes, ARIA roles, and the two literal class
   names this app ships (md-code-block). Hashed CSS-module names are never
   targeted, because they are not addressable from a plugin.
   ========================================================================== */

/* Glass palette. Colour follows the colour scheme; the level axis owns blur
   and sheen, so the two axes never fight over one property. */
body {
  --lg-rim: rgba(255, 255, 255, 0.95);
  /* Light scheme needs a DARK ring: the dark scheme's white hairline is
     invisible on a white panel, and without it a light glass surface has no
     edge at all. This is the light counterpart of the dark rim, not new
     structure — same rule, same slot, opposite polarity. */
  --lg-rim-soft: rgba(15, 23, 42, 0.10);
  --lg-glow: rgba(255, 255, 255, 0.55);
  --lg-sweep: rgba(255, 255, 255, 0.22);
  /* Ambient backdrop, resolution-free: color-scheme is set on <html> by the
     theme presenter, so light-dark() resolves without the body attribute.
     The light tint is stronger than a pure-white canvas on purpose: white
     highlights and white glass fills can only show against something that is
     not white. */
  --lg-canvas: light-dark(#e9eff7, #0d0f13);
  --lg-canvas-top: light-dark(#f4f8fd, #0b0d10);
  --lg-canvas-bottom: light-dark(#dce5f1, #14171d);
  --lg-ambient-a: light-dark(rgba(255, 255, 255, 0.90), rgba(126, 148, 186, 0.13));
  --lg-ambient-b: light-dark(rgba(147, 178, 224, 0.38), rgba(92, 112, 150, 0.10));
  /* The one overlay fill this plugin does raise, used by a single scoped rule
     below. The app tunes its menu fill (0.58 / 0.45) for an OPAQUE ground, but
     the composer's trigger menus float over the conversation column, which this
     plugin makes translucent — the app's own blur(40px) then smears a variegated
     backdrop and the menu reads as see-through. Near-opaque here, and nowhere
     else: the rule is scoped by the app's own data-trigger-menu hook, so the
     sidebar account menu and every other popup keep the app recipe intact. */
  --lg-trigger-menu: light-dark(rgba(248, 249, 250, 0.98), rgba(48, 49, 54, 0.98));
}
body[data-ds-dark-theme] {
  /* The 1px top highlight. It is painted TWICE on the composer — once as the
     inset 1px box-shadow, once as the specular band's 1.6%-tall linear
     gradient — so on the composer the same value reads about twice as bright as
     it does on a dialog. 0.30 measured as a light bar in dark mode; 0.16 keeps
     the edge without it. Light mode keeps its own value: it needs the opposite
     (there a white line on a white panel is invisible anyway). */
  --lg-rim: rgba(255, 255, 255, 0.16);
  --lg-rim-soft: rgba(255, 255, 255, 0.14);
  --lg-glow: rgba(255, 255, 255, 0.16);
  --lg-sweep: rgba(255, 255, 255, 0.08);
}

/* One near-opaque fill for surfaces that hold CONTENT — a document panel, a
   diff, a tool's output. Readable first, glass second. It aliases the token
   that already carries the code-shaped surfaces, so a single value owns every
   "must not read through" surface. */
body {
  --lg-content: var(--dsw-alias-markdown-code-block);
}

/* Level = how much the glass bends light. */
body[data-lg-level="1"] { --lg-blur: none; }
body[data-lg-level="2"] { --lg-blur: blur(16px) saturate(160%); }
body[data-lg-level="3"] { --lg-blur: blur(26px) saturate(185%); }

/* The composer's slash and plus menus, and ONLY those. The app sets
   data-trigger-menu on its MenuSurface in MenuView.tsx (the composer's input
   overlay), so this never reaches the sidebar account menu, the model pickers,
   the hover cards or any other popup — those keep the app's own fill untouched.

   Setting the custom property ON THE MENU ELEMENT is what scopes it:
   MenuSurface's inner .material layer reads var(--dsw-menu-surface-fill), and
   custom properties inherit, so this element's value wins for that subtree alone.
   No !important and no hashed class name involved. */
body[data-lg-level]:not([data-lg-level="0"]) [data-trigger-menu] {
  --dsw-menu-surface-fill: var(--lg-trigger-menu);
}

/* ---------- T2 ambient backdrop -------------------------------------------
   Painted as the body background, which propagates to the canvas because
   <html> declares none. Every translucent surface below then has something to
   sit on. Kept to a narrow luminance band so text contrast is unaffected. */
body[data-lg-backdrop="1"] {
  background-color: var(--lg-canvas) !important;
  background-image:
    radial-gradient(90% 60% at 12% -10%, var(--lg-ambient-a) 0%, rgba(0, 0, 0, 0) 60%),
    radial-gradient(80% 55% at 100% 6%, var(--lg-ambient-b) 0%, rgba(0, 0, 0, 0) 55%),
    linear-gradient(180deg, var(--lg-canvas-top) 0%, var(--lg-canvas-bottom) 100%) !important;
  background-attachment: fixed !important;
}

/* ---------- refraction: one backdrop filter per floating surface ----------
   MEASURED in the packaged build: the app's own menu/popover surface is
   --dsw-menu-backdrop-filter: blur(40px) saturate(150%) over a 45%-opacity
   fill, i.e. its readability comes FROM that 40px blur. An earlier version of
   this rule replaced it with var(--lg-blur) (16px at the default level) — a
   strictly weaker recipe — and the + composer menu became see-through.
   Menus and listboxes are therefore NOT in this list: they keep the app's own
   filter, and this plugin only ever adds to a floating surface, never weakens
   what makes it readable.

   The dialog keeps this filter on purpose: the app blurs its own modal backdrop
   with --dsw-mask-blur (2px, which this plugin deepens through the token), so
   applying --lg-blur here is a strengthening step, not a replacement. */
${ON} [data-composer-card],
${ON} [role="dialog"] {
  -webkit-backdrop-filter: var(--lg-blur);
  backdrop-filter: var(--lg-blur);
}

/* ---------- composer card -------------------------------------------------
   Its fill arrives through --dsw-specific-input-major in the token layer; this
   only appends the rim light to the shipped elevation stack. */
${ON} [data-composer-card] {
  box-shadow:
    var(--dsw-elevation-soft),
    inset 0 1px 0 var(--lg-rim),
    inset 0 0 0 0.5px var(--lg-rim-soft) !important;
}

/* ---------- dialogs -------------------------------------------------------
   Fills come from --dsw-alias-bg-layer-2 in the token layer, so no background
   declaration belongs here.

   MENUS AND LISTBOXES ARE DELIBERATELY ABSENT. Roles are not element-shaped:
   MenuView.tsx says outright that "the listbox role sits on the scrolling
   viewport, not this shell", so [role="listbox"] is an inner box with no
   border-radius of its own. An inset stroke here therefore drew a thin SQUARE
   rectangle inside the composer's rounded menu — reported by the user as "a thin
   rectangle, not rounded", visible only while the glass was on.

   Menus must also look exactly like the app's own: their elevation, stroke and
   radius are the app's job, and this plugin only scopes a fill on
   [data-trigger-menu] below. A dialog is a single rounded element, so the rim
   light stays there and nowhere else. */
${ON} [role="dialog"] {
  box-shadow:
    var(--dsw-elevation-prominent),
    inset 0 1px 0 var(--lg-rim),
    inset 0 0 0 0.5px var(--lg-rim-soft) !important;
}

/* ---------- in-flow surfaces join the material ----------------------------
   Their FILL already arrives through the token layer above; what they gain
   here is the same rim light the composer and dialogs carry, so a card, a code
   block and the composer read as one material instead of three.

   Only real CARD-shaped surfaces belong in this list. A full-height column
   ([data-sidebar-right-panel]) must never be here: a 1px top highlight plus a
   0.5px ring on a box that tall draws two stray lines down and across the
   window instead of an edge. */
${ON} [data-testid="todo-panel"],
${ON} .md-code-block,
${ON} [data-presented-file] {
  box-shadow:
    inset 0 1px 0 var(--lg-rim),
    inset 0 0 0 0.5px var(--lg-rim-soft) !important;
}

/* Code blocks paint their fill on both the wrapper and <pre>; the rim belongs
   on the wrapper, so keep the inner element free of a second ring. */
${ON} .md-code-block > pre {
  box-shadow: none !important;
}

/* ---------- right sidebar as a rounded glass drawer -------------------------
   Shipped, this panel is "a column of the page, not a raised surface": the
   same ground as the conversation, a square edge and a hairline border-left.

   MEASURED in the running build (via a temporary probe that mirrored its
   reading into the window title):
   collapsed, the panel is NOT translated and NOT visibility-hidden. It stays
   parked at the frame's right edge, 495px wide, and is invisible only because
   its ground matches the conversation's. It also always holds one tab, so a
   "has a tab" test cannot tell an empty reserved strip from a drawer in use.
   (The 0.1.5 source's translateX(100%) + visibility:hidden do not describe
   this build.)

   Hence: the open attribute is the only usable state, and the change must be
   FADED rather than switched.
   - collapsed: contribute nothing, so the reserved strip stays native-invisible;
   - open: material + radius + rim, so the rounding has contrast to show itself;
   - both directions ride --ds-transition-duration-slow (0.3s in this build),
     so closing fades the glass out instead of popping it away.

   Traps found the hard way:
   1. Never join the CARD rim rule: a 1px top highlight plus a 0.5px ring on a
      viewport-tall box paints a stray line across and down the window.
   2. No outer shadow: this fill is repainted while the frame's track animates,
      and a multi-layer shadow per frame is what dropped frames on fast toggles.
   3. The panel does not transform in this build, so will-change: transform
      would pin a compositor layer for nothing. */

${DRAWER} [data-sidebar-right-panel="push"] {
  /* The drawer's own fade, deliberately shorter than the app's 0.3s layout
     move: the glass reads better clearing out ahead of the track than riding
     along with it. One number to tune. */
  --lg-drawer-fade: 0.1s;
  background: transparent !important;
  border: 0 !important;
  border-radius: 0;
  box-shadow: none !important;
  /* clip in both states (radius 0 when collapsed) so the corner can animate */
  overflow: clip;
  transition:
    background-color var(--lg-drawer-fade) var(--ds-ease-in-out, ease),
    box-shadow var(--lg-drawer-fade) var(--ds-ease-in-out, ease),
    border-radius var(--lg-drawer-fade) var(--ds-ease-in-out, ease);
}

${DRAWER} [data-sidebar-right-panel="push"][data-sidebar-right-open] {
  /* CONTENT, not a decorative card: this panel holds documents and diffs, the
     app paints NOTHING of its own inside it (measured: the preview module's only
     fills are the changed-file strip and the pdf case), and the user reported
     the panel's title bar reading straight through to the chat. The near-opaque
     content fill replaces the glass one; rounding, ring and fade stay. */
  background: var(--lg-content) !important;
  border-radius: 16px;
  /* The inset ring costs nothing extra: it is part of the fill's own paint. */
  box-shadow: inset 0 0 0 0.5px var(--lg-rim-soft) !important;
}

/* ---------- tool output: give the blocks a floor to stand on ---------------
   MEASURED in the packaged build: a tool's IO card paints
   --dsw-alias-markdown-code-block (class "…_ioCard"), while the BLOCKS it
   renders — a file diff, a read, a search, a terminal — paint NOTHING at all,
   so a diff inherited whatever sat behind the card. Pinning the block roots to
   the same near-opaque content fill makes a diff read as one solid surface
   whatever the host card does.

   Deliberately NOT [data-diff-line]: the added/removed lines carry their own
   --dsw-alias-file-diff-* fills, and an !important background here would wipe
   the red/green diff colours out. Only the containers are pinned. */
${ON} [data-diff],
${ON} [data-read],
${ON} [data-search],
${ON} [data-terminal],
${ON} [data-files-body],
${ON} [data-files-code],
${ON} [data-files-path],
${ON} [data-files-row],
${ON} [data-files-entry],
${ON} [data-code-preview],
${ON} [data-changed-files],
${ON} [data-changes-hover-preview] {
  background-color: var(--lg-content) !important;
}

/* ---------- specular: top line + overhead glow ----------------------------
   Confined to the upper band (the glow's radial centre sits ABOVE the box and
   fades out by 56% of its height) so body text stays crisp. */
${ON} [data-composer-card]::before,
${ON} [role="presentation"] > [role="dialog"][aria-modal="true"]::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: 1;
  background-image:
    linear-gradient(180deg, var(--lg-rim) 0%, rgba(255, 255, 255, 0) 1.6%),
    radial-gradient(140% 62% at 50% -18%, var(--lg-glow) 0%, rgba(255, 255, 255, 0) 56%);
}

/* Level 3 adds the diagonal liquid sweep — the one layer that crosses the
   middle of the surface, so it stays opt-in. */
body[data-lg-level="3"] [data-composer-card]::before,
body[data-lg-level="3"] [role="presentation"] > [role="dialog"][aria-modal="true"]::before {
  background-image:
    linear-gradient(180deg, var(--lg-rim) 0%, rgba(255, 255, 255, 0) 2.4%),
    radial-gradient(150% 70% at 50% -20%, var(--lg-glow) 0%, rgba(255, 255, 255, 0) 62%),
    linear-gradient(112deg, rgba(255, 255, 255, 0) 8%, var(--lg-sweep) 30%, rgba(255, 255, 255, 0) 50%);
}

/* ---------- settings row: NOT gated ---------------------------------------
   This row IS the control, so it must keep its styling while the glass is off;
   it is the one block in this stylesheet that no data-lg-* attribute gates.
   Values follow the shipped preference rows (ui-chat's transcript row). */
.lg-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.lg-row-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 48px;
}
.lg-row-title {
  font-size: 14px;
  font-weight: 400;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
}
.lg-row-desc {
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
`

    // ------------------------------------------------------------------
    // Plugin
    // ------------------------------------------------------------------

    /**
     * Client plugin body.
     * @param ctx - client cordis context; `theme` comes from the injected edge.
     */
    function apply(ctx) {
      const theme = ctx.theme
      const body = document.body

      /** Read a remembered 0/1 flag, falling back to the supplied default. */
      const recallFlag = (key, fallback) => {
        try {
          const raw = window.localStorage.getItem(key)
          if (raw === '0') return 0
          if (raw === '1') return 1
        } catch (error) {
          // Storage can be unavailable; the default still applies.
        }
        return fallback
      }

      /** Read the remembered glass level, falling back to the default. */
      const recallLevel = () => {
        try {
          const raw = window.localStorage.getItem(STORAGE_LEVEL)
          if (raw !== null) {
            const parsed = Number(raw)
            if (Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_LEVEL) return parsed
          }
        } catch (error) {
          // Storage can be unavailable; the default still applies.
        }
        return DEFAULT_LEVEL
      }

      /** Remembering is best-effort; the repaint already happened. */
      const remember = (key, value) => {
        try {
          window.localStorage.setItem(key, String(value))
        } catch (error) {
          // Ignored on purpose.
        }
      }

      let enabled = recallFlag(STORAGE_ENABLED, DEFAULT_ENABLED)
      let level = recallLevel()
      let backdrop = recallFlag(STORAGE_BACKDROP, DEFAULT_BACKDROP)
      let drawer = recallFlag(STORAGE_DRAWER, DEFAULT_DRAWER)
      let disposeTokens
      let disposeCss

      /**
       * Live listeners for the settings row. Scoped to this apply on purpose:
       * an HMR reload disposes the fiber and with it this set, so a stale row
       * can never be notified by a dead closure.
       */
      const listeners = new Set()
      const subscribe = (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      }
      const notify = () => {
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch (error) {
            // One broken subscriber must not stop the others.
          }
        }
      }

      /**
       * Recompose the single token layer from the master switch and the two
       * token-bearing axes, then publish it. With the switch off — or with both
       * axes off — the layer is RELEASED, so the shipped tokens come back
       * instead of being overridden with an equal value.
       */
      const paintTokens = () => {
        const tokens = {}
        if (enabled === 1) {
          if (backdrop === 1) Object.assign(tokens, BACKDROP_TOKENS)
          if (level >= MASK_BLUR_FROM) {
            tokens['--dsw-mask-blur'] = { light: MASK_BLUR, dark: MASK_BLUR }
          }
        }
        if (disposeTokens !== undefined) {
          disposeTokens()
          disposeTokens = undefined
        }
        if (Object.keys(tokens).length > 0) {
          disposeTokens = theme.overrideTokens(LAYER_SOURCE, tokens)
        }
      }

      /** The three CSS gates, read back from the remembered values. */
      const GATES = [
        ['data-lg-level', () => String(level)],
        ['data-lg-backdrop', () => String(backdrop)],
        ['data-lg-drawer', () => String(drawer)],
      ]

      /**
       * The one place that writes the document. With the master switch off the
       * gates are REMOVED rather than set to a neutral value: no rule of the
       * injected stylesheet can match afterwards, which is exactly what
       * "unchanged from the shipped app" has to mean.
       */
      const paintAll = () => {
        for (const [name, read] of GATES) {
          if (enabled === 1) body.setAttribute(name, read())
          else body.removeAttribute(name)
        }
        paintTokens()
        notify()
      }

      /**
       * The settings row's write path and the master switch. Turning it off
       * releases everything this plugin put on the document; turning it back on
       * restores the axis values the user had before.
       * @param next - 1 to enable the glass, 0 to restore the shipped look.
       */
      const setEnabled = (next) => {
        const value = next === 1 ? 1 : 0
        if (value === enabled) return
        enabled = value
        remember(STORAGE_ENABLED, value)
        paintAll()
      }

      ctx.effect(() => {
        paintAll()
        const existing = document.querySelector('style[data-plugin-css=' + JSON.stringify(TAG) + ']')
        if (existing === null) {
          const tag = document.createElement('style')
          tag.dataset.plugin = 'dsh-glass-effect'
          tag.dataset.pluginCss = TAG
          tag.textContent = CSS
          document.head.appendChild(tag)
          disposeCss = () => { tag.remove() }
        }
        return () => {
          if (disposeCss !== undefined) {
            disposeCss()
            disposeCss = undefined
          }
          if (disposeTokens !== undefined) {
            disposeTokens()
            disposeTokens = undefined
          }
          body.removeAttribute('data-lg-level')
          body.removeAttribute('data-lg-backdrop')
          body.removeAttribute('data-lg-drawer')
        }
      }, 'dsh-glass-effect: glass stylesheet')

      // ------------------------------------------------------------------
      // The settings row: 设置 → 通用 → 外观 下方的一行总开关.
      //
      // Registered into a slot the settings domain declares, so it appears
      // beside the shipped preference rows and disappears cleanly if that
      // domain is ever absent. Nothing here is gated by the master switch —
      // this row is how the switch is operated.
      // ------------------------------------------------------------------
      ctx.effect(() => ctx.locale.register(LOCALE_NS, 'zh', MESSAGES.zh),
        'dsh-glass-effect: row copy (zh)')
      ctx.effect(() => ctx.locale.register(LOCALE_NS, 'en', MESSAGES.en),
        'dsh-glass-effect: row copy (en)')

      if (React === undefined || Switch === undefined) {
        try {
          console.error('[dsh-glass-effect] react or the Switch primitive is unavailable; settings row skipped')
        } catch (error) {
          // Logging is best-effort.
        }
      } else {
        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item',
          id: ROW_ID,
          order: ROW_ORDER,
          locale: LOCALE_NS,
          inject: () => ({
            isEnabled: () => enabled === 1,
            setEnabled,
            subscribe,
          }),
        }, GlassEffectRow))
      }
    }

    // `slots` and `locale` are what the settings row needs; Cordis gates service
    // access by this declaration, so a missing entry is a hard failure at apply
    // time even though the code reads fine.
    return { name: 'glassEffect', inject: ['theme', 'locale', 'slots'], apply }
  },
})
