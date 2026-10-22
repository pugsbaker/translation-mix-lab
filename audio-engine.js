export const DEFAULT_VIEW_MODE = 'focus';
export const DEFAULT_FOCUS_PARTICIPANT = 'agent';
export const TRACKS = ['customerOriginal', 'customerTranslation', 'agentOriginal', 'agentTranslation'];
export const MIX_PRESETS = [
  { id: 'silent', label: 'Silent original', original: 0, translation: 85 },
  { id: 'soft', label: 'Soft original', original: 12, translation: 85 },
  { id: 'medium', label: 'Medium original', original: 30, translation: 85 },
  { id: 'strong', label: 'Strong original', original: 55, translation: 85 },
  { id: 'equal', label: 'Equal levels', original: 85, translation: 85 },
];
export function focusTracks(participant) {
  const other = participant === 'agent' ? 'customer' : 'agent';
  return [
    { id: `${participant}Original`, label: 'Your original speech', tier: 'primary' },
    { id: `${participant}Translation`, label: 'Your translated speech', tier: 'soft' },
    { id: `${other}Translation`, label: 'Incoming translation', tier: 'primary' },
    { id: `${other}Original`, label: 'Incoming original speech', tier: 'soft' },
  ];
}
export function defaultFocusLevels(participant) {
  return Object.fromEntries(focusTracks(participant).map(track => [track.id, track.tier === 'primary' ? 85 : 12]));
}
export function presetForLevels(levels, participant) {
  return MIX_PRESETS.find(preset => participant
    ? focusTracks(participant).every(track => levels[track.id] === (track.tier === 'soft' ? preset.original : preset.translation))
    : TRACKS.every(id => levels[id] === (id.endsWith('Original') ? preset.original : preset.translation))) || null;
}
export function buildTimeline(buffers, delay) {
  const customerEnd = Math.max(buffers.customerOriginal.duration, delay + buffers.customerTranslation.duration);
  const agentStart = customerEnd + 0.65;
  return {
    clips: [
      { id: 'customerOriginal', start: 0 },
      { id: 'customerTranslation', start: delay },
      { id: 'agentOriginal', start: agentStart },
      { id: 'agentTranslation', start: agentStart + delay },
    ],
    agentStart,
    duration: agentStart + Math.max(buffers.agentOriginal.duration, delay + buffers.agentTranslation.duration),
  };
}

