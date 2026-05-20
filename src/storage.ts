import type { ChatMessage } from './ollama'

const KEY_MESSAGES = 'qwen-chat:messages'
const KEY_SYSTEM = 'qwen-chat:system'
const KEY_MODEL = 'qwen-chat:model'

export function loadMessages(): ChatMessage[] {
  try {
    return JSON.parse(localStorage.getItem(KEY_MESSAGES) ?? '[]')
  } catch {
    return []
  }
}

export function saveMessages(msgs: ChatMessage[]): void {
  localStorage.setItem(KEY_MESSAGES, JSON.stringify(msgs))
}

export function loadSystemPrompt(): string {
  return localStorage.getItem(KEY_SYSTEM) ?? ''
}

export function saveSystemPrompt(s: string): void {
  localStorage.setItem(KEY_SYSTEM, s)
}

export function loadModel(): string {
  return localStorage.getItem(KEY_MODEL) ?? ''
}

export function saveModel(m: string): void {
  localStorage.setItem(KEY_MODEL, m)
}

const KEY_PRESETS = 'qwen-chat:presets'
const KEY_SELECTED_PRESET = 'qwen-chat:selectedPreset'

export type Preset = { name: string; content: string }

export function loadPresets(): Preset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY_PRESETS) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (p): p is Preset =>
        p != null && typeof p.name === 'string' && typeof p.content === 'string'
    )
  } catch {
    return []
  }
}

export function savePresets(presets: Preset[]): void {
  localStorage.setItem(KEY_PRESETS, JSON.stringify(presets))
}

export function loadSelectedPreset(): string | null {
  const v = localStorage.getItem(KEY_SELECTED_PRESET)
  return v && v.length > 0 ? v : null
}

export function saveSelectedPreset(name: string | null): void {
  if (name === null) localStorage.removeItem(KEY_SELECTED_PRESET)
  else localStorage.setItem(KEY_SELECTED_PRESET, name)
}
