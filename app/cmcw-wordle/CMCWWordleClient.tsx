'use client';

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import {
  CMCW_DAILY_BY_DATE,
  CMCW_WORDLE_END_DATE,
  CMCW_WORDLE_START_DATE,
  CMCW_WORDLE_TIME_ZONE,
  CMCW_WORDS_BY_DATE,
  getCmcwWordleConfigIssues,
} from './words';

type TileState = 'correct' | 'present' | 'absent';

function dateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const month = parts.find((p) => p.type === 'month')?.value ?? '00';
  const day = parts.find((p) => p.type === 'day')?.value ?? '00';
  return `${year}-${month}-${day}`;
}

function scoreGuess(guess: string, answer: string): TileState[] {
  const g = guess.toUpperCase().split('');
  const a = answer.toUpperCase().split('');
  const result: TileState[] = Array.from({ length: 5 }, () => 'absent');

  const remaining: Record<string, number> = {};
  for (let i = 0; i < 5; i++) {
    if (g[i] === a[i]) {
      result[i] = 'correct';
    } else {
      remaining[a[i]] = (remaining[a[i]] ?? 0) + 1;
    }
  }

  for (let i = 0; i < 5; i++) {
    if (result[i] === 'correct') continue;
    const letter = g[i];
    if ((remaining[letter] ?? 0) > 0) {
      result[i] = 'present';
      remaining[letter] -= 1;
    }
  }

  return result;
}

function betterLetterState(prev: TileState | undefined, next: TileState): TileState {
  if (!prev) return next;
  if (prev === 'correct') return prev;
  if (prev === 'present' && next === 'absent') return prev;
  if (prev === 'absent' && (next === 'present' || next === 'correct')) return next;
  if (prev === 'present' && next === 'correct') return next;
  return prev;
}

function emojiFor(state: TileState) {
  if (state === 'correct') return '🟩';
  if (state === 'present') return '🟨';
  return '⬜';
}

type GameState = 'playing' | 'won' | 'lost';

function tileFaceClasses(state: TileState | null) {
  const base = 'wordle-tile-face flex items-center justify-center rounded-lg border text-lg font-semibold select-none';
  if (!state) return `${base} bg-white border-[#E8E6E1] text-[#5D4A2F]`;
  if (state === 'correct') return `${base} bg-[#7CB342] border-[#7CB342] text-white`;
  if (state === 'present') return `${base} bg-[#D6B85A] border-[#D6B85A] text-white`;
  return `${base} bg-[#9CA3AF] border-[#9CA3AF] text-white`;
}

