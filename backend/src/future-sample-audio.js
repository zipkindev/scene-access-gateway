(() => {
  'use strict';

  const STORAGE_KEY = 'future-sample-audio-v2';
  const SAMPLES = Object.freeze({
    none: null,
    neuro: 'audio-samples/freesound_community-ambient-neuro-bass-beat-27709.mp3',
    piano: 'audio-samples/freesound_community-ambient-piano-loop-85bpm-40993.mp3',
    calm: 'audio-samples/freesound_community-calm-loop-80576.mp3',
    forcefield: 'audio-samples/freesound_community-forcefield-ambience-67572.mp3',
    hardstyle: 'audio-samples/freesound_community-hardstyle-atmos01_fmin_150bpm-94733.mp3',
    spooky: 'audio-samples/freesound_community-spooky-keys-63764.mp3',
    ether: 'audio-samples/gigidelaromusic-calm-ether-loop-short-450954.mp3',
    delightful: 'audio-samples/grumpynora-delightful-loop-380173.mp3',
  });
  const LOOP_PRESETS = Object.freeze({
    neuro: { start: 16.4, end: 41.2 },
    piano: { start: 0, end: null },
    calm: { start: 0, end: 5 },
    forcefield: { start: 0, end: null },
    hardstyle: { start: 3.8, end: 6.9 },
    spooky: { start: 0, end: null },
    ether: { start: .1, end: 9.6 },
    delightful: { start: 1.7, end: 12 },
  });
  const SAMPLE_NAMES = Object.freeze({
    ether: 'Calm Ether', delightful: 'Delightful Loop', piano: 'Ambient Piano', calm: 'Calm Loop',
    neuro: 'Ambient Neuro', forcefield: 'Forcefield Ambience', hardstyle: 'Hardstyle Atmosphere', spooky: 'Spooky Keys',
  });
  const CYCLE_ORDER = Object.freeze(['ether','delightful','piano','calm','neuro','forcefield','hardstyle','spooky']);

  function mount({ select, volume, toggle, loopStart, loopEnd, loopReadout, setLoopStart, setLoopEnd, resetLoop, target = document, defaultSample = 'ether' }) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch {}
    let sampleId = SAMPLES[saved.sample] ? saved.sample : SAMPLES[defaultSample] ? defaultSample : 'ether';
    let level = Math.max(0, Math.min(1, Number.isFinite(Number(saved.volume)) ? Number(saved.volume) : .45));
    const savedLoops = saved.loops && typeof saved.loops === 'object' ? saved.loops : {};
    const loops = Object.fromEntries(Object.entries(LOOP_PRESETS).map(([id, preset]) => {
      const candidate = savedLoops[id];
      const start = Number(candidate?.start), end = candidate?.end === null ? null : Number(candidate?.end);
      const valid = Number.isFinite(start) && start >= 0 &&
        (end === null || (Number.isFinite(end) && end >= start + .25));
      return [id, valid ? { start, end } : { ...preset }];
    }));
    let monitorTimer = 0;
    const audio = new Audio();
    audio.loop = false;
    audio.preload = 'auto';

    function persist() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ sample: sampleId, volume: level, loops })); } catch {}
    }

    function loopFor(id = sampleId) {
      const preset = LOOP_PRESETS[id] || { start: 0, end: null };
      const savedLoop = loops[id] || preset;
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      const start = Math.max(0, Math.min(duration || Infinity, Number.isFinite(Number(savedLoop.start)) ? Number(savedLoop.start) : preset.start));
      const requestedEnd = savedLoop.end === null ? null : Number.isFinite(Number(savedLoop.end)) ? Number(savedLoop.end) : preset.end;
      const end = Math.max(start + .25, Math.min(duration || Infinity, requestedEnd === null ? duration : requestedEnd));
      return { start, end: Number.isFinite(end) ? end : 0 };
    }

    function formatTime(value) {
      const seconds = Math.max(0, Number(value) || 0);
      return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}.${Math.floor(seconds * 10) % 10}`;
    }

    function updateLoopControl() {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      const currentLoop = loopFor();
      for (const control of [loopStart, loopEnd]) {
        if (!control) continue;
        control.disabled = sampleId === 'none' || !duration;
        control.max = String(Math.max(.5, duration));
      }
      if (loopStart) loopStart.value = String(currentLoop.start);
      if (loopEnd) loopEnd.value = String(currentLoop.end || duration);
      if (loopReadout) loopReadout.textContent = sampleId === 'none' || !duration
        ? 'Select a clip to edit its loop'
        : `Intro 0:00.0 → ${formatTime(currentLoop.end)} · repeat ${formatTime(currentLoop.start)} → ${formatTime(currentLoop.end)}`;
      setLoopStart && (setLoopStart.disabled = sampleId === 'none' || !duration);
      setLoopEnd && (setLoopEnd.disabled = sampleId === 'none' || !duration);
      resetLoop && (resetLoop.disabled = sampleId === 'none' || !duration);
    }

    function updateControl() {
      if (select) select.value = sampleId;
      if (volume) volume.value = String(Math.round(level * 100));
      if (toggle) {
        toggle.disabled = sampleId === 'none';
        toggle.setAttribute('aria-pressed', String(!audio.paused));
        toggle.textContent = sampleId === 'none' ? 'Clip: select one' : audio.paused ? 'Clip: play' : 'Clip: pause';
      }
      updateLoopControl();
    }

    async function play() {
      if (sampleId === 'none') return;
      try { await audio.play(); } catch {}
      updateControl();
    }

    function setSample(value) {
      if (SAMPLES[value] === undefined) return;
      sampleId = value;
      audio.pause();
      audio.currentTime = 0;
      if (SAMPLES[sampleId]) {
        audio.src = SAMPLES[sampleId];
        audio.load();
        play();
      } else {
        audio.removeAttribute('src');
        audio.load();
      }
      persist();
      updateControl();
    }

    function setVolume(value) {
      level = Math.max(0, Math.min(1, Number(value)));
      audio.volume = level;
      persist();
      updateControl();
    }

    function cycle() {
      const currentIndex = CYCLE_ORDER.indexOf(sampleId);
      const nextId = CYCLE_ORDER[(currentIndex + 1 + CYCLE_ORDER.length) % CYCLE_ORDER.length];
      setSample(nextId);
      return { id: nextId, name: SAMPLE_NAMES[nextId] };
    }

    function saveLoop(start, end) {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      if (!duration || sampleId === 'none') return;
      const safeStart = Math.max(0, Math.min(duration - .25, Number(start)));
      const safeEnd = Math.max(safeStart + .25, Math.min(duration, Number(end)));
      loops[sampleId] = { start: safeStart, end: safeEnd };
      persist();
      updateLoopControl();
    }

    function enforceLoop() {
      if (audio.paused || sampleId === 'none') return;
      const currentLoop = loopFor();
      if (currentLoop.end && audio.currentTime >= currentLoop.end - .035) audio.currentTime = currentLoop.start;
    }
    function restartLoop() { const currentLoop = loopFor(); audio.currentTime = currentLoop.start; play(); }

    function selectChange() { setSample(select.value); }
    function volumeInput() { setVolume(Number(volume.value) / 100); }
    function toggleClick() { if (audio.paused) play(); else { audio.pause(); updateControl(); } }
    function loopStartInput() { saveLoop(Number(loopStart.value), loopFor().end); }
    function loopEndInput() { saveLoop(loopFor().start, Number(loopEnd.value)); }
    function setLoopStartClick() { saveLoop(audio.currentTime, loopFor().end); }
    function setLoopEndClick() { saveLoop(loopFor().start, audio.currentTime); }
    function resetLoopClick() { delete loops[sampleId]; persist(); updateLoopControl(); }
    function firstInteraction() { play(); target?.removeEventListener('pointerdown', firstInteraction);target?.removeEventListener('keydown', firstInteraction); }

    audio.volume = level;
    if (SAMPLES[sampleId]) { audio.src = SAMPLES[sampleId]; audio.load(); }
    select?.addEventListener('change', selectChange);
    volume?.addEventListener('input', volumeInput);
    toggle?.addEventListener('click', toggleClick);
    loopStart?.addEventListener('input', loopStartInput);
    loopEnd?.addEventListener('input', loopEndInput);
    setLoopStart?.addEventListener('click', setLoopStartClick);
    setLoopEnd?.addEventListener('click', setLoopEndClick);
    resetLoop?.addEventListener('click', resetLoopClick);
    target?.addEventListener('pointerdown', firstInteraction, { passive: true });
    target?.addEventListener('keydown', firstInteraction);
    audio.addEventListener('play', updateControl);
    audio.addEventListener('pause', updateControl);
    audio.addEventListener('loadedmetadata', updateControl);
    audio.addEventListener('timeupdate', enforceLoop);
    audio.addEventListener('ended', restartLoop);
    monitorTimer = setInterval(enforceLoop, 40);
    updateControl();

    return {
      play,
      pause() { audio.pause(); updateControl(); },
      setSample, cycle,
      setVolume,
      setLoop: saveLoop,
      state: () => ({ sample: sampleId, volume: level, playing: !audio.paused }),
      destroy() {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        clearInterval(monitorTimer);
        select?.removeEventListener('change', selectChange);
        volume?.removeEventListener('input', volumeInput);
        toggle?.removeEventListener('click', toggleClick);
        loopStart?.removeEventListener('input', loopStartInput);
        loopEnd?.removeEventListener('input', loopEndInput);
        setLoopStart?.removeEventListener('click', setLoopStartClick);
        setLoopEnd?.removeEventListener('click', setLoopEndClick);
        resetLoop?.removeEventListener('click', resetLoopClick);
        target?.removeEventListener('pointerdown', firstInteraction);
        target?.removeEventListener('keydown', firstInteraction);
        audio.removeEventListener('play', updateControl);
        audio.removeEventListener('pause', updateControl);
        audio.removeEventListener('loadedmetadata', updateControl);
        audio.removeEventListener('timeupdate', enforceLoop);
        audio.removeEventListener('ended', restartLoop);
      },
    };
  }

  globalThis.FutureSampleAudio = Object.freeze({ mount, samples: CYCLE_ORDER.map(id=>({id,name:SAMPLE_NAMES[id]})) });
})();
