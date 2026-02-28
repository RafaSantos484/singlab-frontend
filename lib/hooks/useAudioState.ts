/**
 * useAudioState - Hook for syncing audio player state with HTMLAudioElement events
 *
 * Listens to media events (play, playing, pause, ended, timeupdate, ratechange)
 * and updates React state accordingly. Integrates with AudioManager for single-playback.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { audioManager } from '@/lib/audio/AudioManager';

interface UseAudioStateOptions {
  /** Unique ID for this player instance */
  playerId: string;
  /** The audio element to monitor */
  audioElement: HTMLAudioElement | null;
  /** Called when external play is detected (e.g., media key) */
  onStateChange?: (isPlaying: boolean) => void;
}

export interface AudioStateData {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isLoading: boolean;
}

/**
 * Hook that synchronizes React state with HTMLAudioElement events.
 *
 * Event-Driven Approach:
 * Instead of relying on click handlers to update state, this hook listens to
 * actual audio element events. This ensures the UI always reflects true state,
 * regardless of how playback was initiated (button click, media key, system
 * control, or external source).
 *
 * Events Monitored:
 * - play: Playback was initiated (fires before audio actually plays)
 * - playing: Actual playback has started (after buffering completes)
 * - pause: Playback was paused
 * - ended: Track finished playing
 * - timeupdate: Current playback position changed (fires frequently)
 * - loadedmetadata: Audio duration is known
 * - loadstart: Loading has started
 * - canplay: Audio has buffered enough to play
 * - ratechange: Playback speed changed
 *
 * Single Playback Rule:
 * Registers with AudioManager on mount. When this player fires 'play' event,
 * AudioManager automatically pauses all other registered players, ensuring only
 * one track plays at a time across the entire application.
 */
export function useAudioState({
  playerId,
  audioElement,
  onStateChange,
}: UseAudioStateOptions): AudioStateData {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const unregisterRef = useRef<(() => void) | null>(null);
  const prevAudioElementRef = useRef<HTMLAudioElement | null>(null);

  // Sync play/pause state with actual audio element state
  const syncPlayState = useCallback((): void => {
    if (!audioElement) return;
    const willPlay = !audioElement.paused;
    setIsPlaying(willPlay);
    onStateChange?.(willPlay);
  }, [audioElement, onStateChange]);

  // Setup event listeners and AudioManager registration
  useEffect(() => {
    if (!audioElement) {
      // If audio element is removed, unregister
      unregisterRef.current?.();
      unregisterRef.current = null;
      return;
    }

    // Only set up if we have a new audio element
    if (prevAudioElementRef.current === audioElement) {
      return;
    }

    // Clean up old listeners from previous element
    unregisterRef.current?.();

    // Register with AudioManager
    unregisterRef.current = audioManager.register(playerId, audioElement);
    prevAudioElementRef.current = audioElement;

    // -- Event Handlers --

    const handlePlay = (): void => {
      // play event fires when play() is called, but may not have started yet
      // Notify AudioManager to pause other players
      audioManager.onPlayStart(playerId);
      // Don't set playing yet; wait for 'playing' event to ensure it actually started
    };

    const handlePlaying = (): void => {
      // playing event fires when actual playback starts
      setIsPlaying(true);
      onStateChange?.(true);
    };

    const handlePause = (): void => {
      // pause event fires when pause() is called
      audioManager.onPlayStop(playerId);
      setIsPlaying(false);
      onStateChange?.(false);
    };

    const handleEnded = (): void => {
      // ended event fires when track finishes
      audioManager.onPlayStop(playerId);
      setIsPlaying(false);
      setCurrentTime(0);
      onStateChange?.(false);
    };

    const handleTimeUpdate = (): void => {
      setCurrentTime(audioElement.currentTime);
    };

    const handleLoadedMetadata = (): void => {
      setDuration(audioElement.duration);
      setIsLoading(false);
    };

    const handleLoadStart = (): void => {
      setIsLoading(true);
    };

    const handleCanPlay = (): void => {
      setIsLoading(false);
    };

    const handleRateChange = (): void => {
      // Playback rate changed - sync state in case UI needs to react
      syncPlayState();
    };

    // Attach listeners
    audioElement.addEventListener('play', handlePlay);
    audioElement.addEventListener('playing', handlePlaying);
    audioElement.addEventListener('pause', handlePause);
    audioElement.addEventListener('ended', handleEnded);
    audioElement.addEventListener('timeupdate', handleTimeUpdate);
    audioElement.addEventListener('loadedmetadata', handleLoadedMetadata);
    audioElement.addEventListener('loadstart', handleLoadStart);
    audioElement.addEventListener('canplay', handleCanPlay);
    audioElement.addEventListener('ratechange', handleRateChange);

    // Cleanup
    return (): void => {
      audioElement.removeEventListener('play', handlePlay);
      audioElement.removeEventListener('playing', handlePlaying);
      audioElement.removeEventListener('pause', handlePause);
      audioElement.removeEventListener('ended', handleEnded);
      audioElement.removeEventListener('timeupdate', handleTimeUpdate);
      audioElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audioElement.removeEventListener('loadstart', handleLoadStart);
      audioElement.removeEventListener('canplay', handleCanPlay);
      audioElement.removeEventListener('ratechange', handleRateChange);
    };
  }, [audioElement, playerId, onStateChange, syncPlayState]);

  return {
    isPlaying,
    currentTime,
    duration,
    isLoading,
  };
}
