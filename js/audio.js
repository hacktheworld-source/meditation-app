/*
 * Still — audio engine.
 * Every sound is synthesized with the Web Audio API, so the app ships no audio files.
 * Bells are additive synthesis (inharmonic partials with slow beating), ambience is
 * generated noise baked into seamless loops, and everything shares one reverb.
 */
(function () {
  'use strict';

  let ctx = null;
  let master, bellBus, uiBus, ambBus, reverb;
  let bellVolume = 0.8;
  let ambientVolume = 0.5;
  const bufferCache = {};

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.4;
    master.connect(comp);
    comp.connect(ctx.destination);

    reverb = ctx.createConvolver();
    reverb.buffer = impulse(5, 2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.4;
    reverb.connect(wet);
    wet.connect(master);

    bellBus = ctx.createGain();
    bellBus.gain.value = bellVolume;
    bellBus.connect(master);
    bellBus.connect(reverb);

    uiBus = ctx.createGain();
    uiBus.gain.value = 0.5;
    uiBus.connect(master);
    const uiSend = ctx.createGain();
    uiSend.gain.value = 0.25;
    uiBus.connect(uiSend);
    uiSend.connect(reverb);

    ambBus = ctx.createGain();
    ambBus.gain.value = ambientVolume;
    ambBus.connect(master);

    return ctx;
  }

  function impulse(seconds, decay) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  /* ---------- Bells ---------- */

  // partials: [frequency ratio, amplitude, decay seconds]
  const BELLS = {
    bowl: {
      label: 'Singing bowl',
      f: 196,
      attack: 0.015,
      beat: 0.8,
      gain: 0.9,
      partials: [[1, 1, 12], [2.76, 0.5, 9], [5.4, 0.22, 5.5], [8.93, 0.1, 3.2], [13.34, 0.04, 1.8]],
      strike: { freq: 2400, q: 1.5, gain: 0.08, dur: 0.05 },
    },
    bell: {
      label: 'Temple bell',
      f: 262,
      attack: 0.004,
      beat: 0.45,
      gain: 0.75,
      partials: [
        [0.5, 0.35, 10], [1, 1, 7.5], [1.19, 0.45, 5.5], [1.56, 0.35, 4.5],
        [2, 0.3, 3.6], [2.51, 0.2, 2.8], [3.01, 0.12, 2], [4.17, 0.07, 1.4],
      ],
      strike: { freq: 3200, q: 2, gain: 0.12, dur: 0.03 },
    },
    gong: {
      label: 'Gong',
      f: 82,
      attack: 0.18,
      beat: 1.2,
      gain: 1,
      partials: [[1, 1, 14], [1.48, 0.7, 12], [2.03, 0.5, 10], [2.74, 0.35, 8], [3.41, 0.25, 6.5], [4.37, 0.15, 5], [5.63, 0.08, 3.5]],
      swell: { freq: 500, gain: 0.25, rise: 0.6, dur: 7 },
    },
    chime: {
      label: 'Chimes',
      attack: 0.003,
      beat: 0,
      gain: 0.45,
      notes: [{ f: 1046.5, at: 0, g: 1 }, { f: 1318.5, at: 0.22, g: 0.9 }, { f: 1568, at: 0.44, g: 0.85 }, { f: 2093, at: 0.72, g: 0.6 }],
      partials: [[1, 1, 3.8], [2.76, 0.22, 1.8], [5.4, 0.06, 0.9]],
    },
    tingsha: {
      label: 'Tingsha',
      f: 1480,
      attack: 0.002,
      beat: 3.5,
      gain: 0.5,
      notes: [{ at: 0, g: 1 }, { at: 0.03, g: 0.6, detune: 1.012 }],
      partials: [[1, 1, 5], [2.32, 0.4, 3], [3.93, 0.2, 1.8], [5.8, 0.08, 1]],
      strike: { freq: 6000, q: 1, gain: 0.06, dur: 0.02 },
    },
  };

  /**
   * Strike a bell `delay` seconds from now. Returns a handle with cancel().
   */
  function strike(type, delay, vol) {
    if (!init()) return null;
    const def = BELLS[type];
    if (!def) return null;
    delay = Math.max(0, delay || 0);
    vol = vol == null ? 1 : vol;

    const t0 = ctx.currentTime + delay + 0.02;
    const out = ctx.createGain();
    out.gain.value = 0.22 * def.gain * vol;
    out.connect(bellBus);

    const sources = [];
    let end = t0;
    const notes = def.notes || [{ at: 0, g: 1 }];

    notes.forEach(function (n) {
      const base = (n.f || def.f) * (n.detune || 1);
      const start = t0 + n.at;
      def.partials.forEach(function (p) {
        const ratio = p[0], amp = p[1] * n.g, decay = p[2];
        const beats = def.beat ? [-def.beat / 2, def.beat / 2] : [0];
        beats.forEach(function (b) {
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.value = base * ratio + b * Math.sqrt(ratio);
          const g = ctx.createGain();
          const a = amp / beats.length;
          g.gain.setValueAtTime(0.00001, start);
          g.gain.linearRampToValueAtTime(a, start + def.attack);
          g.gain.exponentialRampToValueAtTime(0.00001, start + def.attack + decay);
          o.connect(g);
          g.connect(out);
          o.start(start);
          o.stop(start + def.attack + decay + 0.05);
          sources.push(o);
          end = Math.max(end, start + def.attack + decay);
        });
      });

      if (def.strike) {
        const s = def.strike;
        const src = ctx.createBufferSource();
        src.buffer = noiseBurst();
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = s.freq;
        bp.Q.value = s.q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(s.gain * n.g, start);
        g.gain.exponentialRampToValueAtTime(0.00001, start + s.dur);
        src.connect(bp);
        bp.connect(g);
        g.connect(out);
        src.start(start);
        src.stop(start + s.dur + 0.02);
        sources.push(src);
      }
    });

    if (def.swell) {
      const s = def.swell;
      const src = ctx.createBufferSource();
      src.buffer = noiseBurst(s.dur + 1);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = s.freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.00001, t0);
      g.gain.linearRampToValueAtTime(s.gain, t0 + s.rise);
      g.gain.exponentialRampToValueAtTime(0.00001, t0 + s.dur);
      src.connect(lp);
      lp.connect(g);
      g.connect(out);
      src.start(t0);
      src.stop(t0 + s.dur + 0.1);
      sources.push(src);
    }

    let cancelled = false;
    return {
      time: t0,
      end: end,
      cancel: function () {
        if (cancelled) return;
        cancelled = true;
        const now = ctx.currentTime;
        try {
          out.gain.cancelScheduledValues(now);
          out.gain.setTargetAtTime(0, now, 0.08);
        } catch (e) { /* ignore */ }
        sources.forEach(function (s) {
          try { s.stop(now + 0.5); } catch (e) { /* already stopped */ }
        });
        setTimeout(function () { try { out.disconnect(); } catch (e) { /* ignore */ } }, 800);
      },
    };
  }

  function noiseBurst(seconds) {
    const key = 'burst' + (seconds || 0.2);
    if (bufferCache[key]) return bufferCache[key];
    const len = Math.floor(ctx.sampleRate * (seconds || 0.2));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    bufferCache[key] = buf;
    return buf;
  }

  /* ---------- Interface sounds ---------- */

  let lastTick = 0;
  function ui(kind) {
    if (!init()) return;
    const now = ctx.currentTime;
    if (kind === 'tick') {
      if (now - lastTick < 0.035) return;
      lastTick = now;
      // a soft wooden tick
      const src = ctx.createBufferSource();
      src.buffer = noiseBurst();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2100;
      bp.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.35, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
      src.connect(bp); bp.connect(g); g.connect(uiBus);
      src.start(now); src.stop(now + 0.05);
      return;
    }
    const tones = {
      tap: [[660, 0.12, 0.25]],
      toggle: [[880, 0.1, 0.2], [1320, 0.06, 0.2]],
      open: [[523, 0.09, 0.5], [784, 0.06, 0.6]],
      close: [[784, 0.07, 0.4], [523, 0.07, 0.5]],
      begin: [[392, 0.1, 1.4], [587, 0.07, 1.6], [784, 0.05, 1.8]],
      pause: [[587, 0.09, 0.7], [440, 0.08, 0.9]],
      resume: [[440, 0.08, 0.7], [587, 0.09, 0.9]],
      confirm: [[988, 0.06, 0.35]],
      soft: [[330, 0.12, 1.2]],
    };
    const set = tones[kind] || tones.tap;
    set.forEach(function (t, i) {
      const start = now + i * 0.07;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = t[0];
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.00001, start);
      g.gain.linearRampToValueAtTime(t[1], start + 0.008);
      g.gain.exponentialRampToValueAtTime(0.00001, start + t[2]);
      o.connect(g); g.connect(uiBus);
      o.start(start); o.stop(start + t[2] + 0.05);
    });
  }

  // A breath cue: a gentle swell up (inhale) or down (exhale).
  function breathCue(phase, seconds) {
    if (!init()) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = phase === 'in' ? 220 : phase === 'out' ? 247 : 196;
    const f1 = phase === 'in' ? 247 : phase === 'out' ? 196 : 196;
    o.frequency.setValueAtTime(f0, now);
    o.frequency.linearRampToValueAtTime(f1, now + seconds);
    const g = ctx.createGain();
    const peak = phase === 'hold' ? 0.02 : 0.05;
    g.gain.setValueAtTime(0.00001, now);
    g.gain.linearRampToValueAtTime(peak, now + Math.min(1, seconds / 3));
    g.gain.linearRampToValueAtTime(0.00001, now + seconds);
    o.connect(g); g.connect(uiBus);
    o.start(now); o.stop(now + seconds + 0.05);
  }

  /* ---------- Ambience ---------- */

  const AMBIENCE = {
    rain: 'Rain',
    ocean: 'Ocean',
    wind: 'Wind',
    brown: 'Brown noise',
    drone: 'Drone',
  };

  // Generates `seconds` of stereo audio and crossfades the tail into the head for a seamless loop.
  function makeLoop(key, seconds, fill) {
    if (bufferCache[key]) return bufferCache[key];
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const fade = Math.floor(rate * 1.5);
    const buf = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const raw = new Float32Array(len + fade);
      fill(raw, rate, c);
      for (let i = 0; i < fade; i++) {
        const x = i / fade;
        raw[i] = raw[i] * Math.sqrt(x) + raw[len + i] * Math.sqrt(1 - x);
      }
      buf.getChannelData(c).set(raw.subarray(0, len));
    }
    bufferCache[key] = buf;
    return buf;
  }

  function pink(d) {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }

  function brown(d) {
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }

  function lfo(freq, depth, offset, target) {
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g);
    g.connect(target);
    if (offset != null) target.value = offset;
    o.start();
    return o;
  }

  function buildAmbience(type, out) {
    const nodes = [];
    const loop = function (buf) {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start();
      nodes.push(s);
      return s;
    };

    if (type === 'rain') {
      const buf = makeLoop('rain', 12, function (d, rate) {
        pink(d);
        // bake in droplets: short bright blips scattered randomly
        const count = Math.floor((d.length / rate) * 40);
        for (let k = 0; k < count; k++) {
          const at = Math.floor(Math.random() * d.length);
          const f = 1800 + Math.random() * 4200;
          const amp = 0.05 + Math.random() * 0.18;
          const dur = Math.floor(rate * (0.004 + Math.random() * 0.01));
          for (let i = 0; i < dur && at + i < d.length; i++) {
            d[at + i] += Math.sin((2 * Math.PI * f * i) / rate) * amp * Math.exp(-i / (dur / 4));
          }
        }
      });
      const s = loop(buf);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7500;
      const g = ctx.createGain(); g.gain.value = 0.9;
      s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out);
    } else if (type === 'ocean') {
      const s = loop(makeLoop('brown', 20, brown));
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.4;
      const g = ctx.createGain();
      nodes.push(lfo(0.083, 450, 700, lp.frequency));
      nodes.push(lfo(0.083, 0.42, 0.62, g.gain));
      const hiss = loop(makeLoop('pink', 14, pink));
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
      const hg = ctx.createGain();
      nodes.push(lfo(0.083, 0.05, 0.05, hg.gain));
      s.connect(lp); lp.connect(g); g.connect(out);
      hiss.connect(hp); hp.connect(hg); hg.connect(out);
    } else if (type === 'wind') {
      const s = loop(makeLoop('pink', 14, pink));
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
      const g = ctx.createGain();
      nodes.push(lfo(0.047, 380, 700, bp.frequency));
      nodes.push(lfo(0.071, 0.35, 0.8, g.gain));
      s.connect(bp); bp.connect(g); g.connect(out);
    } else if (type === 'brown') {
      const s = loop(makeLoop('brown', 20, brown));
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = ctx.createGain(); g.gain.value = 0.9;
      s.connect(lp); lp.connect(g); g.connect(out);
    } else if (type === 'drone') {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
      nodes.push(lfo(0.03, 250, 650, lp.frequency));
      const g = ctx.createGain(); g.gain.value = 0.16;
      lp.connect(g); g.connect(out);
      [[73.42, 'sawtooth', 0.5], [110, 'sawtooth', 0.35], [146.83, 'triangle', 0.5], [220, 'triangle', 0.3], [293.66, 'sine', 0.18]]
        .forEach(function (v, i) {
          [-0.12, 0.12].forEach(function (det) {
            const o = ctx.createOscillator();
            o.type = v[1];
            o.frequency.value = v[0] + det * (i + 1);
            const vg = ctx.createGain(); vg.gain.value = v[2] / 2;
            o.connect(vg); vg.connect(lp);
            o.start();
            nodes.push(o);
          });
        });
      const send = ctx.createGain(); send.gain.value = 0.5;
      g.connect(send); send.connect(reverb);
    }
    return nodes;
  }

  let ambient = null; // { type, gain, nodes }

  function startAmbient(type, fade) {
    if (!init()) return;
    if (ambient && ambient.type === type && !ambient.stopping) {
      ambient.gain.gain.cancelScheduledValues(ctx.currentTime);
      ambient.gain.gain.setTargetAtTime(1, ctx.currentTime, 0.3);
      return;
    }
    stopAmbient(1.5);
    if (!type || !AMBIENCE[type]) return;
    const g = ctx.createGain();
    g.gain.value = 0.00001;
    g.connect(ambBus);
    const nodes = buildAmbience(type, g);
    g.gain.setTargetAtTime(1, ctx.currentTime, (fade == null ? 3 : fade) / 3);
    ambient = { type: type, gain: g, nodes: nodes };
  }

  function stopAmbient(fade) {
    if (!ambient || !ctx) return;
    const a = ambient;
    ambient = null;
    a.stopping = true;
    const f = fade == null ? 3 : fade;
    const now = ctx.currentTime;
    a.gain.gain.cancelScheduledValues(now);
    a.gain.gain.setTargetAtTime(0, now, f / 4);
    setTimeout(function () {
      a.nodes.forEach(function (n) { try { n.stop(); } catch (e) { /* ignore */ } });
      try { a.gain.disconnect(); } catch (e) { /* ignore */ }
    }, f * 1000 + 300);
  }

  function duckAmbient(level) {
    if (!ambient || !ctx) return;
    ambient.gain.gain.cancelScheduledValues(ctx.currentTime);
    ambient.gain.gain.setTargetAtTime(level, ctx.currentTime, 0.4);
  }

  function setBellVolume(v) {
    bellVolume = v;
    if (bellBus) bellBus.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
  }

  function setAmbientVolume(v) {
    ambientVolume = v;
    if (ambBus) ambBus.gain.setTargetAtTime(v, ctx.currentTime, 0.1);
  }

  window.StillAudio = {
    init: init,
    now: function () { return ctx ? ctx.currentTime : 0; },
    bells: Object.keys(BELLS).map(function (k) { return { id: k, label: BELLS[k].label }; }),
    ambience: Object.keys(AMBIENCE).map(function (k) { return { id: k, label: AMBIENCE[k] }; }),
    strike: strike,
    ui: ui,
    breathCue: breathCue,
    startAmbient: startAmbient,
    stopAmbient: stopAmbient,
    duckAmbient: duckAmbient,
    currentAmbient: function () { return ambient ? ambient.type : null; },
    setBellVolume: setBellVolume,
    setAmbientVolume: setAmbientVolume,
  };
})();
