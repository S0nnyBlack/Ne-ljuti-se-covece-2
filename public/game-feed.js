export function describeAction(state) {
  const action = state?.lastAction;
  const name = state?.players?.[action?.seat]?.name;
  if (!name) return null;
  if (action.type === 'starter-roll' && Number.isInteger(action.die))
    return `${name}: bacanje za početak — ${action.die}`;
  if (action.type === 'roll' && Number.isInteger(action.die))
    return `${name}: kockica ${action.die}${action.passed ? ' · bez poteza' : ''}`;
  if (action.type === 'move' && Number.isInteger(action.piece) && Number.isInteger(action.die))
    return `${name}: figura ${action.piece + 1} ide ${action.die} polja${action.captured?.length ? ' · izbacivanje' : ''}`;
  return null;
}
