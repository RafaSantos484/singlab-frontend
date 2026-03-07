import { z } from 'zod';

/**
 * Zod validation schema for completing the post-verification user profile.
 * Error messages are i18n translation keys (relative to the `Validation`
 * namespace).
 */
export const CompleteProfileSchema = z.object({
  email: z.email('email.invalid').max(255, 'email.tooLong'),
  name: z.string().min(3, 'name.tooShort').max(255, 'name.tooLong'),
});

export type CompleteProfileDto = z.infer<typeof CompleteProfileSchema>;

/**
 * Validates profile completion payload.
 */
export function validateCompleteProfile(
  data: unknown,
):
  | { success: true; data: CompleteProfileDto }
  | { success: false; errors: Record<string, string> } {
  const result = CompleteProfileSchema.safeParse(data);

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
