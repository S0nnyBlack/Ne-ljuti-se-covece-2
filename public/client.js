/**
 * Ne ljuti se čoveče – Online (client.js)
 * Renders server-authoritative state. Never decides game rules locally.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Board geometry (17x17 grid). Must stay in sync with server step math.
  // ---------------------------------------------------------------------
  const COLORS = ['red', 'green', 'yellow', 'blue'];
  const COLOR_LABEL = { red: 'Crveni', green: 'Zeleni', yellow: 'Žuti', blue: 'Plavi' };
  const START_OFFSET = { red: 0, green: 14, yellow: 28, blue: 42 };
  const SHARED_LENGTH = 56;
  const STEPS_TO_ENTER_HOME = 51;

  // 56-cell clockwise outer track on the 17x17 board.
  const PATH = (() => {
    const cells = [];
    for (let col = 8; col <= 15; col++) cells.push([1, col]);
    for (let row = 2; row <= 15; row++) cells.push([row, 15]);
    for (let col = 14; col >= 1; col--) cells.push([15, col]);
    for (let row = 14; row >= 2; row--) cells.push([row, 1]);
    for (let col = 1; col <= 7; col++) cells.push([1, col]);
    return cells;
  })();

  const HOME_COLUMNS = {
    red: [[4,8],[5,8],[6,8],[7,8]],
    green: [[8,14],[8,13],[8,12],[8,11]],
    yellow: [[14,8],[13,8],[12,8],[11,8]],
    blue: [[8,4],[8,5],[8,6],[8,7]],
  };

  const YARD_SLOTS = {
    red: [[3,3],[3,5],[5,3],[5,5]],
    green: [[3,11],[3,13],[5,11],[5,13]],
    yellow: [[11,11],[11,13],[13,11],[13,13]],
    blue: [[11,3],[11,5],[13,3],[13,5]],
  };

  function globalCellForStep(color, step) {
    return (START_OFFSET[color] + step) % SHARED_LENGTH;
  }
  function isStartCell(cellIdx, color) {
    return cellIdx === START_OFFSET[color];
  }

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  const socket = io();
  let myPlayerId = null;
  let myColor = null;
  let myRoomCode = null;
  let myIsHost = false;
  let latestState = null;
  let boardBuilt = false;

  const prefs = loadPrefs();
  applyTheme(prefs.theme);
  applyReducedMotion(prefs.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const screens = {
    home: $('#screen-home'),
    lobby: $('#screen-lobby'),
    game: $('#screen-game'),
  };

  const nameInput = $('#player-name');
  const joinCodeInput = $('#join-code');
  const homeError = $('#home-error');
  const lobbyError = $('#lobby-error');
  const boardEl = $('#board');
  const toastEl = $('#toast');

  nameInput.value = prefs.name || '';
  nameInput.addEventListener('input', () => {
    prefs.name = nameInput.value.slice(0, 18);
    savePrefs(prefs);
  });

  joinCodeInput.addEventListener('input', () => {
    joinCodeInput.value = joinCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  });

  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.add('hidden'));
    screens[name].classList.remove('hidden');
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  function playerNameOrDefault() {
    const v = (nameInput.value || '').trim();
    return v || 'Igrač';
  }

  // ---------------------------------------------------------------------
  // Home screen actions
  // ---------------------------------------------------------------------
  $('#btn-create-room').addEventListener('click', () => {
    homeError.textContent = '';
    socket.emit('create_room', { name: playerNameOrDefault() }, (res) => {
      if (!res || !res.ok) {
        homeError.textContent = (res && res.error) || 'Greška pri kreiranju sobe.';
        return;
      }
      myPlayerId = res.playerId;
      myColor = res.color;
      myRoomCode = res.code;
      myIsHost = true;
      showScreen('lobby');
    });
  });

  $('#btn-solo-mode').addEventListener('click', () => {
    homeError.textContent = '';
    socket.emit('create_solo', { name: playerNameOrDefault() }, (res) => {
      if (!res || !res.ok) {
        homeError.textContent = (res && res.error) || 'Nije moguće pokrenuti solo test.';
        return;
      }
      myPlayerId = res.playerId;
      myColor = res.color;
      myRoomCode = res.code;
      myIsHost = true;
      showScreen('game');
    });
  });

  $('#btn-join-room').addEventListener('click', () => {
    homeError.textContent = '';
    const code = joinCodeInput.value.trim();
    if (code.length !== 4) {
      homeError.textContent = 'Unesi šifru sobe od 4 karaktera.';
      return;
    }
    socket.emit('join_room', { name: playerNameOrDefault(), code }, (res) => {
      if (!res || !res.ok) {
        homeError.textContent = (res && res.error) || 'Nije moguće pridružiti se sobi.';
        return;
      }
      myPlayerId = res.playerId;
      myColor = res.color;
      myRoomCode = res.code;
      myIsHost = false;
      showScreen('lobby');
    });
  });

  // ---------------------------------------------------------------------
  // Lobby actions
  // ---------------------------------------------------------------------
  $('#btn-copy-code').addEventListener('click', async () => {
    const code = myRoomCode || '';
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(code);
        showToast('Kod je kopiran!');
      } else {
        const tmp = document.createElement('input');
        tmp.value = code;
        document.body.appendChild(tmp);
        tmp.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(tmp);
        showToast(ok ? 'Kod je kopiran!' : 'Kopiranje nije uspelo.');
      }
    } catch (e) {
      showToast('Kopiranje nije uspelo.');
    }
  });

  $('#btn-add-bot').addEventListener('click', () => {
    lobbyError.textContent = '';
    socket.emit('add_bot', {}, (res) => {
      if (!res || !res.ok) {
        lobbyError.textContent = (res && res.error) || 'Nije moguće dodati bota.';
      }
    });
  });

  $('#btn-start-game').addEventListener('click', () => {
    lobbyError.textContent = '';
    socket.emit('start_game', {}, (res) => {
      if (!res || !res.ok) lobbyError.textContent = (res && res.error) || 'Greška.';
    });
  });

  $('#btn-leave-lobby').addEventListener('click', () => {
    window.location.reload();
  });

  // ---------------------------------------------------------------------
  // Game actions
  // ---------------------------------------------------------------------
  const diceButton = $('#btn-roll-dice');
  const diceFace = $('#dice-face');
  const diceStatus = $('#dice-status');
  const DICE_GLYPHS = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

  diceButton.addEventListener('click', () => {
    diceButton.disabled = true;
    diceStatus.textContent = 'Bacanje...';
    diceFace.classList.add('rolling');
    playSound('dice');
    socket.emit('roll_dice', {}, (res) => {
      diceFace.classList.remove('rolling');
      if (!res || !res.ok) {
        diceButton.disabled = false;
        if (res && res.error) diceStatus.textContent = res.error;
      }
    });
  });

  function handleTokenClick(color, tokenIdx) {
    if (color !== myColor) return;
    socket.emit('move_token', { tokenIdx }, (res) => {
      if (!res || !res.ok) {
        if (res && res.error) showToast(res.error);
      }
    });
  }

  // ---------------------------------------------------------------------
  // Chat / reactions
  // ---------------------------------------------------------------------
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const tab = btn.dataset.tab;
      $('#tab-log').classList.toggle('hidden', tab !== 'log');
      $('#tab-chat').classList.toggle('hidden', tab !== 'chat');
    });
  });

  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('send_chat_message', { text });
    input.value = '';
  });

  document.querySelectorAll('.reaction-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      socket.emit('send_reaction', { emoji: btn.dataset.emoji });
    });
  });

  socket.on('chat_message', (msg) => {
    const wrap = $('#chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-msg';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'chat-msg-name';
    nameSpan.style.color = cssColor(msg.color);
    nameSpan.textContent = msg.name + ':';
    div.appendChild(nameSpan);
    div.appendChild(document.createTextNode(msg.text));
    wrap.appendChild(div);
    wrap.scrollTop = wrap.scrollHeight;
  });

  socket.on('reaction', (msg) => {
    const el = document.createElement('div');
    el.className = 'floating-reaction';
    el.textContent = msg.emoji;
    el.style.left = (40 + Math.random() * 20) + '%';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1900);
  });

  // ---------------------------------------------------------------------
  // Winner overlay / new game / settings
  // ---------------------------------------------------------------------
  $('#btn-new-game').addEventListener('click', () => {
    socket.emit('new_game', {}, (res) => {
      if (res && res.ok) {
        $('#winner-overlay').classList.add('hidden');
        showScreen(latestState && latestState.solo ? 'game' : 'lobby');
      }
    });
  });
  $('#btn-winner-close').addEventListener('click', () => {
    $('#winner-overlay').classList.add('hidden');
  });

  function openSettings() { $('#settings-overlay').classList.remove('hidden'); }
  function closeSettings() { $('#settings-overlay').classList.add('hidden'); }
  $('#btn-open-settings-home').addEventListener('click', openSettings);
  $('#btn-open-settings-lobby').addEventListener('click', openSettings);
  $('#btn-open-settings-game').addEventListener('click', openSettings);
  $('#btn-close-settings').addEventListener('click', closeSettings);
  $('#settings-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'settings-overlay') closeSettings();
  });

  document.querySelectorAll('.theme-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      prefs.theme = btn.dataset.theme;
      savePrefs(prefs);
      applyTheme(prefs.theme);
      markSelectedTheme();
    });
  });
  function markSelectedTheme() {
    document.querySelectorAll('.theme-swatch').forEach((b) => {
      b.classList.toggle('selected', b.dataset.theme === prefs.theme);
    });
  }
  markSelectedTheme();

  $('#toggle-sound').checked = prefs.sound !== false;
  $('#toggle-animations').checked = prefs.animations !== false;
  $('#toggle-reduced-motion').checked = !!prefs.reducedMotion;

  $('#toggle-sound').addEventListener('change', (e) => {
    prefs.sound = e.target.checked;
    savePrefs(prefs);
  });
  $('#toggle-animations').addEventListener('change', (e) => {
    prefs.animations = e.target.checked;
    savePrefs(prefs);
    applyReducedMotion(!prefs.animations || prefs.reducedMotion);
  });
  $('#toggle-reduced-motion').addEventListener('change', (e) => {
    prefs.reducedMotion = e.target.checked;
    savePrefs(prefs);
    applyReducedMotion(!prefs.animations || prefs.reducedMotion);
  });

  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme || 'dark');
  }
  function applyReducedMotion(on) {
    document.body.classList.toggle('reduced-motion', !!on);
  }

  function loadPrefs() {
    try {
      const raw = localStorage.getItem('ludo_prefs_v1');
      return raw ? JSON.parse(raw) : { theme: 'dark', sound: true, animations: true };
    } catch (e) {
      return { theme: 'dark', sound: true, animations: true };
    }
  }
  function savePrefs(p) {
    try { localStorage.setItem('ludo_prefs_v1', JSON.stringify(p)); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------
  // Minimal Web Audio sound effects (no external assets)
  // ---------------------------------------------------------------------
  let audioCtx = null;
  function playSound(kind) {
    if (prefs.sound === false) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      const freqs = { dice: 340, move: 520, capture: 200, win: 660 };
      o.frequency.value = freqs[kind] || 400;
      o.type = kind === 'capture' ? 'sawtooth' : 'sine';
      g.gain.setValueAtTime(0.08, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
      o.start();
      o.stop(audioCtx.currentTime + 0.25);
    } catch (e) { /* audio unavailable */ }
  }

  function cssColor(color) {
    const map = { red: '#FF4D5A', green: '#20D878', yellow: '#FFC928', blue: '#398BFF' };
    return map[color] || '#ffffff';
  }

  // ---------------------------------------------------------------------
  // Board building (structure) + rendering (tokens)
  // ---------------------------------------------------------------------
  function buildBoardStructure() {
    boardEl.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'board-grid';

    const cellMap = {}; // "r,c" -> element
    for (let r = 0; r < 17; r++) {
      for (let c = 0; c < 17; c++) {
        const div = document.createElement('div');
        div.className = 'cell';
        div.dataset.r = r; div.dataset.c = c;
        grid.appendChild(div);
        cellMap[r + ',' + c] = div;
      }
    }

    // Path cells
    PATH.forEach(([r, c], idx) => {
      const el = cellMap[r + ',' + c];
      el.classList.add('path-cell');
      if ((r === 1 && (c === 1 || c === 15)) || (r === 15 && (c === 1 || c === 15))) {
        el.classList.add('corner-cell');
      }
      COLORS.forEach((color) => {
        if (isStartCell(idx, color)) el.classList.add('start-' + color);
      });
    });

    // Home columns
    COLORS.forEach((color) => {
      HOME_COLUMNS[color].forEach(([r, c]) => {
        cellMap[r + ',' + c].classList.add('home-col-' + color);
      });
    });

    // Center
    cellMap['7,7'].classList.add('center-cell');

    boardEl.appendChild(grid);

    // Yard decoration boxes (behind the grid, purely visual)
    const yardBoxes = [
      { color: 'red', r0: 2, c0: 2 },
      { color: 'green', r0: 2, c0: 10 },
      { color: 'yellow', r0: 10, c0: 10 },
      { color: 'blue', r0: 10, c0: 2 },
    ];
    yardBoxes.forEach(({ color, r0, c0 }) => {
      const box = document.createElement('div');
      box.className = 'yard-box yard-box--' + color;
      // Yard position/size is controlled by CSS so it stays aligned with the 17x17 grid.
      boardEl.insertBefore(box, grid);
      YARD_SLOTS[color].forEach(([r, c]) => {
        const dot = document.createElement('div');
        dot.className = 'yard-slot-dot';
        dot.style.left = 'calc((' + (c - c0) + ' + 0.32) * (100% / 5))';
        dot.style.top = 'calc((' + (r - r0) + ' + 0.32) * (100% / 5))';
        box.appendChild(dot);
      });
    });

    // Token layer
    const tokenLayer = document.createElement('div');
    tokenLayer.id = 'token-layer';
    tokenLayer.className = 'token-layer';
    boardEl.appendChild(tokenLayer);

    boardBuilt = true;
  }

  function cellToPercentPos([r, c]) {
    return { left: ((c + 0.5) / 17) * 100, top: ((r + 0.5) / 17) * 100 };
  }

  function tokenGridPos(color, tokenIdx, tokenState) {
    if (tokenState.state === 'yard') {
      return YARD_SLOTS[color][tokenIdx];
    }
    if (tokenState.state === 'home') {
      return [7, 7];
    }
    // active
    if (tokenState.step <= STEPS_TO_ENTER_HOME - 1) {
      return PATH[globalCellForStep(color, tokenState.step)];
    }
    return HOME_COLUMNS[color][tokenState.step - STEPS_TO_ENTER_HOME];
  }

  function renderTokens(state) {
    const layer = $('#token-layer');
    if (!layer) return;
    layer.innerHTML = '';

    // Group tokens by grid cell to offset overlapping pieces slightly.
    const byCell = {};
    COLORS.forEach((color) => {
      (state.tokens[color] || []).forEach((t, idx) => {
        if (t.state === 'home') return; // finished tokens are tucked away, shown via player card
        const pos = tokenGridPos(color, idx, t);
        const key = pos[0] + ',' + pos[1];
        byCell[key] = byCell[key] || [];
        byCell[key].push({ color, idx, t });
      });
    });

    const isMyTurn = state.started && !state.winner && state.players[state.currentPlayerIndex] && state.players[state.currentPlayerIndex].id === myPlayerId;
    const myMoves = isMyTurn && state.dice !== null ? computeLocalMovableHint(state) : [];

    const pixelSpread = group => group.length > 1
      ? Math.max(2, boardEl.clientWidth * 0.008)
      : 0;

    Object.entries(byCell).forEach(([key, group]) => {
      const [r, c] = key.split(',').map(Number);
      const spread = pixelSpread(group);

      group.forEach((item, i) => {
        const el = document.createElement('div');
        el.className = 'token token--' + item.color;
        if (group.length > 1) el.classList.add('stack-' + Math.min(group.length, 4));

        // Put each token in the exact same CSS grid cell as the board field.
        // This keeps pieces centered even when the board scales responsively.
        el.style.gridRow = String(r + 1);
        el.style.gridColumn = String(c + 1);
        el.style.width = '72%';
        el.style.height = '72%';

        // Small fan-out only when several pieces share one field.
        const angle = (i / group.length) * Math.PI * 2;
        const dx = Math.cos(angle) * spread;
        const dy = Math.sin(angle) * spread;
        el.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';

        const movable = item.color === myColor && myMoves.includes(item.idx);
        if (movable) {
          el.classList.add('movable');
          el.setAttribute('role', 'button');
          el.setAttribute('aria-label', 'Pomeri figuru');
          el.tabIndex = 0;
          el.addEventListener('click', () => handleTokenClick(item.color, item.idx));
          el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') handleTokenClick(item.color, item.idx);
          });
        }
        layer.appendChild(el);
      });
    });
  }

  // Mirrors server legalMoves() just to know which tokens to highlight;
  // the server re-validates every move, so this is purely a UI hint.
  function computeLocalMovableHint(state) {
    const tokens = state.tokens[myColor] || [];
    const dice = state.dice;
    const moves = [];
    if (!dice) return moves;

    const ownOccupies = (cell, excludeIdx) => tokens.some((t, idx) => {
      if (idx === excludeIdx || t.state !== 'active' || t.step > STEPS_TO_ENTER_HOME - 1) return false;
      return globalCellForStep(myColor, t.step) === cell;
    });

    tokens.forEach((t, idx) => {
      if (t.state === 'home') return;

      if (t.state === 'yard') {
        if (dice === 6 && !ownOccupies(globalCellForStep(myColor, 0), idx)) moves.push(idx);
        return;
      }

      if (t.state === 'active') {
        const newStep = t.step + dice;
        if (newStep > 57) return;

        if (newStep <= STEPS_TO_ENTER_HOME - 1) {
          if (!ownOccupies(globalCellForStep(myColor, newStep), idx)) moves.push(idx);
        } else {
          const occupiedHome = tokens.some((other, otherIdx) =>
            otherIdx !== idx && other.state === 'active' && other.step === newStep
          );
          if (!occupiedHome) moves.push(idx);
        }
      }
    });
    return moves;
  }

  // ---------------------------------------------------------------------
  // Lobby rendering
  // ---------------------------------------------------------------------
  function renderLobby(state) {
    $('#room-code-display').textContent = state.code;
    const slots = document.querySelectorAll('#screen-lobby .slot');
    for (let i = 0; i < 4; i++) {
      const player = state.players[i];
      const inner = slots[i].querySelector('.slot-inner');
      if (!player) {
        inner.className = 'slot-inner slot-empty';
        inner.style.removeProperty('--slot-color');
        inner.innerHTML = '⚪ Čeka igrača...';
        continue;
      }
      inner.className = 'slot-inner slot-filled';
      inner.style.setProperty('--slot-color', cssColor(player.color));
      const initials = (player.name || '?').trim().slice(0, 2).toUpperCase();
      inner.innerHTML =
        '<span class="slot-avatar" style="background:' + cssColor(player.color) + '">' + escapeHtml(initials) + '</span>' +
        '<span><span class="slot-name">' + escapeHtml(player.name) + (player.isHost ? ' 👑' : '') + '</span>' +
        '<span class="slot-tag">' + (player.connected ? 'Povezan' : 'Nije povezan') + '</span></span>';
    }

    const connectedCount = state.players.filter((p) => p.connected).length;
    const startBtn = $('#btn-start-game');
    const addBotBtn = $('#btn-add-bot');
    const me = state.players.find((p) => p.id === myPlayerId);
    const iAmHost = myIsHost || !!(me && me.isHost);
    const slotCount = state.players.filter((p) => p.connected).length;
    startBtn.disabled = !(iAmHost && connectedCount >= 2);
    addBotBtn.classList.toggle('hidden', !!state.solo);
    addBotBtn.disabled = !iAmHost || slotCount >= 4;
    addBotBtn.title = !iAmHost
      ? 'Samo domaćin može da doda bota.'
      : (slotCount >= 4 ? 'Soba je puna.' : 'Dodaj bota u sobu.');
    $('#lobby-hint').textContent = iAmHost
      ? (slotCount >= 4 ? 'Soba je puna (4 igrača).' : 'Dodaj igrače ili botove, pa pokreni igru.')
      : 'Čeka se da domaćin pokrene igru.';

    if (state.started) {
      showScreen('game');
    }
  }

  // ---------------------------------------------------------------------
  // Game screen rendering
  // ---------------------------------------------------------------------
  function renderGame(state) {
    if (!boardBuilt) buildBoardStructure();
    $('#game-room-code').textContent = 'Soba: ' + state.code;

    // Turn indicator
    const cp = state.players[state.currentPlayerIndex];
    const indicator = $('#turn-indicator');
    const text = $('#turn-indicator-text');
    if (state.winner) {
      indicator.classList.remove('my-turn');
      text.textContent = '🏆 Igra je završena';
    } else if (cp) {
      const mine = cp.id === myPlayerId;
      indicator.classList.toggle('my-turn', mine);
      text.textContent = mine
        ? '🟢 Tvoj red je!'
        : (colorDot(cp.color) + ' Red je na: ' + cp.name);
    }

    // Dice
    const myTurn = !state.winner && cp && cp.id === myPlayerId;
    diceFace.textContent = state.dice ? DICE_GLYPHS[state.dice] : '⚀';
    if (state.dice) {
      diceStatus.textContent = 'Rezultat: ' + state.dice;
    } else if (myTurn) {
      diceStatus.textContent = 'Baci kocku';
    } else {
      diceStatus.textContent = cp ? ('Čeka se ' + cp.name + '...') : 'Čeka igrače...';
    }
    diceButton.disabled = !myTurn || state.dice !== null || !!state.winner;

    // Player cards
    const cardsWrap = $('#player-cards');
    cardsWrap.innerHTML = '';
    state.players.forEach((p, idx) => {
      const card = document.createElement('div');
      card.className = 'player-card' + (p.isBot ? ' bot-card' : '');
      card.style.setProperty('--player-color', cssColor(p.color));
      if (idx === state.currentPlayerIndex && !state.winner) card.classList.add('active-turn');
      if (!p.connected) card.classList.add('disconnected');

      const tokensDone = (state.tokens[p.color] || []).filter((t) => t.state === 'home').length;
      const dotsHtml = [0, 1, 2, 3].map((i) => {
        const t = (state.tokens[p.color] || [])[i];
        const done = t && t.state === 'home';
        return '<span class="player-token-dot' + (done ? ' home' : '') + '"></span>';
      }).join('');

      card.innerHTML =
        '<span class="player-avatar">' + escapeHtml((p.name || '?').slice(0, 2).toUpperCase()) + '</span>' +
        '<span class="player-card-body">' +
        '<span class="player-card-name">' + escapeHtml(p.name) + (p.isBot ? ' 🤖' : '') + '</span>' +
        '<span class="player-card-tokens">' + dotsHtml + '</span>' +
        (idx === state.currentPlayerIndex && !state.winner ? '<span class="player-card-turn-tag">' + (p.id === myPlayerId ? 'Tvoj red' : 'Na potezu') + '</span>' : '') +
        '</span>';
      cardsWrap.appendChild(card);
    });

    // Log
    const logWrap = $('#game-log');
    const wasScrolledDown = logWrap.scrollTop + logWrap.clientHeight >= logWrap.scrollHeight - 10;
    logWrap.innerHTML = state.log.map((entry) =>
      '<div class="log-entry">' + escapeHtml(entry.message) + '</div>'
    ).join('');
    if (wasScrolledDown) logWrap.scrollTop = logWrap.scrollHeight;

    renderTokens(state);

    // Winner overlay
    if (state.winner) {
      showWinner(state.winner);
    }
  }

  function colorDot(color) {
    const dots = { red: '🔴', green: '🟢', yellow: '🟡', blue: '🔵' };
    return dots[color] || '⚪';
  }

  let winnerShownFor = null;
  function showWinner(winner) {
    const key = winner.color + winner.name;
    const overlay = $('#winner-overlay');
    if (winnerShownFor === key && !overlay.classList.contains('hidden')) return;
    winnerShownFor = key;
    $('#winner-text').textContent = escapeHtml(winner.name) + ' je pobedio/la!';
    overlay.classList.remove('hidden');
    playSound('win');
    launchConfetti();
  }

  function launchConfetti() {
    if (prefs.animations === false) return;
    const layer = $('#confetti-layer');
    layer.innerHTML = '';
    const colors = ['#FF4D5A', '#20D878', '#FFC928', '#398BFF', '#FFC857'];
    for (let i = 0; i < 40; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + '%';
      piece.style.background = colors[i % colors.length];
      piece.style.animationDuration = (2 + Math.random() * 1.5) + 's';
      piece.style.animationDelay = (Math.random() * 0.6) + 's';
      layer.appendChild(piece);
    }
    setTimeout(() => { layer.innerHTML = ''; }, 4000);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str == null ? '' : str);
    return div.innerHTML;
  }

  // ---------------------------------------------------------------------
  // Socket state wiring
  // ---------------------------------------------------------------------
  let lastDiceValue = null;
  socket.on('room_state', (state) => {
    latestState = state;
    myRoomCode = state.code;

    if (state.dice && state.dice !== lastDiceValue) playSound('move');
    lastDiceValue = state.dice;

    if (screens.game.classList.contains('hidden') === false || state.started) {
      renderGame(state);
    }
    if (!state.started) {
      renderLobby(state);
      if (screens.lobby.classList.contains('hidden') && screens.home.classList.contains('hidden')) {
        showScreen('lobby');
      }
    } else if (screens.game.classList.contains('hidden')) {
      showScreen('game');
      renderGame(state);
    }
  });

  socket.on('connect_error', () => {
    showToast('Problem sa vezom. Pokušaj ponovo.');
  });
})();
