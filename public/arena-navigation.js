// Navigation never sends a leave command or removes a saved game/token.
export function returnToArena({ active = false, destination = "/", confirm, saveSolo, closeStream, navigate }) {
  if (active && !confirm()) return false;
  saveSolo();
  closeStream();
  navigate(destination);
  return true;
}

// An invitation takes precedence over a different saved game.
export function chooseSavedEntry({ inviteCode = "", solo = null, online = null } = {}) {
  if (!inviteCode && solo) return { mode: "solo", solo };
  if (online && /^[A-HJ-NP-Z2-9]{5}$/.test(online.id || "") &&
      /^[a-f0-9]{64}$/.test(online.token || "") && (!inviteCode || online.id === inviteCode)) {
    return { mode: "online", session: online };
  }
  return { mode: "home", session: null };
}
