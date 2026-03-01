import { validateSignIn, SignInSchema } from '../sign-in';

describe('SignInSchema', () => {
  // --- Email validation -----------------------------------------------------

  it('accepts valid emails', () => {
    const result = SignInSchema.safeParse({
      email: 'jane@example.com',
      password: 'SecurePass123!',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email formats', () => {
    const result = SignInSchema.safeParse({
      email: 'not-an-email',
      password: 'SecurePass123!',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('email'))).toBe(
        true,
      );
    }
  });

  it('rejects emails longer than 255 characters', () => {
    const result = SignInSchema.safeParse({
      email: `${'a'.repeat(246)}@example.com`,
      password: 'SecurePass123!',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('email'))).toBe(
        true,
      );
    }
  });

  // --- Password validation --------------------------------------------------

  it('accepts valid passwords', () => {
    const result = SignInSchema.safeParse({
      email: 'jane@example.com',
      password: 'SecurePass123!',
    });
    expect(result.success).toBe(true);
  });

  it('rejects passwords shorter than 6 characters', () => {
    const result = SignInSchema.safeParse({
      email: 'jane@example.com',
      password: 'Pass1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('password'))).toBe(
        true,
      );
    }
  });

  it('rejects passwords longer than 255 characters', () => {
    const result = SignInSchema.safeParse({
      email: 'jane@example.com',
      password: 'P' + 'a'.repeat(255),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('password'))).toBe(
        true,
      );
    }
  });

  it('rejects passwords with spaces', () => {
    const result = SignInSchema.safeParse({
      email: 'jane@example.com',
      password: 'Pass word123!',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('password'))).toBe(
        true,
      );
    }
  });

  it('rejects passwords with control characters', () => {
    const result = SignInSchema.safeParse({
      email: 'jane@example.com',
      password: 'Pass\x00word123!',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('password'))).toBe(
        true,
      );
    }
  });

  it('accepts passwords with special characters', () => {
    const result = SignInSchema.safeParse({
      email: 'jane@example.com',
      password: 'P@$$w0rd!#%&*',
    });
    expect(result.success).toBe(true);
  });
});

describe('validateSignIn', () => {
  it('returns success with valid data', () => {
    const result = validateSignIn({
      email: 'jane@example.com',
      password: 'SecurePass123!',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        email: 'jane@example.com',
        password: 'SecurePass123!',
      });
    }
  });

  it('returns errors object for invalid data', () => {
    const result = validateSignIn({
      email: 'invalid-email',
      password: 'short',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.email).toBeDefined();
      expect(result.errors.password).toBeDefined();
    }
  });

  it('returns specific error messages', () => {
    const result = validateSignIn({
      email: 'invalid-email',
      password: 'SecurePass123!',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.email).toBe('Invalid email format');
    }
  });
});
