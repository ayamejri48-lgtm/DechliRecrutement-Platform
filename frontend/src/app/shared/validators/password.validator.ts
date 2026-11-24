import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
/** Même expression régulière que RegisterRequest et ResetPasswordRequest côté backend. */
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&._-])[A-Za-z\d@$!%*?&._-]{8,}$/;
export const passwordValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null =>
  !control.value || PASSWORD_PATTERN.test(control.value) ? null : { passwordPolicy: true };
export const matchingPasswords: ValidatorFn = (group: AbstractControl): ValidationErrors | null =>
  group.get('password')?.value === group.get('confirmPassword')?.value ? null : { passwordMismatch: true };
