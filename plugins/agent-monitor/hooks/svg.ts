// Desktop drawings: the header tiles, one row per subagent, and the band.
// Pixel crabs, costumes and row layout adapted from savvy-progress
// (github.com/JohnnyVizz/claude-kit, MIT, © 2026 johnnyvizz), itself after DockCrab's Clawdy.

import type { AgentRun } from '../types'

export type Totals = { cost: number; tokens: number; time: number; running: number; done: number; failed: number }

export type Fmt = {
  cost: (usd: number) => string
  tokens: (n: number) => string
  time: (ms: number) => string
  model: (id: string) => string
}

const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','PingFang TC','Noto Sans TC','Segoe UI',sans-serif"
const CLAY = '#D97757'
const INK = '#1F1E1D'

// One color per model family: the costume's accent, the type label and the bar.
const MODEL_COLOR: [RegExp, string][] = [
  [/fable|mythos/i, '#7F77DD'],
  [/opus/i, '#D85A30'],
  [/sonnet/i, '#378ADD'],
  [/haiku/i, '#1D9E75'],
]

export const colorOf = (model: string): string => MODEL_COLOR.find(([re]) => re.test(model))?.[1] ?? '#888780'

// One costume per subagent type; a type not listed is a plain crab.
const COSTUME_OF: Record<string, string> = {
  Explore: 'pirate',
  Plan: 'engineer',
  'general-purpose': 'chef',
  'claude-code-guide': 'detective',
  fork: 'astronaut',
}

export const costumeOf = (type: string): string => COSTUME_OF[type.replace(/^[^:]*:/, '')] ?? 'plain'

const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

// Rough advance of system UI text, in em; CJK is a full em.
const charEm = (ch: string): number =>
  /[⺀-鿿가-힯＀-￯]/.test(ch)
    ? 1
    : /[\s.,:;'|!il1()[\]]/.test(ch)
      ? 0.3
      : /[A-Zm@%]/.test(ch)
        ? 0.72
        : 0.56

const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)

// Cuts `s` to fit `maxW` pixels, with an ellipsis when it had to cut.
const fitText = (s: string, size: number, maxW: number): string => {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

const PANE_CSS = `<style>
.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#9a9a96}.k{fill:#ecebe8}.ln{stroke:#e4e4e1}.tile{fill:#f4f3f0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#7d7d79}.k{fill:#2c2c2b}.ln{stroke:#333331}.tile{fill:#262625}}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
@media (prefers-reduced-motion: reduce){.live{animation:none}}
</style>`

// `cls` puts a pixel in a named group: `bd` (the default) is the body and its
// costume, `la`/`lb` the leg pairs, anything else a prop with its own motion.
type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void

const stamp = (f: Fill, x: number, y: number, rows: string[], map: Record<string, string>, cls?: string): void =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => map[ch] && f(x + dx, y + dy, 1, 1, map[ch] ?? '', cls)))

// `armCls` lets a raised claw travel with the prop it holds.
const crabBody = (f: Fill, armFront = 0, armCls?: string): void => {
  f(7, 10, 16, 12, CLAY)
  f(3, 14, 4, 4, CLAY)
  f(23, 14 + armFront, 4, 4, CLAY, armCls)
  f(9, 12, 2, 2, INK)
  f(19, 12, 2, 2, INK)
  f(7, 22, 2, 4, CLAY, 'la')
  f(17, 22, 2, 4, CLAY, 'la')
  f(11, 22, 2, 4, CLAY, 'lb')
  f(21, 22, 2, 4, CLAY, 'lb')
}

// Pure CSS, run by the compositor. Every running crab walks; each costume adds its prop's motion.
const CRAB_CSS = `<style>
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob .5s steps(1) infinite -.125s}
.run g{transform-box:fill-box}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
.c-astronaut.run{animation:float 1s ease-in-out infinite}
.c-astronaut.run .la,.c-astronaut.run .lb,.c-astronaut.run .bd{animation:none}
.c-astronaut.run .ant{animation:blink 1s steps(1) infinite}
.c-astronaut.run .star{animation:blink .5s steps(1) infinite -.25s}
@keyframes float{50%{transform:translateY(-2px)}}@keyframes blink{50%{opacity:.15}}
.c-detective.run .it{animation:scan 1s steps(1) infinite}
.c-detective.run .gl{animation:blink 1s steps(1) infinite -.5s}
@keyframes scan{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,2px)}75%{transform:translate(-1px,1px)}}
.c-engineer.run .it{transform-origin:100% 100%;animation:twist .5s ease-in-out infinite}
@keyframes twist{50%{transform:rotate(-35deg)}}
.c-chef.run .pan{transform-origin:0 50%;animation:tilt 1s ease-in-out infinite}
.c-chef.run .egg{animation:flip 1s ease-in-out infinite}
@keyframes tilt{20%,40%{transform:rotate(-12deg)}}@keyframes flip{30%{transform:translateY(-5px) scaleY(-1)}60%{transform:translateY(0)}}
.c-pirate.run .it{transform-origin:50% 100%;animation:fence .5s ease-in-out infinite}
@keyframes fence{50%{transform:rotate(25deg)}}
@media (prefers-reduced-motion: reduce){.run,.run g{animation:none!important}}
</style>`

