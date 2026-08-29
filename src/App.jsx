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
import { ShushEngine } from './audioEngine';

const { Text } = Typography;
const BLACKOUT_DELAY = 6500;
const HOLD_DURATION = 800;
const SLEEP_FADE_DURATION = 60_000;

function savedVolume() {
  try {
    const value = Number(window.localStorage.getItem('shush-volume'));
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

  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [volume, setVolume] = useState(savedVolume);
  const [blackedOut, setBlackedOut] = useState(false);
  const [locked, setLocked] = useState(false);
  const [holdingLock, setHoldingLock] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [timerEndAt, setTimerEndAt] = useState(null);
  const [activityTick, setActivityTick] = useState(0);
  const [, setClockTick] = useState(0);

  const stopPlayback = useCallback(() => {
    window.clearTimeout(launchTimer.current);
    engine.current?.stop();
    engine.current = null;
    setPlaying(false);
    setLoading(false);
    setLaunching(false);
    setLocked(false);
    setBlackedOut(false);
  }, []);

  const startPlayback = useCallback(async () => {
    if (engine.current || loading) return;

    const nextEngine = new ShushEngine();
    nextEngine.setVolume(volume / 100);
    engine.current = nextEngine;
    setLoading(true);
    setLaunching(true);
    window.clearTimeout(launchTimer.current);
    launchTimer.current = window.setTimeout(() => setLaunching(false), 1250);

    try {
      await nextEngine.start();
      setPlaying(true);
      setActivityTick((tick) => tick + 1);
    } catch {
      window.clearTimeout(launchTimer.current);
      setLaunching(false);
      nextEngine.stop();
      engine.current = null;
    } finally {
      setLoading(false);
    }
  }, [loading, volume]);

  const togglePlayback = () => {
    if (suppressNextTap.current) {
      suppressNextTap.current = false;
      return;
    }
    if (locked || loading) return;
    if (playing) stopPlayback();
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
    setTimerEndAt(minutes ? Date.now() + minutes * 60_000 : null);
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
        engine.current = null;
        setPlaying(false);
        setLocked(false);
        setBlackedOut(false);
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
    mediaActions.current = { play: startPlayback, pause: stopPlayback };
  }, [startPlayback, stopPlayback]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return undefined;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'Shush',
      artist: 'Soft shushing & white noise',
      artwork: [{
        src: new URL(`${import.meta.env.BASE_URL}icon-512.png`, window.location.href).href,
        sizes: '512x512',
        type: 'image/png',
      }],
    });

    const handlers = {
      play: () => mediaActions.current.play?.(),
      pause: () => mediaActions.current.pause?.(),
      stop: () => mediaActions.current.pause?.(),
    };

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
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    }
  }, [playing]);

  useEffect(() => () => {
    window.clearTimeout(lockHoldTimer.current);
    window.clearTimeout(timerHoldTimer.current);
    window.clearTimeout(sleepTimer.current);
    window.clearTimeout(launchTimer.current);
    engine.current?.stop();
  }, []);

  const timerMinutes = timerEndAt
    ? Math.max(1, Math.ceil((timerEndAt - Date.now()) / 60_000))
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
            className={holdingLock ? 'play-button is-holding' : 'play-button'}
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
            </>
          )}
        </div>

        <div className="controls">
          <Text className="status" aria-live="polite">{status}</Text>
          <div className="sound-wave" aria-hidden="true">
            {Array.from({ length: 7 }, (_, index) => <span key={index} />)}
          </div>

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
