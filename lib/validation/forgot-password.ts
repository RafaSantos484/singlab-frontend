import { z } from 'zod';

/**
 * Zod validation schema for password reset requests.
 * Error messages are i18n translation keys (relative to the `Validation`
 * namespace).
 */
export const ForgotPasswordSchema = z.object({
  email: z.email('email.invalid').max(255, 'email.tooLong'),
});

export type ForgotPasswordDto = z.infer<typeof ForgotPasswordSchema>;

/**
 * Validates a password reset payload.
 */
export function validateForgotPassword(
  data: unknown,
):
  | { success: true; data: ForgotPasswordDto }
  | { success: false; errors: Record<string, string> } {
  const result = ForgotPasswordSchema.safeParse(data);

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
