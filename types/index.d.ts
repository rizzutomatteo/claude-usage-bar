export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** Ultima lettura di contesto e limiti, con l'ora (ms) in cui è stata presa. */
export type Snapshot = {
  tokens?: number
  window: number
  percent?: number
  limits: Limit[]
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-bar': { snap: Snapshot | null; off: boolean; ascii: boolean }
  }
}
