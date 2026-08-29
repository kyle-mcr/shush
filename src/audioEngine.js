class ProceduralShushEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.sources = [];
    this.timer = null;
    this.volume = 1;
  }

  async start() {
    if (this.context) return;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
    this.context = context;

    const master = context.createGain();
    master.gain.setValueAtTime(0, context.currentTime);
    master.gain.linearRampToValueAtTime(this.volume, context.currentTime + 1.4);
    master.connect(context.destination);
    this.master = master;

    const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
    const samples = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.985 + white * 0.015;
      samples[i] = white * 0.72 + last * 1.4;
    }

    const background = context.createBufferSource();
    const backgroundFilter = context.createBiquadFilter();
    const backgroundGain = context.createGain();
    background.buffer = buffer;
    background.loop = true;
    backgroundFilter.type = 'lowpass';
    backgroundFilter.frequency.value = 1200;
    backgroundGain.gain.value = 0.11;
    background.connect(backgroundFilter).connect(backgroundGain).connect(master);
    background.start();
    this.sources.push(background);

    const shush = context.createBufferSource();
    const shushFilter = context.createBiquadFilter();
    const shushGain = context.createGain();
    shush.buffer = buffer;
    shush.loop = true;
    shushFilter.type = 'bandpass';
    shushFilter.frequency.value = 3600;
    shushFilter.Q.value = 0.48;
    shushGain.gain.value = 0.02;
    shush.connect(shushFilter).connect(shushGain).connect(master);
    shush.start(0, 1.37);
    this.sources.push(shush);

    const scheduleBreath = () => {
      if (!this.context) return;
      const now = context.currentTime;
      const duration = 2.7 + Math.random() * 0.5;
      shushGain.gain.cancelScheduledValues(now);
      shushGain.gain.setValueAtTime(Math.max(shushGain.gain.value, 0.02), now);
      shushGain.gain.linearRampToValueAtTime(0.38, now + duration * 0.18);
      shushGain.gain.setValueAtTime(0.38, now + duration * 0.68);
      shushGain.gain.exponentialRampToValueAtTime(0.02, now + duration);
      shushFilter.frequency.setValueAtTime(3200 + Math.random() * 800, now);
      this.timer = window.setTimeout(scheduleBreath, duration * 1000);
    };
    scheduleBreath();
    await context.resume();
  }

  setVolume(value) {
    this.volume = value;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(value, this.context.currentTime, 0.08);
    }
  }

  pause() {
    return this.context?.suspend() ?? Promise.resolve();
  }

  resume() {
    return this.context?.resume() ?? Promise.resolve();
  }

  stop() {
    void this.fadeOutAndStop(450);
  }

  fadeOutAndStop(duration) {
    if (!this.context) return;
    window.clearTimeout(this.timer);
    const context = this.context;
    const master = this.master;
    this.master.gain.cancelScheduledValues(context.currentTime);
    this.master.gain.setValueAtTime(this.master.gain.value, context.currentTime);
    this.master.gain.linearRampToValueAtTime(0, context.currentTime + duration / 1000);
    this.context = null;
    this.master = null;
    this.sources = [];
    return new Promise((resolve) => {
      window.setTimeout(() => {
        master.disconnect();
        context.close();
        resolve();
      }, duration + 50);
    });
  }
}

export class ShushEngine {
  constructor() {
    this.audio = null;
    this.fadingAudio = null;
    this.fallback = null;
    this.context = null;
    this.source = null;
    this.gain = null;
    this.fadeFrame = null;
    this.fadeResolve = null;
    this.volume = 1;
  }

