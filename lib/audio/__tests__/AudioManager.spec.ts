/* @ts-nocheck */
/**
 * Tests for AudioManager - Global playback control
 */

import { audioManager } from '../AudioManager';

describe('AudioManager', () => {
  let mockAudio1: HTMLAudioElement;
  let mockAudio2: HTMLAudioElement;
  let mockAudio3: HTMLAudioElement;

  beforeEach(() => {
    // Create mock audio elements
    mockAudio1 = {
      paused: true,
      pause: jest.fn(),
      dispatchEvent: jest.fn(),
    } as unknown as HTMLAudioElement;

    mockAudio2 = {
      paused: true,
      pause: jest.fn(),
      dispatchEvent: jest.fn(),
    } as unknown as HTMLAudioElement;

    mockAudio3 = {
      paused: true,
      pause: jest.fn(),
      dispatchEvent: jest.fn(),
    } as unknown as HTMLAudioElement;
  });

  it('registers audio players', () => {
    const unregister1 = audioManager.register('player-1', mockAudio1);
    const unregister2 = audioManager.register('player-2', mockAudio2);

    expect(audioManager.getRegisteredPlayers()).toContain('player-1');
    expect(audioManager.getRegisteredPlayers()).toContain('player-2');

    unregister1();
    unregister2();
  });

  it('enforces single active playback - pauses other players', () => {
    const unregister1 = audioManager.register('player-1', mockAudio1);
    const unregister2 = audioManager.register('player-2', mockAudio2);

    // Simulate player 1 starting playback
    mockAudio1.paused = false;
    audioManager.onPlayStart('player-1');

    expect(audioManager.getCurrentlyPlaying()).toBe('player-1');

    // Simulate player 2 starting playback - should pause player 1
    mockAudio2.paused = false;
    audioManager.onPlayStart('player-2');

    // Player 1 should have been paused
    expect(mockAudio1.pause).toHaveBeenCalled();
    expect(audioManager.getCurrentlyPlaying()).toBe('player-2');

    unregister1();
    unregister2();
  });

  it('does not pause player if it is not playing', () => {
    const unregister1 = audioManager.register('player-1', mockAudio1);
    const unregister2 = audioManager.register('player-2', mockAudio2);

    // Player 1 not playing
    mockAudio1.paused = true;

    // Player 2 starts playing
    mockAudio2.paused = false;
    audioManager.onPlayStart('player-2');

    // Player 1 should not have been paused (it was already paused)
    expect(mockAudio1.pause).not.toHaveBeenCalled();

    unregister1();
    unregister2();
  });

  it('tracks currently playing player', () => {
    const unregister1 = audioManager.register('player-1', mockAudio1);
    const unregister2 = audioManager.register('player-2', mockAudio2);

    expect(audioManager.getCurrentlyPlaying()).toBeNull();

    mockAudio1.paused = false;
    audioManager.onPlayStart('player-1');
    expect(audioManager.getCurrentlyPlaying()).toBe('player-1');

    mockAudio2.paused = false;
    audioManager.onPlayStart('player-2');
    expect(audioManager.getCurrentlyPlaying()).toBe('player-2');

    audioManager.onPlayStop('player-2');
    expect(audioManager.getCurrentlyPlaying()).toBeNull();

    unregister1();
    unregister2();
  });

  it('pauses all players with pauseAll', () => {
    const unregister1 = audioManager.register('player-1', mockAudio1);
    const unregister2 = audioManager.register('player-2', mockAudio2);
    const unregister3 = audioManager.register('player-3', mockAudio3);

    mockAudio1.paused = false;
    mockAudio2.paused = false;
    mockAudio3.paused = false;

    audioManager.pauseAll();

    expect(mockAudio1.pause).toHaveBeenCalled();
    expect(mockAudio2.pause).toHaveBeenCalled();
    expect(mockAudio3.pause).toHaveBeenCalled();
    expect(audioManager.getCurrentlyPlaying()).toBeNull();

    unregister1();
    unregister2();
    unregister3();
  });

  it('cleans up on unregister', () => {
    const unregister1 = audioManager.register('player-1', mockAudio1);
    const unregister2 = audioManager.register('player-2', mockAudio2);

    expect(audioManager.getRegisteredPlayers().length).toBe(2);

    unregister1();
    expect(audioManager.getRegisteredPlayers()).not.toContain('player-1');
    expect(audioManager.getRegisteredPlayers()).toContain('player-2');

    unregister2();
    expect(audioManager.getRegisteredPlayers().length).toBe(0);
  });

  it('clears currently playing on unregister', () => {
    const unregister1 = audioManager.register('player-1', mockAudio1);

    mockAudio1.paused = false;
    audioManager.onPlayStart('player-1');
    expect(audioManager.getCurrentlyPlaying()).toBe('player-1');

    unregister1();
    expect(audioManager.getCurrentlyPlaying()).toBeNull();
  });
});
