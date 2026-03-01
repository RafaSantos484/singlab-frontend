import { z } from 'zod';

/**
 * Regex allowing only printable ASCII characters for passwords.
 * Blocks control characters and whitespace while permitting
 * letters, digits, and all common special characters.
 */
const VALID_PASSWORD_CHARS = /^[\x21-\x7E]+$/;

/**
 * Zod validation schema for sign in.
 * Error messages are i18n translation keys (relative to the `Validation`
 * namespace) so that UI components can pass them to `useTranslations`.
 */
export const SignInSchema = z.object({
  email: z
    .string()
    .email('email.invalid')
    .max(255, 'email.tooLong'),
  password: z
    .string()
    .min(6, 'password.tooShort')
    .max(255, 'password.tooLong')
    .regex(
      VALID_PASSWORD_CHARS,
      'password.invalidChars',
    ),
});

export type SignInDto = z.infer<typeof SignInSchema>;

/**
 * Validates sign in credentials against the schema.
 * Returns an object with `success` and either `data` or `errors`.
 * Error values are i18n keys in the `Validation` namespace.
 */
export function validateSignIn(
  data: unknown,
):
  | { success: true; data: SignInDto }
  | { success: false; errors: Record<string, string> } {
  const result = SignInSchema.safeParse(data);

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
