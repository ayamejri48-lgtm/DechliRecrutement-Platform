import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../../core/services/auth.service';
import { matchingPasswords, passwordValidator } from '../../../shared/validators/password.validator';
@Component({ selector: 'app-signup', standalone: true, imports: [CommonModule, ReactiveFormsModule, RouterLink], templateUrl: './signup.component.html', styleUrl: './signup.component.scss' })
export class SignupComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  loading = signal(false);
  success = signal(false);
  error = signal('');
  showPassword = signal(false);
  form = this.fb.nonNullable.group({
    firstName: ['', [Validators.required, Validators.maxLength(100)]],
    lastName: ['', [Validators.required, Validators.maxLength(100)]],
    email: ['', [Validators.required, Validators.email]],
    phone: ['', [Validators.required]],
    password: ['', [Validators.required, passwordValidator]],
    confirmPassword: ['', [Validators.required]]
  }, { validators: matchingPasswords });
  invalid(name: string): boolean { const c = this.form.get(name); return !!c && c.invalid && (c.dirty || c.touched); }
  submit(): void {
    this.error.set(''); this.success.set(false);
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const { confirmPassword, ...payload } = this.form.getRawValue();
    this.loading.set(true);
    this.auth.register(payload).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: () => { this.success.set(true); this.form.reset(); },
      error: (err: HttpErrorResponse) => {
        this.error.set(err.status === 409 ? 'Cette adresse e-mail est déjà utilisée.' : err.status === 0 ? 'Connexion au serveur impossible. Vérifiez que votre backend est démarré.' : 'Inscription impossible. Vérifiez vos informations et réessayez.');
      }
    });
  }
}
