import {
  emitGlobalPlayerSnapshot,
  requestPracticeInstrumentalEnabled,
  requestPracticeMode,
  requestPracticePlaying,
  subscribeGlobalPlayerSnapshots,
  subscribePracticeCommands,
  type PracticeCommand,
} from '@/lib/player/practiceSync';

describe('practiceSync', () => {
  it('delivers snapshots to active subscribers only', () => {
    const listenerA = jest.fn<void, [{ songId: string }]>();
    const listenerB = jest.fn<void, [{ songId: string }]>();

    const unsubscribeA = subscribeGlobalPlayerSnapshots(
      listenerA as (snapshot: Parameters<typeof listenerA>[0]) => void,
    );
    subscribeGlobalPlayerSnapshots(
      listenerB as (snapshot: Parameters<typeof listenerB>[0]) => void,
    );

    emitGlobalPlayerSnapshot({
      songId: 'song-1',
      mode: 'separated',
      isPlaying: true,
      isLoaded: true,
      currentTime: 12,
      duration: 180,
    });

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);

    unsubscribeA();

    emitGlobalPlayerSnapshot({
      songId: 'song-1',
      mode: 'raw',
      isPlaying: false,
      isLoaded: true,
      currentTime: 0,
      duration: 180,
    });

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(2);
  });

  it('emits typed practice commands in request order', () => {
    const received: PracticeCommand[] = [];

    const unsubscribe = subscribePracticeCommands((command) => {
      received.push(command);
    });

    requestPracticeMode('song-2');
    requestPracticeInstrumentalEnabled('song-2', true);
    requestPracticePlaying('song-2', false);

    expect(received).toEqual([
      { type: 'practice-start', songId: 'song-2' },
      {
        type: 'practice-set-instrumental',
        songId: 'song-2',
        enabled: true,
      },
      {
        type: 'practice-set-playing',
        songId: 'song-2',
        playing: false,
      },
    ]);

    unsubscribe();
  });

  it('stops receiving commands after unsubscribe', () => {
    const listener = jest.fn<void, [PracticeCommand]>();

    const unsubscribe = subscribePracticeCommands(listener);
    requestPracticeMode('song-3');

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    requestPracticePlaying('song-3', true);

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
