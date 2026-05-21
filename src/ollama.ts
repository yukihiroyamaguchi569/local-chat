export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  images?: string[]
}

const THINK_OPEN = '<unused94>'
const THINK_CLOSE = '<unused95>'

// Removes completed <unused94>...<unused95> thinking blocks (Gemma reasoning format).
// If a block is open but not yet closed (streaming in progress), suppresses everything from
// the open marker onward so thinking never leaks to the caller mid-stream.
function stripThinking(raw: string): string {
  let out = ''
  let i = 0
  for (;;) {
    const open = raw.indexOf(THINK_OPEN, i)
    if (open === -1) { out += raw.slice(i); break }
    out += raw.slice(i, open)
    const close = raw.indexOf(THINK_CLOSE, open + THINK_OPEN.length)
    if (close === -1) return out
    i = close + THINK_CLOSE.length
    if (raw[i] === '\n') i++
  }
  return out
}

// Holds back a trailing suffix that could be the start of THINK_OPEN to avoid
// emitting a partial marker that would later be swallowed by stripThinking.
function visibleStable(raw: string): string {
  const v = stripThinking(raw)
  for (let n = Math.min(THINK_OPEN.length - 1, v.length); n > 0; n--) {
    if (THINK_OPEN.startsWith(v.slice(v.length - n))) return v.slice(0, v.length - n)
  }
  return v
}

export async function listModels(): Promise<string[]> {
  const res = await fetch('/api/tags')
  if (!res.ok) throw new Error(`Ollama /api/tags failed: ${res.status}`)
  const data = await res.json() as { models: { name: string }[] }
  return data.models.map((m) => m.name)
}

// Returns how many characters at the end of `text` could be the start of `tag`
function partialSuffix(text: string, tag: string): number {
  const max = Math.min(tag.length - 1, text.length)
  for (let len = max; len > 0; len--) {
    if (text.endsWith(tag.slice(0, len))) return len
  }
  return 0
}

const TAG_PAIRS: [open: string, close: string][] = [
  ['<think>', '</think>'],
  ['<unused94>', '<unused95>'],
]

// Wraps onDelta to strip thinking blocks for any known tag pair, handling chunk boundaries
function makeThinkFilter(onDelta: (delta: string) => void): (delta: string) => void {
  let pending = ''
  let closeTag: string | null = null

  return (delta: string) => {
    pending += delta
    let output = ''

    while (true) {
      if (closeTag === null) {
        let bestStart = -1
        let bestOpen = ''
        let bestClose = ''
        for (const [open, close] of TAG_PAIRS) {
          const idx = pending.indexOf(open)
          if (idx !== -1 && (bestStart === -1 || idx < bestStart)) {
            bestStart = idx; bestOpen = open; bestClose = close
          }
        }
        if (bestStart === -1) {
          let keep = 0
          for (const [open] of TAG_PAIRS) keep = Math.max(keep, partialSuffix(pending, open))
          output += keep > 0 ? pending.slice(0, -keep) : pending
          pending = keep > 0 ? pending.slice(-keep) : ''
          break
        }
        output += pending.slice(0, bestStart)
        pending = pending.slice(bestStart + bestOpen.length)
        closeTag = bestClose
      } else {
        const end = pending.indexOf(closeTag)
        if (end === -1) {
          const keep = partialSuffix(pending, closeTag)
          pending = keep > 0 ? pending.slice(-keep) : ''
          break
        }
        pending = pending.slice(end + closeTag.length)
        closeTag = null
      }
    }

    if (output) onDelta(output)
  }
}

export async function streamChat(opts: {
  model: string
  messages: ChatMessage[]
  signal: AbortSignal
  onDelta: (delta: string) => void
}): Promise<void> {
  const { model, messages, signal } = opts
  const onDelta = makeThinkFilter(opts.onDelta)

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true, think: false }),
    signal,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Ollama error ${res.status}: ${text}`)
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let raw = ''
  let emitted = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const chunk = JSON.parse(line) as {
          message?: { content?: string }
          done: boolean
        }
        if (chunk.message?.content) {
          raw += chunk.message.content
          const v = visibleStable(raw)
          if (v.length > emitted) { onDelta(v.slice(emitted)); emitted = v.length }
        }
        if (chunk.done) {
          const finalV = stripThinking(raw)
          if (finalV.length > emitted) onDelta(finalV.slice(emitted))
          return
        }
      } catch {
        // ignore malformed lines
      }
    }
  }
}
