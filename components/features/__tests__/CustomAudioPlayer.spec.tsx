/* @ts-nocheck */
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomAudioPlayer } from '../CustomAudioPlayer';

describe('CustomAudioPlayer', () => {
  let mockPlay: jest.SpyInstance;
  let mockPause: jest.SpyInstance;
  let audioElement: HTMLAudioElement | null;

  beforeEach(() => {
    // Mock HTMLMediaElement methods
    mockPlay = jest
      .spyOn(window.HTMLMediaElement.prototype, 'play')
      .mockImplementation(function (this: HTMLAudioElement) {
        // Set paused to false when play() is called
        Object.defineProperty(this, 'paused', {
          value: false,
          writable: true,
          configurable: true,
        });
        // Dispatch play and playing events
        setTimeout(() => {
          if (this) {
            this.dispatchEvent(new Event('play'));
            this.dispatchEvent(new Event('playing'));
          }
        }, 0);
        return Promise.resolve();
      });

    mockPause = jest
      .spyOn(window.HTMLMediaElement.prototype, 'pause')
      .mockImplementation(function (this: HTMLAudioElement) {
        // Set paused to true when pause() is called
        Object.defineProperty(this, 'paused', {
          value: true,
          writable: true,
          configurable: true,
        });
        // Dispatch pause event
        if (this) {
          this.dispatchEvent(new Event('pause'));
        }
      });

    // Mock paused property (default is true for unplaying audio)
    Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
      configurable: true,
      value: true,
    });

    // Mock currentTime (writable)
    Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      value: 0,
      writable: true,
    });

    // Mock duration (writable so tests can set it)
    Object.defineProperty(window.HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      value: 0,
      writable: true,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    audioElement = null;
  });

  const triggerAudioLoad = async (): Promise<void> => {
    const audio = document.querySelector('audio') as HTMLAudioElement;
    if (audio) {
      audioElement = audio;
      // Set duration directly on the instance
      audio.duration = 120;
      
      // Wait a micro-task for effects to run
      await new Promise(resolve => setTimeout(resolve, 0));
      
      await act(async () => {
        audio.dispatchEvent(new Event('loadstart'));
        audio.dispatchEvent(new Event('loadedmetadata'));
        audio.dispatchEvent(new Event('canplay'));
      });
      
      // Wait another micro-task for state updates
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  };

  it('renders correctly with default props', async () => {
    render(<CustomAudioPlayer src="https://example.com/audio.mp3" />);
    
    await triggerAudioLoad();
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /play/i })).not.toBeDisabled();
    });
    
    expect(screen.getByRole('slider', { name: /audio progress/i })).toBeInTheDocument();
  });

  it('displays custom aria label', () => {
    render(
      <CustomAudioPlayer 
        src="https://example.com/audio.mp3" 
        ariaLabel="Test Song Player"
      />
    );
    
    expect(screen.getByRole('region', { name: 'Test Song Player' })).toBeInTheDocument();
  });

  it('shows play button initially', async () => {
    render(<CustomAudioPlayer src="https://example.com/audio.mp3" />);
    
    await triggerAudioLoad();
    
    await waitFor(() => {
      const playButton = screen.getByRole('button', { name: /play/i });
      expect(playButton).toBeInTheDocument();
      expect(playButton).not.toBeDisabled();
    });
  });

  it('calls play when play button is clicked', async () => {
    const user = userEvent.setup();
    render(<CustomAudioPlayer src="https://example.com/audio.mp3" />);
    
    await triggerAudioLoad();
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /play/i })).not.toBeDisabled();
    });
    
    const playButton = screen.getByRole('button', { name: /play/i });
    await user.click(playButton);
    
    expect(mockPlay).toHaveBeenCalled();
  });

  it('updates UI when play event is triggered (reflects external controls)', async () => {
    render(<CustomAudioPlayer src="https://example.com/audio.mp3" />);
    
    await triggerAudioLoad();
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /play/i })).not.toBeDisabled();
    });

    // Initially should show Play button
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
    
    // Simulate external play (e.g., media key)
    const audio = audioElement || document.querySelector('audio');
    if (audio) {
      await act(async () => {
        Object.defineProperty(audio, 'paused', { value: false, configurable: true });
        audio.dispatchEvent(new Event('play'));
        audio.dispatchEvent(new Event('playing'));
      });
    }
    
    // Should now show Pause button
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();
    });
  });

  it('shows pause button when playing', async () => {
    const user = userEvent.setup();
    render(<CustomAudioPlayer src="https://example.com/audio.mp3" />);
    
    await triggerAudioLoad();
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /play/i })).not.toBeDisabled();
    });
    
    const playButton = screen.getByRole('button', { name: /play/i });
    await user.click(playButton);
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();
    });
  });

  it('calls pause when pause button is clicked', async () => {
    const user = userEvent.setup();
    render(<CustomAudioPlayer src="https://example.com/audio.mp3" />);
    
    await triggerAudioLoad();
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /play/i })).not.toBeDisabled();
    });
    
    // First, start playing
    const playButton = screen.getByRole('button', { name: /play/i });
    await user.click(playButton);
    
    // Then pause
    const pauseButton = await screen.findByRole('button', { name: /pause/i });
    await user.click(pauseButton);
    
    expect(mockPause).toHaveBeenCalled();
  });

  it('updates UI when pause event is triggered (reflects external controls)', async () => {
    const user = userEvent.setup();
    render(<CustomAudioPlayer src="https://example.com/audio.mp3" />);
    
    await triggerAudioLoad();
    
    // Start playing
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /play/i })).not.toBeDisabled();
    });
    
    const playButton = screen.getByRole('button', { name: /play/i });
    await user.click(playButton);
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();
    });
    
    // Simulate external pause (e.g., media key)
    const audio = audioElement || document.querySelector('audio');
    if (audio) {
      await act(async () => {
        Object.defineProperty(audio, 'paused', { value: true, configurable: true });
        audio.dispatchEvent(new Event('pause'));
      });
    }
    
    // Should now show Play button
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
    });
  });

  it('displays formatted time correctly', () => {
    render(<CustomAudioPlayer src="https://example.com/audio.mp3" />);
    
    // Initial times should be 0:00 (both current and total)
    const timeElements = screen.getAllByText('0:00');
    expect(timeElements).toHaveLength(2);
  });

  it('renders volume control on desktop', () => {
    render(<CustomAudioPlayer src="https://example.com/audio.mp3" />);
    
    // Volume slider should exist (though may be hidden on mobile via CSS)
    const volumeSlider = screen.getByRole('slider', { name: /volume/i });
    expect(volumeSlider).toBeInTheDocument();
  });

  it('renders mute button', () => {
    render(<CustomAudioPlayer src="https://example.com/audio.mp3" />);
    
    const muteButton = screen.getByRole('button', { name: /mute/i });
    expect(muteButton).toBeInTheDocument();
  });

  it('has accessible slider for progress', () => {
    render(<CustomAudioPlayer src="https://example.com/audio.mp3" />);
    
    const progressSlider = screen.getByRole('slider', { name: /audio progress/i });
    expect(progressSlider).toBeInTheDocument();
    expect(progressSlider).toHaveAttribute('aria-label', 'Audio progress');
  });

  it('disables controls when loading', () => {
    render(<CustomAudioPlayer src="https://example.com/audio.mp3" />);
    
    // Initially loading (before metadata loads)
    const playButton = screen.getByRole('button', { name: /play/i });
    expect(playButton).toBeDisabled();
  });

  it('handles audio source changes', async () => {
    const { rerender } = render(
      <CustomAudioPlayer src="https://example.com/audio1.mp3" />
    );
    
    await triggerAudioLoad();
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /play/i })).not.toBeDisabled();
    });
    
    rerender(<CustomAudioPlayer src="https://example.com/audio2.mp3" />);
    
    // Component should re-render with new source
    const audio = document.querySelector('audio');
    expect(audio?.src).toContain('audio2.mp3');
  });

  it('applies theme-consistent styling', () => {
    const { container } = render(
      <CustomAudioPlayer src="https://example.com/audio.mp3" />
    );
    
    // Check that the main container exists
    const playerContainer = container.firstChild;
    expect(playerContainer).toBeInTheDocument();
  });

  it('sets aria-pressed attribute correctly', async () => {
    const user = userEvent.setup();
    render(<CustomAudioPlayer src="https://example.com/audio.mp3" />);
    
    await triggerAudioLoad();
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /play/i })).not.toBeDisabled();
    });
    
    const button = screen.getByRole('button', { name: /play/i });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    
    // Click play
    await user.click(button);
    
    // After playing, aria-pressed should be true
    const pauseButton = await screen.findByRole('button', { name: /pause/i });
    expect(pauseButton).toHaveAttribute('aria-pressed', 'true');
  });
});
