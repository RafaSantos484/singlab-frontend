import {
  validateSongFile,
  validateSongMetadata,
  InvalidFileTypeError,
  FileSizeExceededError,
} from '../song-creation';

describe('validateSongFile', () => {
  it('accepts valid audio formats', () => {
    const validFormats = [
      { name: 'test.mp3', type: 'audio/mpeg' },
      { name: 'test.wav', type: 'audio/wav' },
      { name: 'test.ogg', type: 'audio/ogg' },
      { name: 'test.webm', type: 'audio/webm' },
      { name: 'test.mp4', type: 'video/mp4' },
      { name: 'test.mov', type: 'video/quicktime' },
      { name: 'test.flac', type: 'audio/flac' },
    ];

    validFormats.forEach(({ name, type }) => {
      const file = new File(['audio'], name, { type });
      expect(() => validateSongFile(file)).not.toThrow();
    });
  });

  it('rejects unsupported file types', () => {
    const file = new File(['data'], 'test.txt', { type: 'text/plain' });
    expect(() => validateSongFile(file)).toThrow(InvalidFileTypeError);
    expect(() => validateSongFile(file)).toThrow(/unsupported format/i);
  });

  it('rejects files exceeding maximum size', () => {
    // Create a mock file that reports size > 100MB
    const largeFile = new File(['x'.repeat(101 * 1024 * 1024)], 'large.mp3', {
      type: 'audio/mpeg',
    });

    expect(() => validateSongFile(largeFile)).toThrow(FileSizeExceededError);
    expect(() => validateSongFile(largeFile)).toThrow(/exceeds maximum size/i);
  });

  it('accepts files at the maximum size boundary', () => {
    // This test assumes we can create a file up to 100MB - in practice may not work in jsdom
    const maxFile = new File(['audio'], 'max.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(maxFile, 'size', { value: 100 * 1024 * 1024 });

    expect(() => validateSongFile(maxFile)).not.toThrow();
  });

  it('accepts small valid files', () => {
    const smallFile = new File(['audio'], 'small.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(smallFile, 'size', { value: 5 * 1024 * 1024 }); // 5MB

    expect(() => validateSongFile(smallFile)).not.toThrow();
  });
});

describe('validateSongMetadata', () => {
  it('returns null for valid metadata', () => {
    const result = validateSongMetadata('Valid Title', 'Valid Author');
    expect(result).toBeNull();
  });

  it('returns error for empty title', () => {
    const result = validateSongMetadata('', 'Author');
    expect(result).toEqual({ title: 'Song title is required' });
  });

  it('returns error for empty author', () => {
    const result = validateSongMetadata('Title', '');
    expect(result).toEqual({ author: 'Artist/Author name is required' });
  });

  it('returns errors for empty title and author', () => {
    const result = validateSongMetadata('', '');
    expect(result).toEqual({
      title: 'Song title is required',
      author: 'Artist/Author name is required',
    });
  });

  it('returns error for title exceeding 255 characters', () => {
    const longTitle = 'a'.repeat(256);
    const result = validateSongMetadata(longTitle, 'Author');
    expect(result).toEqual({
      title: 'Song title must be 255 characters or less',
    });
  });

  it('returns error for author exceeding 255 characters', () => {
    const longAuthor = 'a'.repeat(256);
    const result = validateSongMetadata('Title', longAuthor);
    expect(result).toEqual({
      author: 'Artist/Author name must be 255 characters or less',
    });
  });

  it('trims whitespace from input', () => {
    const result = validateSongMetadata('  Valid Title  ', '  Valid Author  ');
    expect(result).toBeNull();
  });

  it('rejects title with only whitespace', () => {
    const result = validateSongMetadata('   ', 'Author');
    expect(result).toEqual({ title: 'Song title is required' });
  });

  it('rejects author with only whitespace', () => {
    const result = validateSongMetadata('Title', '   ');
    expect(result).toEqual({ author: 'Artist/Author name is required' });
  });

  it('validates 255 character limits exactly', () => {
    const exact255 = 'a'.repeat(255);
    const result = validateSongMetadata(exact255, 'Author');
    expect(result).toBeNull();
  });
});

