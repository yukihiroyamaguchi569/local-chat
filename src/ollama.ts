export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  images?: string[]
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
        if (chunk.message?.content) onDelta(chunk.message.content)
        if (chunk.done) return
      } catch {
        // ignore malformed lines
      }
    }
  }
}
