const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// iOS intentionally exposes media volume as read-only. Keeping playback on the
// native media element allows it to continue when the PWA is backgrounded.
export const SUPPORTS_SOFTWARE_VOLUME = !IS_IOS;
export const USE_NATIVE_MEDIA_CONTROLS = IS_IOS;

export class ShushEngine {
  constructor({ onPlaybackChange } = {}) {
    this.audio = null;
    this.fadingAudio = null;
    this.fadeFrame = null;
    this.fadeTimeout = null;
    this.fadeResolve = null;
    this.volume = 1;
    this.onPlaybackChange = onPlaybackChange;
    this.handlePlaying = () => this.onPlaybackChange?.(true);
    this.handlePause = () => this.onPlaybackChange?.(false);
  }

  attachEvents(audio) {
    audio.addEventListener('playing', this.handlePlaying);
    audio.addEventListener('pause', this.handlePause);
  }

  detachEvents(audio) {
    audio.removeEventListener('playing', this.handlePlaying);
    audio.removeEventListener('pause', this.handlePause);
  }

  async start() {
    const audio = new Audio(`${import.meta.env.BASE_URL}audio/soothing-shush.m4a`);
    audio.loop = true;
    audio.preload = 'auto';
    audio.playsInline = true;
    audio.volume = SUPPORTS_SOFTWARE_VOLUME ? 0 : 1;
    this.audio = audio;
    this.attachEvents(audio);

    if ('audioSession' in navigator) {
      try { navigator.audioSession.type = 'playback'; } catch { /* unsupported value */ }
    }

    try {
      await audio.play();
      if (SUPPORTS_SOFTWARE_VOLUME) this.fadeAudioTo(this.volume, 1200);
    } catch (error) {
      this.detachEvents(audio);
      audio.pause();
      this.audio = null;
      throw error;
    }
  }

  fadeAudioTo(target, duration) {
    if (!SUPPORTS_SOFTWARE_VOLUME || !this.audio) return;
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
    if (SUPPORTS_SOFTWARE_VOLUME && this.audio) this.fadeAudioTo(value, 120);
  }

  pause() {
    cancelAnimationFrame(this.fadeFrame);
    this.audio?.pause();
    return Promise.resolve();
  }

  async resume() {
    if (!this.audio) return;
    await this.audio.play();
    if (SUPPORTS_SOFTWARE_VOLUME) this.fadeAudioTo(this.volume, 280);
  }

  stop() {
    return this.fadeOutAndStop(450);
  }

  fadeOutAndStop(duration) {
    cancelAnimationFrame(this.fadeFrame);
    window.clearTimeout(this.fadeTimeout);
    this.fadeResolve?.();
    this.fadeResolve = null;

    const audio = this.audio || this.fadingAudio;
    if (!audio) return Promise.resolve();

    this.audio = null;
    this.fadingAudio = audio;

    return new Promise((resolve) => {
      this.fadeResolve = resolve;
      const finish = () => {
        this.detachEvents(audio);
        audio.pause();
        audio.currentTime = 0;
        if (this.fadingAudio === audio) this.fadingAudio = null;
        this.fadeResolve = null;
        resolve();
      };

      if (!SUPPORTS_SOFTWARE_VOLUME) {
        this.fadeTimeout = window.setTimeout(finish, duration);
        return;
      }

      const initial = audio.volume;
      const startedAt = performance.now();
      const fadeOut = (now) => {
        const progress = Math.min((now - startedAt) / duration, 1);
        audio.volume = initial * (1 - progress);
        if (progress < 1) this.fadeFrame = requestAnimationFrame(fadeOut);
        else finish();
      };
      this.fadeFrame = requestAnimationFrame(fadeOut);
    });
  }
}
