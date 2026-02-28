import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SongDeleteButton } from '../SongDeleteButton';
import { songsApi } from '@/lib/api';
import { ApiError } from '@/lib/api/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@/lib/api', () => ({
  songsApi: {
    deleteSong: jest.fn(),
  },
}));

const mockDeleteSong = songsApi.deleteSong as jest.MockedFunction<
  typeof songsApi.deleteSong
>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SongDeleteButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  it('renders the delete icon button', () => {
    render(<SongDeleteButton songId="song-1" songTitle="Test Song" />);

    const button = screen.getByRole('button', { name: /delete/i });
    expect(button).toBeInTheDocument();
  });

  it('renders with custom size prop', () => {
    render(
      <SongDeleteButton songId="song-1" songTitle="Test Song" size="small" />,
    );

    const button = screen.getByRole('button', { name: /delete/i });
    expect(button).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Opening and closing dialog
  // ---------------------------------------------------------------------------

  it('opens confirmation dialog when delete button is clicked', async () => {
    const user = userEvent.setup();
    render(<SongDeleteButton songId="song-1" songTitle="Test Song" />);

    const deleteButton = screen.getByRole('button', { name: /delete/i });
    await user.click(deleteButton);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/delete song\?/i)).toBeInTheDocument();
    expect(screen.getByText(/test song/i)).toBeInTheDocument();
    expect(
      screen.getByText(/this action cannot be undone/i),
    ).toBeInTheDocument();
  });

  it('closes dialog when cancel button is clicked', async () => {
    const user = userEvent.setup();
    render(<SongDeleteButton songId="song-1" songTitle="Test Song" />);

    // Open dialog
    const deleteButton = screen.getByRole('button', { name: /delete/i });
    await user.click(deleteButton);

    // Click cancel
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    // Dialog should be closed
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('closes dialog when backdrop is clicked', async () => {
    const user = userEvent.setup();
    render(<SongDeleteButton songId="song-1" songTitle="Test Song" />);

    // Open dialog
    const deleteButton = screen.getByRole('button', { name: /delete/i });
    await user.click(deleteButton);

    // Close dialog via Escape key (simulates backdrop click behavior)
    await user.keyboard('{Escape}');

    // Dialog should be closed
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Accessibility
  // ---------------------------------------------------------------------------

  it('sets initial focus on cancel button', async () => {
    const user = userEvent.setup();
    render(<SongDeleteButton songId="song-1" songTitle="Test Song" />);

    // Open dialog
    const deleteButton = screen.getByRole('button', { name: /delete/i });
    await user.click(deleteButton);

    // Cancel button should have autoFocus
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await waitFor(() => {
      expect(cancelButton).toHaveFocus();
    });
  });

  it('has proper aria-labelledby and aria-describedby on dialog', async () => {
    const user = userEvent.setup();
    render(<SongDeleteButton songId="song-1" songTitle="Test Song" />);

    // Open dialog
    const deleteButton = screen.getByRole('button', { name: /delete/i });
    await user.click(deleteButton);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(dialog).toHaveAttribute('aria-describedby');
  });

  // ---------------------------------------------------------------------------
  // Successful deletion
  // ---------------------------------------------------------------------------

  it('successfully deletes song and shows success message', async () => {
    const user = userEvent.setup();
    mockDeleteSong.mockResolvedValueOnce('Song deleted successfully');

    render(<SongDeleteButton songId="song-1" songTitle="My Favorite Song" />);

    // Open dialog
    const deleteButton = screen.getByRole('button', { name: /delete/i });
    await user.click(deleteButton);

    // Click confirm delete
    const confirmButton = screen.getByRole('button', { name: /^delete$/i });
    await user.click(confirmButton);

    // Verify API was called with correct songId
    expect(mockDeleteSong).toHaveBeenCalledWith('song-1');
    expect(mockDeleteSong).toHaveBeenCalledTimes(1);

    // Dialog should close
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // Success snackbar should appear
    await waitFor(() => {
      expect(
        screen.getByText(/"My Favorite Song" deleted successfully/i),
      ).toBeInTheDocument();
    });
  });

  it('calls onDeleted callback after successful deletion', async () => {
    const user = userEvent.setup();
    const onDeleted = jest.fn();
    mockDeleteSong.mockResolvedValueOnce('Song deleted successfully');

    render(
      <SongDeleteButton
        songId="song-1"
        songTitle="Test Song"
        onDeleted={onDeleted}
      />,
    );

    // Open dialog and confirm
    const deleteButton = screen.getByRole('button', { name: /delete/i });
    await user.click(deleteButton);

    const confirmButton = screen.getByRole('button', { name: /^delete$/i });
    await user.click(confirmButton);

    // Verify callback was called with songId
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith('song-1');
    });
  });

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  it('shows loading state on confirm button during deletion', async () => {
    const user = userEvent.setup();
    // Create a promise that we can control
    let resolveDelete: ((value: string) => void) | undefined;
    const deletePromise = new Promise<string>((resolve) => {
      resolveDelete = resolve;
    });
    mockDeleteSong.mockReturnValueOnce(deletePromise);

    render(<SongDeleteButton songId="song-1" songTitle="Test Song" />);

    // Open dialog and click delete
    const deleteButton = screen.getByRole('button', { name: /delete/i });
    await user.click(deleteButton);

    const confirmButton = screen.getByRole('button', { name: /^delete$/i });
    await user.click(confirmButton);

    // Loading state should be active (button disabled)
    await waitFor(() => {
      expect(confirmButton).toBeDisabled();
    });

    // Cancel button should also be disabled during loading
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    expect(cancelButton).toBeDisabled();

    // Resolve the promise
    resolveDelete!('Song deleted successfully');

    // Wait for completion
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('disables dialog close during deletion', async () => {
    const user = userEvent.setup();
    let resolveDelete: ((value: string) => void) | undefined;
    const deletePromise = new Promise<string>((resolve) => {
      resolveDelete = resolve;
    });
    mockDeleteSong.mockReturnValueOnce(deletePromise);

    render(<SongDeleteButton songId="song-1" songTitle="Test Song" />);

    // Open dialog and start deletion
    const deleteButton = screen.getByRole('button', { name: /delete/i });
    await user.click(deleteButton);

    const confirmButton = screen.getByRole('button', { name: /^delete$/i });
    await user.click(confirmButton);

    // Try to close dialog with Escape (should not work during deletion)
    await user.keyboard('{Escape}');

    // Dialog should still be open
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Resolve the deletion
    resolveDelete!('Song deleted successfully');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling: Network failure
  // ---------------------------------------------------------------------------

  it('shows error message on network failure', async () => {
    const user = userEvent.setup();
    mockDeleteSong.mockRejectedValueOnce(new Error('Network error'));

    render(<SongDeleteButton songId="song-1" songTitle="Test Song" />);

    // Open dialog and confirm
    const deleteButton = screen.getByRole('button', { name: /delete/i });
    await user.click(deleteButton);

    const confirmButton = screen.getByRole('button', { name: /^delete$/i });
    await user.click(confirmButton);

    // Error snackbar should appear
    await waitFor(() => {
      expect(
        screen.getByText(/failed to delete song/i),
      ).toBeInTheDocument();
    });

    // Dialog should remain open for retry
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Error handling: 401 Unauthorized
  // ---------------------------------------------------------------------------

  it('shows authentication error message on 401', async () => {
    const user = userEvent.setup();
    const error = new ApiError(401, 'Unauthorized', new Date().toISOString());
    mockDeleteSong.mockRejectedValueOnce(error);

    render(<SongDeleteButton songId="song-1" songTitle="Test Song" />);

    // Open dialog and confirm
    const deleteButton = screen.getByRole('button', { name: /delete/i });
    await user.click(deleteButton);

    const confirmButton = screen.getByRole('button', { name: /^delete$/i });
    await user.click(confirmButton);

    // Specific 401 error message should appear
    await waitFor(() => {
      expect(
        screen.getByText(/authentication expired/i),
      ).toBeInTheDocument();
    });

    // Dialog should remain open
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Error handling: 403 Forbidden
  // ---------------------------------------------------------------------------

  it('shows permission error message on 403', async () => {
    const user = userEvent.setup();
    const error = new ApiError(403, 'Forbidden', new Date().toISOString());
    mockDeleteSong.mockRejectedValueOnce(error);

    render(<SongDeleteButton songId="song-1" songTitle="Test Song" />);

    // Open dialog and confirm
    const deleteButton = screen.getByRole('button', { name: /delete/i });
    await user.click(deleteButton);

    const confirmButton = screen.getByRole('button', { name: /^delete$/i });
    await user.click(confirmButton);

    // Specific 403 error message should appear
    await waitFor(() => {
      expect(
        screen.getByText(/you do not have permission/i),
      ).toBeInTheDocument();
    });

    // Dialog should remain open
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Error handling: 404 Not Found
  // ---------------------------------------------------------------------------

  it('shows not found error message on 404', async () => {
    const user = userEvent.setup();
    const error = new ApiError(404, 'Not Found', new Date().toISOString());
    mockDeleteSong.mockRejectedValueOnce(error);

    render(<SongDeleteButton songId="song-1" songTitle="Test Song" />);

    // Open dialog and confirm
    const deleteButton = screen.getByRole('button', { name: /delete/i });
    await user.click(deleteButton);

    const confirmButton = screen.getByRole('button', { name: /^delete$/i });
    await user.click(confirmButton);

    // Specific 404 error message should appear
    await waitFor(() => {
      expect(
        screen.getByText(/this song no longer exists/i),
      ).toBeInTheDocument();
    });

    // Dialog should remain open
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Snackbar behavior
  // ---------------------------------------------------------------------------

  it('closes snackbar when close button is clicked', async () => {
    const user = userEvent.setup();
    mockDeleteSong.mockResolvedValueOnce('Song deleted successfully');

    render(<SongDeleteButton songId="song-1" songTitle="Test Song" />);

    // Perform successful deletion
    const deleteButton = screen.getByRole('button', { name: /delete/i });
    await user.click(deleteButton);

    const confirmButton = screen.getByRole('button', { name: /^delete$/i });
    await user.click(confirmButton);

    // Wait for success snackbar
    await waitFor(() => {
      expect(
        screen.getByText(/deleted successfully/i),
      ).toBeInTheDocument();
    });

    // Wait for dialog to fully close before looking for close button
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // Find and click the close button in the snackbar (now visible)
    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    const snackbarCloseButton = closeButtons[0]; // First close button should be from snackbar
    await user.click(snackbarCloseButton);

    // Snackbar should disappear
    await waitFor(() => {
      expect(
        screen.queryByText(/deleted successfully/i),
      ).not.toBeInTheDocument();
    });
  });
});
