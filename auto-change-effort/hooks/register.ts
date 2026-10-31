import type { EngineInterface, Register } from 'claude-code'
import { buildPrompt, type Level, raise, readLevel, RULES } from './judge'

const COMMAND = 'auto-change-effort'

// Haiku の判定を待つ長さ(D-023)
const JUDGE_TIMEOUT_MS = 4000

// ターンが長引いたとみなす境目(D-022)
const STEP_LIMIT = 10
const ERROR_LIMIT = 2

// バックグラウンドの作業の完了通知(D-024)
const NOTIFICATION = '<task-notification>'

// メインスレッドだけを見る。値はこのセッションの間だけ持ち、読み直しで消える
let judged: Level | undefined // 前のターンで判定した段階(失敗したときに使う)
let level: Level | undefined // このターンで使う段階。undefined なら書き換えない
let isRaised = false // このターンを持ち越しで1段上げたか
let shouldRaise = false // 次のターンを1段上げるか
let isNotice = false // このターンは通知か。通知は持ち越しを使わず、決めもしない(D-032)
let previous = '' // 前の回答。判定の入力に末尾を添える
let steps = 0
let errors = 0

// on / off は次のセッションにも残す。初期は on
async function isOn($: EngineInterface): Promise<boolean> {
  return (await $.store.get('enabled')) !== false
}

function showStatus($: EngineInterface, on: boolean): void {
  if (!on) return void $.ui.status(`${COMMAND}: off`)
  $.ui.status(level ? `effort: ${level}${isRaised ? ' (+1)' : ''}` : undefined)
}

// Haiku に段階を聞く。間に合わない・読めないときは undefined
async function judge($: EngineInterface, text: string): Promise<Level | undefined> {
  const r = await $.model.complete({
    model: 'haiku',
    system: RULES,
    prompt: buildPrompt(text, previous),
    maxTokens: 16,
    timeoutMs: JUDGE_TIMEOUT_MS,
  })
  return r.isAnswered ? readLevel(r.text) : undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'effort の自動切り替えを on / off する',
      argumentHint: 'on|off',
    })
    showStatus($, await isOn($))
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim()
    if (arg !== 'on' && arg !== 'off') {
      const now = (await isOn($)) ? 'on' : 'off'
      return { text: `今は ${now} です。/${COMMAND} on か off で切り替えます` }
    }
    await $.store.set('enabled', arg === 'on')
    // 切り替えたターンからやり直す。off の間は effort を触らない
    level = undefined
    isRaised = false
    shouldRaise = false
    showStatus($, arg === 'on')
    return { text: `${COMMAND}: ${arg}` }
  }).catch(() => ({ text: `${COMMAND}: 切り替えに失敗しました` }))

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    const enabled = await isOn($)
    steps = 0
    errors = 0
    if (!enabled) {
      level = undefined
      isRaised = false
      shouldRaise = false
      showStatus($, false)
      return next(e)
    }

    // 通知と、入力の無いターンは判定せず前の段階のまま
    const text = e.text.trim()
    isNotice = text.startsWith(NOTIFICATION)
    if (text !== '' && !isNotice) {
      judged = (await judge($, text)) ?? judged
    }
    // 持ち越しは次の人の依頼まで残す
    isRaised = shouldRaise && judged !== undefined && !isNotice
    level = judged && isRaised ? raise(judged) : judged
    if (!isNotice) shouldRaise = false
    showStatus($, true)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    steps++
    // effort を取らないモデルは触らない
    if (level === undefined || e.effort === undefined) return yield* next(e)
    return yield* next({ ...e, effort: level })
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && r.isError === true) errors++
    return r
  }).catch(($, e, next) => next(e)) // 数え損ねてもツールは止めない

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && level !== undefined && !isNotice) {
      shouldRaise = steps > STEP_LIMIT || errors >= ERROR_LIMIT
    }
    if (e.agentId === undefined && e.answer !== '') previous = e.answer
    return next(e)
  })
}
