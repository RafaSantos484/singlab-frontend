/**
 * AudioManager - Singleton for global audio playback control
 *
 * Responsible for:
 * - Managing all audio players across the application
 * - Enforcing the "single active playback" rule
 * - Coordinating pause/resume across multiple players
 *
 * When one player starts playback (fires 'play' event), the manager
 * automatically pauses all other registered players. This ensures users
 * don't accidentally play multiple tracks simultaneously.
 *
 * Why Singleton Pattern:
 * A single, shared instance ensures all players are aware of each other.
 * Components register themselves when their audio element mounts and
 * unregister on unmount. The manager maintains a central registry and
 * coordinates all playback state changes.
 */

export interface AudioPlayerInstance {
  id: string;
  audioElement: HTMLAudioElement;
  pauseCallback: () => void;
}

class AudioManagerSingleton {
  private players = new Map<string, AudioPlayerInstance>();
  private currentlyPlaying: string | null = null;

  /**
   * Register an audio player with the manager.
   * Returns an unregister function for cleanup.
   */
  register(id: string, audioEl: HTMLAudioElement): () => void {
    const pauseCallback = (): void => {
      if (!audioEl.paused) {
        audioEl.pause();
      }
    };

    this.players.set(id, {
      id,
      audioElement: audioEl,
      pauseCallback,
    });

    // Return cleanup function
    return (): void => {
      this.players.delete(id);
      if (this.currentlyPlaying === id) {
        this.currentlyPlaying = null;
      }
    };
  }

  /**
   * Notify the manager that a player wants to play.
   * Pauses all other players.
   */
  onPlayStart(id: string): void {
    if (this.currentlyPlaying === id) {
      // Already the active playback
      return;
    }

    // Pause all other players
    for (const [playerId, player] of this.players) {
      if (playerId !== id && !player.audioElement.paused) {
        player.pauseCallback();
      }
    }

    this.currentlyPlaying = id;
  }

  /**
   * Notify the manager that a player has stopped.
   */
  onPlayStop(id: string): void {
    if (this.currentlyPlaying === id) {
      this.currentlyPlaying = null;
    }
  }

  /**
   * Get the currently playing player ID.
   */
  getCurrentlyPlaying(): string | null {
    return this.currentlyPlaying;
  }

  /**
   * Pause all active players. Useful for cleanup or emergency stop.
   */
  pauseAll(): void {
    for (const player of this.players.values()) {
      if (!player.audioElement.paused) {
        player.pauseCallback();
      }
    }
    this.currentlyPlaying = null;
  }

  /**
   * Debug: Get list of registered players.
   */
  getRegisteredPlayers(): string[] {
    return Array.from(this.players.keys());
  }
}

// Export singleton instance
export const audioManager = new AudioManagerSingleton();
