
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  Observable,
  catchError,
  finalize,
  shareReplay,
  tap,
  throwError
} from 'rxjs';

export interface SignupRequest {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
}

export type UserRole = 'ADMIN' | 'RECRUITER' | 'CANDIDATE';

export interface AuthResponse {
  token: string;
  type: string;
  email: string;
  role: UserRole;
  refreshToken?: string | null;
}

const SESSION_STORAGE_KEY = 'dechli.auth.session';

@Injectable({ providedIn: 'root' })
export class AuthService {

  private readonly http = inject(HttpClient);

  private readonly session = signal<AuthResponse | null>(this.readStoredSession());

  private refreshInFlight$: Observable<AuthResponse> | null = null;

  readonly currentSession = this.session.asReadonly();

  register(data: SignupRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>('/auth/register', data);
  }

  login(email: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(
      '/auth/login',
      { email, password },
      { withCredentials: true }
    ).pipe(
      tap(response => this.setSession(response))
    );
  }

  forgotPassword(email: string): Observable<string> {
    return this.http.post(
      '/auth/forgot-password',
      { email },
      { responseType: 'text' }
    );
  }

  resetPassword(token: string, newPassword: string): Observable<string> {
    return this.http.post(
      '/auth/reset-password',
      { token, newPassword },
      { responseType: 'text' }
    );
  }

  refresh(): Observable<AuthResponse> {
    if (this.refreshInFlight$) {
      return this.refreshInFlight$;
    }

    const stored = this.session() ?? this.readStoredSession();
    const body = stored?.refreshToken
      ? { refreshToken: stored.refreshToken }
      : {};

    this.refreshInFlight$ = this.http.post<AuthResponse>(
      '/auth/session/refresh',
      body,
      {
        withCredentials: true,
        headers: { 'X-Session-Request': 'browser' }
      }
    ).pipe(
      tap(response => this.setSession(response)),
      catchError(error => {
        this.clearSession();
        return throwError(() => error);
      }),
      finalize(() => {
        this.refreshInFlight$ = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    return this.refreshInFlight$;
  }

  logout(): Observable<string> {
    this.clearSession();

    return this.http.post(
      '/auth/session/logout',
      {},
      {
        withCredentials: true,
        headers: { 'X-Session-Request': 'browser' },
        responseType: 'text'
      }
    );
  }

  clearSession(): void {
    this.session.set(null);
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // ignore storage errors (mode privé, quota, etc.)
    }
  }

  getAccessToken(): string | null {
    return this.session()?.token ?? null;
  }

  private setSession(response: AuthResponse): void {
    this.session.set(response);
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(response));
    } catch {
      // ignore storage errors
    }
  }

  private readStoredSession(): AuthResponse | null {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as Partial<AuthResponse>;
      if (
        typeof parsed?.token === 'string' &&
        parsed.token &&
        typeof parsed.email === 'string' &&
        (parsed.role === 'ADMIN' || parsed.role === 'RECRUITER' || parsed.role === 'CANDIDATE')
      ) {
        return {
          token: parsed.token,
          type: typeof parsed.type === 'string' ? parsed.type : 'Bearer',
          email: parsed.email,
          role: parsed.role,
          refreshToken: parsed.refreshToken ?? null
        };
      }
    } catch {
      // ignore corrupt storage
    }

    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // ignore
    }

    return null;
  }
}
