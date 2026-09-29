const storageKey = 'coveceArenaSessionV2';
const validSession = value => value && /^[A-HJ-NP-Z2-9]{5}$/.test(value.id || '') && /^[a-f0-9]{64}$/.test(value.token || '');

function parse(value) {
  try { return JSON.parse(value || 'null'); } catch { return null; }
}

export function readSession(storage, invitedRoom = '') {
  const active = parse(storage.getItem(storageKey));
  if (!invitedRoom) return validSession(active) ? active : null;
  const invited = parse(storage.getItem(`${storageKey}:${invitedRoom}`));
  if (validSession(invited) && invited.id === invitedRoom) return invited;
  return validSession(active) && active.id === invitedRoom ? active : null;
}

export function saveSession(storage, session) {
  const active = parse(storage.getItem(storageKey));
  if (validSession(active)) storage.setItem(`${storageKey}:${active.id}`, JSON.stringify(active));
  storage.setItem(`${storageKey}:${session.id}`, JSON.stringify(session));
  storage.setItem(storageKey, JSON.stringify(session));
}

export function forgetSession(storage, session) {
  if (!session) return;
  storage.removeItem(`${storageKey}:${session.id}`);
  const active = parse(storage.getItem(storageKey));
  if (active?.id === session.id) storage.removeItem(storageKey);
}
