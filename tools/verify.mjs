/**
 * Offline verification for dsh-glass-effect.
 *
 * Checks everything that does not need the running GUI:
 *   - the manifest shape the dsh client-module scanner reads,
 *   - the `window.__ModuleLoader__.load` registration contract,
 *   - the injected stylesheet: every surface hook present, every application
 *     rule gated on an attribute, balanced braces, no hardcoded radius,
 *     design-system elevation tokens still composed,
 *   - both axes: glass level and ambient backdrop, their attributes, the
 *     composed token layer, persistence, wrapping, unrelated keys ignored,
 *   - teardown removes style tag, attributes, token layer and listener.
 *
 * Run: node tools/verify.mjs [--root <dir>]      (exit code 0 = all passed)
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import assert from 'node:assert/strict'

const rootArg = process.argv.indexOf('--root')
const root = rootArg >= 0
  ? resolve(process.argv[rootArg + 1])
  : dirname(dirname(fileURLToPath(import.meta.url)))

const failures = []
let checks = 0

/** Run one assertion group, recording instead of throwing so the whole report prints. */
function check(label, fn) {
  checks += 1
  try {
    fn()
    console.log(`  ok   ${label}`)
  } catch (error) {
    failures.push({ label, error })
    console.log(`  FAIL ${label}\n         ${error.message.split('\n')[0]}`)
  }
}

console.log(`\nverifying: ${root}`)

// ---------------------------------------------------------------------------
// 1. Manifest
// ---------------------------------------------------------------------------

console.log('\n[1] manifest')

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const patchText = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')

check('package name, exports["./client"], main and patch file all agree', () => {
  assert.equal(typeof pkg.name, 'string')
  assert.ok(pkg.name.length > 0, 'package name is empty')
  assert.equal(pkg.type, 'module')
  assert.equal(typeof pkg.main, 'string', 'main must be a string')
  assert.ok(existsSync(join(root, pkg.main)), `main file is missing: ${pkg.main}`)
  const client = pkg.exports?.['./client']
  assert.equal(typeof client, 'string', 'exports["./client"] must be a string')
  assert.ok(existsSync(join(root, client)), `client bundle is missing: ${client}`)
  assert.equal(pkg.dsh?.client?.platform, 'web',
    'only platform "web" rows are composed into the client graph')
  const patch = pkg.dsh?.bundle?.patch
  assert.equal(typeof patch, 'string', 'dsh.bundle.patch must be a string')
  assert.ok(existsSync(join(root, patch)), `bundle patch is missing: ${patch}`)
})

check('cordis.patch.yml inserts one row, named after the package', () => {
  const rows = [...patchText.matchAll(/^\s*-\s*id:\s*(\S+)\s*\n\s*name:\s*(\S+)\s*$/gm)]
    .map(m => ({ id: m[1], name: m[2] }))
  assert.equal(rows.length, 1, `expected exactly one insert row, found ${rows.length}`)
  assert.equal(rows[0].name, pkg.name, 'patch row name must equal the package name (module identity)')
})

// ---------------------------------------------------------------------------
// 2. Bundle registration in a minimal DOM
// ---------------------------------------------------------------------------

console.log('\n[2] client bundle')

/** Just enough DOM for this bundle: body attributes, head, style tags. */
function createFakeDom() {
  const head = {
    children: [],
    appendChild(node) { this.children.push(node); node.parentNode = this },
  }
  const attrs = new Map()
  const body = {
    setAttribute: (key, value) => { attrs.set(key, String(value)) },
    getAttribute: key => (attrs.has(key) ? attrs.get(key) : null),
    removeAttribute: key => { attrs.delete(key) },
  }
  const document = {
    body,
    head,
    createElement(tag) {
      return {
        tagName: tag,
        dataset: {},
        textContent: '',
        parentNode: null,
        remove() {
          const parent = this.parentNode
          if (parent === null) return
          const index = parent.children.indexOf(this)
          if (index >= 0) parent.children.splice(index, 1)
          this.parentNode = null
        },
      }
    },
    querySelector(selector) {
      const match = /^style\[data-plugin-css="(.*)"\]$/.exec(selector)
      if (match === null) throw new Error(`fake DOM cannot resolve selector: ${selector}`)
      const wanted = JSON.parse(`"${match[1]}"`)
      return head.children.find(child => child.tagName === 'style' && child.dataset.pluginCss === wanted) ?? null
    },
  }
  return { document, body, head, attrs }
}

const clientSource = readFileSync(join(root, pkg.exports['./client']), 'utf8')
const listeners = []
const storage = new Map()
let registration

const { document: fakeDocument, head: fakeHead, attrs: bodyAttrs } = createFakeDom()

const fakeWindow = {
  __ModuleLoader__: {
    load(reg) {
      assert.equal(registration, undefined, 'bundle registered twice')
      registration = reg
    },
  },
  localStorage: {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, String(value)) },
  },
  addEventListener: (type, fn) => { listeners.push({ type, fn }) },
  removeEventListener: (type, fn) => {
    const index = listeners.findIndex(l => l.type === type && l.fn === fn)
    if (index >= 0) listeners.splice(index, 1)
  },
  document: fakeDocument,
}

