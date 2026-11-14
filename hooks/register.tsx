// Barra dei consumi nella riga sotto al riquadro, accanto a "⏵⏵ auto mode on".
//
// Prende il posto del suggerimento fisso "(shift+tab to cycle) · ← for agents", così non
// serve la riga separata della status line. Se Claude Code mette in quella riga qualcosa
// di vivo (attività in background, "premi di nuovo Ctrl-C"...), la sua riga resta e la
// barra le va dietro, più corta.
//
//   ctx ━━──────────  13%  128k/1M  │  5h ━━━━━│━━───  52%  ↺ 16:50 · 2h10m  ▲ finisce ~15:40  │  7g ...
//
// Per i limiti: il pieno è l'usato, la tacca │ è dove saresti a ritmo costante
// (tempo passato / durata della finestra), ↺ quando si azzera. ✓ −30 = 30 punti sotto il ritmo;
// "in linea" entro ±max(3 punti, 10% del previsto), perché le percentuali arrivano intere;
// ▲ finisce ~ora = sopra il ritmo, e andando avanti con la media fin qui finisce a quell'ora.
//
// /bar la spegne e la riaccende; la scelta resta anche per le sessioni nuove ($.store).

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit, Snapshot } from '../types'

const snap = atom({ plugin: 'usage-bar', key: 'snap' } as const, null)
const off = atom({ plugin: 'usage-bar', key: 'off' } as const, false)

// ── colori ─────────────────────────────────────────────────────────────────────
const TEXT = '#c9d1d9'
const LABEL = '#7d8590'
const SUBTLE = '#5c636e'
const TRACK = '#343a44'
const SEP = '#3e444e'
const MARK = '#b4bcc8'
const ACCENT = '#7aa2f7'
const OK = '#56d4a0'
const WARN = '#f2c25b'
const BAD = '#f2777a'

const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']
const FINESTRE = {
  five_hour: ['5h', 5 * 3600_000],
  seven_day: ['7g', 7 * 86400_000],
} as const
type Finestra = keyof typeof FINESTRE

// pezzi della riga di Claude Code che sono solo promemoria fissi: la barra li sostituisce
const FISSI = [/^\(?shift\+tab to cycle\)?$/i, /^\? for shortcuts$/i, /^← for agents$/i, /^esc to interrupt$/i]

type Seg = { t: string; c: string; b?: boolean }
type Grado = { barra: number; tok: boolean; conto: boolean; parola: boolean; breve: boolean; fine: boolean; reset: boolean; sep: string }

const g = (barra: number, o: Partial<Grado> = {}): Grado => ({
  barra, tok: false, conto: false, parola: false, breve: false, fine: true, reset: true, sep: '  │  ', ...o,
})

// dal più ricco al più asciutto: si usa il primo che entra
const GRADI: Grado[] = [
  g(14, { tok: true, conto: true, parola: true }),
  g(12, { tok: true, conto: true, parola: true }),
  g(10, { conto: true, parola: true }),
  g(10),
  g(8, { breve: true, sep: ' │ ' }),
  g(5, { breve: true, sep: ' │ ' }),
  g(0, { breve: true, sep: '  ·  ' }),
  g(0, { breve: true, fine: false, sep: ' · ' }),
  g(0, { breve: true, fine: false, reset: false, sep: ' · ' }),
]

// ── ore nel fuso del computer di chi usa la mod (il sandbox segue TZ del processo) ──
const due = (n: number) => String(n).padStart(2, '0')

function orario(ms: number, conGiorno: boolean, ora: number): string {
  const t = new Date(ms)
  const hm = `${due(t.getHours())}:${due(t.getMinutes())}`
  if (!conGiorno) return hm
  if (t.toDateString() === new Date(ora).toDateString()) return `oggi ${hm}`
  return `${GIORNI[t.getDay()]} ${hm}`
}

function durata(ms: number): string {
  let m = Math.max(0, Math.floor(ms / 60_000))
  if (m < 60) return `${m}m`
  let h = Math.floor(m / 60)
  m %= 60
  if (h < 24) return m ? `${h}h${due(m)}m` : `${h}h`
  const gg = Math.floor(h / 24)
  h %= 24
  return h ? `${gg}g ${h}h` : `${gg}g`
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(Math.round(n))
}

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x))
const giorno = (s: string) => s.split(' ')[0] ?? s

