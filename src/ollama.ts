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

export async function streamChat(opts: {
  model: string
  messages: ChatMessage[]
  signal: AbortSignal
  onDelta: (delta: string) => void
}): Promise<void> {
  const { model, messages, signal, onDelta } = opts

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
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
