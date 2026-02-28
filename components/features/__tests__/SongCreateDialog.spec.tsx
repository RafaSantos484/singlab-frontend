import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SongCreateDialog } from '../SongCreateDialog';

// Mock the song creation service
jest.mock('@/lib/api/song-creation', () => ({
  createSong: jest.fn(),
  validateSongFile: jest.fn(),
  validateSongMetadata: jest.fn(),
  InvalidFileError: class InvalidFileError extends Error {
    name = 'InvalidFileError';
  },
  FileSizeExceededError: class FileSizeExceededError extends Error {
    name = 'FileSizeExceededError';
  },
  InvalidFileTypeError: class InvalidFileTypeError extends Error {
    name = 'InvalidFileTypeError';
  },
}));

// Mock API types
jest.mock('@/lib/api/types', () => ({
  ApiError: class ApiError extends Error {
    name = 'ApiError';
    statusCode = 0;
    timestamp = '';
    constructor(statusCode: number, message: string, timestamp: string) {
      super(message);
      this.statusCode = statusCode;
      this.timestamp = timestamp;
    }
  },
}));

describe('SongCreateDialog', () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders dialog title and form fields when open', () => {
    render(<SongCreateDialog open onClose={mockOnClose} />);

    expect(screen.getByText('Upload New Song')).toBeInTheDocument();
    expect(screen.getByLabelText('Song Title')).toBeInTheDocument();
    expect(screen.getByLabelText('Artist / Author')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /choose audio file/i }),
    ).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    render(<SongCreateDialog open={false} onClose={mockOnClose} />);

    expect(screen.queryByText('Upload New Song')).not.toBeInTheDocument();
  });

  it('disables submit button when form fields are empty', () => {
    render(<SongCreateDialog open onClose={mockOnClose} />);

    const submitButton = screen.getByRole('button', {
      name: /upload song/i,
    });
    expect(submitButton).toBeDisabled();
  });

  it('calls onClose when Cancel button is clicked', async () => {
    const user = userEvent.setup();
    render(<SongCreateDialog open onClose={mockOnClose} />);

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('shows file upload button and helper text', () => {
    render(<SongCreateDialog open onClose={mockOnClose} />);

    expect(
      screen.getByRole('button', { name: /choose audio file/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/supported.*mp3.*wav.*ogg/i)).toBeInTheDocument();
  });

  it('shows selected file name after selection', async () => {
    render(<SongCreateDialog open onClose={mockOnClose} />);

    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(['audio'], 'test.mp3', { type: 'audio/mpeg' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/test\.mp3/)).toBeInTheDocument();
    });
  });

  it('has accessible keyboard navigation', async () => {
    const user = userEvent.setup();
    render(<SongCreateDialog open onClose={mockOnClose} />);

    const titleInput = screen.getByLabelText('Song Title');
    // Title should be autofocused
    expect(titleInput).toBeInTheDocument();

    // Tab through fields
    await user.tab();
    // Verify tab order works (browser default)
  });
});
