import { __testUtils } from '../SingingPracticeDialog';

interface DetectionInput {
  frequency: number;
  confidence: number;
}

function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

describe('SingingPracticeDialog helper regressions', () => {
  it('selectFftSize returns a power-of-two size that supports low-frequency analysis', () => {
    const fftSize = __testUtils.selectFftSize(48_000);

    expect(fftSize).toBe(2048);
    expect((fftSize & (fftSize - 1)) === 0).toBe(true);
  });

  it('appendPitchPoint enforces monotonic timestamps', () => {
    const points: Array<{ time: number; midi: number | null }> = [
      { time: 1, midi: 60 },
    ];

    __testUtils.appendPitchPoint(points, { time: 1, midi: 61 });

    expect(points).toHaveLength(2);
    expect(points[1]?.time).toBeGreaterThan(points[0]?.time ?? 0);
    expect(points[1]?.midi).toBe(61);
  });

  it('findClosestPointByTime skips null midi points and finds nearest valid point', () => {
    const points = [
      { time: 10, midi: 60 },
      { time: 10.2, midi: null },
      { time: 10.35, midi: 62 },
      { time: 11.1, midi: 64 },
    ];

    const nearest = __testUtils.findClosestPointByTime(points, 10.3, 9.5);

    expect(nearest).toEqual({ time: 10.35, midi: 62 });
  });

  it('stabilizePitch drops very low confidence detections', () => {
    const state = __testUtils.createPitchTrackProcessorState();

    const result = __testUtils.stabilizePitch(
      state,
      {
        frequency: midiToFrequency(60),
        confidence: 0.2,
      } satisfies DetectionInput,
      1000,
    );

    expect(result).toBeNull();
    expect(state.lastSmoothedMidi).toBeNull();
  });

  it('stabilizePitch resists one-frame transients and then ramps toward sustained jumps', () => {
    const state = __testUtils.createPitchTrackProcessorState();

    const base = __testUtils.stabilizePitch(
      state,
      {
        frequency: midiToFrequency(60),
        confidence: 0.9,
      } satisfies DetectionInput,
      1000,
    );

    const transientFrame = __testUtils.stabilizePitch(
      state,
      {
        frequency: midiToFrequency(72),
        confidence: 0.7,
      } satisfies DetectionInput,
      1014,
    );

    const sustainedJump = __testUtils.stabilizePitch(
      state,
      {
        frequency: midiToFrequency(72),
        confidence: 0.7,
      } satisfies DetectionInput,
      1028,
    );

    expect(base).not.toBeNull();
    expect(transientFrame).toBeCloseTo(base ?? 0, 4);
    expect(sustainedJump).toBeGreaterThan(transientFrame ?? 0);
    expect(sustainedJump).toBeLessThan(66);
  });
});