const COSTUMES: Record<string, (f: Fill, t: string) => void> = {
  // Astronaut in a glass dome; floats instead of walking, the antenna and the star blink.
  astronaut: (f, t) => {
    crabBody(f)
    f(6, 7, 18, 1, '#E6E8EE'); f(5, 8, 1, 14, '#E6E8EE'); f(24, 8, 1, 14, '#E6E8EE'); f(6, 22, 18, 1, '#C9CCD2')
    f(6, 8, 18, 14, 'rgba(169,214,245,.32)'); f(8, 9, 2, 1, '#fff'); f(8, 10, 1, 2, '#fff')
    f(14, 4, 2, 3, '#C9CCD2'); f(14, 2, 2, 2, t, 'ant'); f(13, 18, 4, 2, t)
    f(27, 3, 1, 3, '#F5C542', 'star'); f(26, 4, 3, 1, '#F5C542', 'star')
  },
  // Detective with a deerstalker; the magnifier sweeps and glints.
  detective: (f, t) => {
    crabBody(f, -4, 'it')
    stamp(f, 6, 3, ['......bbbbbb......', '....bbcbbcbbbb....', '...bbbbbbbbbbbb...', '..bcbbcbbcbbcbbb..', '.bbbbbbbbbbbbbbbb.', 'dddddddddddddddddd'], { b: '#7A4A26', c: '#A0703F', d: '#5A3519' })
    f(6, 9, 18, 1, t)
    stamp(f, 23, 1, ['.kkk.', 'k...k', 'k...k', 'k...k', '.kkk.'], { k: '#3A3A3C' }, 'it')
    f(24, 2, 3, 3, 'rgba(169,214,245,.7)', 'it'); f(25, 6, 1, 4, '#7A4A26', 'it'); f(24, 2, 1, 1, '#fff', 'gl')
  },
  // Engineer in a hard hat; the wrench turns a bolt.
  engineer: (f, t) => {
    crabBody(f)
    stamp(f, 6, 4, ['.....yyyyyyyy.....', '...yyyyyhhyyyyy...', '..yyyyyyhhyyyyyy..', '..yyyyyyhhyyyyyy..', '.yyyyyyyhhyyyyyyy.', 'dddddddddddddddddd'], { y: '#F5C542', h: '#FBE08A', d: '#C99A1E' })
    f(13, 5, 4, 2, t)
    stamp(f, 0, 10, ['.s.s', 'sss.', '.s..', '.s..'], { s: '#8E929A' }, 'it')
  },
  // Chef in a toque; tosses the omelette.
  chef: (f, t) => {
    crabBody(f, -4, 'pan')
    stamp(f, 6, 0, ['........lll.......', '.......lllll......', '.wwwwgwwwwwwgwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwgwwwwwggwwwww', '.wwwwgwwwwwggwwwww', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.'], { w: '#F4F3EE', l: '#F7F6F2', g: '#D2D1C8', b: t, d: '#B45F43' })
    f(22, 8, 7, 2, '#4A4A48', 'pan'); f(26, 10, 1, 1, '#4A4A48', 'pan'); f(24, 7, 3, 1, '#F5B731', 'egg')
  },
  // Pirate scouting the code; the cutlass fences.
  pirate: f => {
    crabBody(f)
    stamp(f, 5, 3, ['.kk..............kk.', '.kkk....kkkk....kkk.', '..kkkkkkkwwkkkkkkk..', '..kkkkkkkkkkkkkkkk..', '.gggggggggggggggggg.'], { k: '#55514C', w: '#F8F6F1', g: '#F5C542' })
    f(7, 11, 11, 1, INK); f(18, 11, 4, 3, INK)
    f(27, 6, 1, 9, '#C9CCD2', 'it'); f(26, 15, 3, 1, '#7A4A26', 'it')
  },
  plain: f => crabBody(f),
}

// Body and props nest inside `bd` so a prop rides the bob and adds its own motion;
// legs stay outside it and step on their own.
const crab = (x: number, y: number, costume: string, color: string, isWalking: boolean, scale = 1.1): string => {
  const groups = new Map<string, string[]>([['bd', []]])
  const f: Fill = (cx, cy, w, h, c, cls = 'bd') => {
    if (!groups.has(cls)) groups.set(cls, [])
    groups.get(cls)?.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`)
  }
  ;(COSTUMES[costume] ?? COSTUMES.plain)?.(f, color)
  const group = (cls: string) => `<g class="${cls}">${(groups.get(cls) ?? []).join('')}</g>`
  const props = [...groups.keys()].filter(k => k !== 'bd' && k !== 'la' && k !== 'lb')
  const body = `<g class="bd">${(groups.get('bd') ?? []).join('')}${props.map(group).join('')}</g>`
  return `<g transform="translate(${x},${y}) scale(${scale})" shape-rendering="crispEdges"><g class="c-${costume}${isWalking ? ' run' : ''}">${body}${group('la')}${group('lb')}</g></g>`
}

const statusMark = (x: number, y: number, status: string, color: string): string => {
  if (status === 'running') return `<circle class="live" cx="${x}" cy="${y}" r="3.5" fill="${color}"/>`
  if (status === 'done') return `<path d="M${x - 5} ${y}l3.5 3.5 6.5-7" fill="none" stroke="#3B9C5F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  return `<path d="M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8" stroke="#D0453F" stroke-width="1.8" stroke-linecap="round"/>`
}

const svg = (W: number, H: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${PANE_CSS}${CRAB_CSS}${body}</svg>`

export const HEADER_H = 44
export const ROW_H = 66
export const BAND_H = 32

export const headerSvg = (W: number, t: Totals, fmt: Fmt): string => {
  const gap = 6
  const tw = (W - gap * 2) / 3
  const tile = (i: number, k: string, v: string) =>
    `<rect class="tile" x="${i * (tw + gap)}" y="0" width="${tw}" height="40" rx="8"/>
<text class="s" x="${i * (tw + gap) + 9}" y="16" font-family="${FONT}" font-size="11">${k}</text>
<text class="t" x="${i * (tw + gap) + 9}" y="33" font-family="${FONT}" font-size="15" font-weight="600" font-variant-numeric="tabular-nums">${v}</text>`
  return svg(W, HEADER_H, `${tile(0, '費用', '≈' + fmt.cost(t.cost))}${tile(1, 'Tokens', fmt.tokens(t.tokens))}${tile(2, '時間', fmt.time(t.time))}`)
}

export const agentSvg = (W: number, a: AgentRun, ctx: number, elapsedMs: number, fmt: Fmt): string => {
  const color = colorOf(a.model)
  const textW = W - 42 - 22
  const meta = [fmt.model(a.model), ...(a.status === 'failed' ? ['失敗'] : [])].join('  ·  ')
  const stats = `ctx ${ctx}% · ${fmt.tokens(a.tokens)}  ≈${fmt.cost(a.costUsd)}  ${fmt.time(elapsedMs)}`
  const fillW = Math.round(textW * (a.status === 'done' ? 1 : ctx / 100))
  // What it did last, on the left of the stats line, in the room the stats leave.
  const actW = textW - textWidth(stats, 11) - 12
  const activity =
    a.activity && actW > 40
      ? `<text class="s act" x="42" y="49" font-family="${FONT}" font-size="11">${xml(fitText(a.activity, 11, actW))}</text>`
      : ''
  return svg(
    W,
    ROW_H,
    `${crab(0, 14, costumeOf(a.type), color, a.status === 'running')}
<text class="t" x="42" y="18" font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(a.description || a.type, 13, textW))}</text>
<text x="42" y="34" font-family="${FONT}" font-size="11"><tspan fill="${color}">${xml(a.type)}</tspan><tspan class="s">  ${xml(meta)}</tspan></text>
<text class="s" x="${42 + textW}" y="49" text-anchor="end" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(stats)}</text>${activity}
<rect class="k" x="42" y="55" width="${textW}" height="4" rx="2"/><rect x="42" y="55" width="${fillW}" height="4" rx="2" fill="${color}"/>
${statusMark(W - 8, 16, a.status, color)}
<line class="ln" x1="0" y1="65.5" x2="${W}" y2="65.5"/>`,
  )
}

// The band: one crab per subagent, running ones first, then the summary on the right.
export const bandSvg = (W: number, list: AgentRun[], summary: string): string => {
  const ordered = [...list.filter(a => a.status === 'running'), ...list.filter(a => a.status !== 'running')]
  const room = Math.max(1, Math.floor((W - textWidth(summary, 12) - 24) / 36))
  const shown = ordered.slice(-room)
  const more = ordered.length - shown.length
  const crabs = shown
    .map((a, i) => {
      const color = colorOf(a.model)
      const live = a.status === 'running' ? `<circle class="live" cx="${i * 36 + 32}" cy="4" r="3" fill="${color}"/>` : ''
      return `<g opacity="${a.status === 'running' ? 1 : 0.55}">${crab(i * 36, 0, costumeOf(a.type), color, a.status === 'running')}</g>${live}`
    })
    .join('')
  const x = shown.length * 36 + 4
  return svg(
    W,
    BAND_H,
    `${crabs}${more ? `<text class="s" x="${x}" y="21" font-family="${FONT}" font-size="12">+${more}</text>` : ''}
<text class="s" x="${W}" y="21" text-anchor="end" font-family="${FONT}" font-size="12" font-variant-numeric="tabular-nums">${xml(summary)}</text>`,
  )
}
