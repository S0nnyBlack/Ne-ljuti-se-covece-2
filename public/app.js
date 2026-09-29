import { readRoomCode } from './room-code.js';
import { newGame, join as joinGame, start as startGame, roll as rollGame, move as moveGame, publicGame } from '../game.js';
import { chooseBotMove, rollBotDie } from './solo-bots.js';

const colors = ['red', 'blue', 'yellow', 'green'];
const names = ['Crveni', 'Plavi', 'Žuti', 'Zeleni'];
const starts = [0, 13, 26, 39];
const track = [[6,1],[6,0],[7,0],[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[9,6],[10,6],[11,6],[12,6],[13,6],[14,6],[14,7],[14,8],[13,8],[12,8],[11,8],[10,8],[9,8],[8,9],[8,10],[8,11],[8,12],[8,13],[8,14],[7,14],[6,14],[6,13],[6,12],[6,11],[6,10],[6,9],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8],[0,7],[0,6],[1,6],[2,6],[3,6],[4,6],[5,6],[6,5],[6,4],[6,3],[6,2]];
const lanes = [[[7,1],[7,2],[7,3],[7,4],[7,5]],[[13,7],[12,7],[11,7],[10,7],[9,7]],[[7,13],[7,12],[7,11],[7,10],[7,9]],[[1,7],[2,7],[3,7],[4,7],[5,7]]];
const homes = [[[2,2],[3,2],[2,3],[3,3]],[[11,2],[12,2],[11,3],[12,3]],[[11,11],[12,11],[11,12],[12,12]],[[2,11],[3,11],[2,12],[3,12]]];
const pipMap = {1:[[50,50]],2:[[28,28],[72,72]],3:[[28,28],[50,50],[72,72]],4:[[28,28],[72,28],[28,72],[72,72]],5:[[28,28],[72,28],[50,50],[28,72],[72,72]],6:[[28,24],[72,24],[28,50],[72,50],[28,76],[72,76]]};
const $ = selector => document.querySelector(selector);
const storageKey = 'coveceArenaSessionV2';
let session = null;
let state = null;
let soloGame = null;
let events = null;
let busy = false;
let entryView = 'home';
let toastTimer;

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 3000);
}

function modal(title, description, actions) {
  $('#modalTitle').textContent = title;
  $('#modalText').textContent = description;
  const container = $('#modalActions');
  container.replaceChildren();
  for (const action of actions) {
    const button = document.createElement('button');
    button.textContent = action.label;
    if (action.primary) button.className = 'primary';
    button.onclick = () => { $('#modalBg').classList.remove('show'); action.run?.(); };
    container.append(button);
  }
  $('#modalBg').classList.add('show');
}

function buildBoard() {
  const route = new Set(track.map(xy => xy.join(',')));
  const startColors = new Map(starts.map((index, seat) => [track[index].join(','), colors[seat]]));
  const laneColors = new Map(lanes.flatMap((line, seat) => line.map(xy => [xy.join(','), colors[seat]])));
  const fragment = document.createDocumentFragment();
  for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) {
    const key = `${x},${y}`;
    const cell = document.createElement('div');
    cell.className = 'cell';
    const home = x < 6 && y < 6 ? 'red' : x > 8 && y < 6 ? 'blue' : x > 8 && y > 8 ? 'yellow' : x < 6 && y > 8 ? 'green' : null;
    if (home) cell.classList.add('home', home);
    else if (x >= 6 && x <= 8 && y >= 6 && y <= 8) cell.classList.add('center');
    else if (laneColors.has(key)) cell.classList.add('lane', laneColors.get(key));
    else if (startColors.has(key)) cell.classList.add('start', startColors.get(key));
    else if (route.has(key)) cell.classList.add('track');
    if (homes.some(line => line.some(([hx, hy]) => hx === x && hy === y))) cell.classList.add('nest');
    cell.setAttribute('aria-hidden', 'true');
    fragment.append(cell);
  }
  const center = document.createElement('div');
  center.className = 'board-center';
  center.setAttribute('aria-hidden', 'true');
  center.innerHTML = '<span>★</span>';
  fragment.append(center);
  $('#board').replaceChildren(fragment);
}

function coordinate(seat, piece) {
  const position = state?.pieces[seat]?.[piece] ?? -1;
  if (position < 0) return homes[seat][piece];
  if (position < 52) return track[(starts[seat] + position) % 52];
  if (position < 57) return lanes[seat][position - 52];
  return [[7,6],[8,7],[7,8],[6,7]][seat];
}

