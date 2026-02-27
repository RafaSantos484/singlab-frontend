import { ApiError } from '../types';

describe('ApiError', () => {
  const statusCode = 404;
  const message = 'Resource not found';
  const timestamp = '2024-01-01T00:00:00.000Z';

  it('creates an instance of Error', () => {
    const error = new ApiError(statusCode, message, timestamp);
    expect(error).toBeInstanceOf(Error);
  });

  it('creates an instance of ApiError', () => {
    const error = new ApiError(statusCode, message, timestamp);
    expect(error).toBeInstanceOf(ApiError);
  });

  it('sets the name to ApiError', () => {
    const error = new ApiError(statusCode, message, timestamp);
    expect(error.name).toBe('ApiError');
  });

  it('sets the message property', () => {
    const error = new ApiError(statusCode, message, timestamp);
    expect(error.message).toBe(message);
  });

  it('sets the statusCode property', () => {
    const error = new ApiError(statusCode, message, timestamp);
    expect(error.statusCode).toBe(statusCode);
  });

  it('sets the timestamp property', () => {
    const error = new ApiError(statusCode, message, timestamp);
    expect(error.timestamp).toBe(timestamp);
  });

  it('can be caught as a generic Error', () => {
    const throwApiError = (): void => {
      throw new ApiError(500, 'Internal server error', timestamp);
    };

    expect(throwApiError).toThrow(Error);
    expect(throwApiError).toThrow('Internal server error');
  });

  it('statusCode is readonly', () => {
    const error = new ApiError(statusCode, message, timestamp);
    // TypeScript compile-time protection; verify value does not change
    expect(error.statusCode).toBe(statusCode);
  });
});
