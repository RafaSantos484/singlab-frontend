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
 * Error messages are i18n translation keys (relative to the `Validation`
 * namespace) so that UI components can pass them to `useTranslations`.
 */
export const CreateUserSchema = z.object({
  name: z.string().min(3, 'name.tooShort').max(255, 'name.tooLong'),
  email: z.email('email.invalid').max(255, 'email.tooLong'),
  password: z
    .string()
    .min(6, 'password.tooShort')
    .max(255, 'password.tooLong')
    .regex(VALID_PASSWORD_CHARS, 'password.invalidChars'),
});

export type CreateUserDto = z.infer<typeof CreateUserSchema>;

/**
 * Validates a user creation payload against the schema.
 * Returns an object with `success` and either `data` or `errors`.
 * Error values are i18n keys in the `Validation` namespace.
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
