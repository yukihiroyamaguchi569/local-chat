import { useEffect, useRef, useState, useCallback } from 'react'
import type { ChatMessage } from './ollama'
import { listModels, streamChat } from './ollama'
import {
  loadMessages,
  loadModel,
  loadSystemPrompt,
  loadPresets,
  loadSelectedPreset,
  saveMessages,
  saveModel,
  saveSystemPrompt,
  savePresets,
  saveSelectedPreset,
} from './storage'
import type { Preset } from './storage'

export default function App() {
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState<string>(loadModel)
  const [systemPrompt, setSystemPrompt] = useState<string>(loadSystemPrompt)
  const [systemOpen, setSystemOpen] = useState(false)
  const [presets, setPresets] = useState<Preset[]>(loadPresets)
  const [selectedPresetName, setSelectedPresetName] = useState<string | null>(loadSelectedPreset)
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages)
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    listModels()
      .then((list) => {
        setModels(list)
        setModel((prev) => prev || list[0] || '')
      })
      .catch(() => setError('Ollama に接続できません。ollama serve が起動しているか確認してください。'))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => { saveMessages(messages) }, [messages])
  useEffect(() => { saveSystemPrompt(systemPrompt) }, [systemPrompt])
  useEffect(() => { saveModel(model) }, [model])
  useEffect(() => { savePresets(presets) }, [presets])
  useEffect(() => { saveSelectedPreset(selectedPresetName) }, [selectedPresetName])

  useEffect(() => {
    if (selectedPresetName && !presets.find(p => p.name === selectedPresetName)) {
      setSelectedPresetName(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')
    setError(null)

    const userMsg: ChatMessage = { role: 'user', content: text }
    const history: ChatMessage[] = [...messages, userMsg]
    setMessages(history)

    const payload: ChatMessage[] = systemPrompt.trim()
      ? [{ role: 'system', content: systemPrompt }, ...history]
      : history

    const assistantMsg: ChatMessage = { role: 'assistant', content: '' }
    setMessages([...history, assistantMsg])

    const ctrl = new AbortController()
    abortRef.current = ctrl
    setIsStreaming(true)

    try {
      await streamChat({
        model,
        messages: payload,
        signal: ctrl.signal,
        onDelta: (delta) => {
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last?.role === 'assistant') {
              next[next.length - 1] = { ...last, content: last.content + delta }
            }
            return next
          })
        },
      })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError((e as Error).message)
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
      inputRef.current?.focus()
    }
  }, [input, isStreaming, messages, model, systemPrompt])

  const onChangeSystemPrompt = (v: string) => {
    setSystemPrompt(v)
    if (selectedPresetName !== null) {
      const sel = presets.find(p => p.name === selectedPresetName)
      if (!sel || sel.content !== v) setSelectedPresetName(null)
    }
  }

  const selectPreset = (name: string) => {
    const p = presets.find(x => x.name === name)
    if (!p) return
    setSystemPrompt(p.content)
    setSelectedPresetName(name)
  }

  const saveAsNewPreset = () => {
    const raw = window.prompt('プリセット名を入力してください')
    if (raw === null) return
    const name = raw.trim()
    if (!name) { window.alert('名前を入力してください'); return }
    const existing = presets.find(p => p.name === name)
    if (existing) {
      if (!window.confirm(`「${name}」は既に存在します。上書きしますか？`)) return
      setPresets(presets.map(p => p.name === name ? { name, content: systemPrompt } : p))
    } else {
      setPresets([...presets, { name, content: systemPrompt }])
    }
    setSelectedPresetName(name)
  }

  const deletePreset = (name: string) => {
    if (!window.confirm(`「${name}」を削除しますか？`)) return
    setPresets(presets.filter(p => p.name !== name))
    if (selectedPresetName === name) setSelectedPresetName(null)
  }

  const stop = () => {
    abortRef.current?.abort()
  }

  const clearChat = () => {
    setMessages([])
    setError(null)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="layout">
      <header className="header">
        <div className="header-left">
          <span className="app-title">Local Chat</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={isStreaming}
            className="model-select"
          >
            {models.length === 0 && <option value="">モデル読込中...</option>}
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div className="header-right">
          <button
            className="btn-ghost"
            onClick={() => setSystemOpen((v) => !v)}
          >
            {systemOpen ? 'システムプロンプト ▲' : 'システムプロンプト ▼'}
          </button>
          <button className="btn-ghost" onClick={clearChat}>
            新規会話
          </button>
        </div>
      </header>

      {systemOpen && (
        <div className="system-panel">
          <aside className="preset-list">
            {presets.length === 0 && (
              <div className="preset-empty">プリセットなし</div>
            )}
            {presets.map((p) => (
              <div
                key={p.name}
                className={'preset-item' + (p.name === selectedPresetName ? ' preset-item-active' : '')}
                onClick={() => selectPreset(p.name)}
              >
                <span className="preset-name">{p.name}</span>
                <button
                  className="preset-delete"
                  onClick={(e) => { e.stopPropagation(); deletePreset(p.name) }}
                  aria-label={`${p.name} を削除`}
                >×</button>
              </div>
            ))}
            <button className="preset-add" onClick={saveAsNewPreset}>
              ＋ 新規保存
            </button>
          </aside>
          <textarea
            className="system-input"
            placeholder="システムプロンプト（空白の場合は送信しない）"
            value={systemPrompt}
            onChange={(e) => onChangeSystemPrompt(e.target.value)}
            rows={60}
          />
        </div>
      )}

      {error && <div className="error-bar">{error}</div>}

      <main className="messages">
        {messages.length === 0 && (
          <div className="empty">メッセージを入力して送信してください</div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`bubble bubble-${msg.role}`}>
            <span className="bubble-label">{msg.role === 'user' ? 'あなた' : 'AI'}</span>
            <pre className="bubble-content">{msg.content}</pre>
          </div>
        ))}
        <div ref={bottomRef} />
      </main>

      <footer className="input-bar">
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder="メッセージを入力… (Enter で送信 / Shift+Enter で改行)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          disabled={isStreaming}
        />
        <div className="input-actions">
          {isStreaming ? (
            <button className="btn-stop" onClick={stop}>停止</button>
          ) : (
            <button className="btn-send" onClick={send} disabled={!input.trim()}>
              送信
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}
