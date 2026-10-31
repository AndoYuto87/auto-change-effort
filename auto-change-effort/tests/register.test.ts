import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

// 1ターン流す。steps 回モデルに聞き、errors 回ツールがエラーになる。各ステップで送られた effort を返す
async function turn(
  $: Engine,
  text: string,
  opts: { steps?: number; errors?: number; agentId?: string; answer?: string } = {},
): Promise<(string | number | undefined)[]> {
  const turnId = `t-${Math.random()}`
  const { agentId } = opts
  await $.turn.start({ text, turnId, agentId })
  for (let i = 0; i < (opts.errors ?? 0); i++) {
    await $.tool.call({ tool: 'Bash', command: 'false', agentId })
  }
  const sent: (string | number | undefined)[] = []
  for (let i = 0; i < (opts.steps ?? 1); i++) {
    const stream = $.turn.step({ turnId, index: i, model: 'opus', effort: 'high', messageCount: 1, agentId })
    for await (const _ of stream) void _
    sent.push(lastEffort)
  }
  await $.turn.complete({ turnId, answer: opts.answer ?? '', durationMs: 0, isAborted: false, reason: 'answer', agentId })
  return sent
}

let lastEffort: string | number | undefined
let status: string | undefined
let asked: string[] = []
let reply: string | undefined // undefined なら Haiku が間に合わない

function engine(on: Parameters<Parameters<typeof test>[1]>[1], store: Record<string, unknown> = {}) {
  lastEffort = undefined
  status = undefined
  asked = []
  reply = 'low'
  mock.store(on, store)
  on('command.register', () => ({ value: { command: 'auto-change-effort' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', (_, e) => ((status = e.text), { value: undefined }))
  on('model.complete', (_, e) => {
    asked.push(e.prompt)
    return {
      value: reply === undefined
        ? { isAnswered: false, reason: 'aborted', usage }
        : { isAnswered: true, text: reply, usage },
    }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    lastEffort = e.effort
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] }
  })
  on('tool.call', () => ({ isError: true, result: 'failed', text: 'failed' }))
  on('turn.complete', () => ({ text: '' }))
}

test('判定どおりに書き換え、ステータスに出す', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  reply = 'medium'
  expect(await turn($, 'この差分をレビューして')).toEqual(['medium'])
  expect(status).toBe('effort: medium')
})

test('off なら Haiku を呼ばず、effort を触らない', async ($, on) => {
  engine(on, { enabled: false })
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  expect(await turn($, 'この用語は何?')).toEqual(['high'])
  expect(asked.length).toBe(0)
  expect(status).toBe('auto-change-effort: off')
})

test('コマンドで off / on を切り替える', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  const run = (args: string) =>
    $.command.run({ command: 'auto-change-effort', args, origin: { kind: 'composer' }, presentation: { layout: 'main', columns: 80 } } as never)
  await run('off')
  expect(status).toBe('auto-change-effort: off')
  expect(await turn($, 'こんにちは')).toEqual(['high'])
  await run('on')
  expect(await turn($, 'こんにちは')).toEqual(['low'])
})

test('通知のターンは Haiku を呼ばず、前の段階のまま', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  reply = 'medium'
  await turn($, 'この差分をレビューして')
  const n = asked.length
  expect(await turn($, '<task-notification>done</task-notification>')).toEqual(['medium'])
  expect(asked.length).toBe(n)
})

test('長引いたあとの通知のターンは上げず、次の依頼で1段上げる', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await turn($, '直して', { steps: 11 })
  expect(await turn($, '<task-notification>done</task-notification>')).toEqual(['low'])
  expect(status).toBe('effort: low')
  expect(await turn($, 'ありがとう')).toEqual(['medium'])
})

test('通知のターンが長引いても、次は上げない', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await turn($, '依頼')
  await turn($, '<task-notification>done</task-notification>', { steps: 11, errors: 2 })
  expect(await turn($, 'ありがとう')).toEqual(['low'])
})

test('Haiku が間に合わなければ前の段階、初回は設定どおり', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  reply = undefined
  expect(await turn($, '最初の依頼')).toEqual(['high'])
  reply = 'low'
  await turn($, 'ありがとう')
  reply = undefined
  expect(await turn($, '次の依頼')).toEqual(['low'])
})

test('長引いたターンの次は1段上げ、その次は戻す', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await turn($, '直して', { steps: 11 })
  const sent = await turn($, 'ありがとう')
  expect(sent).toEqual(['medium'])
  expect(status).toBe('effort: medium (+1)')
  expect(await turn($, 'ありがとう')).toEqual(['low'])
})

test('ツールのエラーが累計2回なら次を1段上げる。xhigh で止まる', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await turn($, '直して', { errors: 1 })
  expect(await turn($, '続けて')).toEqual(['low'])
  await turn($, '直して', { errors: 2 })
  expect(await turn($, '続けて')).toEqual(['medium'])
  reply = 'xhigh'
  await turn($, '監査して', { errors: 2 })
  expect(await turn($, '続けて')).toEqual(['xhigh'])
})

test('サブエージェントのターンは触らず、数えない', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await turn($, 'メインの依頼')
  const n = asked.length
  const sent = await turn($, 'サブの依頼', { agentId: 'a1', steps: 11, errors: 2 })
  expect(sent.every(x => x === 'high')).toBe(true)
  expect(asked.length).toBe(n)
  expect(await turn($, 'メインの次')).toEqual(['low'])
})

test('前の回答の末尾を判定に添える', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })
  await turn($, '案を出して', { answer: '1. 用語を足す\n2. 全体を監査する' })
  await turn($, '2')
  expect(asked[asked.length - 1].includes('2. 全体を監査する')).toBe(true)
})
