import { validateCreateUser, CreateUserSchema } from '../create-user';

describe('CreateUserSchema', () => {
  // --- Name validation ------------------------------------------------------

  it('accepts valid names', () => {
    const result = CreateUserSchema.safeParse({
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'SecurePass123!',
    });
    expect(result.success).toBe(true);
  });

  it('rejects names shorter than 3 characters', () => {
    const result = CreateUserSchema.safeParse({
      name: 'ab',
      email: 'jane@example.com',
      password: 'SecurePass123!',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('name'))).toBe(
        true,
      );
    }
  });

  it('rejects names longer than 255 characters', () => {
    const result = CreateUserSchema.safeParse({
      name: 'a'.repeat(256),
      email: 'jane@example.com',
      password: 'SecurePass123!',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('name'))).toBe(
        true,
      );
    }
  });

  // --- Email validation -----------------------------------------------------

  it('accepts valid emails', () => {
    const result = CreateUserSchema.safeParse({
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'SecurePass123!',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email formats', () => {
    const result = CreateUserSchema.safeParse({
      name: 'Jane Doe',
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
    const result = CreateUserSchema.safeParse({
      name: 'Jane Doe',
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
    const result = CreateUserSchema.safeParse({
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'SecurePass123!',
    });
    expect(result.success).toBe(true);
  });

  it('rejects passwords shorter than 6 characters', () => {
    const result = CreateUserSchema.safeParse({
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'Pass1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.includes('password')),
      ).toBe(true);
    }
  });

  it('rejects passwords longer than 255 characters', () => {
    const result = CreateUserSchema.safeParse({
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'P' + 'a'.repeat(255),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.includes('password')),
      ).toBe(true);
    }
  });

  it('rejects passwords with spaces', () => {
    const result = CreateUserSchema.safeParse({
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'Pass word123!',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.includes('password')),
      ).toBe(true);
    }
  });

  it('rejects passwords with control characters', () => {
    const result = CreateUserSchema.safeParse({
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'Pass\x00word123!',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.includes('password')),
      ).toBe(true);
    }
  });

  it('accepts passwords with special characters', () => {
    const result = CreateUserSchema.safeParse({
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'P@$$w0rd!#%&*',
    });
    expect(result.success).toBe(true);
  });
});

describe('validateCreateUser', () => {
  it('returns success with valid data', () => {
    const result = validateCreateUser({
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'SecurePass123!',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: 'SecurePass123!',
      });
    }
  });

  it('returns errors object for invalid data', () => {
    const result = validateCreateUser({
      name: 'ab',
      email: 'invalid-email',
      password: 'short',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.name).toBeDefined();
      expect(result.errors.email).toBeDefined();
      expect(result.errors.password).toBeDefined();
    }
  });

  it('returns specific error messages', () => {
    const result = validateCreateUser({
      name: 'ab',
      email: 'jane@example.com',
      password: 'SecurePass123!',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.name).toBe('Name must be at least 3 characters');
    }
  });
});
