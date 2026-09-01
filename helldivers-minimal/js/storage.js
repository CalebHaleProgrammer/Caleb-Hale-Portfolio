// LocalStorage helpers for username, settings, stats
const Storage = {
  KEY: 'hellbrowsers_v1',

  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {
      username: '',
      volume: 0.7,
      showFps: false,
      reduceMotion: false,
      stats: {
        missions: 0,
        kills: 0,
        deaths: 0,
        extracts: 0,
        playTime: 0
      }
    };
  },

  save(data) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(data));
    } catch (e) {}
  },

  update(partial) {
    const data = this.load();
    Object.assign(data, partial);
    this.save(data);
    return data;
  },

  addStats(delta) {
    const data = this.load();
    for (const k in delta) {
      data.stats[k] = (data.stats[k] || 0) + delta[k];
    }
    this.save(data);
    return data.stats;
  }
};