// ── pezzi ──────────────────────────────────────────────────────────────────────
function barra(pct: number, larghezza: number, colore: string, segno?: number): Seg[] {
  let pieni = Math.round((clamp(pct) / 100) * larghezza)
  if (pct > 0 && pieni === 0) pieni = 1
  if (segno === undefined) {
    return [{ t: '━'.repeat(pieni), c: colore }, { t: '─'.repeat(larghezza - pieni), c: TRACK }]
  }
  pieni = Math.min(pieni, larghezza - 1) // la tacca prende una cella
  let pos = Math.min(larghezza - 1, Math.round((clamp(segno) / 100) * larghezza))
  if (colore === OK) pos = Math.max(pos, pieni) // in linea o sotto: la tacca non entra nel pieno
  const tacca = { t: '│', c: MARK }
  if (pos < pieni) {
    return [
      { t: '━'.repeat(pos), c: colore }, tacca, { t: '━'.repeat(pieni - pos), c: colore },
      { t: '─'.repeat(larghezza - pieni - 1), c: TRACK },
    ]
  }
  return [
    { t: '━'.repeat(pieni), c: colore }, { t: '─'.repeat(pos - pieni), c: TRACK }, tacca,
    { t: '─'.repeat(larghezza - pos - 1), c: TRACK },
  ]
}

const perc = (v: number, larga: boolean): string => (larga ? String(Math.round(v)).padStart(3) : String(Math.round(v))) + '%'

function contesto(s: Snapshot, gr: Grado): Seg[] {
  const out: Seg[] = [{ t: 'ctx ', c: LABEL }]
  let pct = s.percent
  if (pct === undefined && s.tokens !== undefined && s.window) pct = (s.tokens / s.window) * 100
  if (pct === undefined) return [...out, { t: '—', c: SUBTLE }]
  const colore = pct < 50 ? ACCENT : pct < 75 ? WARN : BAD
  if (gr.barra) out.push(...barra(pct, gr.barra, colore), { t: ' ', c: TEXT })
  out.push({ t: perc(pct, gr.barra > 0), c: pct < 50 ? TEXT : colore, b: true })
  if (gr.tok && s.window) out.push({ t: `  ${tokens(s.tokens ?? (pct / 100) * s.window)}/${tokens(s.window)}`, c: SUBTLE })
  return out
}

function limite(kind: Finestra, limiti: Limit[], gr: Grado, ora: number): Seg[] {
  const [nome, finestra] = FINESTRE[kind]
  const out: Seg[] = [{ t: nome + ' ', c: LABEL }]
  const info = limiti.find(l => l.kind === kind)
  if (!info) return [...out, { t: '—', c: SUBTLE }]
  const usato = info.percentUsed
  const reset = info.resetsAt ? Date.parse(info.resetsAt) : NaN
  const settimana = kind === 'seven_day'

  if (!Number.isFinite(reset) || reset <= ora) {
    // finestra già scaduta: il prossimo messaggio ne apre una nuova
    if (gr.barra) out.push(...barra(0, gr.barra, OK), { t: '   ', c: TEXT })
    return [...out, { t: '0%', c: TEXT, b: true }, { t: '  azzerato', c: SUBTLE }]
  }

  const frac = clamp((ora - (reset - finestra)) / finestra, 0, 1)
  const atteso = frac * 100 // dove saresti andando a ritmo costante
  const delta = usato - atteso
  const tolleranza = Math.max(3, atteso * 0.1)

  let colore: string
  let simbolo: string
  let testo: string
  let finisce: number | undefined
  if (usato >= 100) {
    colore = BAD
    simbolo = '✕'
    testo = 'esaurito'
  } else if (delta <= tolleranza) {
    colore = OK
    simbolo = '✓'
    testo = delta >= -tolleranza ? 'in linea' : `−${Math.round(-delta)}`
  } else {
    colore = delta < 10 ? WARN : BAD
    simbolo = '▲'
    testo = `+${Math.round(delta)}`
    if (frac >= 0.02 && usato > 0) {
      const t = ora + ((100 - usato) * (frac * finestra)) / usato // con la media fin qui
      if (t < reset) finisce = t
    }
  }

  if (gr.barra) out.push(...barra(usato, gr.barra, colore, atteso), { t: ' ', c: TEXT })
  out.push({ t: perc(usato, gr.barra > 0), c: colore === OK ? TEXT : colore, b: true })

  let quando = orario(reset, settimana, ora)
  if (settimana && gr.breve) quando = giorno(quando)
  if (!gr.reset) {
    // telefono: niente orari
  } else if (!gr.barra) {
    out.push({ t: ' ↺', c: SUBTLE }, { t: quando, c: TEXT })
  } else {
    out.push({ t: '  ↺ ', c: SUBTLE }, { t: quando, c: TEXT })
    if (gr.conto && !settimana) out.push({ t: ' · ' + durata(reset - ora), c: SUBTLE })
  }

  if (finisce !== undefined && gr.fine) {
    let t = orario(finisce, settimana, ora)
    if (settimana && gr.breve) t = giorno(t)
    testo = (gr.parola ? 'finisce ~' : '~') + t
  } else if (!gr.fine) {
    testo = '' // riga minima: solo il simbolo
  }
  out.push({ t: (gr.barra ? '  ' : ' ') + `${simbolo} ${testo}`.trimEnd(), c: colore, b: colore !== OK })
  return out
}

