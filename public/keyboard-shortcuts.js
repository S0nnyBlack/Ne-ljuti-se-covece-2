export function keyboardGameAction(key, game) {
  if (!game.desktop || !game.visible || game.modalOpen || game.busy || !game.ownTurn ||
      key.repeat || key.isComposing || key.altKey || key.ctrlKey || key.metaKey || key.shiftKey ||
      game.focusIsEditable) return null;

  if (key.code === 'Space') {
    if (game.focusIsActivatable) return null;
    return ['choose-starter', 'await-roll'].includes(game.phase) ? { type: 'roll' } : null;
  }

  const match = /^(?:Digit|Numpad)([1-4])$/.exec(key.code);
  const piece = match ? Number(match[1]) - 1 : null;
  return game.phase === 'await-move' && piece !== null && game.legalMoves.includes(piece)
    ? { type: 'move', piece } : null;
}
