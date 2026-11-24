
import {
  HttpErrorResponse,
  HttpInterceptorFn
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError, timeout } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  const path = req.url.split('?')[0];

  // Ne jamais intercepter le refresh lui-même (évite deadlock / hang).
  if (path === '/auth/session/refresh') {
    return next(req);
  }

  const protectedApi =
    /^\/(users|offres|candidatures|notifications)(\/|$)/.test(path) ||
    /^\/api\/v1\/tests(\/|$)/.test(path) ||
    path === '/auth/me' ||
    /^\/auth\/admin(\/|$)/.test(path) ||
    /^\/auth\/users(\/|$)/.test(path) ||
    path === '/auth/candidates';

  const token = protectedApi ? auth.getAccessToken() : null;

  const request = token
    ? req.clone({
        setHeaders: {
          Authorization: `Bearer ${token}`
        }
      })
    : req;

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {

      // Pas de refresh pour les routes publiques,
      // sans token, ou pour une erreur autre que 401.
      if (!protectedApi || !token || error.status !== 401) {
        return throwError(() => error);
      }

      // Renouvellement sécurisé via cookie HttpOnly — timeout anti-hang.
      return auth.refresh().pipe(
        timeout({ first: 8000 }),
        switchMap(session =>
          next(
            req.clone({
              setHeaders: {
                Authorization: `Bearer ${session.token}`
              }
            })
          )
        ),
        catchError(retryError => {
          if (
            retryError instanceof HttpErrorResponse &&
            retryError.status === 401
          ) {
            auth.clearSession();
          }

          return throwError(() => retryError);
        })
      );
    })
  );
};
