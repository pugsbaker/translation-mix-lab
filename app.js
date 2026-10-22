import { Mixer, TRACKS, MIX_PRESETS, presetForLevels, focusTracks, defaultFocusLevels, DEFAULT_VIEW_MODE, DEFAULT_FOCUS_PARTICIPANT } from './audio-engine.js?v=90b308a770e0';
const $ = id => document.getElementById(id);
const definitions = {
  customerOriginal: { name: 'Customer original', language: 'Spanish', voice: 'marin', text: 'Hola, mi pedido debía llegar ayer, pero todavía no lo he recibido. ¿Podría ayudarme a saber dónde está?', type: 'ORIGINAL', container: 'agentTracks' },
  customerTranslation: { name: 'Customer translation', language: 'English', voice: 'marin', text: 'Hello, my order was supposed to arrive yesterday, but I still haven’t received it. Could you help me find out where it is?', type: 'TRANSLATION', container: 'agentTracks' },
  agentOriginal: { name: 'Agent original', language: 'English', voice: 'cedar', text: 'Of course. I’m sorry about the delay. I can check that for you now. Could you please give me your order number?', type: 'ORIGINAL', container: 'customerTracks' },
  agentTranslation: { name: 'Agent translation', language: 'Spanish', voice: 'cedar', text: 'Por supuesto. Lamento la demora. Puedo revisarlo ahora mismo. ¿Podría darme su número de pedido, por favor?', type: 'TRANSLATION', container: 'customerTracks' },
};
let mixer, config, generating = false, loadedSignature = '';
let viewMode = DEFAULT_VIEW_MODE, focusParticipant = DEFAULT_FOCUS_PARTICIPANT;
const focusLevels = Object.fromEntries(['agent', 'customer'].map(side => [side, defaultFocusLevels(side)]));
const focusPresetNames = { silent: 'Silent soft tracks', soft: 'Soft monitoring', medium: 'Medium monitoring', strong: 'Strong monitoring', equal: 'Equal levels' };
function engine() {
  if (!mixer) {
    mixer = new Mixer(new AudioContext());
    for (const id of TRACKS) mixer.setGain(id, Number($(`${id}Volume`).value) / 100);
    mixer.delay = Number($('delay').value);
    mixer.preview(document.querySelector('input[name="preview"]:checked').value);
    mixer.setMonitoring($('hearMyTranslation').checked);
    for (const side of ['agent', 'customer']) for (const id of TRACKS) mixer.setFocusGain(side, id, focusLevels[side][id] / 100);
    mixer.setFocusParticipant(focusParticipant);
    mixer.setViewMode(viewMode);
  }
  return mixer;
}
function formTracks() { return Object.fromEntries(TRACKS.map(id => [id, { text: $(`${id}Text`).value, voice: $(`${id}Voice`).value }])); }
function signature() { return JSON.stringify(formTracks()); }
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function updateReady() {
  const loaded = Boolean(mixer?.buffers);
  const fresh = loaded && signature() === loadedSignature;
  $('play').disabled = !fresh || generating;
  $('reset').disabled = !loaded || generating;
  $('generate').disabled = true;
  $('readyBadge').textContent = generating ? 'GENERATING' : fresh ? 'AUDIO READY' : loaded ? 'SCRIPT CHANGED' : 'NO AUDIO YET';
  $('readyBadge').classList.toggle('ready', fresh);
  if (loaded && !fresh && mixer.playing) mixer.pause();
}
for (const [id, track] of Object.entries(definitions)) {
  const row = document.createElement('div'); row.className = `track ${track.type.toLowerCase()}`;
  row.innerHTML = `<div class="track-meta"><span class="track-dot"></span><label for="${id}Volume">${track.name}<small>${track.language} · ${track.type.toLowerCase()}</small></label><output id="${id}Value">${track.type === 'ORIGINAL' ? 12 : 85}%</output></div><input id="${id}Volume" type="range" min="0" max="100" value="${track.type === 'ORIGINAL' ? 12 : 85}" aria-label="${track.name} volume"><div class="range-caption"><span>Silent</span><span>Full volume</span></div>`;
  $(track.container).append(row);
  $(`${id}Volume`).addEventListener('input', e => { $(`${id}Value`).value = `${e.target.value}%`; mixer?.setGain(id, Number(e.target.value) / 100); updatePresetState(); });
  const field = document.createElement('div'); field.className = 'dialogue-field';
  field.innerHTML = `<div class="dialogue-heading"><label for="${id}Text">${track.name} <span>${track.language}</span></label><label class="voice-label" for="${id}Voice">Voice <select id="${id}Voice"></select></label></div><textarea id="${id}Text" maxlength="2000" rows="4" spellcheck="true" lang="${track.language === 'Spanish' ? 'es' : 'en'}"></textarea><span class="character-count" id="${id}Count"></span>`;
  $('dialogue').append(field); $(`${id}Text`).value = track.text;
  $(`${id}Text`).addEventListener('input', () => { updateCounts(); updateReady(); status('Script changed. Generate explicitly to save the new speech tracks.'); });
  $(`${id}Voice`).addEventListener('change', () => { updateReady(); status('Voice changed. Generate explicitly to save the new speech tracks.'); });
}
function updateCounts() { for (const id of TRACKS) $(`${id}Count`).textContent = `${$(`${id}Text`).value.length} / 2000`; }
updateCounts();
function updatePresetState() {
  const focus = viewMode === 'focus';
  const levels = focus ? focusLevels[focusParticipant] : Object.fromEntries(TRACKS.map(id => [id, Number($(`${id}Volume`).value)]));
  const selected = presetForLevels(levels, focus ? focusParticipant : undefined);
  $('presetState').textContent = selected ? (focus ? focusPresetNames[selected.id] : selected.label) : 'Custom';
  for (const preset of MIX_PRESETS) $(`preset-${preset.id}`).setAttribute('aria-pressed', String(selected?.id === preset.id));
  updateMonitorState();
}
for (const preset of MIX_PRESETS) {
  const button = document.createElement('button');
  button.id = `preset-${preset.id}`;
  button.className = 'preset-button';
  button.type = 'button';
  button.innerHTML = `<span>${preset.label}</span><small>Original ${preset.original}% · Translation ${preset.translation}%</small>`;
  button.addEventListener('click', () => {
    if (viewMode === 'focus') {
      for (const side of ['agent', 'customer']) for (const track of focusTracks(side)) focusLevels[side][track.id] = track.tier === 'soft' ? preset.original : preset.translation;
      mixer?.applyFocusPreset(preset.id);
      renderFocus(); updatePresetState(); return;
    }
    for (const id of TRACKS) {
      const value = id.endsWith('Original') ? preset.original : preset.translation;
      $(`${id}Volume`).value = value;
      $(`${id}Value`).value = `${value}%`;
    }
    mixer?.applyPreset(preset.id);
    updatePresetState();
  });
  $('presetButtons').append(button);
}
updateView();
function renderFocus() {
  const name = focusParticipant === 'agent' ? 'Agent' : 'Customer';
  $('focusTitle').textContent = `${name} focus · all four tracks`;
  $('focusAvatar').textContent = name[0];
  $('focusDescription').textContent = `Your ${focusParticipant === 'agent' ? 'English' : 'Spanish'} speech and the other participant’s speech, with both translations.`;
  $('focusTracks').replaceChildren();
  for (const track of focusTracks(focusParticipant)) {
    const value = focusLevels[focusParticipant][track.id], definition = definitions[track.id];
    const row = document.createElement('div'); row.className = `track ${track.tier === 'primary' ? 'translation' : 'original'}`;
    row.dataset.focusTrack = track.id;
    const name = `${track.label} · ${definition.language}`;
    row.innerHTML = `<div class="track-meta"><span class="track-dot"></span><label for="focus-${track.id}Volume">${track.label}<small>${definition.language} · ${definition.name} · ${track.tier} level</small></label><output id="focus-${track.id}Value">${value}%</output></div><input id="focus-${track.id}Volume" type="range" min="0" max="100" value="${value}" aria-label="${name} volume"><div class="range-caption"><span>Silent</span><span>Full volume</span></div>`;
    $('focusTracks').append(row);
    $(`focus-${track.id}Volume`).addEventListener('input', e => {
      focusLevels[focusParticipant][track.id] = Number(e.target.value);
      $(`focus-${track.id}Value`).value = `${e.target.value}%`;
      mixer?.setFocusGain(focusParticipant, track.id, Number(e.target.value) / 100);
      updatePresetState();
    });
  }
}
function updateView() {
  const focus = viewMode === 'focus';
  document.querySelectorAll('input[name="viewMode"]').forEach(input => { input.checked = input.value === viewMode; });
  document.querySelectorAll('input[name="focusParticipant"]').forEach(input => { input.checked = input.value === focusParticipant; });
  $('listenerOptions').hidden = focus; $('focusOptions').hidden = !focus;
  $('listenerMixer').hidden = focus; $('focusMixer').hidden = !focus;
  $('monitorOption').hidden = focus;
  $('presetButtons').setAttribute('aria-label', focus ? 'Mix presets for both participant focuses' : 'Mix presets for both listeners');
  $('mixHeading').textContent = focus ? 'One participant. All four tracks.' : 'One preset. Both sides.';
  $('mixDescription').textContent = focus ? 'Own original and incoming translation are primary. Own translation and incoming original are soft. Presets apply to both participant focuses.' : 'Set the original beneath the translation for both listeners. Individual sliders still work live.';
  $('presetNote').textContent = focus ? 'Primary tracks stay at 85% in each preset. Soft tracks use 0%, 12%, 30%, 55%, or 85%. All four tracks have independent controls below.' : 'Translation stays at 85% in every preset. Silent original exposes the full translation delay; Equal levels sets both voices to 85%.';
  for (const preset of MIX_PRESETS) $(`preset-${preset.id}`).innerHTML = `<span>${focus ? focusPresetNames[preset.id] : preset.label}</span><small>${focus ? 'Soft tracks' : 'Original'} ${preset.original}% · ${focus ? 'Primary' : 'Translation'} ${preset.translation}%</small>`;
  renderFocus(); updatePresetState();
}
document.querySelectorAll('input[name="viewMode"]').forEach(input => input.addEventListener('change', () => { viewMode = input.value; mixer?.setViewMode(viewMode); updateView(); }));
document.querySelectorAll('input[name="focusParticipant"]').forEach(input => input.addEventListener('change', () => { focusParticipant = input.value; mixer?.setFocusParticipant(focusParticipant); renderFocus(); updatePresetState(); }));
function updateMonitorState() {
  const enabled = $('hearMyTranslation').checked;
  const both = document.querySelector('input[name="preview"]:checked').value === 'both';
  $('monitorState').textContent = !enabled ? 'Own translation monitoring off' : both ? 'Both sides · each translation plays once at its normal level' : `Own translation levels · Agent ${$('customerOriginalVolume').value}% · Customer ${$('agentOriginalVolume').value}%`;
}
$('hearMyTranslation').addEventListener('change', () => { mixer?.setMonitoring($('hearMyTranslation').checked); updateMonitorState(); });
document.querySelectorAll('input[name="preview"]').forEach(input => input.addEventListener('change', () => { mixer?.preview(input.value); updateMonitorState(); }));
$('delay').addEventListener('input', e => { $('delayValue').value = `${Number(e.target.value).toFixed(1)} s`; mixer?.setDelay(Number(e.target.value)); });
$('play').addEventListener('click', async () => {
  try { const audio = engine(); await audio.context.resume(); if (audio.playing) audio.pause(); else audio.play(); }
  catch { status('Your browser could not start audio. Try a current Chrome, Safari, or Firefox browser.', true); }
});
$('reset').addEventListener('click', () => mixer?.reset());
async function apiJson(url, options) {
  const res = await fetch(url, options);
  const body = await res.json(); if (!res.ok) throw new Error(body.error || 'The server could not complete the request.'); return body;
}
function time(value) { value = Math.max(0, Math.floor(value || 0)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`; }
function tick() {
  const timeline = mixer?.timeline;
  if (timeline) {
    const position = Math.max(0, mixer.position);
    if (mixer.playing && position >= timeline.duration) mixer.pause();
    $('progress').max = timeline.duration; $('progress').value = position;
    $('clock').textContent = `${time(position)} / ${time(timeline.duration)}`;
    const speaker = position >= timeline.agentStart ? 'agent' : 'customer';
    $('phase').textContent = position >= timeline.duration ? 'Preview complete' : viewMode === 'focus'
      ? `${speaker === 'agent' ? 'Agent' : 'Customer'} speaks · ${speaker === focusParticipant ? 'your original + translation' : 'incoming original + translation'}`
      : position >= timeline.agentStart ? 'Agent reply → customer’s Spanish mix' : 'Customer speaks → agent’s English mix';
    for (const clip of timeline.clips) {
      const active = mixer.playing && position >= clip.start && position < clip.start + mixer.buffers[clip.id].duration;
      $(`${clip.id}Volume`).closest('.track').classList.toggle('active', active);
      $(`focus-${clip.id}Volume`)?.closest('.track').classList.toggle('active', active);
    }
  }
  $('play').textContent = mixer?.playing ? 'Ⅱ Pause preview' : '▶ Play preview';
  requestAnimationFrame(tick);
}
tick();
async function init() {
  try {
    const session = await apiJson('./demo-session.json');
    config = { configured: false, model: session.model };
    $('modelInfo').textContent = 'Prerecorded AI-generated speech demo';
    const audio = engine(), buffers = {};
    for (const id of TRACKS) {
      const saved = session.tracks[id];
      const res = await fetch(saved.audioUrl);
      if (!res.ok) throw new Error('A saved demo audio file could not be loaded. Please refresh and try again.');
      buffers[id] = await audio.context.decodeAudioData(await res.arrayBuffer());
      $(id + 'Text').value = saved.text;
      $(id + 'Text').readOnly = true;
      $(id + 'Voice').add(new Option(saved.voice, saved.voice, true, true));
      $(id + 'Voice').disabled = true;
    }
    audio.load(buffers); loadedSignature = signature(); updateCounts();
    status('Demo speech loaded. Playback, presets, and delay changes use the saved tracks—no generation or API calls.');
  } catch (error) { status(error.message || 'Demo audio could not be loaded.', true); }
  updateReady();
}
await init();
