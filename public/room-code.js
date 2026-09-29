export function readRoomCode(value, base = 'https://invite.invalid') {
  if (typeof value !== 'string') return '';
  let code = value.trim();
  if (code.includes('room=')) {
    try { code = new URL(code, base).searchParams.get('room') || ''; } catch { return ''; }
  }
  code = code.toUpperCase();
  return /^[A-HJ-NP-Z2-9]{5}$/.test(code) ? code : '';
}
