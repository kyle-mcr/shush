import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CaretRightFilled,
  ClockCircleOutlined,
  LockOutlined,
  PauseOutlined,
  SoundOutlined,
  UnlockOutlined,
} from '@ant-design/icons';
import { Button, Drawer, Slider, Typography } from 'antd';
import {
  ShushEngine,
  SUPPORTS_SOFTWARE_VOLUME,
  USE_NATIVE_MEDIA_RESUME,
} from './audioEngine';

const { Text } = Typography;
const BLACKOUT_DELAY = 6500;
const HOLD_DURATION = 800;
const SLEEP_FADE_DURATION = 60_000;
const MOON_TEXTURE_URL = new URL(
  `${import.meta.env.BASE_URL}moon-texture.png`,
  window.location.href,
).href;
const MEDIA_ARTWORK_URL = new URL(
  `${import.meta.env.BASE_URL}web-app-manifest-512x512.png`,
  window.location.href,
).href;
const MEDIA_ICON_URL = new URL(
  `${import.meta.env.BASE_URL}web-app-manifest-192x192.png`,
  window.location.href,
).href;

function updateMediaMetadata() {
  if (!('mediaSession' in navigator) || !('MediaMetadata' in window)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: 'Shush',
    artist: 'Soft shushing & white noise',
    album: 'Night Sky',
    artwork: [
      { src: MEDIA_ICON_URL, sizes: '192x192', type: 'image/png' },
      { src: MEDIA_ARTWORK_URL, sizes: '512x512', type: 'image/png' },
    ],
  });
}

function updateExternalPlaybackState(isPlaying) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }
}

function savedVolume() {
  try {
    const saved = window.localStorage.getItem('shush-volume');
    if (saved === null) return 100;

    const value = Number(saved);
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : 100;
  } catch {
    return 100;
  }
}

