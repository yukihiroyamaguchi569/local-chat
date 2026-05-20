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