  async start() {
    const audio = new Audio(`${import.meta.env.BASE_URL}audio/soothing-shush.m4a`);
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 1;
    this.audio = audio;

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        const context = new AudioContext();
        const source = context.createMediaElementSource(audio);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, context.currentTime);
        source.connect(gain).connect(context.destination);
        this.context = context;
        this.source = source;
        this.gain = gain;
        await context.resume();
      } else {
        audio.volume = 0;
      }

      await audio.play();
      this.fadeAudioTo(this.volume, 1200);
    } catch {
      audio.pause();
      this.source?.disconnect();
      this.gain?.disconnect();
      void this.context?.close();
      this.audio = null;
      this.context = null;
      this.source = null;
      this.gain = null;
      const fallback = new ProceduralShushEngine();
      fallback.setVolume(this.volume);
      this.fallback = fallback;
      await fallback.start();
    }
  }

  fadeAudioTo(target, duration) {
    if (this.gain && this.context) {
      const now = this.context.currentTime;
      const parameter = this.gain.gain;
      if ('cancelAndHoldAtTime' in parameter) {
        parameter.cancelAndHoldAtTime(now);
      } else {
        const current = parameter.value;
        parameter.cancelScheduledValues(now);
        parameter.setValueAtTime(current, now);
      }
      parameter.linearRampToValueAtTime(target, now + duration / 1000);
      return;
    }

    if (!this.audio) return;
    cancelAnimationFrame(this.fadeFrame);
    const audio = this.audio;
    const initial = audio.volume;
    const startedAt = performance.now();

    const update = (now) => {
      if (this.audio !== audio) return;
      const progress = Math.min((now - startedAt) / duration, 1);
      audio.volume = initial + (target - initial) * progress;
      if (progress < 1) this.fadeFrame = requestAnimationFrame(update);
    };
    this.fadeFrame = requestAnimationFrame(update);
  }

  setVolume(value) {
    this.volume = value;
    if (this.audio) this.fadeAudioTo(value, 120);
    this.fallback?.setVolume(value);
  }

  async pause() {
    cancelAnimationFrame(this.fadeFrame);

    if (this.gain && this.context) {
      const now = this.context.currentTime;
      this.gain.gain.cancelScheduledValues(now);
      this.gain.gain.setValueAtTime(0, now);
    }

    this.audio?.pause();
    await this.context?.suspend();
    await this.fallback?.pause();
  }

  async resume() {
    if (this.fallback) {
      await this.fallback.resume();
      return;
    }
    if (!this.audio) return;

    await this.context?.resume();
    await this.audio.play();
    this.fadeAudioTo(this.volume, 280);
  }

  stop() {
    return this.fadeOutAndStop(450);
  }

  fadeOutAndStop(duration) {
    cancelAnimationFrame(this.fadeFrame);
    this.fadeResolve?.();
    this.fadeResolve = null;

    if (this.fallback) {
      const fallback = this.fallback;
      this.fallback = null;
      return fallback.fadeOutAndStop(duration) ?? Promise.resolve();
    }

    const audio = this.audio || this.fadingAudio;
    if (!audio) return Promise.resolve();

    this.audio = null;
    this.fadingAudio = audio;
    const context = this.context;
    const source = this.source;
    const gain = this.gain;
    this.context = null;
    this.source = null;
    this.gain = null;

    if (context && gain) {
      const now = context.currentTime;
      const parameter = gain.gain;
      if ('cancelAndHoldAtTime' in parameter) {
        parameter.cancelAndHoldAtTime(now);
      } else {
        const current = parameter.value;
        parameter.cancelScheduledValues(now);
        parameter.setValueAtTime(current, now);
      }
      parameter.linearRampToValueAtTime(0, now + duration / 1000);

      return new Promise((resolve) => {
        this.fadeResolve = resolve;
        window.setTimeout(() => {
          audio.pause();
          audio.currentTime = 0;
          source?.disconnect();
          gain.disconnect();
          void context.close();
          if (this.fadingAudio === audio) this.fadingAudio = null;
          this.fadeResolve = null;
          resolve();
        }, duration + 50);
      });
    }

    const initial = audio.volume;
    const startedAt = performance.now();

    return new Promise((resolve) => {
      this.fadeResolve = resolve;
      const finish = () => {
        audio.pause();
        audio.currentTime = 0;
        if (this.fadingAudio === audio) this.fadingAudio = null;
        this.fadeResolve = null;
        resolve();
      };

      const fadeOut = (now) => {
        const progress = Math.min((now - startedAt) / duration, 1);
        audio.volume = initial * (1 - progress);
        if (progress < 1) {
          this.fadeFrame = requestAnimationFrame(fadeOut);
        } else {
          finish();
        }
      };

      this.fadeFrame = requestAnimationFrame(fadeOut);
    });
  }
}