function canMove(seat, piece) {
  return !!session && !!state && !busy && session.seat === seat && state.current === seat && state.phase === 'await-move' && state.legalMoves.includes(piece);
}

function renderPieces() {
  $('#board').querySelectorAll('.piece').forEach(element => element.remove());
  if (!state) return;
  const occupied = new Map();
  for (let seat = 0; seat < state.seats; seat++) for (let piece = 0; piece < 4; piece++) {
    const [x, y] = coordinate(seat, piece);
    const key = `${x},${y}`;
    const overlap = occupied.get(key) || 0;
    occupied.set(key, overlap + 1);
    const element = document.createElement('button');
    element.className = `piece ${colors[seat]} ${canMove(seat, piece) ? 'selectable' : ''}`;
    element.style.left = `${(x + .5) / 15 * 100}%`;
    element.style.top = `${(y + .5) / 15 * 100}%`;
    if (overlap) {
      element.style.marginLeft = `${(overlap % 2 ? 1 : -1) * overlap * 4}px`;
      element.style.marginTop = `${overlap * 2}px`;
    }
    element.disabled = !canMove(seat, piece);
    element.dataset.seat = seat;
    element.dataset.piece = piece;
    element.setAttribute('aria-label', `${names[seat]} figura ${piece + 1}${element.disabled ? '' : ', dostupna za pomeranje'}`);
    $('#board').append(element);
  }
}

function renderPlayers() {
  const container = $('#players');
  container.replaceChildren();
  for (let seat = 0; seat < 4; seat++) {
    const row = document.createElement('div');
    row.className = `player ${state?.current === seat && state?.phase !== 'lobby' ? 'active' : ''}`;
    const dot = document.createElement('span');
    dot.className = `player-dot ${colors[seat]}`;
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = state?.players[seat]?.name || names[seat];
    const sub = document.createElement('small');
    sub.textContent = seat >= (state?.seats || 4) ? 'Nije u partiji' : !state?.players[seat] ? 'Slobodno mesto' :
      state.phase === 'lobby' ? 'Spreman' : state.phase === 'choose-starter' ?
      state.starterRolls?.[seat] != null ? `Bacio ${state.starterRolls[seat]}` :
      state.starterCandidates?.includes(seat) ? seat === state.current ? 'Baca za početak' : 'Čeka bacanje' : 'Čeka ishod' :
      state.winner === seat ? 'Pobednik' : state.current === seat ? 'Na potezu' : 'Čeka red';
    info.append(title, sub);
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `${state?.pieces[seat]?.filter(position => position === 57).length || 0}/4`;
    row.append(dot, info, count);
    container.append(row);
  }
}

function renderDice() {
  $('#modeSeats').textContent = `${state?.seats || 4} igrača`;
  $('#modeType').textContent = session?.solo ? 'solo' : 'online';
  $('#gameStatusLabel').textContent = session?.solo ? 'Solo igra' : 'Online igra';
  $('#gameFooterMode').textContent = `Arena Games · ${session?.solo ? 'solo' : 'online'} partija`;
  const die = state?.roll || state?.lastAction?.die || 1;
  $('#diceFace').replaceChildren(...pipMap[die].map(([x, y]) => {
    const pip = document.createElement('i');
    pip.className = 'pip';
    pip.style.left = `${x}%`;
    pip.style.top = `${y}%`;
    return pip;
  }));
  const choosingStarter = state?.phase === 'choose-starter';
  $('#turnNo').textContent = choosingStarter ? 'Ko počinje?' : `Potez ${String(state?.turn || 1).padStart(2, '0')}`;
  const active = state?.players[state.current];
  const activeName = active?.name || names[state?.current || 0];
  const waiting = state?.phase === 'lobby';
  const finished = state?.phase === 'finished';
  $('#diceTitle').textContent = state?.roll ? `Palo je ${state.roll}` : waiting ? 'Čekamo igrače' :
    choosingStarter ? 'Biramo prvog igrača' : finished ? 'Partija je završena' : 'Spreman?';
  $('#diceSubtitle').textContent = waiting ? `${state.players.filter(Boolean).length}/${state.seats} igrača` :
    choosingStarter ? `${activeName} baca za početak.` : state?.phase === 'await-move' ? 'Izaberi označenu figuru.' : `${activeName} je na potezu.`;
  $('#boardStatus').textContent = finished ? `${state.players[state.winner].name} je pobedio/la!` : waiting ? 'Čekamo igrače' :
    choosingStarter ? `${activeName} baca za početak` : `${activeName} je na potezu`;
  $('#rollBtn').disabled = busy || !session || !state || !['await-roll', 'choose-starter'].includes(state.phase) || state.current !== session.seat;
  $('#rollBtn').textContent = finished ? 'Partija završena' : state?.phase === 'await-move' ? 'Izaberi figuru' : waiting ? 'Čekamo igrače' :
    state?.current !== session?.seat ? 'Čekaj svoj red' : choosingStarter ? 'Baci za početak' : 'Baci kockicu';
  const choosingPiece = state?.phase === 'await-move' && state.current === session?.seat;
  $('#rollBtn').hidden = choosingPiece;
  const options = $('#moveOptions');
  options.hidden = !choosingPiece;
  options.replaceChildren();
  if (choosingPiece) for (const piece of state.legalMoves) {
    const button = document.createElement('button');
    button.textContent = `Figura ${piece + 1}`;
    button.setAttribute('aria-label', `Pomeri figuru ${piece + 1}`);
    button.disabled = busy;
    button.onclick = () => submit(() => command('move', { piece }));
    options.append(button);
  }
  $('#helpText').textContent = waiting ? 'Podeli pozivnicu drugim igračima.' : choosingStarter ?
    'Svi bacaju jednom; najviši broj počinje. Izjednačeni ponovo bacaju.' : finished ? 'Za novu partiju napravi novu sobu.' :
    state?.phase === 'await-move' ? 'Izaberi figuru dugmetom ili dodirni označenu figuru na tabli.' :
    state?.openingAttempts ? `Još ${3 - state.openingAttempts} pokušaja za šesticu.` : 'Šestica izvodi figuru iz kućice.';
}

