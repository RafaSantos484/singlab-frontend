import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SongEditDialog } from '../SongEditDialog';
import { songsApi } from '@/lib/api';
import { ApiError, type Song } from '@/lib/api/types';

// Mock the API
jest.mock('@/lib/api', () => ({
  songsApi: {
    updateSong: jest.fn(),
  },
}));

const mockUpdateSong = songsApi.updateSong as jest.MockedFunction<
  typeof songsApi.updateSong
>;

describe('SongEditDialog', () => {
  const mockSong: Song = {
    id: 'test-song-id',
    title: 'Test Song Title',
    author: 'Test Artist',
    rawSongInfo: {
      urlInfo: {
        value: 'https://example.com/song.mp3',
        expiresAt: '2026-12-31T23:59:59Z',
      },
      uploadedAt: '2026-01-01T00:00:00Z',
    },
    separatedSongInfo: null,
  };

  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders with pre-filled data from song prop', () => {
    render(
      <SongEditDialog open={true} onClose={mockOnClose} song={mockSong} />,
    );

    expect(screen.getByDisplayValue('Test Song Title')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Test Artist')).toBeInTheDocument();
    expect(screen.getByText('Edit Song')).toBeInTheDocument();
  });

  it('does not show file input section', () => {
    render(
      <SongEditDialog open={true} onClose={mockOnClose} song={mockSong} />,
    );

    // File input should not exist
    expect(screen.queryByText(/choose audio file/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/supported:/i)).not.toBeInTheDocument();
  });

  it('shows info message about audio file not being editable', () => {
    render(
      <SongEditDialog open={true} onClose={mockOnClose} song={mockSong} />,
    );

    expect(
      screen.getByText(/the audio file cannot be changed/i),
    ).toBeInTheDocument();
  });

  it('validates required title field', async () => {
    const user = userEvent.setup();
    render(
      <SongEditDialog open={true} onClose={mockOnClose} song={mockSong} />,
    );

    const titleInput = screen.getByLabelText(/song title/i);
    await user.clear(titleInput);

    // Check that button becomes disabled
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /update song/i }),
      ).toBeDisabled();
    });

    expect(mockUpdateSong).not.toHaveBeenCalled();
  });

  it('validates required author field', async () => {
    const user = userEvent.setup();
    render(
      <SongEditDialog open={true} onClose={mockOnClose} song={mockSong} />,
    );

    const authorInput = screen.getByLabelText(/artist.*author/i);
    await user.clear(authorInput);

    // Check that button becomes disabled
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /update song/i }),
      ).toBeDisabled();
    });

    expect(mockUpdateSong).not.toHaveBeenCalled();
  });

  it('validates title max length (255 chars)', async () => {
    const user = userEvent.setup();
    render(
      <SongEditDialog open={true} onClose={mockOnClose} song={mockSong} />,
    );

    const titleInput = screen.getByLabelText(/song title/i) as HTMLInputElement;

    // Try to type more than 255 chars (maxLength should prevent this)
    titleInput.focus();
    titleInput.setSelectionRange(0, titleInput.value.length);
    const longString = 'a'.repeat(300);
    await user.keyboard(longString);

    await waitFor(() => {
      const currentValue = titleInput.value;
      // Input should be truncated to 255 chars
      expect(currentValue.length).toBeLessThanOrEqual(255);
    });
  });

  it('validates author max length (255 chars)', async () => {
    const user = userEvent.setup();
    render(
      <SongEditDialog open={true} onClose={mockOnClose} song={mockSong} />,
    );

    const authorInput = screen.getByLabelText(
      /artist.*author/i,
    ) as HTMLInputElement;

    // Try to type more than 255 chars (maxLength should prevent this)
    authorInput.focus();
    authorInput.setSelectionRange(0, authorInput.value.length);
    const longString = 'a'.repeat(300);
    await user.keyboard(longString);

    await waitFor(() => {
      const currentValue = authorInput.value;
      // Input should be truncated to 255 chars
      expect(currentValue.length).toBeLessThanOrEqual(255);
    });
  });

  it('closes dialog without update when no changes made', async () => {
    const user = userEvent.setup();
    render(
      <SongEditDialog open={true} onClose={mockOnClose} song={mockSong} />,
    );

    await user.click(screen.getByRole('button', { name: /update song/i }));

    expect(mockUpdateSong).not.toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('updates song with only changed fields', async () => {
    const user = userEvent.setup();
    mockUpdateSong.mockResolvedValueOnce({
      id: mockSong.id,
      title: 'Updated Title',
      author: mockSong.author,
      rawSongInfo: mockSong.rawSongInfo,
    });

    render(
      <SongEditDialog open={true} onClose={mockOnClose} song={mockSong} />,
    );

    const titleInput = screen.getByLabelText(/song title/i);
    await user.clear(titleInput);
    await user.type(titleInput, 'Updated Title');
    await user.click(screen.getByRole('button', { name: /update song/i }));

    await waitFor(() => {
      expect(mockUpdateSong).toHaveBeenCalledWith(mockSong.id, {
        title: 'Updated Title',
      });
    });

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('updates both title and author when both changed', async () => {
    const user = userEvent.setup();
    mockUpdateSong.mockResolvedValueOnce({
      id: mockSong.id,
      title: 'New Title',
      author: 'New Artist',
      rawSongInfo: mockSong.rawSongInfo,
    });

    render(
      <SongEditDialog open={true} onClose={mockOnClose} song={mockSong} />,
    );

    const titleInput = screen.getByLabelText(/song title/i) as HTMLInputElement;
    const authorInput = screen.getByLabelText(
      /artist.*author/i,
    ) as HTMLInputElement;

    // Select all text and replace
    titleInput.focus();
    titleInput.setSelectionRange(0, titleInput.value.length);
    await user.keyboard('New Title');

    authorInput.focus();
    authorInput.setSelectionRange(0, authorInput.value.length);
    await user.keyboard('New Artist');

    await user.click(screen.getByRole('button', { name: /update song/i }));

    await waitFor(() => {
      expect(mockUpdateSong).toHaveBeenCalledWith(mockSong.id, {
        title: 'New Title',
        author: 'New Artist',
      });
    });

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('shows loading state during update', async () => {
    const user = userEvent.setup();
    mockUpdateSong.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100)),
    );

    render(
      <SongEditDialog open={true} onClose={mockOnClose} song={mockSong} />,
    );

    const titleInput = screen.getByLabelText(/song title/i);
    await user.clear(titleInput);
    await user.type(titleInput, 'Updated Title');
    await user.click(screen.getByRole('button', { name: /update song/i }));

    expect(screen.getByText(/updating\.\.\./i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();

    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('displays error message on API error', async () => {
    const user = userEvent.setup();
    const apiError = new ApiError(
      500,
      'Internal server error',
      '2026-02-27T10:00:00Z',
    );
    mockUpdateSong.mockRejectedValueOnce(apiError);

    render(
      <SongEditDialog open={true} onClose={mockOnClose} song={mockSong} />,
    );

    const titleInput = screen.getByLabelText(/song title/i);
    await user.clear(titleInput);
    await user.type(titleInput, 'Updated Title');
    await user.click(screen.getByRole('button', { name: /update song/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/update failed: internal server error \(500\)/i),
      ).toBeInTheDocument();
    });

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('displays generic error on unknown error', async () => {
    const user = userEvent.setup();
    mockUpdateSong.mockRejectedValueOnce(new Error('Network error'));

    render(
      <SongEditDialog open={true} onClose={mockOnClose} song={mockSong} />,
    );

    const titleInput = screen.getByLabelText(/song title/i);
    await user.clear(titleInput);
    await user.type(titleInput, 'Updated Title');
    await user.click(screen.getByRole('button', { name: /update song/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/an unexpected error occurred/i),
      ).toBeInTheDocument();
    });

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('clears errors when user starts typing', async () => {
    const user = userEvent.setup();
    render(
      <SongEditDialog open={true} onClose={mockOnClose} song={mockSong} />,
    );

    const titleInput = screen.getByLabelText(/song title/i);

    // Clear input to make button disabled
    await user.clear(titleInput);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /update song/i }),
      ).toBeDisabled();
    });

    // Type something to re-enable button
    await user.type(titleInput, 'New');

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /update song/i }),
      ).toBeEnabled();
    });
  });

  it('closes dialog on cancel button click', async () => {
    const user = userEvent.setup();
    render(
      <SongEditDialog open={true} onClose={mockOnClose} song={mockSong} />,
    );

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(mockOnClose).toHaveBeenCalledTimes(1);
    expect(mockUpdateSong).not.toHaveBeenCalled();
  });

  it('closes dialog on ESC key', async () => {
    const user = userEvent.setup();
    render(
      <SongEditDialog open={true} onClose={mockOnClose} song={mockSong} />,
    );

    await user.keyboard('{Escape}');

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('disables Update button when title is empty', async () => {
    const user = userEvent.setup();
    render(
      <SongEditDialog open={true} onClose={mockOnClose} song={mockSong} />,
    );

    const titleInput = screen.getByLabelText(/song title/i);
    await user.clear(titleInput);

    expect(screen.getByRole('button', { name: /update song/i })).toBeDisabled();
  });

  it('disables Update button when author is empty', async () => {
    const user = userEvent.setup();
    render(
      <SongEditDialog open={true} onClose={mockOnClose} song={mockSong} />,
    );

    const authorInput = screen.getByLabelText(/artist.*author/i);
    await user.clear(authorInput);

    expect(screen.getByRole('button', { name: /update song/i })).toBeDisabled();
  });

  it('resets form state when dialog reopens', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <SongEditDialog open={true} onClose={mockOnClose} song={mockSong} />,
    );

    const titleInput = screen.getByLabelText(/song title/i) as HTMLInputElement;
    titleInput.focus();
    titleInput.setSelectionRange(0, titleInput.value.length);
    await user.keyboard('Modified Title');

    // Close dialog (no need for act wrapper)
    rerender(
      <SongEditDialog open={false} onClose={mockOnClose} song={mockSong} />,
    );

    // Wait briefly for close animation
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Reopen dialog
    rerender(
      <SongEditDialog open={true} onClose={mockOnClose} song={mockSong} />,
    );

    // Should show original song data, not the modified data
    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Song Title')).toBeInTheDocument();
    });
  });

  it('trims whitespace from title and author before submitting', async () => {
    const user = userEvent.setup();
    mockUpdateSong.mockResolvedValueOnce({
      id: mockSong.id,
      title: 'Trimmed Title',
      author: 'Trimmed Author',
      rawSongInfo: mockSong.rawSongInfo,
    });

    render(
      <SongEditDialog open={true} onClose={mockOnClose} song={mockSong} />,
    );

    const titleInput = screen.getByLabelText(/song title/i) as HTMLInputElement;
    const authorInput = screen.getByLabelText(
      /artist.*author/i,
    ) as HTMLInputElement;

    // Select all text and replace
    titleInput.focus();
    titleInput.setSelectionRange(0, titleInput.value.length);
    await user.keyboard('  Trimmed Title  ');

    authorInput.focus();
    authorInput.setSelectionRange(0, authorInput.value.length);
    await user.keyboard('  Trimmed Author  ');

    await user.click(screen.getByRole('button', { name: /update song/i }));

    await waitFor(() => {
      expect(mockUpdateSong).toHaveBeenCalledWith(mockSong.id, {
        title: 'Trimmed Title',
        author: 'Trimmed Author',
      });
    });
  });
});
