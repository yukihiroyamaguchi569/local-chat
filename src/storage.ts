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