// The backtick count has to be checked BEFORE the bundle is run: a stray one
// inside the CSS literal truncates it, and the resulting parse error names a CSS
// token rather than the real cause ("Unexpected identifier 'role'"). This has
// cost six debugging rounds, so the guard now speaks first.
{
  const marker = 'const CSS = '
  const start = clientSource.indexOf(marker)
  const end = start < 0 ? -1 : clientSource.indexOf('// ------', start)
  const backticks = start < 0 || end < start
    ? -1
    : (clientSource.slice(start + marker.length, end).match(/`/g) ?? []).length
  if (backticks !== 2) {
    console.log('\nFATAL: the CSS template literal does not hold exactly two backticks')
    console.log(`       found ${backticks === -1 ? 'no literal at all' : backticks}`)
    console.log('       every backtick between the CSS literal markers closes or reopens it,')
    console.log('       so this file would ship a truncated stylesheet — use quotes in comments.')
    process.exit(1)
  }
}

let bundleError
try {
  runInContext(clientSource, createContext({ window: fakeWindow, document: fakeDocument }))
} catch (error) {
  console.log('\nFATAL: the client bundle failed to parse or run')
  console.log(`       ${error.message}`)
  console.log('       (the CSS literal is balanced, so look for a real syntax error)')
  process.exit(1)
}

check('registration id equals the package name and factory is a function', () => {
  assert.ok(registration, 'window.__ModuleLoader__.load was never called')
  assert.equal(registration.id, pkg.name, 'registration id must equal the graph row id (package name)')
  assert.equal(typeof registration.factory, 'function')
})

check('the CSS template literal holds exactly one pair of backticks', () => {
  // The guard above already proved this; the check stays so the summary line
  // reports it and the reasoning lives next to the other contract checks.
  const marker = 'const CSS = '
  const start = clientSource.indexOf(marker)
  assert.ok(start > 0, 'the CSS template literal marker is missing')
  const end = clientSource.indexOf('// ------', start)
  assert.ok(end > start, 'the section marker closing the CSS literal is missing')
  const backticks = (clientSource.slice(start + marker.length, end).match(/`/g) ?? []).length
  assert.equal(backticks, 2,
    `expected exactly two backticks in the CSS literal (open + close), found ${backticks}`)
})

/**
 * Stub module table for the bundle's `require`. `react` and ui-primitives are
 * seeds/static packages in the real host; here they only have to be shaped well
 * enough for the settings row to render into a plain object tree.
 */