function renderBodyWithBoldAnswer(body: string, answer: string) {
  const safe = answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${safe}\\b`, 'gi');
  const parts = body.split(re);
  const matches = body.match(re) ?? [];

  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]) nodes.push(parts[i]);
    const m = matches[i];
    if (m) nodes.push(<strong key={`ans-${i}`}>{m}</strong>);
  }
  return nodes;
}

function normalizeGuess(value: string) {
  return value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
}

type SavedSnapshot = { guesses: string[]; state: GameState };

function parseSavedRaw(raw: string | null): SavedSnapshot {
  if (!raw) return { guesses: [], state: 'playing' };
  try {
    const parsed = JSON.parse(raw) as { guesses?: unknown; state?: unknown };
    const guesses = Array.isArray(parsed.guesses)
      ? parsed.guesses
          .filter((g): g is string => typeof g === 'string')
          .map(normalizeGuess)
          .filter((g) => g.length === 5)
          .slice(0, 6)
      : [];
    const state: GameState = parsed.state === 'won' || parsed.state === 'lost' ? parsed.state : 'playing';
    return { guesses, state };
  } catch {
    return { guesses: [], state: 'playing' };
  }
}

type SavedSettings = { hardMode: boolean };

function parseSettingsRaw(raw: string | null): SavedSettings {
  if (!raw) return { hardMode: false };
  try {
    const parsed = JSON.parse(raw) as { hardMode?: unknown };
    return { hardMode: parsed.hardMode === true };
  } catch {
    return { hardMode: false };
  }
}

function writeSavedSettings(storageKey: string, next: SavedSettings | null) {
  if (typeof window === 'undefined') return;
  try {
    if (next) window.localStorage.setItem(storageKey, JSON.stringify(next));
    else window.localStorage.removeItem(storageKey);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event('cmcw-wordle:storage'));
}

function nthPosition(n: number) {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

type HardConstraints = {
  greenPositions: Array<string | null>;
  minCounts: Map<string, number>;
};

function buildHardConstraints(guesses: string[], evaluatedGuesses: TileState[][]): HardConstraints {
  const greenPositions: Array<string | null> = Array.from({ length: 5 }, () => null);
  const minCounts = new Map<string, number>();

  for (let i = 0; i < guesses.length; i++) {
    const guess = guesses[i];
    const scored = evaluatedGuesses[i];
    const perGuessCounts = new Map<string, number>();

    for (let j = 0; j < 5; j++) {
      const letter = guess[j];
      const state = scored[j];
      if (state === 'correct') greenPositions[j] = letter;
      if (state === 'correct' || state === 'present') {
        perGuessCounts.set(letter, (perGuessCounts.get(letter) ?? 0) + 1);
      }
    }

    for (const [letter, count] of perGuessCounts.entries()) {
      minCounts.set(letter, Math.max(minCounts.get(letter) ?? 0, count));
    }
  }

  return { greenPositions, minCounts };
}

function validateHardModeGuess(guess: string, constraints: HardConstraints): string | null {
  for (let i = 0; i < 5; i++) {
    const required = constraints.greenPositions[i];
    if (required && guess[i] !== required) {
      return `Hard mode: ${nthPosition(i + 1)} letter must be ${required}.`;
    }
  }

  for (const [letter, requiredCount] of constraints.minCounts.entries()) {
    let countInGuess = 0;
    for (const ch of guess) if (ch === letter) countInGuess += 1;
    if (countInGuess < requiredCount) {
      return requiredCount === 1
        ? `Hard mode: guess must include ${letter}.`
        : `Hard mode: guess must include ${letter} ${requiredCount} times.`;
    }
  }

  return null;
}

function useSavedGameRaw(storageKey: string, enabled: boolean) {
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (typeof window === 'undefined') return () => {};
    const handler = () => onStoreChange();
    window.addEventListener('storage', handler);
    window.addEventListener('cmcw-wordle:storage', handler as EventListener);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('cmcw-wordle:storage', handler as EventListener);
    };
  }, []);

  const getSnapshot = useCallback(() => {
    if (!enabled) return '';
    return window.localStorage.getItem(storageKey) ?? '';
  }, [enabled, storageKey]);
  const getServerSnapshot = useCallback(() => '', []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function writeSavedGame(storageKey: string, next: SavedSnapshot | null) {
  if (typeof window === 'undefined') return;
  try {
    if (next) window.localStorage.setItem(storageKey, JSON.stringify(next));
    else window.localStorage.removeItem(storageKey);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event('cmcw-wordle:storage'));
}

function DayGame({
  todayKey,
  dayNumber,
  answer,
  canPlay,
}: {
  todayKey: string;
  dayNumber: number | null;
  answer: string;
  canPlay: boolean;
}) {
  const settingsKey = useMemo(() => 'cmcw-wordle:settings', []);
  const settingsRaw = useSavedGameRaw(settingsKey, true);
  const settings = useMemo(() => parseSettingsRaw(settingsRaw), [settingsRaw]);
  const hardModeEnabled = settings.hardMode;
  const storageKey = useMemo(() => `cmcw-wordle:v2:${todayKey}`, [todayKey]);
  const savedRaw = useSavedGameRaw(storageKey, canPlay);
  const saved = useMemo(() => parseSavedRaw(savedRaw), [savedRaw]);
  const guesses = saved.guesses;
  const gameState = saved.state;
  const [current, setCurrent] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const messageTimerRef = useRef<number | null>(null);
  const shakeTimeoutRef = useRef<number | null>(null);
  const revealTimersRef = useRef<number[]>([]);
  const popTimeoutRef = useRef<number | null>(null);
  const popOutTimeoutRef = useRef<number | null>(null);
  const danceTimeoutRef = useRef<number | null>(null);
  const animIdRef = useRef(0);
  const [shakeAnim, setShakeAnim] = useState<{ row: number; id: number } | null>(null);
  const [popAnim, setPopAnim] = useState<{ row: number; col: number; id: number } | null>(null);
  const [popOutAnim, setPopOutAnim] = useState<{ row: number; col: number; id: number } | null>(null);
  const [danceAnim, setDanceAnim] = useState<{ row: number; id: number } | null>(null);
  const [revealRow, setRevealRow] = useState<number | null>(null);
  const [revealProgress, setRevealProgress] = useState(5);
  const pendingOutcomeRef = useRef<{ outcome: GameState | null; answer: string } | null>(null);
  const isRevealing = revealRow !== null;
  const [isResultPopupOpen, setIsResultPopupOpen] = useState(false);
  const [resultPopupOutcome, setResultPopupOutcome] = useState<GameState | null>(null);
  const [resultPopupTries, setResultPopupTries] = useState<number | null>(null);
  const winPopup = CMCW_DAILY_BY_DATE[todayKey] ?? null;

  const clearRevealTimers = () => {
    for (const id of revealTimersRef.current) window.clearTimeout(id);
    revealTimersRef.current = [];
  };

  useEffect(() => {
    return () => {
      if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
      if (shakeTimeoutRef.current) window.clearTimeout(shakeTimeoutRef.current);
      clearRevealTimers();
      if (popTimeoutRef.current) window.clearTimeout(popTimeoutRef.current);
      if (popOutTimeoutRef.current) window.clearTimeout(popOutTimeoutRef.current);
      if (danceTimeoutRef.current) window.clearTimeout(danceTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    setIsResultPopupOpen(false);
    setResultPopupOutcome(null);
    setResultPopupTries(null);
  }, [storageKey]);

  const setTimedMessage = useCallback((text: string) => {
    setMessage(text);
    if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    messageTimerRef.current = window.setTimeout(() => setMessage(null), 2000);
  }, []);

  const evaluatedGuesses = useMemo(() => guesses.map((g) => scoreGuess(g, answer)), [answer, guesses]);
  const hardConstraints = useMemo(() => buildHardConstraints(guesses, evaluatedGuesses), [evaluatedGuesses, guesses]);

  const letterStates = useMemo(() => {
    const map = new Map<string, TileState>();
    for (let i = 0; i < guesses.length; i++) {
      const guess = guesses[i];
      const scored = evaluatedGuesses[i];
      let colsToApply = 5;
      if (revealRow !== null) {
        if (i < revealRow) colsToApply = 5;
        else if (i === revealRow) colsToApply = Math.max(0, Math.min(5, revealProgress));
        else colsToApply = 0;
      }
      for (let j = 0; j < colsToApply; j++) {
        const letter = guess[j];
        const next = scored[j];
        map.set(letter, betterLetterState(map.get(letter), next));
      }
    }
    return map;
  }, [evaluatedGuesses, guesses, revealProgress, revealRow]);

  const submitGuess = useCallback(() => {
    if (!canPlay) return;
    if (gameState !== 'playing') return;
    if (isRevealing) return;

    const guess = current.toUpperCase();
    if (guess.length !== 5) {
      const id = (animIdRef.current += 1);
      setShakeAnim({ row: guesses.length, id });
      if (shakeTimeoutRef.current) window.clearTimeout(shakeTimeoutRef.current);
      shakeTimeoutRef.current = window.setTimeout(() => {
        setShakeAnim((prev) => (prev?.id === id ? null : prev));
      }, 520);
      setTimedMessage('Enter 5 letters.');
      return;
    }

    if (hardModeEnabled && guesses.length > 0) {
      const issue = validateHardModeGuess(guess, hardConstraints);
      if (issue) {
        const id = (animIdRef.current += 1);
        setShakeAnim({ row: guesses.length, id });
        if (shakeTimeoutRef.current) window.clearTimeout(shakeTimeoutRef.current);
        shakeTimeoutRef.current = window.setTimeout(() => {
          setShakeAnim((prev) => (prev?.id === id ? null : prev));
        }, 520);
        setTimedMessage(issue);
        return;
      }
    }

    const nextGuesses = [...guesses, guess];
    setCurrent('');

    const rowIndex = nextGuesses.length - 1;
    pendingOutcomeRef.current = {
      outcome: guess === answer ? 'won' : nextGuesses.length >= 6 ? 'lost' : null,
      answer,
    };

    writeSavedGame(storageKey, { guesses: nextGuesses, state: 'playing' });

    clearRevealTimers();
    setRevealRow(rowIndex);
    setRevealProgress(0);

    for (let i = 0; i < 5; i++) {
      const t = window.setTimeout(() => {
        setRevealProgress(i + 1);
      }, i * 120 + 260);
      revealTimersRef.current.push(t);
    }

    const finish = window.setTimeout(() => {
      setRevealProgress(5);
      setRevealRow(null);

      const pending = pendingOutcomeRef.current;
      if (!pending?.outcome) return;

      if (pending.outcome === 'won') {
        writeSavedGame(storageKey, { guesses: nextGuesses, state: 'won' });
        setTimedMessage('Nice! You got it.');
        if (winPopup) {
          setResultPopupOutcome('won');
          setResultPopupTries(nextGuesses.length);
          setIsResultPopupOpen(true);
        }
        const id = (animIdRef.current += 1);
        setDanceAnim({ row: rowIndex, id });
        if (danceTimeoutRef.current) window.clearTimeout(danceTimeoutRef.current);
        danceTimeoutRef.current = window.setTimeout(() => {
          setDanceAnim((prev) => (prev?.id === id ? null : prev));
        }, 1400);
      } else if (pending.outcome === 'lost') {
        writeSavedGame(storageKey, { guesses: nextGuesses, state: 'lost' });
        setTimedMessage(`Answer: ${pending.answer}`);
        if (winPopup) {
          setResultPopupOutcome('lost');
          setResultPopupTries(null);
          setIsResultPopupOpen(true);
        }
      }
    }, 4 * 120 + 620);
    revealTimersRef.current.push(finish);

  }, [answer, canPlay, current, gameState, guesses, hardConstraints, hardModeEnabled, isRevealing, setTimedMessage, storageKey, winPopup]);

  const handleKey = useCallback(
    (key: string) => {
      if (!canPlay) return;
      if (gameState !== 'playing') return;
      if (isRevealing) return;

      if (key === 'ENTER') {
        submitGuess();
        return;
      }
      if (key === 'BACKSPACE') {
        setCurrent((c) => {
          if (c.length === 0) return c;
          const id = (animIdRef.current += 1);
          setPopOutAnim({ row: guesses.length, col: c.length - 1, id });
          if (popOutTimeoutRef.current) window.clearTimeout(popOutTimeoutRef.current);
          popOutTimeoutRef.current = window.setTimeout(() => {
            setPopOutAnim((prev) => (prev?.id === id ? null : prev));
          }, 160);
          return c.slice(0, -1);
        });
        return;
      }
      if (/^[A-Z]$/.test(key)) {
        setCurrent((c) => {
          if (c.length >= 5) return c;
          const next = c + key;
          const id = (animIdRef.current += 1);
          setPopAnim({ row: guesses.length, col: next.length - 1, id });
          if (popTimeoutRef.current) window.clearTimeout(popTimeoutRef.current);
          popTimeoutRef.current = window.setTimeout(() => {
            setPopAnim((prev) => (prev?.id === id ? null : prev));
          }, 160);
          return next;
        });
      }
    },
    [canPlay, gameState, guesses.length, isRevealing, submitGuess],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleKey('ENTER');
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        handleKey('BACKSPACE');
        return;
      }
      const k = e.key.toUpperCase();
      if (/^[A-Z]$/.test(k)) handleKey(k);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleKey]);

  const resetToday = useCallback(() => {
    setCurrent('');
    setMessage(null);
    writeSavedGame(storageKey, null);
  }, [storageKey]);

  const copyShare = useCallback(async () => {
    const tries = gameState === 'won' ? guesses.length : 'X';
    const mode = hardModeEnabled ? 'Hard Mode' : 'Normal Mode';
    const header = `CMCW Wordle ${dayNumber ?? '?'} / 5 — ${tries} / 6 (${mode})`;
    const grid = evaluatedGuesses.map((row) => row.map(emojiFor).join('')).join('\n');
    const text = `${header}\n${grid}\n(muircollegecouncil.org)`;
    try {
      await navigator.clipboard.writeText(text);
      setTimedMessage('Copied!');
    } catch {
      setTimedMessage('Copy failed.');
    }
  }, [dayNumber, evaluatedGuesses, gameState, guesses.length, hardModeEnabled, setTimedMessage]);

  const keyboardRows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

  return (
    <div className="flex flex-col items-center gap-5">
      {isResultPopupOpen && winPopup && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="CMCW Wordle message"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white border border-[#E8E6E1] shadow-xl p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-[#5D4A2F]">CMCW</h2>
                {resultPopupOutcome === 'won' ? (
                  <p className="text-sm text-gray-600 mt-1">
                    You got the word in <span className="font-semibold text-[#5D4A2F]">{resultPopupTries}</span> tries.
                    <span className="ml-1">({hardModeEnabled ? 'Hard Mode' : 'Normal Mode'})</span>
                  </p>
                ) : resultPopupOutcome === 'lost' ? (
                  <p className="text-sm text-gray-600 mt-1">
                    Maybe next time! <span className="ml-1">({hardModeEnabled ? 'Hard Mode' : 'Normal Mode'})</span>
                  </p>
                ) : (
                  <p className="text-sm text-gray-500 mt-1">{todayKey}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsResultPopupOpen(false)}
                className="text-gray-500 hover:text-gray-700 rounded-md px-2 py-1"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 text-gray-700 whitespace-pre-line">
              {renderBodyWithBoldAnswer(winPopup.winPopupBody.trimEnd(), answer)}
              {resultPopupOutcome === 'lost' && (
                <>
                  {'\n\n'}
                  The word was <strong>{answer}</strong>.
                </>
              )}
            </div>

            <div className="mt-5 flex flex-wrap gap-3 justify-end">
              <Button variant="outline" onClick={() => setIsResultPopupOpen(false)}>
                Close
              </Button>
              <Button asChild>
                <a href={winPopup.moreInfoUrl} target="_blank" rel="noopener noreferrer">
                  Open {winPopup.moreInfoHandle}
                </a>
              </Button>
            </div>
          </div>
        </div>
      )}
      <div className="w-full flex items-center justify-between">
        <div className="text-sm text-gray-600">
          <span>
            Today: <span className="font-medium text-[#5D4A2F]">{todayKey}</span>
            {dayNumber ? <span className="ml-2 text-gray-500">(Day {dayNumber} of 5)</span> : null}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={resetToday} disabled={!canPlay || guesses.length === 0}>
            Reset
          </Button>
          <Button
            variant={hardModeEnabled ? 'default' : 'outline'}
            onClick={() => {
              if (guesses.length > 0) return;
              writeSavedSettings(settingsKey, { hardMode: !hardModeEnabled });
              setTimedMessage(!hardModeEnabled ? 'Hard mode on.' : 'Hard mode off.');
            }}
            disabled={!canPlay || guesses.length > 0}
            aria-pressed={hardModeEnabled}
            title={guesses.length > 0 ? 'Hard mode can only be changed before your first guess.' : 'Toggle hard mode.'}
          >
            Hard Mode
          </Button>
          <Button onClick={copyShare} disabled={!canPlay || (gameState !== 'won' && gameState !== 'lost')}>
            Share
          </Button>
        </div>
      </div>

      <div className="min-h-6 text-sm text-gray-700">{message}</div>

      <div className="grid grid-rows-6 gap-2">
        {Array.from({ length: 6 }).map((_, rowIndex) => {
          const committedGuess = guesses[rowIndex];
          const isActiveRow = rowIndex === guesses.length && gameState === 'playing';
          const rowText = committedGuess ?? (isActiveRow ? current : '');
          const letters = rowText.padEnd(5, ' ').slice(0, 5).split('');
          const shakeId = shakeAnim?.row === rowIndex ? shakeAnim.id : 0;
          const danceId = danceAnim?.row === rowIndex ? danceAnim.id : 0;
          const isRevealRow = committedGuess && revealRow === rowIndex;
          const scored = committedGuess ? scoreGuess(committedGuess, answer) : null;

          return (
            <div
              key={`${rowIndex}-${shakeId}`}
              className={`grid grid-cols-5 gap-2 ${shakeId ? 'wordle-row-shake' : ''}`}
            >
              {letters.map((ch, i) => {
                const tileState = scored ? scored[i] : null;
                const display = ch === ' ' ? '' : ch;
                const popId = popAnim?.row === rowIndex && popAnim.col === i ? popAnim.id : 0;
                const popOutId = popOutAnim?.row === rowIndex && popOutAnim.col === i ? popOutAnim.id : 0;
                const tileKey = `${rowIndex}-${i}-${popId}-${popOutId}-${danceId}`;
                const flipDelay = isRevealRow ? `${i * 120}ms` : '0ms';
                const danceDelay = `${i * 80}ms`;
                const shouldFlip = !!committedGuess;
                const wrapperClasses = [
                  'w-12 h-12 sm:w-14 sm:h-14 wordle-tile-3d',
                  shouldFlip ? 'wordle-tile-flipped' : '',
                  popId ? 'wordle-tile-pop' : '',
                  popOutId ? 'wordle-tile-pop-out' : '',
                  danceId ? 'wordle-tile-dance' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <div
                    key={tileKey}
                    className={wrapperClasses}
                    style={
                      ({
                        ['--flip-delay' as string]: flipDelay,
                        ['--dance-delay' as string]: danceDelay,
                      } as CSSProperties)
                    }
                    aria-label={display || 'empty'}
                  >
                    <div className="wordle-tile-inner">
                      <div className={tileFaceClasses(null)}>{display}</div>
                      <div className={`${tileFaceClasses(tileState)} wordle-tile-back`}>{display}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="w-full max-w-xl">
        <div className="space-y-2">
          <div className="flex gap-1.5 justify-center">
            {keyboardRows[0].split('').map((k) => {
              const st = letterStates.get(k);
              const cls =
                st === 'correct'
                  ? 'bg-[#7CB342] text-white'
                  : st === 'present'
                    ? 'bg-[#D6B85A] text-white'
                    : st === 'absent'
                      ? 'bg-[#9CA3AF] text-white'
                      : 'bg-[#FAF7F2] text-[#5D4A2F] border border-[#E8E6E1]';
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => handleKey(k)}
                  disabled={!canPlay || gameState !== 'playing' || isRevealing}
                  className={`h-11 w-9 sm:w-10 rounded-md text-sm font-semibold transition-colors disabled:opacity-60 ${cls}`}
                >
                  {k}
                </button>
              );
            })}
          </div>
          <div className="flex gap-1.5 justify-center">
            {keyboardRows[1].split('').map((k) => {
              const st = letterStates.get(k);
              const cls =
                st === 'correct'
                  ? 'bg-[#7CB342] text-white'
                  : st === 'present'
                    ? 'bg-[#D6B85A] text-white'
                    : st === 'absent'
                      ? 'bg-[#9CA3AF] text-white'
                      : 'bg-[#FAF7F2] text-[#5D4A2F] border border-[#E8E6E1]';
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => handleKey(k)}
                  disabled={!canPlay || gameState !== 'playing' || isRevealing}
                  className={`h-11 w-9 sm:w-10 rounded-md text-sm font-semibold transition-colors disabled:opacity-60 ${cls}`}
                >
                  {k}
                </button>
              );
            })}
          </div>
          <div className="flex gap-1.5 justify-center">
            <button
              type="button"
              onClick={() => handleKey('ENTER')}
              disabled={!canPlay || gameState !== 'playing' || isRevealing}
              className="h-11 px-3 rounded-md text-sm font-semibold bg-[#5D4A2F] text-white disabled:opacity-60"
            >
              Enter
            </button>
            {keyboardRows[2].split('').map((k) => {
              const st = letterStates.get(k);
              const cls =
                st === 'correct'
                  ? 'bg-[#7CB342] text-white'
                  : st === 'present'
                    ? 'bg-[#D6B85A] text-white'
                    : st === 'absent'
                      ? 'bg-[#9CA3AF] text-white'
                      : 'bg-[#FAF7F2] text-[#5D4A2F] border border-[#E8E6E1]';
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => handleKey(k)}
                  disabled={!canPlay || gameState !== 'playing' || isRevealing}
                  className={`h-11 w-9 sm:w-10 rounded-md text-sm font-semibold transition-colors disabled:opacity-60 ${cls}`}
                >
                  {k}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => handleKey('BACKSPACE')}
              disabled={!canPlay || gameState !== 'playing' || isRevealing}
              className="h-11 px-3 rounded-md text-sm font-semibold bg-[#5D4A2F] text-white disabled:opacity-60"
              aria-label="Backspace"
            >
              ⌫
            </button>
          </div>
        </div>

        <div className="mt-4 text-center text-xs text-gray-500">
          <span>Tip: Type on your keyboard or tap the letters. Only valid Wordle words are accepted.</span>
        </div>
      </div>
    </div>
  );
}

export function CMCWWordleClient() {
  const configIssues = useMemo(() => getCmcwWordleConfigIssues(), []);
  const [todayKey, setTodayKey] = useState(() => dateKeyInTimeZone(new Date(), CMCW_WORDLE_TIME_ZONE));

  const inEventRange = todayKey >= CMCW_WORDLE_START_DATE && todayKey <= CMCW_WORDLE_END_DATE;
  const activeKey =
    todayKey < CMCW_WORDLE_START_DATE ? CMCW_WORDLE_START_DATE : todayKey > CMCW_WORDLE_END_DATE ? CMCW_WORDLE_END_DATE : todayKey;
  const answer = CMCW_WORDS_BY_DATE[activeKey] ?? null;
  const canPlay = !!answer && configIssues.length === 0;

  const sortedKeys = useMemo(() => Object.keys(CMCW_WORDS_BY_DATE).sort(), []);
  const dayIndex = sortedKeys.indexOf(activeKey);
  const dayNumber = dayIndex >= 0 ? dayIndex + 1 : null;

  useEffect(() => {
    const id = window.setInterval(() => {
      const next = dateKeyInTimeZone(new Date(), CMCW_WORDLE_TIME_ZONE);
      setTodayKey((prev) => (prev === next ? prev : next));
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-8">
        <h1 className="text-[#5D4A2F] text-3xl sm:text-4xl font-semibold tracking-tight">CMCW Wordle</h1>
        <p className="text-gray-600 mt-3">Celebrating Muir College Week Wordle. One word per day, March 2–6, 2026 (PT).</p>
      </div>

      {configIssues.length > 0 && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <div className="font-semibold mb-1">CMCW Wordle configuration issue</div>
          <ul className="list-disc pl-5 space-y-1">
            {configIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {!inEventRange && configIssues.length === 0 && answer && (
        <div className="mb-6 rounded-xl border border-[#E8E6E1] bg-white px-4 py-3 text-sm text-gray-700">
          <span className="font-medium text-[#5D4A2F]">Preview mode:</span> showing the word for <span className="font-medium">{activeKey}</span> (PT).
        </div>
      )}

      {canPlay && answer ? (
        <DayGame key={activeKey} todayKey={activeKey} dayNumber={dayNumber} answer={answer} canPlay={canPlay} />
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="text-sm text-gray-600">
            Today: <span className="font-medium text-[#5D4A2F]">{todayKey}</span>
          </div>
          <div className="text-center text-xs text-gray-500">
            Unable to load today’s Wordle. Please check back soon.
          </div>
        </div>
      )}
    </div>
  );
}