export default function App() {
  const engine = useRef(null);
  const blackoutTimer = useRef(null);
  const lockHoldTimer = useRef(null);
  const timerHoldTimer = useRef(null);
  const sleepTimer = useRef(null);
  const launchTimer = useRef(null);
  const suppressNextTap = useRef(false);
  const mediaActions = useRef({});
  const wantsPlayback = useRef(false);
  const playbackTransition = useRef(null);
  const timerPausedAt = useRef(null);

  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [moonTextureReady, setMoonTextureReady] = useState(false);
  const [volume, setVolume] = useState(savedVolume);
  const [blackedOut, setBlackedOut] = useState(false);
  const [locked, setLocked] = useState(false);
  const [holdingLock, setHoldingLock] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [timerStartedAt, setTimerStartedAt] = useState(null);
  const [timerEndAt, setTimerEndAt] = useState(null);
  const [activityTick, setActivityTick] = useState(0);
  const [clockTick, setClockTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const texture = new Image();

    const revealTexture = async () => {
      try {
        await texture.decode?.();
      } catch {
        // A completed image is still safe to reveal when decode() is unavailable.
      }
      if (!cancelled) setMoonTextureReady(true);
    };

    texture.addEventListener('load', revealTexture, { once: true });
    texture.src = MOON_TEXTURE_URL;
    if (texture.complete && texture.naturalWidth) void revealTexture();

    return () => {
      cancelled = true;
      texture.removeEventListener('load', revealTexture);
    };
  }, []);

  const handleActualPlaybackChange = useCallback((isPlaying) => {
    if (isPlaying) {
      if (timerPausedAt.current) {
        const pausedFor = Date.now() - timerPausedAt.current;
        setTimerStartedAt((startedAt) => startedAt ? startedAt + pausedFor : null);
        setTimerEndAt((endAt) => endAt ? endAt + pausedFor : null);
        timerPausedAt.current = null;
      }
      wantsPlayback.current = true;
      updateExternalPlaybackState(true);
      setPlaying(true);
      setActivityTick((tick) => tick + 1);
      return;
    }

    if (!timerPausedAt.current) timerPausedAt.current = Date.now();
    wantsPlayback.current = false;
    updateExternalPlaybackState(false);
    setPlaying(false);
    setLoading(false);
    setLaunching(false);
    setLocked(false);
    setBlackedOut(false);
  }, []);

  const pausePlayback = useCallback(() => {
    wantsPlayback.current = false;
    if (!timerPausedAt.current) timerPausedAt.current = Date.now();
    window.clearTimeout(launchTimer.current);
    void engine.current?.pause();
    updateExternalPlaybackState(false);
    setPlaying(false);
    setLoading(false);
    setLaunching(false);
    setLocked(false);
    setBlackedOut(false);
  }, []);

  const startPlayback = useCallback(() => {
    if (wantsPlayback.current) return playbackTransition.current ?? Promise.resolve();
    wantsPlayback.current = true;
    if (playbackTransition.current) return playbackTransition.current;

    const request = (async () => {
      let activeEngine = engine.current;
      const isNewEngine = !activeEngine;

      if (!activeEngine) {
        activeEngine = new ShushEngine({ onPlaybackChange: handleActualPlaybackChange });
        activeEngine.setVolume(volume / 100);
        engine.current = activeEngine;
        setLaunching(true);
        window.clearTimeout(launchTimer.current);
        launchTimer.current = window.setTimeout(() => setLaunching(false), 1250);
      }

      setLoading(true);
      updateMediaMetadata();

      try {
        if (isNewEngine) await activeEngine.start();
        else await activeEngine.resume();

        if (!wantsPlayback.current) {
          await activeEngine.pause();
          return;
        }

        updateMediaMetadata();
        updateExternalPlaybackState(true);
        setPlaying(true);
        setActivityTick((tick) => tick + 1);
      } catch {
        wantsPlayback.current = false;
        window.clearTimeout(launchTimer.current);
        setLaunching(false);
        void activeEngine.stop();
        if (engine.current === activeEngine) engine.current = null;
        updateExternalPlaybackState(false);
      } finally {
        setLoading(false);
      }
    })();

    playbackTransition.current = request;
    void request.finally(() => {
      if (playbackTransition.current === request) playbackTransition.current = null;
    });
    return request;
  }, [handleActualPlaybackChange, volume]);

  const togglePlayback = () => {
    if (suppressNextTap.current) {
      suppressNextTap.current = false;
      return;
    }
    if (locked || loading) return;
    if (playing) pausePlayback();
    else startPlayback();
  };

  const registerActivity = () => {
    if (!playing) return;
    if (blackedOut) {
      suppressNextTap.current = true;
      window.setTimeout(() => { suppressNextTap.current = false; }, 350);
    }
    setBlackedOut(false);
    setActivityTick((tick) => tick + 1);
  };

  const changeVolume = (value) => {
    setVolume(value);
    engine.current?.setVolume(value / 100);
    try {
      window.localStorage.setItem('shush-volume', String(value));
    } catch {
      // Playback still works when storage is unavailable.
    }
  };

  const beginLockHold = (event) => {
    event.stopPropagation();
    window.clearTimeout(lockHoldTimer.current);
    setHoldingLock(true);
    lockHoldTimer.current = window.setTimeout(() => {
      setLocked((isLocked) => !isLocked);
      setHoldingLock(false);
      setBlackedOut(false);
      setActivityTick((tick) => tick + 1);
      suppressNextTap.current = true;
      window.setTimeout(() => { suppressNextTap.current = false; }, 350);
      if ('vibrate' in navigator) navigator.vibrate(25);
    }, HOLD_DURATION);
  };

  const cancelLockHold = () => {
    window.clearTimeout(lockHoldTimer.current);
    setHoldingLock(false);
  };

  const openTimer = () => {
    setTimerOpen(true);
    setBlackedOut(false);
  };

  const beginTimerHold = () => {
    window.clearTimeout(timerHoldTimer.current);
    timerHoldTimer.current = window.setTimeout(openTimer, 550);
  };

  const cancelTimerHold = () => window.clearTimeout(timerHoldTimer.current);

  const chooseTimer = (minutes) => {
    const now = Date.now();
    timerPausedAt.current = minutes && !playing ? now : null;
    setTimerStartedAt(minutes ? now : null);
    setTimerEndAt(minutes ? now + minutes * 60_000 : null);
    setTimerOpen(false);
    setActivityTick((tick) => tick + 1);
  };

  useEffect(() => {
    window.clearTimeout(blackoutTimer.current);
    if (playing && !timerOpen) {
      blackoutTimer.current = window.setTimeout(() => setBlackedOut(true), BLACKOUT_DELAY);
    }
    return () => window.clearTimeout(blackoutTimer.current);
  }, [playing, timerOpen, activityTick]);

  useEffect(() => {
    window.clearTimeout(sleepTimer.current);
    if (!timerEndAt || !playing || !engine.current) return undefined;

    const activeEngine = engine.current;
    const delay = Math.max(timerEndAt - Date.now() - SLEEP_FADE_DURATION, 0);
    sleepTimer.current = window.setTimeout(async () => {
      await activeEngine.fadeOutAndStop(SLEEP_FADE_DURATION);
      if (engine.current === activeEngine) {
        wantsPlayback.current = false;
        engine.current = null;
        updateExternalPlaybackState(false);
        setPlaying(false);
        setLocked(false);
        setBlackedOut(false);
        timerPausedAt.current = null;
        setTimerStartedAt(null);
        setTimerEndAt(null);
      }
    }, delay);

    return () => window.clearTimeout(sleepTimer.current);
  }, [playing, timerEndAt]);

  useEffect(() => {
    if (!timerEndAt) return undefined;
    const interval = window.setInterval(() => setClockTick((tick) => tick + 1), 30_000);
    return () => window.clearInterval(interval);
  }, [timerEndAt]);

  useEffect(() => {
    mediaActions.current = { play: startPlayback, pause: pausePlayback };
  }, [startPlayback, pausePlayback]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return undefined;

    updateMediaMetadata();

    const handlers = {
      pause: () => mediaActions.current.pause?.(),
      stop: () => mediaActions.current.pause?.(),
    };

    // In backgrounded iOS PWAs, native resume remains available while page
    // JavaScript may be suspended. Other platforms can use the custom handler.
    if (!USE_NATIVE_MEDIA_RESUME) {
      handlers.play = () => mediaActions.current.play?.();
    }

    Object.entries(handlers).forEach(([action, handler]) => {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported action */ }
    });

    return () => {
      Object.keys(handlers).forEach((action) => {
        try { navigator.mediaSession.setActionHandler(action, null); } catch { /* unsupported action */ }
      });
    };
  }, []);

  useEffect(() => {
    updateExternalPlaybackState(playing);
  }, [playing]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;

    try {
      if (!timerStartedAt || !timerEndAt) {
        navigator.mediaSession.setPositionState();
        return;
      }

      const now = !playing && timerPausedAt.current ? timerPausedAt.current : Date.now();
      const duration = Math.max((timerEndAt - timerStartedAt) / 1000, 1);
      const position = Math.min(
        Math.max((now - timerStartedAt) / 1000, 0),
        Math.max(duration - 0.01, 0),
      );
      navigator.mediaSession.setPositionState({ duration, playbackRate: 1, position });
    } catch {
      // Some older mobile browsers expose Media Session without position state.
    }
  }, [timerStartedAt, timerEndAt, playing, clockTick]);

  useEffect(() => () => {
    wantsPlayback.current = false;
    window.clearTimeout(lockHoldTimer.current);
    window.clearTimeout(timerHoldTimer.current);
    window.clearTimeout(sleepTimer.current);
    window.clearTimeout(launchTimer.current);
    engine.current?.stop();
  }, []);

  const timerNow = !playing && timerPausedAt.current ? timerPausedAt.current : Date.now();
  const timerMinutes = timerEndAt
    ? Math.max(1, Math.ceil((timerEndAt - timerNow) / 60_000))
    : null;
  const status = loading
    ? 'Loading'
    : locked
      ? 'Controls locked'
      : playing
        ? 'Shushing'
        : 'Tap to shush';
  const appClasses = [
    'app',
    playing && 'is-playing',
    launching && 'is-launching',
    blackedOut && 'is-blackout',
    locked && 'is-locked',
  ].filter(Boolean).join(' ');

  return (
    <main className={appClasses} onPointerDownCapture={registerActivity}>
      <div className="sky-background" aria-hidden="true">
        {Array.from({ length: 74 }, (_, index) => (
          <span
            className="page-star"
            key={index}
            style={{
              '--page-star-x': `${(index * 53 + 3) % 101}%`,
              '--page-star-y': `${(index * 79 + 5) % 97}%`,
              '--page-star-size': `${0.7 + (index % 4) * 0.45}px`,
              '--page-star-delay': `${-(index % 12) * 0.75}s`,
              '--page-star-speed': `${5 + (index % 7) * 0.8}s`,
            }}
          />
        ))}
        <span className="sky-streak sky-streak-one" />
        <span className="sky-streak sky-streak-two" />
      </div>
      <section className="player" aria-label="Shushing sound player">
        <div className="brand" aria-label="Shush">shush<span>.</span></div>

        <div className="sound-stage">
          <div className="pulse" aria-hidden="true">
            <span className="aura" />
            <span className="night-sky">
              {Array.from({ length: 42 }, (_, index) => (
                <span
                  className="star"
                  key={index}
                  style={{
                    '--star-x': `${(index * 37 + 11) % 97}%`,
                    '--star-y': `${(index * 61 + 7) % 93}%`,
                    '--star-size': `${1 + (index % 3) * 0.65}px`,
                    '--star-delay': `${-(index % 9) * 0.7}s`,
                    '--star-speed': `${4.5 + (index % 5) * 0.9}s`,
                  }}
                />
              ))}
              <span className="shooting-star shooting-star-one" />
              <span className="shooting-star shooting-star-two" />
              <span className="shooting-star shooting-star-three" />
            </span>
            <span className="ring ring-one" />
            <span className="ring ring-two" />
            <span className="ring ring-three" />
            <span className="orbit orbit-one" />
            <span className="orbit orbit-two" />
          </div>
          <div className="launch-effects" aria-hidden="true">
            <span className="launch-ring launch-ring-one" />
            <span className="launch-ring launch-ring-two" />
          </div>
          <Button
            type="primary"
            shape="circle"
            className={[
              'play-button',
              holdingLock && 'is-holding',
              moonTextureReady && 'is-texture-ready',
            ].filter(Boolean).join(' ')}
            style={{ '--moon-texture': `url("${MOON_TEXTURE_URL}")` }}
            icon={locked
              ? <LockOutlined />
              : (
                <span className="moon-icons" aria-hidden="true">
                  <CaretRightFilled className="moon-icon moon-icon-play" />
                  <PauseOutlined className="moon-icon moon-icon-pause" />
                </span>
              )}
            onClick={togglePlayback}
            onPointerDown={locked ? beginLockHold : undefined}
            onPointerUp={locked ? cancelLockHold : undefined}
            onPointerLeave={locked ? cancelLockHold : undefined}
            onContextMenu={(event) => event.preventDefault()}
            aria-label={locked
              ? 'Press and hold to unlock controls'
              : playing
                ? 'Pause shushing sound'
                : 'Play shushing sound'}
            aria-pressed={playing}
          />
        </div>

        <div className="utility-controls">
          {playing && (
            <>
              <Button
                type="text"
                className="utility-button"
                icon={<ClockCircleOutlined />}
                onClick={openTimer}
                onPointerDown={beginTimerHold}
                onPointerUp={cancelTimerHold}
                onPointerLeave={cancelTimerHold}
                aria-label={timerMinutes ? `Sleep timer, ${timerMinutes} minutes remaining` : 'Open sleep timer'}
              >
                {timerMinutes ? `${timerMinutes} min` : 'Timer'}
              </Button>
              <Button
                type="text"
                className={holdingLock ? 'utility-button is-holding' : 'utility-button'}
                icon={locked ? <LockOutlined /> : <UnlockOutlined />}
                onPointerDown={beginLockHold}
                onPointerUp={cancelLockHold}
                onPointerLeave={cancelLockHold}
                onContextMenu={(event) => event.preventDefault()}
                aria-label={locked ? 'Press and hold to unlock controls' : 'Press and hold to lock controls'}
              >
                {locked ? 'Hold to unlock' : 'Hold to lock'}
              </Button>
            </>
          )}
        </div>

        <div className="controls">
          <Text className="status" aria-live="polite">{status}</Text>
          <div className="sound-wave" aria-hidden="true">
            {Array.from({ length: 7 }, (_, index) => <span key={index} />)}
          </div>

          {SUPPORTS_SOFTWARE_VOLUME && (
            <div className="volume-control">
              <SoundOutlined aria-hidden="true" />
              <Slider
                min={0}
                max={100}
                value={volume}
                onChange={changeVolume}
                disabled={locked}
                tooltip={{ formatter: (value) => `${value}%` }}
                aria-label="Volume"
              />
            </div>
          )}
        </div>
      </section>

      <Drawer
        title="Sleep timer"
        placement="bottom"
        height="auto"
        open={timerOpen}
        onClose={() => setTimerOpen(false)}
        rootClassName="timer-drawer"
      >
        <div className="timer-options">
          {[10, 20, 30, 60].map((minutes) => (
            <Button
              key={minutes}
              size="large"
              type={timerMinutes === minutes ? 'primary' : 'default'}
              onClick={() => chooseTimer(minutes)}
            >
              {minutes} minutes
            </Button>
          ))}
          {timerEndAt && (
            <Button type="text" danger onClick={() => chooseTimer(null)}>Turn timer off</Button>
          )}
          <Text className="timer-note">Sound fades gently during the final minute.</Text>
        </div>
      </Drawer>
    </main>
  );
}
