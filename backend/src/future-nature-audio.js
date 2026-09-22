(() => {
  'use strict';

  const STORAGE_KEY = 'future-nature-audio-v1';
  const AudioEngine = globalThis.AudioContext || globalThis.webkitAudioContext;
  const TRACKS = Object.freeze({
    none: { name: 'None', interval: 0, notes: [] },
    zen: { name: 'Zen Garden', interval: 2200, notes: [783.99, 880, 659.25, 987.77, 783.99, 698.46] },
    energy: { name: 'Gentle Energy', interval: 430, notes: [392, 523.25, 440, 587.33, 392, 659.25, 440, 523.25] },
    light: { name: 'Light Beats', interval: 670, notes: [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880, 698.46] },
    focus: { name: 'Focus Pattern', interval: 920, notes: [329.63, 392, 493.88, 440, 369.99, 440, 523.25, 392] },
  });

  function readSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const parsedVolume = Number(saved.volume);
      return {
        enabled: saved.enabled !== false,
        volume: Math.max(0, Math.min(.5, Number.isFinite(parsedVolume) ? parsedVolume : .3)),
        waterfall: Math.max(0, Math.min(1, Number.isFinite(Number(saved.waterfall)) ? Number(saved.waterfall) : 1)),
        wind: Math.max(0, Math.min(1, Number.isFinite(Number(saved.wind)) ? Number(saved.wind) : 1)),
        chimes: Math.max(0, Math.min(1, Number.isFinite(Number(saved.chimes)) ? Number(saved.chimes) : 1)),
        track: TRACKS[saved.track] ? saved.track : 'none',
        trackVolume: Math.max(0, Math.min(1, Number.isFinite(Number(saved.trackVolume)) ? Number(saved.trackVolume) : .55)),
      };
    } catch {
      return { enabled: true, volume: .3, waterfall: 1, wind: 1, chimes: 1, track: 'none', trackVolume: .55 };
    }
  }

  function mount({ target = document, toggle, volume, waterfallVolume, windVolume, chimeVolume, testChime, track, trackVolume }) {
    const settings = readSettings();
    let context = null;
    let master = null;
    let started = false;
    let destroyed = false;
    let enabled = settings.enabled;
    let level = settings.volume;
    let waterfallLevel = settings.waterfall;
    let windLevel = settings.wind;
    let chimeLevel = settings.chimes;
    let trackId = settings.track;
    let trackLevel = settings.trackVolume;
    let trackTimer = 0;
    let trackStep = 0;
    let waterfallGain = null;
    let airGain = null;
    let chimeTimer = 0;
    const sources = [];

    function persist() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled, volume: level, waterfall: waterfallLevel, wind: windLevel, chimes: chimeLevel, track: trackId, trackVolume: trackLevel })); } catch {}
    }

    function updateControl() {
      if (volume) volume.value = String(Math.round(level * 100));
      if (waterfallVolume) waterfallVolume.value = String(Math.round(waterfallLevel * 100));
      if (windVolume) windVolume.value = String(Math.round(windLevel * 100));
      if (chimeVolume) chimeVolume.value = String(Math.round(chimeLevel * 100));
      if (track) track.value = trackId;
      if (trackVolume) trackVolume.value = String(Math.round(trackLevel * 100));
      if (!toggle) return;
      toggle.setAttribute('aria-pressed', String(started && enabled));
      toggle.textContent = !AudioEngine ? 'Sound unavailable' : !enabled ? 'Nature: muted' : started ? 'Nature: on' : 'Nature: tap to start';
    }

    function setGain(node, value, seconds = .4) {
      if (!node || !context) return;
      node.gain.cancelScheduledValues(context.currentTime);
      node.gain.setTargetAtTime(value, context.currentTime, Math.max(.01, seconds / 3));
    }

    function noise(destination, seconds, smoothing) {
      const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
      const data = buffer.getChannelData(0);
      let previous = 0;
      for (let index = 0; index < data.length; index++) {
        const white = Math.random() * 2 - 1;
        previous = previous * smoothing + white * (1 - smoothing);
        data[index] = previous;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(destination);
      source.start();
      sources.push(source);
    }

    function makeNatureBed() {
      master = context.createGain();
      master.gain.value = 0;
      master.connect(context.destination);

      const waterfallFilter = context.createBiquadFilter();
      waterfallFilter.type = 'bandpass';
      waterfallFilter.frequency.value = 1450;
      waterfallFilter.Q.value = .65;
      waterfallGain = context.createGain();
      waterfallGain.gain.value = .078 * waterfallLevel;
      waterfallFilter.connect(waterfallGain);
      waterfallGain.connect(master);
      noise(waterfallFilter, 3, .54);

      const airFilter = context.createBiquadFilter();
      airFilter.type = 'highpass';
      airFilter.frequency.value = 1050;
      airFilter.Q.value = .42;
      airGain = context.createGain();
      airGain.gain.value = .018 * windLevel;
      airFilter.connect(airGain);
      airGain.connect(master);
      noise(airFilter, 5, .32);
    }

    function chime(frequency, delay = 0, strength = .028, panPosition = 0) {
      if (!context || !enabled) return;
      const now = context.currentTime + delay;
      const output = context.createStereoPanner ? context.createStereoPanner() : context.createGain();
      if (output.pan) output.pan.value = Math.max(-.7, Math.min(.7, panPosition));
      output.connect(master);
      const partials = [
        { ratio: 1, level: 1, decay: 2.65 },
        { ratio: 2.73, level: .24, decay: 1.35 },
        { ratio: 5.18, level: .075, decay: .72 },
      ];
      partials.forEach((partial, index) => {
        const tone = context.createOscillator();
        const gain = context.createGain();
        tone.type = 'sine';
        tone.frequency.setValueAtTime(frequency * partial.ratio, now);
        if (tone.detune) tone.detune.value = (Math.random() - .5) * (index ? 7 : 2);
        gain.gain.setValueAtTime(.0001, now);
        gain.gain.exponentialRampToValueAtTime(Math.max(.0001, strength * partial.level * chimeLevel), now + .006 + index * .002);
        gain.gain.exponentialRampToValueAtTime(.0001, now + partial.decay);
        tone.connect(gain);
        gain.connect(output);
        tone.start(now);
        tone.stop(now + partial.decay + .04);
      });
      const strikeBuffer = context.createBuffer(1, Math.max(1, Math.round(context.sampleRate * .024)), context.sampleRate);
      const strikeData = strikeBuffer.getChannelData(0);
      for (let index = 0; index < strikeData.length; index++) strikeData[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / strikeData.length, 2);
      const strike = context.createBufferSource();
      const strikeFilter = context.createBiquadFilter();
      const strikeGain = context.createGain();
      strike.buffer = strikeBuffer;
      strikeFilter.type = 'bandpass';
      strikeFilter.frequency.value = 3200;
      strikeFilter.Q.value = 1.1;
      strikeGain.gain.value = strength * .24 * chimeLevel;
      strike.connect(strikeFilter);
      strikeFilter.connect(strikeGain);
      strikeGain.connect(output);
      strike.start(now);
    }

    function chimeCluster(preview = false) {
      const notes = [523.25, 587.33, 659.25, 783.99, 880];
      const count = preview ? 4 : 2 + Math.floor(Math.random() * 3);
      let delay = 0;
      for (let index = 0; index < count; index++) {
        const frequency = notes[(Math.floor(Math.random() * notes.length) + index) % notes.length];
        const pan = preview ? [-.45, .28, -.12, .5][index] : Math.random() * 1.2 - .6;
        chime(frequency, delay, (preview ? .027 : .02 + Math.random() * .009) * (1 - index * .08), pan);
        delay += preview ? .24 + index * .045 : .14 + Math.random() * .38;
      }
    }

    function previewChime() {
      if (!started) awaken();
      chimeCluster(true);
    }

    function gameTone(startFrequency, endFrequency, duration, strength, delay = 0) {
      if (!context || !enabled) return;
      const now = context.currentTime + delay;
      const source = context.createOscillator();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      source.type = 'sine';
      source.frequency.setValueAtTime(startFrequency, now);
      source.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
      filter.type = 'highpass';
      filter.frequency.value = 145;
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(strength, now + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      source.start(now);
      source.stop(now + duration + .03);
    }

    function gameCue(kind, detail = {}) {
      if (!started) awaken();
      if (!context || !enabled || kind !== '2048-move') return;
      gameTone(430, 325, .13, .014);
      if (detail.merged) {
        gameTone(490, 610, .24, .02, .11);
        gameTone(650, 760, .27, .008, .15);
      }
    }

    function tone(frequency, duration, strength, wave = 'sine', delay = 0) {
      if (!context || !enabled || trackLevel <= 0) return;
      const now = context.currentTime + delay;
      const source = context.createOscillator();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      source.type = wave;
      source.frequency.setValueAtTime(frequency, now);
      filter.type = 'highpass';
      filter.frequency.value = 210;
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(.0001, strength * trackLevel), now + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      source.start(now);
      source.stop(now + duration + .03);
    }

    function softBeat(strength = .018) {
      if (!context || !enabled || trackLevel <= 0) return;
      const buffer = context.createBuffer(1, Math.round(context.sampleRate * .055), context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < data.length; index++) data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      filter.type = 'bandpass';
      filter.frequency.value = 1800;
      filter.Q.value = .8;
      gain.gain.value = strength * trackLevel;
      source.buffer = buffer;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      source.start();
    }

    function playTrackStep() {
      const config = TRACKS[trackId];
      if (!config || trackId === 'none') return;
      const frequency = config.notes[trackStep % config.notes.length];
      if (trackId === 'zen') {
        tone(frequency, .78, .026, 'sine');
        if (trackStep % 3 === 2) tone(frequency * 1.5, .55, .011, 'sine', .12);
      } else if (trackId === 'energy') {
        softBeat(trackStep % 4 === 0 ? .032 : .016);
        if (trackStep % 2 === 0) tone(frequency, .16, .019, 'triangle');
      } else if (trackId === 'light') {
        softBeat(.012);
        tone(frequency, .3, .021, 'sine');
        if (trackStep % 4 === 3) tone(frequency * 1.25, .24, .01, 'sine', .08);
      } else if (trackId === 'focus') {
        tone(frequency, .34, .022, 'triangle');
        if (trackStep % 4 === 0) softBeat(.014);
      }
      trackStep++;
    }

    function scheduleTrack(immediate = false) {
      clearTimeout(trackTimer);
      const config = TRACKS[trackId];
      if (destroyed || !started || !config || trackId === 'none') return;
      trackTimer = setTimeout(() => {
        playTrackStep();
        scheduleTrack(false);
      }, immediate ? 120 : config.interval);
    }

    function scheduleChime(first = false) {
      clearTimeout(chimeTimer);
      if (destroyed || !started) return;
      chimeTimer = setTimeout(() => {
        if (enabled) {
          chimeCluster(false);
        }
        scheduleChime(false);
      }, first ? 2200 : 9000 + Math.random() * 14000);
    }

    function awaken() {
      if (destroyed || !enabled || !AudioEngine) { updateControl(); return false; }
      if (!context) { context = new AudioEngine(); makeNatureBed(); }
      context.resume?.();
      started = true;
      setGain(master, level, .7);
      scheduleChime(true);
      scheduleTrack(true);
      updateControl();
      return true;
    }

    function setEnabled(value) {
      enabled = Boolean(value);
      persist();
      if (enabled) awaken(); else setGain(master, 0, .12);
      updateControl();
    }

    function setVolume(value) {
      level = Math.max(0, Math.min(.5, Number(value)));
      if (started && enabled) setGain(master, level, .15);
      persist();
      updateControl();
    }

    function setLayer(name, value) {
      const next = Math.max(0, Math.min(1, Number(value)));
      if (name === 'waterfall') {
        waterfallLevel = next;
        if (waterfallGain) setGain(waterfallGain, .078 * waterfallLevel, .12);
      } else if (name === 'wind') {
        windLevel = next;
        if (airGain) setGain(airGain, .018 * windLevel, .12);
      } else if (name === 'chimes') {
        chimeLevel = next;
      }
      persist();
      updateControl();
    }

    function setTrack(value) {
      if (!TRACKS[value]) return;
      trackId = value;
      trackStep = 0;
      persist();
      if (!started && trackId !== 'none') awaken(); else scheduleTrack(true);
      updateControl();
    }

    function setTrackVolume(value) {
      trackLevel = Math.max(0, Math.min(1, Number(value)));
      persist();
      updateControl();
    }

    function firstInteraction(event) { if (event.target !== toggle) awaken(); }
    function toggleClick() { if (!started && enabled) awaken(); else setEnabled(!enabled); }
    function volumeInput() { setVolume(Number(volume.value) / 100); }
    function waterfallInput() { setLayer('waterfall', Number(waterfallVolume.value) / 100); }
    function windInput() { setLayer('wind', Number(windVolume.value) / 100); }
    function chimeInput() { setLayer('chimes', Number(chimeVolume.value) / 100); }
    function trackChange() { setTrack(track.value); }
    function trackVolumeInput() { setTrackVolume(Number(trackVolume.value) / 100); }

    target.addEventListener('pointerdown', firstInteraction, { passive: true });
    target.addEventListener('keydown', firstInteraction);
    toggle?.addEventListener('click', toggleClick);
    volume?.addEventListener('input', volumeInput);
    waterfallVolume?.addEventListener('input', waterfallInput);
    windVolume?.addEventListener('input', windInput);
    chimeVolume?.addEventListener('input', chimeInput);
    testChime?.addEventListener('click', previewChime);
    track?.addEventListener('change', trackChange);
    trackVolume?.addEventListener('input', trackVolumeInput);
    updateControl();

    return {
      awaken, setEnabled, setVolume, setLayer, setTrack, setTrackVolume, previewChime, gameCue,
      state: () => ({ supported: Boolean(AudioEngine), started, enabled, volume: level, waterfall: waterfallLevel, wind: windLevel, chimes: chimeLevel, track: trackId, trackVolume: trackLevel }),
      destroy() {
        destroyed = true;
        clearTimeout(chimeTimer);
        clearTimeout(trackTimer);
        target.removeEventListener('pointerdown', firstInteraction);
        target.removeEventListener('keydown', firstInteraction);
        toggle?.removeEventListener('click', toggleClick);
        volume?.removeEventListener('input', volumeInput);
        waterfallVolume?.removeEventListener('input', waterfallInput);
        windVolume?.removeEventListener('input', windInput);
        chimeVolume?.removeEventListener('input', chimeInput);
        testChime?.removeEventListener('click', previewChime);
        track?.removeEventListener('change', trackChange);
        trackVolume?.removeEventListener('input', trackVolumeInput);
        sources.forEach(source => { try { source.stop(); } catch {} });
        context?.close?.();
      },
    };
  }

  globalThis.FutureNatureAudio = Object.freeze({ mount, tracks: Object.entries(TRACKS).map(([id, value]) => ({ id, name: value.name })) });
})();
