import { expect, test } from 'claude-code/testing'
import { buildPrompt, PREVIOUS_LIMIT, raise, readLevel, REQUEST_LIMIT } from '../hooks/judge'

test('返事から段階を読む', async () => {
  expect(readLevel('low')).toBe('low')
  expect(readLevel(' Medium\n')).toBe('medium')
  expect(readLevel('high')).toBe('high')
  // xhigh の中の high を拾わない
  expect(readLevel('xhigh')).toBe('xhigh')
  expect(readLevel('段階は xhigh です')).toBe('xhigh')
  expect(readLevel('max')).toBe(undefined)
  expect(readLevel('')).toBe(undefined)
})

test('1段上げ、xhigh で止まる', async () => {
  expect(raise('low')).toBe('medium')
  expect(raise('medium')).toBe('high')
  expect(raise('high')).toBe('xhigh')
  expect(raise('xhigh')).toBe('xhigh')
})

test('依頼は先頭を、前の回答は末尾を残す', async () => {
  const request = 'あ'.repeat(REQUEST_LIMIT) + 'い'
  const previous = 'う' + 'え'.repeat(PREVIOUS_LIMIT)
  const prompt = buildPrompt(request, previous)
  expect(prompt.includes('い')).toBe(false)
  expect(prompt.includes('う')).toBe(false)
  expect(prompt.indexOf('<前の回答の末尾>') < prompt.indexOf('<依頼>')).toBe(true)
  // 前の回答が無ければ依頼だけ
  expect(buildPrompt('テスト').includes('前の回答')).toBe(false)
})