function render() {
  const view = session ? (!state || state.phase === 'lobby' ? 'lobby' : 'game') : entryView;
  for (const name of ['home', 'setup', 'lobby', 'game']) $(`#${name}View`).hidden = name !== view;
  if (view === 'lobby') renderLobby();
  renderPlayers(); renderDice(); renderPieces();
}

function renderLobby() {
  const joined = state?.players.filter(Boolean).length || 1;
  $('#lobbyCount').textContent = `${joined}/${state?.seats || 4} igrača`;
  $('#roomCode').textContent = session?.id || '';
  $('#mySeat').textContent = session ? `Igraš kao ${names[session.seat]}${session.seat === 0 ? ' · domaćin' : ''}` : '';
  $('#startBtn').hidden = session?.seat !== 0;
  $('#startBtn').disabled = busy || !state || joined < 2;
  $('#lobbyWait').textContent = !state ? 'Učitavanje sobe…' : joined < 2 ? 'Potrebna su najmanje dva igrača.' : session.seat === 0 ? 'Možeš pokrenuti partiju ili sačekati ostale.' : 'Čeka se da domaćin pokrene partiju.';
  const slots = $('#lobbyPlayers');
  slots.replaceChildren();
  for (let seat = 0; seat < (state?.seats || 4); seat++) {
    const player = state?.players[seat];
    const row = document.createElement('div');
    row.className = `lobby-player ${seat === 0 && player ? 'is-host' : ''} ${player ? '' : 'is-empty'}`;
    const avatar = document.createElement('span');
    avatar.className = 'lobby-avatar';
    avatar.textContent = player ? player.name.slice(0, 1).toUpperCase() : '·';
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = player ? `${player.name}${seat === 0 ? ' ★' : ''}` : 'Čeka igrača…';
    const subtitle = document.createElement('small');
    subtitle.textContent = player ? names[seat] : 'Slobodno mesto';
    info.append(title, subtitle);
    row.append(avatar, info);
    slots.append(row);
  }
}

