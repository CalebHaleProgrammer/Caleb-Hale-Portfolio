// UI wiring and bootstrap — HellBrowsers
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function setStatus(msg) {
    const el = $('#status-msg');
    if (el) el.textContent = msg || '';
  }

  // Safe load
  let data;
  try {
    data = Storage.load();
  } catch (e) {
    data = { username: '', volume: 0.7, showFps: false, reduceMotion: false, stats: {} };
  }

  // Prefill UI
  try {
    $('#username').value = data.username || '';
    $('#volume').value = data.volume ?? 0.7;
    $('#vol-val').textContent = (data.volume ?? 0.7).toFixed(2);
    $('#show-fps').checked = !!data.showFps;
    $('#reduce-motion').checked = !!data.reduceMotion;
  } catch (e) {}

  try {
    AudioSys.init();
    AudioSys.setVolume(data.volume ?? 0.7);
  } catch (e) {}

  const canvas = $('#canvas');
  if (!canvas) {
    console.error('Canvas missing');
    return;
  }

  Game.init(canvas);
  Game.showFps = !!data.showFps;
  Game.reduceMotion = !!data.reduceMotion;

  Game.onMissionEnd = (stats) => {
    const end = $('#mission-end');
    if (end) {
      end.classList.remove('hidden');
      $('#end-title').textContent = stats.success ? 'MISSION COMPLETE' : 'MISSION FAILED';
      $('#end-stats').textContent = `Kills: ${stats.kills}  ·  Wave: ${stats.wave}  ·  Time: ${stats.time}s`;
    }
  };

  function show(id) {
    $$('.screen').forEach(s => s.classList.add('hidden'));
    const el = $(id);
    if (el) el.classList.remove('hidden');
  }

  function getName() {
    return ($('#username').value.trim() || 'Diver').slice(0, 16);
  }

  // --- Solo (always works) ---
  $('#btn-solo').onclick = () => {
    const name = getName();
    try { Storage.update({ username: name }); } catch (e) {}
    try { AudioSys.ui(); } catch (e) {}
    setStatus('');
    show('#game');
    // Small delay so the browser paints the visible #game before we measure size
    requestAnimationFrame(() => {
      Game.startSolo(name);
      if (!Game._looping) {
        Game._looping = true;
        requestAnimationFrame((t) => Game.loop(t));
      }
      startHUD();
    });
  };

  // --- Host ---
  $('#btn-host').onclick = async () => {
    const name = getName();
    try { Storage.update({ username: name }); } catch (e) {}
    try { AudioSys.ui(); } catch (e) {}
    show('#loading');
    $('#loading-msg').textContent = 'Starting peer connection...';
    try {
      await Network.init();
      await Network.host(name);
      $('#host-code').textContent = Network.localId || '???';
      $('#host-panel').classList.remove('hidden');
      $('#join-panel').classList.add('hidden');
      show('#menu');
      setStatus('Hosting — share the Peer ID above');
      refreshPlayerList();
      Network.onPlayerJoin = () => refreshPlayerList();
      Network.onPlayerLeave = () => refreshPlayerList();
      Network.onStart = () => {
        show('#game');
        requestAnimationFrame(() => {
          Game.startMulti(Network.localId, true, Network.players, name);
          if (!Game._looping) {
            Game._looping = true;
            requestAnimationFrame((t) => Game.loop(t));
          }
          startHUD();
        });
      };
      $('#btn-start').disabled = false;
    } catch (e) {
      console.error(e);
      alert('Could not host: ' + (e.message || e) + '\n\nSolo Deploy still works.');
      show('#menu');
      setStatus('Multiplayer unavailable — try Solo');
    }
  };

  // --- Join UI toggle ---
  $('#btn-join').onclick = () => {
    $('#join-panel').classList.remove('hidden');
    $('#host-panel').classList.add('hidden');
    setStatus('Paste the host\'s full Peer ID');
  };

  $('#btn-join-confirm').onclick = async () => {
    const name = getName();
    const code = ($('#room-code').value || '').trim();
    if (!code) {
      setStatus('Enter a Peer ID first');
      return;
    }
    try { Storage.update({ username: name }); } catch (e) {}
    try { AudioSys.ui(); } catch (e) {}
    show('#loading');
    $('#loading-msg').textContent = 'Connecting to host...';
    try {
      await Network.init();
      await Network.join(code, name);
      Network.onStart = () => {
        show('#game');
        requestAnimationFrame(() => {
          const roster = new Map([[Network.localId, { name }]]);
          Game.startMulti(Network.localId, false, roster, name);
          if (!Game._looping) {
            Game._looping = true;
            requestAnimationFrame((t) => Game.loop(t));
          }
          startHUD();
        });
      };
      Network.onState = (state) => Game.applyState(state);
      $('#loading-msg').textContent = 'Connected! Waiting for host to start the mission...';
      setStatus('Joined — waiting for host');
    } catch (e) {
      console.error(e);
      alert('Join failed: ' + (e.message || e) + '\n\nMake sure you pasted the full Peer ID and the host is online.');
      show('#menu');
      setStatus('Join failed');
    }
  };

  $('#btn-start').onclick = () => {
    try { AudioSys.ui(); } catch (e) {}
    Network.startGame({});
  };

  $('#btn-cancel-load').onclick = () => {
    try { Network.destroy(); } catch (e) {}
    show('#menu');
    setStatus('');
  };

  function refreshPlayerList() {
    const ul = $('#player-list');
    if (!ul) return;
    ul.innerHTML = '';
    for (const [id, info] of Network.players) {
      const li = document.createElement('li');
      li.textContent = (info.isHost ? '★ ' : '') + (info.name || id.slice(0, 8));
      ul.appendChild(li);
    }
  }

  // Options / Stats
  $('#btn-options').onclick = () => { try { AudioSys.ui(); } catch(e){} show('#options'); };
  $('#btn-options-back').onclick = () => show('#menu');
  $('#btn-stats').onclick = () => {
    try { AudioSys.ui(); } catch(e){}
    let s = { missions: 0, kills: 0, extracts: 0, deaths: 0, playTime: 0 };
    try { s = Storage.load().stats || s; } catch (e) {}
    $('#stats-content').innerHTML = `
      <p>Missions: ${s.missions || 0}</p>
      <p>Kills: ${s.kills || 0}</p>
      <p>Extracts: ${s.extracts || 0}</p>
      <p>Deaths: ${s.deaths || 0}</p>
      <p>Play time: ${Math.floor((s.playTime || 0) / 60)}m ${(s.playTime || 0) % 60}s</p>
    `;
    show('#stats');
  };
  $('#btn-stats-back').onclick = () => show('#menu');

  $('#volume').oninput = (e) => {
    const v = parseFloat(e.target.value);
    $('#vol-val').textContent = v.toFixed(2);
    try { AudioSys.setVolume(v); } catch (e) {}
    try { Storage.update({ volume: v }); } catch (e) {}
  };
  $('#show-fps').onchange = (e) => {
    Game.showFps = e.target.checked;
    try { Storage.update({ showFps: e.target.checked }); } catch (e) {}
    const fpsEl = $('#fps');
    if (fpsEl) fpsEl.classList.toggle('hidden', !e.target.checked);
  };
  $('#reduce-motion').onchange = (e) => {
    Game.reduceMotion = e.target.checked;
    try { Storage.update({ reduceMotion: e.target.checked }); } catch (e) {}
  };

  // Pause / End
  $('#btn-resume').onclick = () => {
    Game.state = 'playing';
    $('#pause-menu').classList.add('hidden');
  };
  $('#btn-leave').onclick = leaveMission;
  $('#btn-return').onclick = leaveMission;

  function leaveMission() {
    try { Network.destroy(); } catch (e) {}
    Game.reset();
    Game._looping = false;
    show('#menu');
    $('#pause-menu').classList.add('hidden');
    $('#mission-end').classList.add('hidden');
    setStatus('');
  }

  // HUD loop
  let hudRunning = false;
  function startHUD() {
    if (hudRunning) return;
    hudRunning = true;
    function tick() {
      if (Game.state === 'menu') {
        hudRunning = false;
        return;
      }
      const lp = Game.players.get(Game.localPlayerId);
      if (lp) {
        const ammoEl = $('#ammo');
        const fill = $('#health-fill');
        if (ammoEl) ammoEl.textContent = `AMMO ${lp.ammo}/${lp.maxAmmo}`;
        if (fill) {
          fill.style.width = `${Math.max(0, (lp.hp / lp.maxHp) * 100)}%`;
          fill.style.background = lp.hp < 30 ? '#f33' : '#33cc66';
        }
      }
      const waveEl = $('#wave-info');
      if (waveEl) waveEl.textContent = `WAVE ${Game.wave}  ·  KILLS ${Game.kills}`;

      const et = $('#extract-timer');
      if (et) {
        if (Game.state === 'extract') {
          et.classList.remove('hidden');
          const span = et.querySelector('span');
          if (span) span.textContent = Math.ceil(Game.extractTimer);
        } else {
          et.classList.add('hidden');
        }
      }

      const pause = $('#pause-menu');
      if (pause) {
        if (Game.state === 'paused') pause.classList.remove('hidden');
        else pause.classList.add('hidden');
      }

      if (Game.showFps) {
        const fpsEl = $('#fps');
        if (fpsEl) {
          fpsEl.classList.remove('hidden');
          fpsEl.textContent = Game.fps + ' FPS';
        }
      }

      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // Network input for host
  Network.onInput = (from, input) => Game.applyInput(from, input);

  // Start on menu
  show('#menu');
  setStatus('Ready — Solo Deploy works immediately');
})();
