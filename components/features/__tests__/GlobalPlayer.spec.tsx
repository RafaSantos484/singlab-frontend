import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GlobalPlayer } from '../GlobalPlayer';
import { useGlobalState } from '@/lib/store';
import { useGlobalStateDispatch } from '@/lib/store/GlobalStateContext';
import { useSongRawUrl } from '@/lib/hooks/useSongRawUrl';
import type { Song } from '@/lib/api/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@/lib/store');
jest.mock('@/lib/store/GlobalStateContext');
jest.mock('@/lib/hooks/useSongRawUrl');

const mockUseGlobalState = useGlobalState as jest.MockedFunction<
  typeof useGlobalState
>;
const mockUseGlobalStateDispatch =
  useGlobalStateDispatch as jest.MockedFunction<
    typeof useGlobalStateDispatch
  >;
const mockUseSongRawUrl = useSongRawUrl as jest.MockedFunction<
  typeof useSongRawUrl
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockSong: Song = {
  id: 'song-123',
  title: 'Test Song',
  author: 'Test Artist',
  rawSongInfo: {
    urlInfo: {
      value: 'https://example.com/audio.mp3',
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
    uploadedAt: '2024-01-01T00:00:00.000Z',
  },
};

const mockDispatch = jest.fn();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GlobalPlayer', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mocks
    mockUseGlobalStateDispatch.mockReturnValue(mockDispatch);
    mockUseSongRawUrl.mockReturnValue({
      url: 'https://example.com/audio.mp3',
      isRefreshing: false,
      error: null,
    });

    // Mock HTMLMediaElement methods
    HTMLMediaElement.prototype.play = jest.fn(() => Promise.resolve());
    HTMLMediaElement.prototype.pause = jest.fn();
    HTMLMediaElement.prototype.load = jest.fn();
  });

  it('does not render when no song is loaded', () => {
    mockUseGlobalState.mockReturnValue({
      currentSongId: null,
      playbackStatus: 'idle',
      songs: [],
      authStatus: 'authenticated',
      userProfile: null,
      songsStatus: 'ready',
    });

    const { container } = render(<GlobalPlayer />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the player when a song is loaded', () => {
    mockUseGlobalState.mockReturnValue({
      currentSongId: 'song-123',
      playbackStatus: 'paused',
      songs: [mockSong],
      authStatus: 'authenticated',
      userProfile: null,
      songsStatus: 'ready',
    });

    render(<GlobalPlayer />);

    expect(screen.getByText('Test Song')).toBeInTheDocument();
    expect(screen.getByText('Test Artist')).toBeInTheDocument();
  });

  it('displays play button when paused', () => {
    mockUseGlobalState.mockReturnValue({
      currentSongId: 'song-123',
      playbackStatus: 'paused',
      songs: [mockSong],
      authStatus: 'authenticated',
      userProfile: null,
      songsStatus: 'ready',
    });

    render(<GlobalPlayer />);

    const playButton = screen.getByRole('button', { name: /play/i });
    expect(playButton).toBeInTheDocument();
  });

  it('displays pause button when playing', () => {
    mockUseGlobalState.mockReturnValue({
      currentSongId: 'song-123',
      playbackStatus: 'playing',
      songs: [mockSong],
      authStatus: 'authenticated',
      userProfile: null,
      songsStatus: 'ready',
    });

    render(<GlobalPlayer />);

    const pauseButton = screen.getByRole('button', { name: /pause/i });
    expect(pauseButton).toBeInTheDocument();
  });

  it('calls play on the audio element when play button is clicked', async () => {
    const user = userEvent.setup();
    mockUseGlobalState.mockReturnValue({
      currentSongId: 'song-123',
      playbackStatus: 'paused',
      songs: [mockSong],
      authStatus: 'authenticated',
      userProfile: null,
      songsStatus: 'ready',
    });

    const mockPlay = jest.fn(() => Promise.resolve());
    HTMLMediaElement.prototype.play = mockPlay;

    render(<GlobalPlayer />);

    const playButton = screen.getByRole('button', { name: /play/i });
    await user.click(playButton);

    await waitFor(() => {
      expect(mockPlay).toHaveBeenCalled();
    });
  });

  it('calls pause on the audio element when pause button is clicked', async () => {
    const user = userEvent.setup();
    mockUseGlobalState.mockReturnValue({
      currentSongId: 'song-123',
      playbackStatus: 'playing',
      songs: [mockSong],
      authStatus: 'authenticated',
      userProfile: null,
      songsStatus: 'ready',
    });

    const mockPause = jest.fn();
    HTMLMediaElement.prototype.pause = mockPause;

    render(<GlobalPlayer />);

    const pauseButton = screen.getByRole('button', { name: /pause/i });
    await user.click(pauseButton);

    await waitFor(() => {
      expect(mockPause).toHaveBeenCalled();
    });
  });

  it('dispatches PLAYER_STOP when stop button is clicked', async () => {
    const user = userEvent.setup();
    mockUseGlobalState.mockReturnValue({
      currentSongId: 'song-123',
      playbackStatus: 'playing',
      songs: [mockSong],
      authStatus: 'authenticated',
      userProfile: null,
      songsStatus: 'ready',
    });

    render(<GlobalPlayer />);

    const stopButton = screen.getByRole('button', { name: /stop/i });
    await user.click(stopButton);

    expect(mockDispatch).toHaveBeenCalledWith({ type: 'PLAYER_STOP' });
  });

  it('shows loading indicator when refreshing URL', () => {
    mockUseGlobalState.mockReturnValue({
      currentSongId: 'song-123',
      playbackStatus: 'paused',
      songs: [mockSong],
      authStatus: 'authenticated',
      userProfile: null,
      songsStatus: 'ready',
    });

    mockUseSongRawUrl.mockReturnValue({
      url: 'https://example.com/audio.mp3',
      isRefreshing: true,
      error: null,
    });

    render(<GlobalPlayer />);

    // CircularProgress is rendered but doesn't have a specific role
    const progress = screen.getByRole('progressbar', { hidden: true });
    expect(progress).toBeInTheDocument();
  });

  it('displays error message when URL fetch fails', () => {
    mockUseGlobalState.mockReturnValue({
      currentSongId: 'song-123',
      playbackStatus: 'paused',
      songs: [mockSong],
      authStatus: 'authenticated',
      userProfile: null,
      songsStatus: 'ready',
    });

    mockUseSongRawUrl.mockReturnValue({
      url: null,
      isRefreshing: false,
      error: 'Failed to load audio URL',
    });

    render(<GlobalPlayer />);

    expect(screen.getByText('Failed to load audio URL')).toBeInTheDocument();
  });

  it('disables play button when no URL is available', () => {
    mockUseGlobalState.mockReturnValue({
      currentSongId: 'song-123',
      playbackStatus: 'paused',
      songs: [mockSong],
      authStatus: 'authenticated',
      userProfile: null,
      songsStatus: 'ready',
    });

    mockUseSongRawUrl.mockReturnValue({
      url: null,
      isRefreshing: false,
      error: null,
    });

    render(<GlobalPlayer />);

    const playButton = screen.getByRole('button', { name: /play/i });
    expect(playButton).toBeDisabled();
  });
});
