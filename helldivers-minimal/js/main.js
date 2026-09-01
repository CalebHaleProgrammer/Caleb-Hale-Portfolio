// UI wiring — HellBrowsers
// Buttons are attached as early as possible so a later error doesn't kill the menu.
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function setStatus(msg) {
    const el = $('#status-msg');
    if (el) el.textContent = msg || '';
  }

  function showScreen(id) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    const el = $(id);
    if (el) el.classList.add('active');
  }

  function openSub(id) {
    $$('.subpanel').forEach(p => p.classList.remove('open'));
    const el = $(id);
    if (el) el.classList.add('open');
  }

  function closeSubs() {
    $$('.subpanel').forEach(p => p.classList.remove('open'));
  }

  function getName() {
    return (($('#username') && $('#username').value.trim()) || 'Diver').slice(0, 16);
  }

  // ========== ALWAYS-AVAILABLE MENU BUTTONS (no Game dependency) ==========
  // These must work even if game.js / network.js fail to load.

  const btnOptions = $('#btn-options');
  if (btnOptions) {
    btnOptions.addEventListener('click', function () {
      showScreen('#options');
    });
  }

  const btnOptionsBack = $('#btn-options-back');
  if (btnOptionsBack) {
    btnOptionsBack.addEventListener('click', function () {
      showScreen('#menu');
    });
  }

  const btnStats = $('#btn-stats');
  if (btnStats) {
    btnStats.addEventListener('click', function () {
      let s = { missions: 0, kills: 0, extracts: 0, deaths: 0, playTime: 0 };
      try {
        if (typeof Storage !== 'undefined') {
          s = Object.assign(s, Storage.load().stats || {});
        }
      } catch (e) {}
      const box = $('#stats-content');
      if (box) {
        box.innerHTML =
          '<p>Missions: ' + (s.missions || 0) + '</p>' +
          '<p>Kills: ' + (s.kills || 0) + '</p>' +
          '<p>Extracts: ' + (s.extracts || 0) + '</p>' +
          '<p>Deaths: ' + (s.deaths || 0) + '</p>' +
          '<p>Play time: ' + Math.floor((s.playTime || 0) / 60) + 'm ' + ((s.playTime || 0) % 60) + 's</p>';
      }
      showScreen('#stats');
    });
  }

  const btnStatsBack = $('#btn-stats-back');
  if (btnStatsBack) {
    btnStatsBack.addEventListener('click', function () {
      showScreen('#menu');
    });
  }

  const btnJoin = $('#btn-join');
  if (btnJoin) {
    btnJoin.addEventListener('click', function () {
      openSub('#join-panel');
      setStatus('Paste the host\'s full Peer ID');
    });
  }

  const btnCancelLoad = $('#btn-cancel-load');
  if (btnCancelLoad) {
    btnCancelLoad.addEventListener('click', function () {
      try { if (typeof Network !== 'undefined') Network.destroy(); } catch (e) {}
      showScreen('#menu');
      setStatus('');
    });
  }

  // Volume / checkboxes (safe)
  const vol = $('#volume');
  if (vol) {
    vol.addEventListener('input', function (e) {
      const v = parseFloat(e.target.value);
      const label = $('#vol-val');
      if (label) label.textContent = v.toFixed(2);
      try { if (typeof AudioSys !== 'undefined') AudioSys.setVolume(v); } catch (e) {}
      try { if (typeof Storage !== 'undefined') Storage.update({ volume: v }); } catch (e) {}
    });
  }

  // ========== GAME-DEPENDENT BUTTONS ==========
  // Wrapped so a missing Game / Network does not prevent the menu from working.

  function safeAudioUi() {
    try { if (typeof AudioSys !== 'undefined') AudioSys.ui(); } catch (e) {}
  }

  // Solo Deploy
  const btnSolo = $('#btn-solo');
  if (btnSolo) {
    btnSolo.addEventListener('click', function () {
      const name = getName();
      try { if (typeof Storage !== 'undefined') Storage.update({ username: name }); } catch (e) {}
      safeAudioUi();
      setStatus('');
      closeSubs();

      if (typeof Game === 'undefined') {
        setStatus('Game module failed to load — check console');
        console.error('HellBrowsers: Game is undefined. Did js/game.js load?');
        return;
      }

      showScreen('#game');
      requestAnimationFrame(function () {
        try {
          Game.startSolo(name);
          if (!Game._looping) {
            Game._looping = true;
            requestAnimationFrame(function (t) { Game.loop(t); });
          }
          startHUD();
        } catch (err) {
          console.error('Solo start error', err);
          setStatus('Error starting game: ' + err.message);
          showScreen('#menu');
        }
      });
    });
  }

  // Host
  const btnHost = $('#btn-host');
  if (btnHost) {
    btnHost.addEventListener('click', async function () {
      const name = getName();
      try { if (typeof Storage !== 'undefined') Storage.update({ username: name }); } catch (e) {}
      safeAudioUi();

      if (typeof Network === 'undefined' || typeof Peer === 'undefined') {
        alert('Multiplayer library not available.\nSolo Deploy still works.');
        setStatus('Multiplayer unavailable — try Solo');
        return;
      }

      showScreen('#loading');
      if ($('#loading-msg')) $('#loading-msg').textContent = 'Starting peer connection...';
      try {
        await Network.init();
        await Network.host(name);
        if ($('#host-code')) $('#host-code').textContent = Network.localId || '???';
        openSub('#host-panel');
        showScreen('#menu');
        setStatus('Hosting — share the Peer ID');
        refreshPlayerList();
        Network.onPlayerJoin = refreshPlayerList;
        Network.onPlayerLeave = refreshPlayerList;
        Network.onStart = function () {
          showScreen('#game');
          requestAnimationFrame(function () {
            Game.startMulti(Network.localId, true, Network.players, name);
            if (!Game._looping) {
              Game._looping = true;
              requestAnimationFrame(function (t) { Game.loop(t); });
            }
            startHUD();
          });
        };
        if ($('#btn-start')) $('#btn-start').disabled = false;
      } catch (e) {
        console.error(e);
        alert('Could not host: ' + (e.message || e) + '\n\nSolo Deploy still works.');
        showScreen('#menu');
        setStatus('Multiplayer unavailable — try Solo');
      }
    });
  }

  // Join confirm
  const btnJoinConfirm = $('#btn-join-confirm');
  if (btnJoinConfirm) {
    btnJoinConfirm.addEventListener('click', async function () {
      const name = getName();
      const code = (($('#room-code') && $('#room-code').value) || '').trim();
      if (!code) {
        setStatus('Enter a Peer ID first');
        return;
      }
      try { if (typeof Storage !== 'undefined') Storage.update({ username: name }); } catch (e) {}
      safeAudioUi();

      if (typeof Network === 'undefined' || typeof Peer === 'undefined') {
        alert('Multiplayer library not available.');
        return;
      }

      showScreen('#loading');
      if ($('#loading-msg')) $('#loading-msg').textContent = 'Connecting to host...';
      try {
        await Network.init();
        await Network.join(code, name);
        Network.onStart = function () {
          showScreen('#game');
          requestAnimationFrame(function () {
            const roster = new Map([[Network.localId, { name: name }]]);
            Game.startMulti(Network.localId, false, roster, name);
            if (!Game._looping) {
              Game._looping = true;
              requestAnimationFrame(function (t) { Game.loop(t); });
            }
            startHUD();
          });
        };
        Network.onState = function (state) { Game.applyState(state); };
        if ($('#loading-msg')) $('#loading-msg').textContent = 'Connected! Waiting for host to start...';
        setStatus('Joined — waiting for host');
      } catch (e) {
        console.error(e);
        alert('Join failed: ' + (e.message || e));
        showScreen('#menu');
        setStatus('Join failed');
      }
    });
  }

  const btnStart = $('#btn-start');
  if (btnStart) {
    btnStart.addEventListener('click', function () {
      safeAudioUi();
      if (typeof Network !== 'undefined') Network.startGame({});
    });
  }

  // Pause / leave
  const btnResume = $('#btn-resume');
  if (btnResume) {
    btnResume.addEventListener('click', function () {
      if (typeof Game !== 'undefined') Game.state = 'playing';
      const pm = $('#pause-menu');
      if (pm) pm.classList.remove('show');
    });
  }

  function leaveMission() {
    try { if (typeof Network !== 'undefined') Network.destroy(); } catch (e) {}
    if (typeof Game !== 'undefined') {
      Game.reset();
      Game._looping = false;
    }
    showScreen('#menu');
    const pm = $('#pause-menu');
    if (pm) pm.classList.remove('show');
    const me = $('#mission-end');
    if (me) me.classList.remove('show');
    setStatus('');
  }

  if ($('#btn-leave')) $('#btn-leave').addEventListener('click', leaveMission);
  if ($('#btn-return')) $('#btn-return').addEventListener('click', leaveMission);

  function refreshPlayerList() {
    const ul = $('#player-list');
    if (!ul || typeof Network === 'undefined') return;
    ul.innerHTML = '';
    for (const [id, info] of Network.players) {
      const li = document.createElement('li');
      li.textContent = (info.isHost ? '★ ' : '') + (info.name || id.slice(0, 8));
      ul.appendChild(li);
    }
  }

  // ========== INIT GAME MODULES (after buttons are live) ==========
  try {
    let data = { username: '', volume: 0.7, showFps: false, reduceMotion: false };
    try { if (typeof Storage !== 'undefined') data = Storage.load(); } catch (e) {}

    if ($('#username') && data.username) $('#username').value = data.username;
    if ($('#volume')) {
      $('#volume').value = data.volume ?? 0.7;
      if ($('#vol-val')) $('#vol-val').textContent = (data.volume ?? 0.7).toFixed(2);
    }
    if ($('#show-fps')) $('#show-fps').checked = !!data.showFps;
    if ($('#reduce-motion')) $('#reduce-motion').checked = !!data.reduceMotion;

    try {
      if (typeof AudioSys !== 'undefined') {
        AudioSys.init();
        AudioSys.setVolume(data.volume ?? 0.7);
      }
    } catch (e) { console.warn('Audio init', e); }

    const canvas = $('#canvas');
    if (canvas && typeof Game !== 'undefined') {
      Game.init(canvas);
      Game.showFps = !!data.showFps;
      Game.reduceMotion = !!data.reduceMotion;
      Game.onMissionEnd = function (stats) {
        const end = $('#mission-end');
        if (end) {
          end.classList.add('show');
          if ($('#end-title')) $('#end-title').textContent = stats.success ? 'MISSION COMPLETE' : 'MISSION FAILED';
          if ($('#end-stats')) $('#end-stats').textContent = 'Kills: ' + stats.kills + '  ·  Wave: ' + stats.wave + '  ·  Time: ' + stats.time + 's';
        }
      };
    } else {
      console.error('HellBrowsers: Game module or canvas missing');
      setStatus('Game engine failed to load (see console)');
    }

    if ($('#show-fps')) {
      $('#show-fps').addEventListener('change', function (e) {
        if (typeof Game !== 'undefined') Game.showFps = e.target.checked;
        try { if (typeof Storage !== 'undefined') Storage.update({ showFps: e.target.checked }); } catch (e) {}
      });
    }
    if ($('#reduce-motion')) {
      $('#reduce-motion').addEventListener('change', function (e) {
        if (typeof Game !== 'undefined') Game.reduceMotion = e.target.checked;
        try { if (typeof Storage !== 'undefined') Storage.update({ reduceMotion: e.target.checked }); } catch (e) {}
      });
    }

    if (typeof Network !== 'undefined') {
      Network.onInput = function (from, input) {
        if (typeof Game !== 'undefined') Game.applyInput(from, input);
      };
    }
  } catch (err) {
    console.error('HellBrowsers init error', err);
    setStatus('Init error — menu still works');
  }

  // HUD loop
  let hudRunning = false;
  function startHUD() {
    if (hudRunning) return;
    hudRunning = true;
    function tick() {
      if (typeof Game === 'undefined' || Game.state === 'menu') {
        hudRunning = false;
        return;
      }
      const lp = Game.players.get(Game.localPlayerId);
      if (lp) {
        if ($('#ammo')) $('#ammo').textContent = 'AMMO ' + lp.ammo + '/' + lp.maxAmmo;
        const fill = $('#health-fill');
        if (fill) {
          fill.style.width = Math.max(0, (lp.hp / lp.maxHp) * 100) + '%';
          fill.style.background = lp.hp < 30 ? '#f33' : '#33cc66';
        }
      }
      if ($('#wave-info')) $('#wave-info').textContent = 'WAVE ' + Game.wave + '  ·  KILLS ' + Game.kills;

      const et = $('#extract-timer');
      if (et) {
        if (Game.state === 'extract') {
          et.classList.add('show');
          const span = et.querySelector('span');
          if (span) span.textContent = Math.ceil(Game.extractTimer);
        } else {
          et.classList.remove('show');
        }
      }

      const pause = $('#pause-menu');
      if (pause) {
        if (Game.state === 'paused') pause.classList.add('show');
        else pause.classList.remove('show');
      }

      const fpsEl = $('#fps');
      if (fpsEl) {
        if (Game.showFps) {
          fpsEl.classList.add('show');
          fpsEl.textContent = Game.fps + ' FPS';
        } else {
          fpsEl.classList.remove('show');
        }
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // Initial
  showScreen('#menu');
  setStatus('Ready — Solo Deploy works immediately');
  console.log('HellBrowsers menu ready. Game=', typeof Game, 'Network=', typeof Network, 'Peer=', typeof Peer);
})();
