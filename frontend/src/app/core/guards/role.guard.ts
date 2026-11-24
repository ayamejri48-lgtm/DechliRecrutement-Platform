
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService, UserRole } from '../services/auth.service';

export const roleGuard = (role: UserRole): CanActivateFn => () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const authorize = (currentRole: UserRole) =>
    currentRole === role ? true : router.createUrlTree(['/account']);

  const current = auth.currentSession();
  if (current) return authorize(current.role);

  return auth.refresh().pipe(
    map(session => authorize(session.role)),
    catchError(() => of(router.createUrlTree(['/login'])))
  );
};

export const roleHome = (role: UserRole) =>
  role === 'ADMIN' ? '/admin/dashboard' :
  role === 'RECRUITER' ? '/recruiter/dashboard' : '/candidate/dashboard';
