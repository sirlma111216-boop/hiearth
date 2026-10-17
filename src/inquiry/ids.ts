export function newId(prefix = 'id'): string {
  const buf = new Uint8Array(8)
  crypto.getRandomValues(buf)
  return prefix + '_' + Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function idempotencyKey(): string {
  const buf = new Uint8Array(12)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}
