import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomAudioPlayer } from '../CustomAudioPlayer';

describe('CustomAudioPlayer', () => {
  let mockPlay: jest.SpyInstance;
  let mockPause: jest.SpyInstance;

  beforeEach(() => {
    // Mock HTMLMediaElement methods
    mockPlay = jest
      .spyOn(window.HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve());
    mockPause = jest
      .spyOn(window.HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {});

    // Mock audio metadata
    Object.defineProperty(window.HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      value: 120,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const triggerAudioLoad = async (): Promise<void> => {
    const audio = document.querySelector('audio');
    if (audio) {
      await act(async () => {
        audio.dispatchEvent(new Event('loadedmetadata'));
        audio.dispatchEvent(new Event('canplay'));
      });
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
});
