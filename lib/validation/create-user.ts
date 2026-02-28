import { z } from 'zod';

/**
 * Regex allowing only printable ASCII characters for passwords.
 * Blocks control characters and whitespace while permitting
 * letters, digits, and all common special characters.
 * Mirrors backend validation.
 */
const VALID_PASSWORD_CHARS = /^[\x21-\x7E]+$/;

/**
 * Zod validation schema for user creation.
 * Mirrors the backend CreateUserSchema to ensure consistency.
 */
export const CreateUserSchema = z.object({
  name: z
    .string()
    .min(3, 'Name must be at least 3 characters')
    .max(255, 'Name must be at most 255 characters'),
  email: z
    .string()
    .email('Invalid email format')
    .max(255, 'Email must be at most 255 characters'),
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters')
    .max(255, 'Password must be at most 255 characters')
    .regex(
      VALID_PASSWORD_CHARS,
      'Password must contain only printable characters (no spaces or control characters)',
    ),
});

export type CreateUserDto = z.infer<typeof CreateUserSchema>;

/**
 * Validates a user creation payload against the schema.
 * Returns an object with `success` and either `data` or `errors`.
 */
export function validateCreateUser(
  data: unknown,
):
  | { success: true; data: CreateUserDto }
  | { success: false; errors: Record<string, string> } {
  const result = CreateUserSchema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = issue.path.join('.');
    errors[field] = issue.message;
  }

  return { success: false, errors };
}
