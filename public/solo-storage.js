export function restoreSoloSnapshot(raw) {
  let saved;
  try { saved = JSON.parse(raw); } catch { return null; }
  const game = saved?.game;
  if (saved?.version !== 1 || typeof saved.playerId !== 'string' || !saved.playerId ||
      game?.version !== 1 || !Number.isInteger(game.seats) || game.seats < 2 || game.seats > 4 ||
      !['choose-starter', 'await-roll', 'await-move', 'finished'].includes(game.phase) ||
      !Number.isInteger(game.current) || game.current < 0 || game.current >= game.seats ||
      !Number.isInteger(game.revision) || game.revision < 0 ||
      !Array.isArray(game.players) || game.players.length !== game.seats ||
      !Array.isArray(game.pieces) || game.pieces.length !== game.seats ||
      !Array.isArray(game.starterCandidates) || !Array.isArray(game.starterRolls) ||
      game.starterRolls.length !== game.seats ||
      (game.roll !== null && (!Number.isInteger(game.roll) || game.roll < 1 || game.roll > 6)) ||
      !Number.isInteger(game.openingAttempts) || game.openingAttempts < 0 || game.openingAttempts > 3 ||
      (game.winner !== null && (!Number.isInteger(game.winner) || game.winner < 0 || game.winner >= game.seats)) ||
      game.players.some(player => typeof player?.id !== 'string' || !player.id ||
        typeof player.name !== 'string' || !player.name || player.name.length > 32) ||
      game.pieces.some(row => !Array.isArray(row) || row.length !== 4 ||
        row.some(position => !Number.isInteger(position) || position < -1 || position > 57)) ||
      game.players[0].id !== saved.playerId) return null;
  return { game, playerId: saved.playerId };
}