async function api(url, method = 'GET', payload, token) {
  const response = await fetch(url, {
    method,
    headers: { ...(payload === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'Zahtev nije uspeo.'), { status: response.status, code: result.code });
  return result;
}

function receive(next) {
  if (!state || next.revision >= state.revision) {
    if (session?.playerId) {
      const seat = next.players.findIndex(player => player?.id === session.playerId);
      if (seat < 0) {
        events?.close(); session = null; state = null; entryView = 'setup';
        localStorage.removeItem(storageKey); history.replaceState(null, '', '/'); render();
        return;
      }
      if (seat !== session.seat) {
        session.seat = seat;
        localStorage.setItem(storageKey, JSON.stringify(session));
      }
    }
    const previous = state?.revision;
    state = next;
    render();
    if (previous !== undefined && next.revision > previous && next.lastAction?.type === 'roll' && next.lastAction.passed) {
      toast(next.lastAction.attemptsLeft ? `Palo je ${next.lastAction.die}. Još ${next.lastAction.attemptsLeft} pokušaja za šesticu.` :
        `Palo je ${next.lastAction.die}. Nema mogućeg poteza.`);
    }
    if (previous !== undefined && next.revision > previous && next.lastAction?.type === 'starter-roll') {
      if (next.lastAction.winnerSeat != null) toast(`${next.players[next.lastAction.winnerSeat].name} počinje partiju.`);
      else if (next.lastAction.tiedSeats?.length > 1) toast('Izjednačenje! Izjednačeni ponovo bacaju.');
    }
    if (previous !== undefined && next.revision > previous && next.phase === 'finished') modal('Pobeda!', `${next.players[next.winner].name} je doveo/la sve četiri figure u cilj.`, [{ label: 'Zatvori' }]);
  }
}

function connect() {
  events?.close();
  if (!session || session.solo) return;
  const current = session;
  const controller = new AbortController();
  let timer;
  events = { close() { controller.abort(); clearTimeout(timer); } };
  async function stream() {
    try {
      const response = await fetch(`/api/games/${current.id}/events`, {
        headers: { authorization: `Bearer ${current.token}` }, signal: controller.signal
      });
      if ([401, 404].includes(response.status)) {
        if (session === current) {
          events.close(); session = null; state = null; entryView = 'setup';
          localStorage.removeItem(storageKey); render(); toast('Soba ili sesija više nije dostupna.');
        }
        return;
      }
      if (!response.ok) throw new Error('Veza nije dostupna.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const event = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = event.split('\n').find(line => line.startsWith('data: '));
            if (data && session === current) receive(JSON.parse(data.slice(6)));
          }
        }
      } finally { await reader.cancel(); reader.releaseLock(); }
    } catch (error) {
      if (!controller.signal.aborted && state?.phase === 'lobby') $('#lobbyWait').textContent = 'Veza se obnavlja…';
    }
    if (!controller.signal.aborted && session === current) timer = setTimeout(stream, 3000);
  }
  stream();
}

async function command(action, payload = {}) {
  const current = session;
  if (current?.solo) {
    if (action === 'roll') rollGame(soloGame, current.seat, rollBotDie());
    else if (action === 'move') moveGame(soloGame, current.seat, payload.piece);
    else throw new Error('Ova komanda nije dostupna u solo igri.');
    state = publicGame(soloGame);
    render();
    await advanceSoloBots();
    return publicGame(soloGame);
  }
  const input = { ...payload, requestId: crypto.randomUUID(), expectedRevision: state.revision };
  try {
    // A transport retry must reuse both the ID and revision; it cannot roll twice.
    try { return await api(`/api/games/${current.id}/${action}`, 'POST', input, current.token); }
    catch (error) {
      if (error.status) throw error;
      return await api(`/api/games/${current.id}/${action}`, 'POST', input, current.token);
    }
  } catch (error) {
    if (error.code === 'STALE_REVISION' && session === current) receive(await api(`/api/games/${current.id}`, 'GET', undefined, current.token));
    throw error;
  }
}

