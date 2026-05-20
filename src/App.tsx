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

type TextAttachment = { kind: 'text'; id: string; name: string; ext: string; content: string }
type ImageAttachment = { kind: 'image'; id: string; name: string; mime: string; base64: string }
type Attachment = TextAttachment | ImageAttachment

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTS.includes(ext)
}

function extOf(name: string): string {
  const m = name.match(/\.([^.]+)$/)
  return m ? m[1].toLowerCase() : 'text'
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result ?? ''))
    r.onerror = () => reject(new Error(`${file.name} の読み込みに失敗`))
    r.readAsText(file, 'utf-8')
  })
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result ?? '')
      const i = s.indexOf(',')
      resolve(i >= 0 ? s.slice(i + 1) : s)
    }
    r.onerror = () => reject(new Error(`${file.name} の読み込みに失敗`))
    r.readAsDataURL(file)
  })
}

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
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    if ((!text && attachments.length === 0) || isStreaming) return
    setInput('')
    setError(null)

    const textParts = attachments
      .filter((a): a is TextAttachment => a.kind === 'text')
      .map(a => '```' + a.ext + '\n' + a.content + '\n```')
    const composedContent = [...textParts, text].filter(Boolean).join('\n\n')
    const imageList = attachments
      .filter((a): a is ImageAttachment => a.kind === 'image')
      .map(a => a.base64)
    setAttachments([])

    const userMsg: ChatMessage = {
      role: 'user',
      content: composedContent,
      ...(imageList.length > 0 ? { images: imageList } : {}),
    }
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
  }, [input, isStreaming, messages, model, systemPrompt, attachments])

  const openFilePicker = () => {
    if (isStreaming) return
    fileInputRef.current?.click()
  }

  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files
    if (!list || list.length === 0) return
    const files = Array.from(list)
    e.target.value = ''
    const added: Attachment[] = []
    for (const f of files) {
      try {
        if (isImageFile(f)) {
          const base64 = await readAsBase64(f)
          added.push({ kind: 'image', id: crypto.randomUUID(), name: f.name, mime: f.type || 'image/png', base64 })
        } else {
          const content = await readAsText(f)
          added.push({ kind: 'text', id: crypto.randomUUID(), name: f.name, ext: extOf(f.name), content })
        }
      } catch (err) {
        setError((err as Error).message)
      }
    }
    setAttachments(prev => [...prev, ...added])
  }

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id))
  }

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
            {msg.images && msg.images.length > 0 && (
              <div className="bubble-images">
                {msg.images.map((b64, j) => (
                  <img key={j} className="bubble-thumb" src={`data:image/*;base64,${b64}`} alt="" />
                ))}
              </div>
            )}
            {msg.content && <pre className="bubble-content">{msg.content}</pre>}
          </div>
        ))}
        <div ref={bottomRef} />
      </main>

      <footer className="input-bar">
        {attachments.length > 0 && (
          <div className="attachment-chips">
            {attachments.map((a) => (
              <div key={a.id} className={`chip chip-${a.kind}`}>
                {a.kind === 'image' ? (
                  <img className="chip-thumb" src={`data:${a.mime};base64,${a.base64}`} alt={a.name} />
                ) : (
                  <span className="chip-icon">📄</span>
                )}
                <span className="chip-name" title={a.name}>{a.name}</span>
                <button
                  className="chip-remove"
                  onClick={() => removeAttachment(a.id)}
                  disabled={isStreaming}
                  aria-label={`${a.name} を削除`}
                >×</button>
              </div>
            ))}
          </div>
        )}
        <div className="input-row">
          <button
            className="btn-attach"
            onClick={openFilePicker}
            disabled={isStreaming}
            aria-label="ファイルを添付"
          >📎</button>
          <input ref={fileInputRef} type="file" multiple hidden onChange={onPickFiles} />
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
              <button
                className="btn-send"
                onClick={send}
                disabled={!input.trim() && attachments.length === 0}
              >送信</button>
            )}
          </div>
        </div>
      </footer>
    </div>
  )
}
