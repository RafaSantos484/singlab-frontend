export type PlayerMode = 'raw' | 'separated';

export interface GlobalPlayerSnapshot {
  songId: string;
  mode: PlayerMode;
  isPlaying: boolean;
  isLoaded: boolean;
  currentTime: number;
  duration: number;
}

export interface PracticeStartCommand {
  type: 'practice-start';
  songId: string;
}

export interface PracticeSetInstrumentalCommand {
  type: 'practice-set-instrumental';
  songId: string;
  enabled: boolean;
}

export interface PracticeSetPlayingCommand {
  type: 'practice-set-playing';
  songId: string;
  playing: boolean;
}

export type PracticeCommand =
  | PracticeStartCommand
  | PracticeSetInstrumentalCommand
  | PracticeSetPlayingCommand;

export interface PracticeDialogOpenRequest {
  songId: string;
}

type SnapshotSubscriber = (snapshot: GlobalPlayerSnapshot) => void;
type CommandSubscriber = (command: PracticeCommand) => void;
type PracticeDialogOpenSubscriber = (
  request: PracticeDialogOpenRequest,
) => void;

const snapshotSubscribers = new Set<SnapshotSubscriber>();
const commandSubscribers = new Set<CommandSubscriber>();
const practiceDialogOpenSubscribers = new Set<PracticeDialogOpenSubscriber>();

/**
 * Subscribes to global player state snapshots emitted by GlobalPlayer.
 */
export function subscribeGlobalPlayerSnapshots(
  listener: SnapshotSubscriber,
): () => void {
  snapshotSubscribers.add(listener);
  return (): void => {
    snapshotSubscribers.delete(listener);
  };
}

/**
 * Emits a player state snapshot to all active subscribers.
 */
export function emitGlobalPlayerSnapshot(snapshot: GlobalPlayerSnapshot): void {
  snapshotSubscribers.forEach((listener) => {
    listener(snapshot);
  });
}

/**
 * Subscribes to commands targeting GlobalPlayer behavior.
 */
export function subscribePracticeCommands(
  listener: CommandSubscriber,
): () => void {
  commandSubscribers.add(listener);
  return (): void => {
    commandSubscribers.delete(listener);
  };
}

/**
 * Requests GlobalPlayer to enter separated instrumental practice mode.
 */
export function requestPracticeMode(songId: string): void {
  const command: PracticeStartCommand = {
    type: 'practice-start',
    songId,
  };

  commandSubscribers.forEach((listener) => {
    listener(command);
  });
}

/**
 * Requests GlobalPlayer to enable or disable the instrumental backing mix.
 */
export function requestPracticeInstrumentalEnabled(
  songId: string,
  enabled: boolean,
): void {
  const command: PracticeSetInstrumentalCommand = {
    type: 'practice-set-instrumental',
    songId,
    enabled,
  };

  commandSubscribers.forEach((listener) => {
    listener(command);
  });
}

/**
 * Requests GlobalPlayer to pause or resume playback from Practice mode.
 */
export function requestPracticePlaying(songId: string, playing: boolean): void {
  const command: PracticeSetPlayingCommand = {
    type: 'practice-set-playing',
    songId,
    playing,
  };

  commandSubscribers.forEach((listener) => {
    listener(command);
  });
}

/**
 * Subscribes to requests to open Practice dialog for a song.
 */
export function subscribePracticeDialogOpenRequests(
  listener: PracticeDialogOpenSubscriber,
): () => void {
  practiceDialogOpenSubscribers.add(listener);
  return (): void => {
    practiceDialogOpenSubscribers.delete(listener);
  };
}

/**
 * Requests opening Practice dialog for the provided song.
 */
export function requestPracticeDialogOpen(songId: string): void {
  const request: PracticeDialogOpenRequest = { songId };

  practiceDialogOpenSubscribers.forEach((listener) => {
    listener(request);
  });
}