const elementCalls = []
const stubReact = {
  createElement(type, props, ...children) {
    const element = { type, props: props ?? {}, children }
    elementCalls.push(element)
    return element
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect() { /* the row's subscription is exercised directly instead */ },
}
const stubSwitch = function Switch() { return null }

const moduleTable = {
  react: stubReact,
  '@deepseek-ai/dsh-client-ui-primitives': { Switch: stubSwitch },
}
const requestedSpecifiers = []
const bundleRequire = (specifier) => {
  requestedSpecifiers.push(specifier)
  if (!(specifier in moduleTable)) throw new Error(`unexpected module request: ${specifier}`)
  return moduleTable[specifier]
}

const plugin = registration.factory(bundleRequire)

check('factory returns a Cordis plugin declaring the theme service', () => {
  assert.equal(typeof plugin.apply, 'function')
  assert.ok(Array.isArray(plugin.inject), 'inject must be an array')
  assert.ok(plugin.inject.includes('theme'), 'the token layer needs the theme service')
  assert.ok(plugin.inject.includes('locale'), 'the settings row needs the locale service')
  assert.ok(plugin.inject.includes('slots'), 'the settings row needs the slots service')
})

check('every service the code touches is declared in inject', () => {
  // Cordis gates ctx.<service> by the fiber's inject declaration, so a missing
  // entry is a hard failure at apply time that no unit test would notice — a
  // permissive fake context hands out every service regardless. It shipped that
  // way once (ctx.slots without 'slots'), which is why this scan exists.
  const CONTEXT_MEMBERS = new Set(['effect', 'on', 'provide', 'get', 'inject', 'emit', 'set'])
  const used = new Set([...clientSource.matchAll(/\bctx\.([A-Za-z][A-Za-z0-9]*)\./g)].map(m => m[1]))
  const services = [...used].filter(name => !CONTEXT_MEMBERS.has(name))
  assert.ok(services.length > 0, 'the scan found no service usage at all — did the call shape change?')
  for (const name of services) {
    assert.ok(plugin.inject.includes(name),
      `ctx.${name} is used but not declared in inject: [${plugin.inject.join(', ')}]`)
  }
})

check('the bundle requests exactly react and ui-primitives', () => {
  assert.deepEqual([...requestedSpecifiers].sort(),
    ['@deepseek-ai/dsh-client-ui-primitives', 'react'],
    'the bundle must stay a two-module classic script')
})

check('the bundle touches nothing but the DOM and its own four storage keys', () => {
  // Publication guard. This file is meant to be read and trusted by strangers
  // (it ships to GitHub), so anything that would make a reviewer suspicious is
  // asserted ABSENT rather than merely undocumented. Keep this list strict: a
  // new capability that needs one of these deserves a deliberate decision here.
  for (const banned of [
    // Network.
    'fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'http://', 'https://',
    // Dynamic execution / injection.
    'eval(', 'new Function', 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write',
    // Data outside this plugin's own scope.
    'document.cookie', 'sessionStorage', 'indexedDB', 'clipboard', 'postMessage',
    'document.title', 'navigator.', 'process.',
  ]) {
    assert.ok(!clientSource.includes(banned), `the bundle must not contain "${banned}"`)
  }
  const keys = [...new Set([...clientSource.matchAll(/'(dsh-glass-effect-[a-z]+)'/g)].map(m => m[1]))].sort()
  assert.deepEqual(keys, [
    'dsh-glass-effect-backdrop',
    'dsh-glass-effect-drawer',
    'dsh-glass-effect-enabled',
    'dsh-glass-effect-level',
  ], 'only these four keys may be touched; they are this plugin\'s own state')
})

// ---------------------------------------------------------------------------
// 3. Injected stylesheet
// ---------------------------------------------------------------------------

console.log('\n[3] stylesheet')

const layers = new Map()
const calls = []
const localeRegistrations = []
const injectedSlots = []
const rowRegistrations = []
let seq = 0
const effects = []

/**
 * Build one plugin context. Cases that need a different stored configuration
 * apply a fresh context, the way a page load would; nothing is shared but the
 * collectors, which describe whichever instance applied last.
 */
const makeCtx = () => ({
  theme: {
    overrideTokens(source, tokens) {
      const mine = ++seq
      layers.set(source, { seq: mine, tokens })
      calls.push({ source, tokens })
      return () => { if (layers.get(source)?.seq === mine) layers.delete(source) }
    },
  },
  locale: {
    register(...args) {
      localeRegistrations.push(args)
      return () => {}
    },
  },
  slots: {
    inject(key, callback) {
      injectedSlots.push({ key, callback })
      // The real registry runs this once the slot is declared; here the slot is
      // assumed present so the registration itself can be inspected.
      callback()
      return () => {}
    },
    register(options, component) {
      rowRegistrations.push({ options, component })
      return () => {}
    },
  },
  effect(fn, label) {
    const dispose = fn()
    effects.push({ label, dispose })
  },
})

const fakeCtx = makeCtx()

plugin.apply(fakeCtx)

const styleTags = fakeHead.children.filter(child => child.tagName === 'style')
const css = styleTags.length === 1 ? styleTags[0].textContent : ''
/** Structure checks run without comments: prose carries commas and hook names. */
const code = css.replace(/\/\*[\s\S]*?\*\//g, '')

check('exactly one stylesheet is injected, tagged with the plugin identity', () => {
  assert.equal(styleTags.length, 1, `expected one style tag, found ${styleTags.length}`)
  assert.equal(styleTags[0].dataset.plugin, pkg.name)
  assert.equal(styleTags[0].dataset.pluginCss, `${pkg.name}/client.css`)
  assert.ok(css.length > 1000, 'the stylesheet looks empty')
})

/** Every surface selector this plugin claims to reach. */
const SURFACE_HOOKS = [
  '[data-composer-card]', '[role="dialog"]', '[role="menu"]', '[role="listbox"]',
  '[role="presentation"]', '.md-code-block', '[data-testid="todo-panel"]',
  '[data-presented-file]', '[data-sidebar-right-panel',
]

check('every surface hook is present in the stylesheet', () => {
  for (const hook of SURFACE_HOOKS) assert.ok(code.includes(hook), `stylesheet never mentions ${hook}`)
})

check('every application rule is gated on one of the plugin attributes', () => {
  const ungated = []
  for (const line of code.split('\n')) {
    if (!SURFACE_HOOKS.some(hook => line.includes(hook))) continue
    if (!line.includes('body[data-lg-')) ungated.push(line.trim())
  }
  assert.deepEqual(ungated, [], `ungated selectors:\n  ${ungated.join('\n  ')}`)
})

check('the ambient backdrop is gated on its own attribute', () => {
  const rule = code.split('\n').filter(line => line.includes('[data-lg-backdrop="1"]'))
  assert.ok(rule.length > 0, 'no backdrop rule found')
  for (const line of rule) {
    assert.ok(line.includes('body[data-lg-backdrop="1"]'),
      `backdrop rule must hang off body[data-lg-backdrop="1"]: ${line.trim()}`)
  }
})

check('no selector outside the two gates: every rule chunk starts from body', () => {
  const offenders = []
  for (const chunk of code.split('}')) {
    const brace = chunk.indexOf('{')
    if (brace < 0) continue
    const selector = chunk.slice(0, brace).trim()
    if (selector === '' || selector.startsWith('@')) continue
    // The settings row is deliberately ungated and class-anchored (checked
    // separately below); everything else must hang off body.
    if (selector.includes('.lg-row')) continue
    for (const part of selector.split(',')) {
      if (!part.includes('body')) offenders.push(part.trim())
    }
  }
  assert.deepEqual(offenders, [], `selectors not anchored on body:\n  ${offenders.join('\n  ')}`)
})

check('braces balance', () => {
  const open = (code.match(/\{/g) ?? []).length
  const close = (code.match(/\}/g) ?? []).length
  assert.equal(open, close, `unbalanced braces: ${open} open vs ${close} close`)
})

check('design-system fidelity: elevation composed, shipped radii inherited', () => {
  assert.ok(code.includes('var(--dsw-elevation-soft)'), 'the composer keeps the shipped soft elevation')
  assert.ok(code.includes('var(--dsw-elevation-prominent)'), 'popovers keep the shipped prominent elevation')
  // A surface that already ships a radius must INHERIT it instead of having a
  // second, conflicting one forced on it (the original repo hardcoded 28px over
  // the composer's 22px). The right panel ships square, so it is the one
  // surface allowed to bring its own radius — and it must stay in a sane range.
  const blocks = code.split('}')
  let sawInherit = false
  for (const block of blocks) {
    const radii = [...block.matchAll(/border-radius:\s*([^;]+);/g)].map(m => m[1].trim())
    if (radii.length === 0) continue
    const isPanel = block.includes('[data-sidebar-right-panel')
    for (const value of radii) {
      if (isPanel) {
        // The panel ships square: 0 is the collapsed state clearing the radius,
        // anything else is the open drawer's own corner.
        const px = Number.parseInt(value, 10)
        assert.ok(Number.isInteger(px) && (px === 0 || (px >= 8 && px <= 32)),
          `the drawer radius should be 0 or 8..32px, found "${value}"`)
      } else {
        assert.equal(value, 'inherit', `shipped radius must be inherited, found "${value}"`)
        sawInherit = true
      }
    }
  }
  assert.ok(sawInherit, 'the specular layer should inherit the radius of the surface it sits on')
})

// ---------------------------------------------------------------------------
// 4. Two axes: glass level and ambient backdrop
// ---------------------------------------------------------------------------

console.log('\n[4] surfaces + material tokens')

const lastTokens = () => calls[calls.length - 1].tokens
const tokenKeys = () => Object.keys(lastTokens())

/**
 * Re-apply the plugin with these remembered values, as a fresh page load would.
 * The three axes have no runtime control any more — the settings row is the only
 * switch — so a seeded storage is how a case asks for one configuration.
 */
const reconfigure = (seed) => {
  for (const [key, value] of Object.entries(seed)) storage.set(key, String(value))
  // A real reload disposes the previous fiber first; do the same, or the old
  // instance's token layer would outlive its plugin and mask a release.
  for (const { dispose } of effects) {
    if (typeof dispose === 'function') dispose()
  }
  effects.length = 0
  rowRegistrations.length = 0
  localeRegistrations.length = 0
  injectedSlots.length = 0
  plugin.apply(makeCtx())
}

check('defaults: frosted glass + backdrop on + drawer on, all three attributes set', () => {
  assert.equal(bodyAttrs.get('data-lg-level'), '2')
  assert.equal(bodyAttrs.get('data-lg-backdrop'), '1')
  assert.equal(bodyAttrs.get('data-lg-drawer'), '1')
  assert.equal(storage.size, 0, 'nothing should be stored before the first switch')
  assert.equal(calls.length, 1, 'expected one composed token layer')
  assert.equal(calls[0].source, pkg.name)
  const keys = tokenKeys()
  assert.equal(keys.length, 12, `expected 11 material tokens + the mask blur, got ${keys.join(', ')}`)
  for (const name of keys) {
    const pair = lastTokens()[name]
    assert.equal(typeof pair?.light, 'string', `${name} needs a light value`)
    assert.equal(typeof pair?.dark, 'string', `${name} needs a dark value`)
  }
})

check('the material tokens cover the in-flow surfaces the complaint named', () => {
  const keys = tokenKeys()
  for (const name of [
    '--dsw-alias-bg-base',
    '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3',
    '--dsw-specific-input-major',
    '--dsw-alias-markdown-code-block', '--dsw-alias-markdown-code-block-banner',
    '--dsw-specific-tip', '--dsw-specific-sidebar-fill',
  ]) {
    assert.ok(keys.includes(name), `missing material token ${name}`)
  }
})

check('the stylesheet hardcodes no colour of its own', () => {
  // The ambient backdrop is the one legitimate literal background. Any other
  // fill must reference a theme token (--dsw-*) or one of this plugin's own
  // palette variables (--lg-*), so a surface's colour stays owned by the token
  // layer instead of drifting into this file as a literal.
  // `background-image` on the specular pseudo-element is an overlay, not a fill.
  const blocks = code.split('}')
  const backdropIndex = blocks.findIndex(block => block.includes('[data-lg-backdrop="1"]'))
  assert.ok(backdropIndex >= 0, 'the backdrop rule should own the only literal background')
  const offenders = []
  blocks.forEach((block, index) => {
    if (index === backdropIndex) return
    for (const match of block.matchAll(/(?:^|[;{\s])background(?:-color)?\s*:\s*([^;]+);/g)) {
      const value = match[1].replace(/!important/g, '').trim()
      // Token references keep the colour owned by the theme; `transparent` is
      // how a rule clears a surface, which is not a colour of its own.
      if (value === 'transparent') continue
      if (value.startsWith('var(--dsw-')) continue
      if (value.startsWith('var(--lg-')) continue
      offenders.push(value)
    }
  })
  assert.deepEqual(offenders, [], `hardcoded surface fills: ${offenders.join(' | ')}`)
})

check('the full-height panel never carries the card treatment that drew stray lines', () => {
  // Regression lock for the reported bug: a 1px top highlight plus a 0.5px ring
  // on a viewport-tall column paints a bright line across and down the window.
  const blocks = code.split('}').filter(block => block.includes('[data-sidebar-right-panel'))
  assert.ok(blocks.length > 0, 'the drawer rule is missing')
  for (const block of blocks) {
    assert.ok(!block.includes('inset 0 1px 0 var(--lg-rim)'),
      'a full-height column must not carry the card top highlight (stray horizontal line)')
    assert.ok(/\[data-sidebar-right-panel="push"\]/.test(block),
      'the drawer shape must be scoped to the push variant, never to fullscreen')
  }
  assert.ok(blocks.some(block => block.includes('border: 0')),
    'the shipped bright hairline must be replaced, not kept alongside the rim')
})

check('the drawer clears itself when collapsed, and fades instead of popping', () => {
  // Measured in the running build: a collapsed panel is NOT translated and NOT
  // visibility-hidden — it stays parked at the frame's right edge, and it
  // always holds one tab. So the open attribute is the only usable state, the
  // collapsed state must contribute nothing, and the switch has to fade.
  const blocks = code.split('}').filter(block => block.includes('[data-sidebar-right-panel'))
  assert.equal(blocks.length, 2, 'expected a collapsed base rule and an open drawer rule')
  const base = blocks.find(block => !block.includes('[data-sidebar-right-open]'))
  const open = blocks.find(block => block.includes('[data-sidebar-right-open]'))
  assert.ok(base, 'the collapsed base rule is missing')
  assert.ok(open, 'the open drawer rule is missing')

  assert.ok(base.includes('background: transparent'), 'collapsed: the reserved strip must stay invisible')
  assert.ok(base.includes('box-shadow: none'), 'collapsed: no elevation may survive')
  assert.ok(base.includes('border-radius: 0'), 'collapsed: no rounding may survive')
  assert.ok(/transition:[^;]*background-color/.test(base),
    'the fill must be transitioned, or the glass pops away at the start of the close')
  assert.ok(/transition:[^;]*border-radius/.test(base), 'the corner must fade out with it')
  assert.ok(base.includes('--lg-drawer-fade:'),
    'the fade must be one tunable value, not a duration copied into three transitions')
  assert.ok(!base.includes('--ds-transition-duration-slow'),
    'the drawer fade is deliberately shorter than the app layout move')

  assert.ok(open.includes('var(--lg-content)'),
    'open: the panel needs the near-opaque content fill, or its title bar reads through')
  assert.ok(open.includes('border-radius:'), 'open: must be rounded')

  for (const block of blocks) {
    assert.ok(block.includes('body[data-lg-drawer="1"]'),
      'the drawer is its own switch — one keypress must be able to retire it')
    assert.ok(!block.includes(':has('),
      'the panel always holds one role=tab, so a tab test is not a gate')
    assert.ok(!block.includes('var(--dsw-elevation-'),
      'no outer shadow: it is re-rastered every frame while the track animates')
    assert.ok(!block.includes('inset 0 1px 0 var(--lg-rim)'),
      'a full-height column must never carry the card top highlight (stray horizontal line)')
  }
})

check('every material fill is translucent in both schemes', () => {
  const fills = Object.entries(lastTokens()).filter(([, pair]) => pair.light.startsWith('rgba('))
  assert.equal(fills.length, 11, `expected 11 colour tokens beside the mask blur, got ${fills.length}`)
  for (const [name, pair] of fills) {
    for (const mode of ['light', 'dark']) {
      const alpha = Number(pair[mode].slice(5, -1).split(',')[3])
      assert.ok(alpha > 0 && alpha < 1, `${name} (${mode}) must be translucent, got alpha ${alpha}`)
    }
  }
})

check('light glass stays glass: the surfaces that must stay see-through', () => {
  // Light mode has no dark backdrop to hide behind, so its transparency IS the
  // effect for DECORATIVE surfaces. These ceilings keep a later edit from
  // quietly painting those solid; raise them deliberately if a heavier look is
  // wanted. Content surfaces are the other way round (next check).
  const alphaOf = (name) => Number(lastTokens()[name].light.slice(5, -1).split(',')[3])
  assert.ok(alphaOf('--dsw-specific-input-major') <= 0.50,
    'the composer card (--dsw-specific-input-major) must stay see-through in light mode')
  assert.ok(alphaOf('--dsw-alias-bg-layer-2') <= 0.52,
    'the settings page and the shared modal keep the alphas the user tuned (0.48 / 0.60)')
  assert.ok(alphaOf('--dsw-alias-bg-base') <= 0.55,
    'the column ground must stay see-through in light mode, or the backdrop cannot read')
  // Content and OVERLAY fills are the exception (previous/next checks): a code
  // block, a diff, or a menu is read, not looked through.
  const CONTENT = [
    '--dsw-alias-markdown-code-block',
    '--dsw-alias-markdown-code-block-banner',
    '--dsw-specific-menu',
    '--dsw-menu-surface-fill',
  ]
  for (const [name, pair] of Object.entries(lastTokens())) {
    if (!pair.light.startsWith('rgba(')) continue
    if (CONTENT.includes(name)) continue
    assert.ok(alphaOf(name) <= 0.75, `${name} is too opaque for a light glass surface`)
  }
})

check('content surfaces are readable: one near-opaque fill for all of them', () => {
  // Stock is FULLY OPAQUE for both tokens this covers, so the plugin only ever
  // takes readability away here; the floor is what keeps a diff legible over
  // other text. (1 - alpha) * (text - fill) is what the eye sees: at 0.52 a
  // bright glyph still leaked ~109 levels through, at 0.98 it is ~4.5.
  assert.ok(code.includes('--lg-content: var(--dsw-alias-markdown-code-block)'),
    'the content fill must alias the near-opaque code-block token')
  for (const name of ['--dsw-alias-markdown-code-block', '--dsw-alias-markdown-code-block-banner']) {
    for (const mode of ['light', 'dark']) {
      const alpha = Number(lastTokens()[name][mode].slice(5, -1).split(',')[3])
      assert.ok(alpha >= 0.95, `${name} (${mode}) must stay readable over content behind it, got ${alpha}`)
      assert.ok(alpha < 1, `${name} (${mode}) should still be glass, not a solid plate, got ${alpha}`)
    }
  }
})

check('the plugin never weakens a floating surface own blur', () => {
  // Reported bug: the composer's `+` menu read straight through. MEASURED in
  // the packaged build: the menu's readable recipe is a 45%-opacity fill under
  // `--dsw-menu-backdrop-filter: blur(40px) saturate(150%)`. This plugin used to
  // replace that filter with `var(--lg-blur)` — 16px at the default level, i.e.
  // strictly weaker — which is what turned the menu into a window. Menus and
  // listboxes now keep the app's own filter; the rule may only cover surfaces
  // whose stock blur this plugin strengthens (the composer has none, the modal
  // backdrop is 2px stock and is deepened through --dsw-mask-blur).
  const blur = code.split('}').find(chunk => chunk.includes('backdrop-filter: var(--lg-blur)'))
  assert.ok(blur, 'the refraction rule is missing')
  assert.ok(!blur.includes('[role="menu"]'),
    'menus must keep the app own blur(40px); overriding it is what made the + menu see-through')
  assert.ok(!blur.includes('[role="listbox"]'), 'listboxes must keep the app own blur too')
  for (const allow of ['[data-composer-card]', '[role="dialog"]']) {
    assert.ok(blur.includes(allow), `the refraction rule should still cover ${allow}`)
  }
})

check('tool output blocks get a solid floor, without wiping the diff colours', () => {
  // MEASURED in the packaged build: the tool IO card paints the code-block
  // token, while the blocks inside it ([data-diff], [data-read], [data-search],
  // [data-terminal], the changed-file surfaces) paint NOTHING at all, so a diff
  // inherited whatever sat behind the card.
  const block = code.split('}').find(chunk => chunk.includes('[data-diff]'))
  assert.ok(block, 'the tool-output block rule is missing')
  for (const hook of [
    '[data-read]', '[data-search]', '[data-terminal]',
    '[data-files-body]', '[data-files-code]', '[data-files-path]',
    '[data-files-row]', '[data-files-entry]', '[data-code-preview]',
    // The changed-files card is the surface the user kept reporting: it paints
    // itself with --dsw-alias-bg-layer-1 (see ChangedFiles.module.css), and the
    // data-files-* hooks above belong to a DIFFERENT plugin (the sidebar file
    // browser), so missing these two was why an earlier fix changed nothing.
    '[data-changed-files]', '[data-changes-hover-preview]',
  ]) {
    assert.ok(block.includes(hook), `the tool-output rule must cover ${hook}`)
  }
  assert.ok(block.includes('background-color: var(--lg-content)'),
    'the floor must be the shared near-opaque content fill (--lg-content)')
  assert.ok(block.includes('body[data-lg-level]'),
    'and it stays behind the glass gate like every other application rule')
  assert.ok(!block.includes('[data-diff-line]'),
    'never pin [data-diff-line]: !important there would wipe the added/removed colours')
})

check('overlays are readable: menus get the app own macOS opacity', () => {
  // The stock Windows/Linux menu is `--dsw-menu-surface-fill` = 0.58 / 0.45 under
  // a blur(40px) on an inner `.material` layer, which both the composer's `+`
  // command menu and the `/` menu read as "very transparent". The app itself
  // forces 0.94 on macOS (design-platform.css, because overlays over native
  // vibrancy cannot blur reliably), so the plugin adopts exactly those values
  // for every platform.
  //
  // BOTH names are required: MenuSurface paints with the RAW token
  // (`background: var(--dsw-menu-surface-fill)` in MenuSurface.module.css),
  // while `--dsw-specific-menu` is only its alias, consumed by the other
  // overlays. Setting the alias alone left every MenuSurface popup — the `+`
  // menu, its submenus, the model picker — at the stock value, which is exactly
  // why an earlier attempt showed no effect there.
  for (const name of ['--dsw-specific-menu', '--dsw-menu-surface-fill']) {
    for (const mode of ['light', 'dark']) {
      const alpha = Number(lastTokens()[name][mode].slice(5, -1).split(',')[3])
      assert.ok(alpha >= 0.9, `${name} (${mode}) must stay readable, got ${alpha}`)
      assert.ok(alpha < 1, `${name} (${mode}) should keep a hint of glass, got ${alpha}`)
    }
    assert.equal(lastTokens()[name].light, 'rgba(248, 249, 250, 0.98)')
    assert.equal(lastTokens()[name].dark, 'rgba(48, 49, 54, 0.98)')
  }
})

check('the dark top highlight stays a hairline, not a light bar', () => {
  // User feedback: the 1px top line read as too bright in dark mode. It is
  // painted TWICE on the composer (the inset box-shadow plus the specular band's
  // 1.6%-tall gradient), which is why one value reads stronger there than on a
  // dialog. Locked from above so it cannot creep back, and from below so the
  // edge cannot disappear either.
  const dark = code.slice(code.indexOf('body[data-ds-dark-theme]'))
  const rim = /--lg-rim:\s*rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/.exec(dark)
  assert.ok(rim, 'the dark-scheme rim value is missing')
  const alpha = Number(rim[1])
  assert.ok(alpha <= 0.20, `the dark top highlight must stay subtle, got alpha ${alpha}`)
  assert.ok(alpha >= 0.08, `it must still define an edge, got alpha ${alpha}`)
  const light = code.slice(0, code.indexOf('body[data-ds-dark-theme]'))
  assert.ok(/--lg-rim:\s*rgba\(255,\s*255,\s*255,\s*0\.9/.test(light),
    'the light scheme keeps its own near-invisible-on-white rim; do not copy the dark one over')
})

check('no two tiers of the elevation ladder collapse into one value', () => {
  const TIERS = [
    '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1',
    '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3',
  ]
  for (const mode of ['light', 'dark']) {
    const values = TIERS.map(name => lastTokens()[name][mode])
    assert.equal(new Set(values).size, TIERS.length,
      `${mode}: tiers collapsed — ${values.join(' | ')}`)
  }
})

check('a stored backdrop of 0 drops the material tokens', () => {
  reconfigure({ 'dsh-glass-effect-backdrop': 0 })
  assert.equal(bodyAttrs.get('data-lg-backdrop'), '0')
  assert.deepEqual(tokenKeys(), ['--dsw-mask-blur'], 'only the mask blur survives with the backdrop off')
  reconfigure({ 'dsh-glass-effect-backdrop': 1 })
  assert.equal(bodyAttrs.get('data-lg-backdrop'), '1')
  assert.equal(tokenKeys().length, 12, 'the material tokens return with the backdrop')
})

check('each stored glass level paints its own contract', () => {
  // 0 = no surface rule matches, 1 = clear, 2 = frosted, 3 = deep.
  for (const level of [0, 1, 2, 3]) {
    reconfigure({ 'dsh-glass-effect-level': level, 'dsh-glass-effect-backdrop': 1 })
    assert.equal(bodyAttrs.get('data-lg-level'), String(level))
    const expected = level >= 2 ? 12 : 11
    assert.equal(tokenKeys().length, expected,
      `level ${level}: mask blur only belongs to level 2 and above`)
  }
})

check('with every axis off the token layer is released, not overridden', () => {
  reconfigure({ 'dsh-glass-effect-level': 0, 'dsh-glass-effect-backdrop': 0 })
  assert.equal(bodyAttrs.get('data-lg-level'), '0')
  assert.equal(bodyAttrs.get('data-lg-backdrop'), '0')
  assert.equal(layers.size, 0, 'no token layer may survive with every axis off')
  const before = calls.length
  reconfigure({ 'dsh-glass-effect-level': 1, 'dsh-glass-effect-backdrop': 0 })
  assert.equal(calls.length, before, 'no overrideTokens call with nothing to override')
})

check('a stored drawer of 0 turns the drawer treatment off', () => {
  reconfigure({ 'dsh-glass-effect-drawer': 0 })
  assert.equal(bodyAttrs.get('data-lg-drawer'), '0')
  reconfigure({ 'dsh-glass-effect-drawer': 1 })
  assert.equal(bodyAttrs.get('data-lg-drawer'), '1')
})

check('the plugin installs no keyboard shortcut at all', () => {
  // The settings row is the only control. A chord that quietly changed one axis
  // would be a second, invisible source of state — and the user asked for none.
  assert.equal(listeners.filter(l => l.type === 'keydown').length, 0,
    'no key listener may be registered')
  assert.ok(!clientSource.includes('addEventListener'),
    'the bundle must not register global listeners at all')
  assert.ok(!clientSource.includes('Ctrl+Alt'),
    'no shortcut may survive in code or comments')
})

// Leave the axes at their shipped defaults, so the remaining sections start
// from one well-defined configuration.
reconfigure({
  'dsh-glass-effect-level': 2,
  'dsh-glass-effect-backdrop': 1,
  'dsh-glass-effect-drawer': 1,
})

// ---------------------------------------------------------------------------
// 5. Master switch + the settings row
// ---------------------------------------------------------------------------

console.log('\n[5] master switch + settings row')

const rowFace = () => rowRegistrations[0].options.inject()

check('the settings row registers into the General section under Appearance', () => {
  assert.equal(injectedSlots.length, 1, 'expected exactly one slot injection')
  assert.equal(injectedSlots[0].key, 'settings.general.item')
  assert.equal(rowRegistrations.length, 1, 'expected exactly one row registration')
  const { options, component } = rowRegistrations[0]
  assert.equal(options.name, 'settings.general.item')
  assert.equal(options.id, 'glass-effect', 'a fresh id adds a row instead of replacing a shipped one')
  assert.ok(options.order > 10 && options.order < 11,
    `the row must land between appearance (10) and font-size (11), got ${options.order}`)
  assert.equal(options.locale, 'glass-effect', 'the row draws its own copy through its own namespace')
  assert.equal(typeof options.inject, 'function')
  assert.equal(typeof component, 'function')
})

check('both row dictionaries are registered', () => {
  const byLocale = new Map(localeRegistrations.map(args => [args[1], args[2]]))
  assert.deepEqual([...byLocale.keys()].sort(), ['en', 'zh'])
  for (const dict of byLocale.values()) {
    assert.equal(typeof dict['row.title'], 'string', 'the switch needs an accessible name')
    assert.equal(typeof dict['row.description'], 'string')
  }
})

check('the row renders the shipped Switch with an accessible name', () => {
  const face = rowFace()
  assert.equal(typeof face.isEnabled, 'function', 'the face must expose a getter, not a frozen snapshot')
  assert.equal(typeof face.setEnabled, 'function')
  assert.equal(typeof face.subscribe, 'function')
  elementCalls.length = 0
  const tree = rowRegistrations[0].component({ t: key => key, ...face })
  assert.ok(tree, 'the row must render an element')
  const switchElement = elementCalls.find(call => call.type === stubSwitch)
  assert.ok(switchElement, 'the row must render the Switch primitive')
  assert.equal(switchElement.props.checked, true, 'the switch must reflect the current state')
  assert.equal(typeof switchElement.props.onChange, 'function')
  assert.equal(switchElement.props.label, 'row.title', 'the primitive requires a label and has no default')
  const classes = elementCalls.map(call => call.props.className).filter(Boolean)
  assert.ok(classes.includes('lg-row'), 'the row must carry its own class')
})

/** Whatever the axes hold when the switch is turned off, for the restore check. */
const axisBefore = {
  level: bodyAttrs.get('data-lg-level'),
  backdrop: bodyAttrs.get('data-lg-backdrop'),
  drawer: bodyAttrs.get('data-lg-drawer'),
  tokens: tokenKeys().length,
}

check('turning the master switch off leaves the app exactly as shipped', () => {
  rowFace().setEnabled(0)
  for (const name of ['data-lg-level', 'data-lg-backdrop', 'data-lg-drawer']) {
    assert.equal(bodyAttrs.has(name), false, `${name} must be removed, not neutralised`)
  }
  assert.equal(layers.size, 0, 'the token layer must be released, not overridden with equal values')
  assert.equal(storage.get('dsh-glass-effect-enabled'), '0')
})

check('with the switch off there is no second way back on', () => {
  // No listener at all means no hidden control: the row is the only writer.
  assert.equal(listeners.length, 0, 'the plugin must register no global listener at all')
  assert.equal(layers.size, 0, 'and no token layer may be left behind')
  assert.equal(bodyAttrs.has('data-lg-level'), false)
  assert.equal(bodyAttrs.has('data-lg-backdrop'), false)
  assert.equal(bodyAttrs.has('data-lg-drawer'), false)
})

check('turning it back on restores the axis values the user had', () => {
  rowFace().setEnabled(1)
  assert.equal(bodyAttrs.get('data-lg-level'), axisBefore.level)
  assert.equal(bodyAttrs.get('data-lg-backdrop'), axisBefore.backdrop)
  assert.equal(bodyAttrs.get('data-lg-drawer'), axisBefore.drawer)
  assert.equal(tokenKeys().length, axisBefore.tokens, 'the material layer comes back with the switch')
  assert.equal(storage.get('dsh-glass-effect-enabled'), '1')
})

check('the switch from the row drives the same state as the service face', () => {
  // End to end: what a click on the row actually calls.
  elementCalls.length = 0
  rowRegistrations[0].component({ t: key => key, ...rowFace() })
  const switchElement = elementCalls.find(call => call.type === stubSwitch)
  switchElement.props.onChange(false)
  assert.equal(rowFace().isEnabled(), false, 'clicking off must reach the plugin state')
  assert.equal(bodyAttrs.has('data-lg-level'), false)
  rowFace().setEnabled(1)
  assert.equal(rowFace().isEnabled(), true)
})

check('the settings row is the one block the glass gate does not cover', () => {
  const rowLines = code.split('\n').filter(line => line.includes('.lg-row'))
  assert.ok(rowLines.length >= 4, 'the row stylesheet is missing')
  for (const line of rowLines) {
    assert.ok(!line.includes('body[data-lg-'),
      `the row must keep its styling while the glass is off: ${line.trim()}`)
  }
})

check('teardown removes stylesheet, attributes, token layer and listener', () => {
  for (const effect of effects) effect.dispose()
  assert.equal(fakeHead.children.length, 0, 'the style tag must be removed')
  assert.equal(bodyAttrs.has('data-lg-level'), false, 'the level attribute must be removed')
  assert.equal(bodyAttrs.has('data-lg-backdrop'), false, 'the backdrop attribute must be removed')
  assert.equal(bodyAttrs.has('data-lg-drawer'), false, 'the drawer attribute must be removed')
  assert.equal(layers.size, 0, 'the token layer must be removed')
  assert.equal(listeners.length, 0, 'the keydown listener must be removed')
})

// ---------------------------------------------------------------------------
// 6. Host half
// ---------------------------------------------------------------------------

console.log('\n[6] host half')

const host = await import(pathToFileURL(join(root, pkg.main)).href)

check('host half is an inert, importable Cordis plugin', () => {
  assert.equal(host.name, 'glassEffect')
  assert.equal(typeof host.apply, 'function')
  assert.doesNotThrow(() => host.apply())
})

// ---------------------------------------------------------------------------

console.log(`\n${checks - failures.length}/${checks} checks passed`)
if (failures.length > 0) {
  console.log('\nfailures:')
  for (const { label, error } of failures) console.log(`- ${label}: ${error.message}`)
  process.exitCode = 1
}
