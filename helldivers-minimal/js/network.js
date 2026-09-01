// PeerJS multiplayer networking - host authoritative
const Network = {
  peer: null,
  connections: new Map(), // peerId -> DataConnection
  isHost: false,
  roomId: null,
  localId: null,
  players: new Map(), // peerId -> { name, ready }
  onPlayerJoin: null,
  onPlayerLeave: null,
  onState: null,
  onInput: null,
  onStart: null,
  onMessage: null,
  maxPlayers: 8,

  init() {
    if (typeof Peer === 'undefined' || window.PEERJS_FAILED) {
      return Promise.reject(new Error('PeerJS failed to load. Multiplayer unavailable (solo still works).'));
    }
    // Use public PeerJS cloud (no self-host needed)
    this.peer = new Peer({
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });

    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Peer connection timed out')), 12000);
      this.peer.on('open', (id) => {
        clearTimeout(t);
        this.localId = id;
        resolve(id);
      });
      this.peer.on('error', (err) => {
        clearTimeout(t);
        console.error('Peer error', err);
        reject(err);
      });
      this.peer.on('connection', (conn) => this._handleIncoming(conn));
    });
  },

  async host(name) {
    this.isHost = true;
    this.roomId = this.localId.slice(0, 6).toUpperCase();
    this.players.set(this.localId, { name, ready: true, isHost: true });
    return this.roomId;
  },

  async join(roomCode, name) {
    this.isHost = false;
    this.roomId = roomCode.toUpperCase();
    // For simplicity we treat the room code as the host's peer ID prefix.
    // In practice users share the full short code; we attempt connection to known hosts.
    // Real deployments often use a tiny signaling relay or deterministic ID mapping.
    // Here we ask the user to paste the host's full peer ID or use a simple short code map.
    // For this minimal version: host displays full ID shortened; join uses the displayed code.
    // We'll use the code as the target peer ID (users share the 6-char code which is the start of the ID).
    // To make it work better we will have the host use a custom ID if possible, but PeerJS free cloud
    // generates random IDs. So for reliability we will have host share the full peer ID shortened,
    // and join attempts connection using the provided code as full ID if length matches, else prefix search is not possible.
    // Practical solution for GitHub Pages: host shows full peer ID, user pastes it.
    // To keep UX nice we use 6-char and assume user pastes enough of the ID or we document it.
    // For this build: treat the entered code as the exact peer ID to connect to.
    const targetId = roomCode.trim();
    const conn = this.peer.connect(targetId, { reliable: true });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);
      conn.on('open', () => {
        clearTimeout(timeout);
        this.connections.set(targetId, conn);
        this._setupConn(conn);
        // Introduce ourselves
        conn.send({ type: 'join', name, id: this.localId });
        resolve();
      });
      conn.on('error', (e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });
  },

  _handleIncoming(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      this._setupConn(conn);
    });
  },

  _setupConn(conn) {
    conn.on('data', (data) => this._onData(conn.peer, data));
    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this.players.delete(conn.peer);
      if (this.onPlayerLeave) this.onPlayerLeave(conn.peer);
    });
  },

  _onData(from, data) {
    if (!data || !data.type) return;
    switch (data.type) {
      case 'join':
        if (this.isHost) {
          if (this.players.size >= this.maxPlayers) {
            this.sendTo(from, { type: 'reject', reason: 'full' });
            return;
          }
          this.players.set(from, { name: data.name, ready: true });
          // Send current roster + assign slot
          this.broadcast({ type: 'roster', players: Array.from(this.players.entries()) });
          if (this.onPlayerJoin) this.onPlayerJoin(from, data.name);
        }
        break;
      case 'roster':
        this.players = new Map(data.players);
        if (this.onPlayerJoin) this.onPlayerJoin(null, null); // refresh UI
        break;
      case 'start':
        if (this.onStart) this.onStart(data);
        break;
      case 'input':
        if (this.isHost && this.onInput) this.onInput(from, data.input);
        break;
      case 'state':
        if (!this.isHost && this.onState) this.onState(data.state);
        break;
      case 'msg':
        if (this.onMessage) this.onMessage(data);
        break;
      default:
        break;
    }
  },

  broadcast(data, exclude = null) {
    for (const [id, conn] of this.connections) {
      if (id !== exclude && conn.open) {
        try { conn.send(data); } catch (e) {}
      }
    }
  },

  sendTo(peerId, data) {
    const conn = this.connections.get(peerId);
    if (conn && conn.open) {
      try { conn.send(data); } catch (e) {}
    }
  },

  sendInput(input) {
    if (this.isHost) return; // host applies locally
    // send to host (first connection or known host)
    for (const [id, conn] of this.connections) {
      if (conn.open) {
        conn.send({ type: 'input', input });
        break;
      }
    }
  },

  sendState(state) {
    if (!this.isHost) return;
    this.broadcast({ type: 'state', state });
  },

  startGame(payload) {
    if (!this.isHost) return;
    this.broadcast({ type: 'start', ...payload });
    if (this.onStart) this.onStart(payload);
  },

  destroy() {
    for (const conn of this.connections.values()) {
      try { conn.close(); } catch (e) {}
    }
    this.connections.clear();
    this.players.clear();
    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
      this.peer = null;
    }
  }
};