export class Mixer {
  constructor(context) {
    this.context = context;
    this.buffers = null;
    this.delay = 1.2;
    this.offset = 0;
    this.playing = false;
    this.sources = [];
    this.monitorEnabled = false;
    this.viewMode = DEFAULT_VIEW_MODE;
    this.focusParticipant = DEFAULT_FOCUS_PARTICIPANT;
    this.focusLevels = Object.fromEntries(['agent', 'customer'].map(side => [side, defaultFocusLevels(side)]));
    this.levels = Object.fromEntries(TRACKS.map(id => [id, id.endsWith('Original') ? 0.12 : 0.85]));
    this.buses = Object.fromEntries(['agent', 'customer'].map(id => {
      const gain = context.createGain(); gain.connect(context.destination); return [id, gain];
    }));
    this.gains = Object.fromEntries(TRACKS.map(id => {
      const gain = context.createGain(); gain.gain.value = id.endsWith('Original') ? 0.12 : 0.85;
      gain.connect(this.buses[id.startsWith('customer') ? 'agent' : 'customer']); return [id, gain];
    }));
    this.monitorGains = Object.fromEntries([
      ['agentTranslation', 'agent'], ['customerTranslation', 'customer'],
    ].map(([track, listener]) => {
      const gain = context.createGain(); gain.gain.value = 0;
      gain.connect(this.buses[listener]); return [track, gain];
    }));
    this.focusBus = context.createGain(); this.focusBus.gain.value = 0;
    this.focusBus.connect(context.destination);
    this.focusGains = Object.fromEntries(TRACKS.map(id => {
      const gain = context.createGain(); gain.gain.value = this.focusLevels.agent[id] / 100;
      gain.connect(this.focusBus); return [id, gain];
    }));
    this.preview('agent');
  }
  setGain(id, value) {
    this.levels[id] = value;
    this.gains[id].gain.setTargetAtTime(value, this.context.currentTime, 0.015);
    this.updateMonitoring();
  }
  setMonitoring(enabled) { this.monitorEnabled = Boolean(enabled); this.updateMonitoring(); }
  updateMonitoring() {
    // Both sides already includes each translation on its normal listener bus.
    // Suppress the extra monitor routes there, preserving the normal mix level.
    const enabled = this.viewMode === 'listener' && this.monitorEnabled && this.previewMode !== 'both';
    for (const [track, original] of [['agentTranslation', 'customerOriginal'], ['customerTranslation', 'agentOriginal']]) {
      this.monitorGains[track].gain.setTargetAtTime(enabled ? this.levels[original] : 0, this.context.currentTime, 0.015);
    }
  }
  applyPreset(id) {
    const preset = MIX_PRESETS.find(preset => preset.id === id);
    if (!preset) throw new Error('Unknown mix preset.');
    for (const track of TRACKS) this.setGain(track, (track.endsWith('Original') ? preset.original : preset.translation) / 100);
  }
  preview(mode) {
    this.previewMode = mode;
    this.updateRouting();
  }
  setViewMode(mode) { this.viewMode = mode; this.updateRouting(); }
  setFocusParticipant(participant) {
    this.focusParticipant = participant;
    for (const id of TRACKS) this.focusGains[id].gain.setTargetAtTime(this.focusLevels[participant][id] / 100, this.context.currentTime, 0.015);
  }
  setFocusGain(participant, id, value) {
    this.focusLevels[participant][id] = value * 100;
    if (participant === this.focusParticipant) this.focusGains[id].gain.setTargetAtTime(value, this.context.currentTime, 0.015);
  }
  applyFocusPreset(id) {
    const preset = MIX_PRESETS.find(preset => preset.id === id);
    if (!preset) throw new Error('Unknown mix preset.');
    for (const side of ['agent', 'customer']) for (const track of focusTracks(side)) {
      this.setFocusGain(side, track.id, (track.tier === 'soft' ? preset.original : preset.translation) / 100);
    }
  }
  updateRouting() {
    const listener = this.viewMode === 'listener';
    for (const id of ['agent', 'customer']) this.buses[id].gain.setTargetAtTime(listener && (this.previewMode === 'both' || this.previewMode === id) ? 0.7 : 0, this.context.currentTime, 0.015);
    this.focusBus.gain.setTargetAtTime(listener ? 0 : 0.7, this.context.currentTime, 0.015);
    this.updateMonitoring();
  }
  get timeline() { return this.buffers ? buildTimeline(this.buffers, this.delay) : null; }
  get position() { return this.playing ? Math.min(this.timeline.duration, this.offset + this.context.currentTime - this.started) : this.offset; }
  load(buffers) { this.reset(); this.buffers = buffers; }
  stopSources() { for (const source of this.sources) { try { source.stop(); } catch {} source.disconnect(); } this.sources = []; }
  pause() { this.offset = this.position; this.playing = false; this.stopSources(); }
  reset() { this.playing = false; this.offset = 0; this.stopSources(); }
  setDelay(value) { const resume = this.playing; this.reset(); this.delay = value; if (resume) this.play(); }
  play() {
    if (!this.buffers || this.playing) return;
    if (this.offset >= this.timeline.duration) this.offset = 0;
    this.started = this.context.currentTime + 0.025;
    this.playing = true;
    for (const clip of this.timeline.clips) {
      const buffer = this.buffers[clip.id];
      const elapsed = Math.max(0, this.offset - clip.start);
      if (elapsed >= buffer.duration) continue;
      const source = this.context.createBufferSource(); source.buffer = buffer;
      source.connect(this.gains[clip.id]);
      if (this.monitorGains[clip.id]) source.connect(this.monitorGains[clip.id]);
      source.connect(this.focusGains[clip.id]);
      source.start(this.started + Math.max(0, clip.start - this.offset), elapsed);
      this.sources.push(source);
    }
  }
}