async function advanceSoloBots() {
  while (session?.solo && soloGame.phase !== 'finished' && soloGame.current !== session.seat) {
    const seat = soloGame.current;
    if (soloGame.phase === 'choose-starter' || soloGame.phase === 'await-roll') {
      rollGame(soloGame, seat, rollBotDie());
    } else if (soloGame.phase === 'await-move') {
      const piece = chooseBotMove(soloGame, seat);
      if (piece === null) throw new Error('Bot nije pronašao dozvoljen potez.');
      moveGame(soloGame, seat, piece);
    } else break;
    state = publicGame(soloGame);
    render();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

async function startSoloGame(botCount = Number($('#botCount').value), playerName = $('#playerName').value.trim() || 'Igrač') {
  const playerId = crypto.randomUUID();
  soloGame = newGame(botCount + 1);
  joinGame(soloGame, playerId, playerName);
  for (let index = 1; index <= botCount; index++) joinGame(soloGame, crypto.randomUUID(), `Bot ${index}`);
  startGame(soloGame, 0);
  session = { id: 'solo', seat: 0, playerId, solo: true };
  state = publicGame(soloGame);
  history.replaceState(null, '', '/');
  entryView = 'game';
  render();
  await advanceSoloBots();
  receive(publicGame(soloGame));
}

async function establish(result) {
  events?.close();
  state = null;
  session = { id: result.id, token: result.token, seat: result.seat, playerId: result.state.players[result.seat].id };
  localStorage.setItem(storageKey, JSON.stringify(session));
  history.replaceState(null, '', `?room=${result.id}`);
  receive(result.state);
  connect();
}

async function submit(action) {
  if (busy) return;
  busy = true; render();
  try {
    const result = await action();
    if (result) receive(result);
  } catch (error) { toast(error.message || 'Greška u povezivanju.'); }
  finally { busy = false; render(); }
}

$('#createBtn').onclick = () => submit(async () => {
  const result = await api('/api/games', 'POST', { name: $('#playerName').value.trim() || 'Igrač', seats: Number($('#seatCount').value) });
  establish(result);
});
$('#joinBtn').onclick = () => submit(async () => {
  const id = readRoomCode($('#joinCode').value, location.origin);
  if (!id) throw new Error('Unesi kod sobe od 5 znakova ili pozivni link.');
  const result = await api(`/api/games/${id}/join`, 'POST', { name: $('#joinName').value.trim() || 'Igrač' });
  establish(result);
});
$('#enterOnline').onclick = () => { entryView = 'setup'; render(); };
$('#soloBtn').onclick = () => submit(startSoloGame);
$('#backHome').onclick = () => { entryView = 'home'; render(); };
$('#startBtn').onclick = () => submit(() => command('start'));
$('#copyBtn').onclick = async () => {
  try { await navigator.clipboard.writeText(`${location.origin}/?room=${session.id}`); toast('Pozivnica je kopirana.'); }
  catch { toast(`Kod sobe: ${session.id}`); }
};
$('#leaveBtn').onclick = () => {
  modal('Napusti sobu?', 'Tvoje mesto će biti oslobođeno. Ako si domaćin, sledeći igrač preuzima sobu.', [
    { label: 'Odustani' },
    { label: 'Napusti', primary: true, run: () => submit(async () => {
      await command('leave');
      events?.close(); session = null; state = null; entryView = 'setup';
      localStorage.removeItem(storageKey); history.replaceState(null, '', '/');
    }) }
  ]);
};
$('#resetBtn').onclick = () => {
  modal('Nova partija?', session?.solo ? 'Pokrenuće se nova solo partija sa istim brojem botova.' : 'Napraviće se nova soba. Ova partija ostaje dostupna preko stare veze.', [
    { label: 'Odustani' },
    { label: 'Napravi', primary: true, run: () => submit(async () => {
      if (session?.solo) return startSoloGame(state.seats - 1, state.players[session.seat].name);
      const result = await api('/api/games', 'POST', { name: state?.players[session?.seat]?.name || $('#playerName').value.trim() || 'Igrač', seats: state?.seats || Number($('#seatCount').value) });
      establish(result);
    }) }
  ]);
};
$('#rollBtn').onclick = () => submit(() => command('roll'));
$('#board').onclick = event => {
  const piece = event.target.closest('.piece');
  if (piece && !piece.disabled) submit(() => command('move', { piece: Number(piece.dataset.piece) }));
};
function showRules(event) {
  event.preventDefault();
  $('.mobile-menu').open = false;
  modal('Kako se igra', 'Svaki igrač ima četiri figure. Svi bacaju za početak: najviši broj počinje, a izjednačeni ponovo bacaju. Šestica izvodi figuru iz kuće i daje novo bacanje. Kada su ti sve preostale figure u kući, imaš do tri pokušaja da dobiješ šesticu. Kreći se u smeru kazaljke na satu. Ne možeš stati na svoju figuru, osim u zajedničkom cilju. Na protivničku figuru možeš stati i na obojenom startu: vraćaš je u kuću i ponovo bacaš. Za cilj je potreban tačan broj koraka. Pobeđuje prvi sa sve četiri figure u cilju.', [{ label: 'Razumem', primary: true }]);
}
$('#rulesLink').onclick = showRules;
$('#mobileRules').onclick = showRules;
$('#modalBg').onclick = event => { if (event.target.id === 'modalBg') $('#modalBg').classList.remove('show'); };
document.addEventListener('keydown', event => { if (event.key === 'Escape') $('#modalBg').classList.remove('show'); });

buildBoard();
$('#joinCode').value = readRoomCode(location.search, location.origin);
if ($('#joinCode').value) entryView = 'setup';
try { session = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { session = null; }
if (session && /^[A-HJ-NP-Z2-9]{5}$/.test(session.id || '') && /^[a-f0-9]{64}$/.test(session.token || '')) {
  api(`/api/games/${session.id}`, 'GET', undefined, session.token).then(receive).then(connect).catch(() => { localStorage.removeItem(storageKey); session = null; state = null; render(); });
} else session = null;
render();