function riga(s: Snapshot, gr: Grado, ora: number): Seg[] {
  const sep = { t: gr.sep, c: SEP }
  return [...contesto(s, gr), sep, ...limite('five_hour', s.limits, gr, ora), sep, ...limite('seven_day', s.limits, gr, ora)]
}

const larghezza = (segs: Seg[]) => segs.reduce((n, x) => n + [...x.t].length, 0)

// il grado si sceglie sul caso più lungo possibile, così a parità di spazio la riga non cambia forma
function scegli(s: Snapshot, spazio: number, ora: number): Grado | undefined {
  const w = s.window || 200_000
  const peggiore: Snapshot = {
    window: w, percent: 99, tokens: w * 0.99, now: ora,
    limits: [
      { kind: 'five_hour', percentUsed: 80, resetsAt: new Date(ora + 2 * 3600_000).toISOString() },
      { kind: 'seven_day', percentUsed: 60, resetsAt: new Date(ora + 5 * 86400_000).toISOString() },
    ],
  }
  return GRADI.find(gr => larghezza(riga(peggiore, gr, ora)) + 2 <= spazio)
}

// ── aggancio ───────────────────────────────────────────────────────────────────
async function leggi($: EngineInterface): Promise<void> {
  const u = await $.session.usage()
  const now = await $.clock.now()
  const s: Snapshot = { tokens: u.context.tokens, window: u.context.window, percent: u.context.percent, limits: u.rateLimits, now }
  await update($, snap, () => s)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'bar', description: 'Mostra o nasconde la barra dei consumi (contesto, 5h, 7g)' })
    const spenta = (await $.store.get('off')) === true
    await update($, off, () => spenta)
    $.clock.after(0, () => void leggi($))
    $.clock.every(30_000, () => void leggi($)) // tiene giusti i conti alla rovescia
    return r
  })

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    const s: Snapshot = { tokens: e.context.tokens, window: e.context.window, percent: e.context.percent, limits: e.rateLimits, now }
    await update($, snap, () => s)
    return next(e)
  })

  on('command.run', { command: 'bar' }, async $ => {
    const spenta = !(await read($, off))
    await update($, off, () => spenta)
    await $.store.set('off', spenta)
    return { text: spenta ? 'Barra dei consumi nascosta (/bar per riaccenderla)' : 'Barra dei consumi attiva' }
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (await read($, off)) return next(e)
    const s = await read($, snap)
    if (!s) return next(e)

    const hint = e.props.hint ?? ''
    const parti = hint.split(' · ').map(p => p.trim()).filter(Boolean)
    const vivi = parti.some(p => !FISSI.some(re => re.test(p)))
    const conEtichetta = /shift\+tab to cycle/i.test(hint) // c'è "⏵⏵ ... mode on" davanti

    let spazio = (e.viewport?.columns ?? 120) - 2 - (conEtichetta ? 18 : 0) // "⏵⏵ auto mode on · "; un'etichetta più lunga taglia la fine
    if (vivi) spazio -= [...hint].length + 5

    // se nemmeno il grado più asciutto entra, si usa quello e la fine si taglia
    const gr = scegli(s, spazio, s.now) ?? GRADI[GRADI.length - 1]!

    const { Box, Text } = $.ui.resolve(e)
    const pezzi = riga(s, gr, s.now).filter(x => x.t)
    const barraTxt = (
      <Text wrap="truncate-end">
        {pezzi.map(x => (
          <Text color={x.c} bold={x.b}>{x.t}</Text>
        ))}
      </Text>
    )
    if (!vivi) return <Box flexDirection="row">{barraTxt}</Box>
    return (
      <Box flexDirection="row">
        {await next(e)}
        <Text color={SEP}>{'  │  '}</Text>
        {barraTxt}
      </Box>
    )
  })
}
