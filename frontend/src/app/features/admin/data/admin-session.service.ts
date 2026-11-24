import { Injectable, inject, signal } from '@angular/core';
import {
  Observable,
  catchError,
  map,
  of,
  shareReplay,
  tap,
  throwError
} from 'rxjs';

import {
  Candidature,
  Offre,
  PlatformService,
  User
} from '../../../core/services/platform.service';

@Injectable({ providedIn: 'root' })
export class AdminSessionService {
  private readonly platform = inject(PlatformService);

  readonly me = signal<User | null>(null);
  readonly users = signal<User[]>([]);
  readonly offres = signal<Offre[]>([]);
  readonly candidatures = signal<Candidature[]>([]);
  readonly avatarUrl = signal<string | null>(null);

  private meInflight$: Observable<User> | null = null;
  private usersInflight$: Observable<User[]> | null = null;
  private offresInflight$: Observable<Offre[]> | null = null;
  private candidaturesInflight$: Observable<Candidature[]> | null = null;
  private avatarInflight$: Observable<string | null> | null = null;
  private usersReady = false;
  private offresReady = false;
  private candidaturesReady = false;
  private avatarReady = false;
  private ownsAvatarBlob = false;

  ensureMe(force = false): Observable<User> {
    const cached = this.me();
    if (!force && cached) return of(cached);
    if (!force && this.meInflight$) return this.meInflight$;

    this.meInflight$ = this.platform.me().pipe(
      tap((u) => {
        this.me.set(u);
        this.meInflight$ = null;
      }),
      catchError((err) => {
        this.me.set(null);
        this.meInflight$ = null;
        return throwError(() => err);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    return this.meInflight$;
  }

  setMe(user: User): void {
    this.me.set(user);
  }

  ensureUsers(force = false): Observable<User[]> {
    if (!force && this.usersReady) return of(this.users());
    if (!force && this.usersInflight$) return this.usersInflight$;

    this.usersInflight$ = this.platform.users().pipe(
      map((list) => list ?? []),
      tap((list) => {
        this.users.set(list);
        this.usersReady = true;
        this.usersInflight$ = null;
      }),
      catchError((err) => {
        this.usersInflight$ = null;
        this.usersReady = false;
        return throwError(() => err);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    return this.usersInflight$;
  }

  refreshUsers(): Observable<User[]> {
    this.usersReady = false;
    this.usersInflight$ = null;
    return this.ensureUsers(true);
  }

  /** Met à jour le flag enabled en mémoire (affichage immédiat post désact./réact.). */
  patchUserEnabled(id: number, enabled: boolean): void {
    const next = this.users().map((u) =>
      u.id === id ? { ...u, enabled } : u
    );
    this.users.set(next);
  }

  /** Ajoute ou remplace un utilisateur dans le cache admin. */
  upsertUser(user: User): void {
    const list = this.users();
    const idx = list.findIndex((u) => u.id === user.id);
    if (idx < 0) {
      this.users.set([user, ...list]);
      return;
    }
    const next = [...list];
    next[idx] = { ...next[idx], ...user };
    this.users.set(next);
  }

  removeUser(id: number): void {
    this.users.set(this.users().filter((u) => u.id !== id));
  }

  /** Toutes les offres (ADMIN via GET /offres/mine). */
  ensureOffres(force = false): Observable<Offre[]> {
    if (!force && this.offresReady) return of(this.offres());
    if (!force && this.offresInflight$) return this.offresInflight$;

    this.offresInflight$ = this.platform.offresMine().pipe(
      map((list) => list ?? []),
      tap((list) => {
        this.offres.set(list);
        this.offresReady = true;
        this.offresInflight$ = null;
      }),
      catchError((err) => {
        this.offresInflight$ = null;
        this.offresReady = false;
        return throwError(() => err);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    return this.offresInflight$;
  }

  refreshOffres(): Observable<Offre[]> {
    this.offresReady = false;
    this.offresInflight$ = null;
    return this.ensureOffres(true);
  }

  ensureCandidatures(force = false): Observable<Candidature[]> {
    if (!force && this.candidaturesReady) return of(this.candidatures());
    if (!force && this.candidaturesInflight$) return this.candidaturesInflight$;

    this.candidaturesInflight$ = this.platform.candidaturesAdmin().pipe(
      map((list) => list ?? []),
      tap((list) => {
        this.candidatures.set(list);
        this.candidaturesReady = true;
        this.candidaturesInflight$ = null;
      }),
      catchError((err) => {
        this.candidaturesInflight$ = null;
        this.candidaturesReady = false;
        return throwError(() => err);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    return this.candidaturesInflight$;
  }

  refreshCandidatures(): Observable<Candidature[]> {
    this.candidaturesReady = false;
    this.candidaturesInflight$ = null;
    return this.ensureCandidatures(true);
  }

  ensureAvatarPhoto(force = false): Observable<string | null> {
    if (!force && this.avatarReady) return of(this.avatarUrl());
    if (!force && this.avatarInflight$) return this.avatarInflight$;

    this.avatarInflight$ = this.platform.downloadProfilePhoto().pipe(
      map((blob) => {
        if (!blob || blob.size === 0) {
          this.revokeAvatar();
          this.avatarUrl.set(null);
          this.avatarReady = true;
          return null;
        }
        this.revokeAvatar();
        const url = URL.createObjectURL(blob);
        this.ownsAvatarBlob = true;
        this.avatarUrl.set(url);
        this.avatarReady = true;
        return url;
      }),
      catchError(() => {
        this.revokeAvatar();
        this.avatarUrl.set(null);
        this.avatarReady = true;
        return of(null);
      }),
      tap(() => {
        this.avatarInflight$ = null;
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    return this.avatarInflight$;
  }

  refreshAvatarPhoto(): Observable<string | null> {
    this.avatarReady = false;
    this.avatarInflight$ = null;
    return this.ensureAvatarPhoto(true);
  }

  clear(): void {
    this.me.set(null);
    this.users.set([]);
    this.offres.set([]);
    this.candidatures.set([]);
    this.revokeAvatar();
    this.avatarUrl.set(null);
    this.meInflight$ = null;
    this.usersInflight$ = null;
    this.offresInflight$ = null;
    this.candidaturesInflight$ = null;
    this.avatarInflight$ = null;
    this.usersReady = false;
    this.offresReady = false;
    this.candidaturesReady = false;
    this.avatarReady = false;
  }

  mapHttpError(status?: number, detail?: string): string {
    const text = this.humanize(detail);
    if (status === 400) return text || 'Requête invalide.';
    if (status === 401) return 'Session expirée. Reconnectez-vous.';
    if (status === 403) return text || 'Accès refusé (permissions insuffisantes).';
    if (status === 404) return text || 'Ressource introuvable.';
    if (status === 409) return text || 'Conflit métier.';
    if (status === 500) return text || 'Erreur serveur. Réessayez plus tard.';
    return text || 'Une erreur est survenue.';
  }

  private humanize(detail?: string): string {
    const raw = (detail || '').trim();
    if (!raw || raw.length > 240) return '';
    const known: Record<string, string> = {
      'User not found': 'Ce compte est introuvable dans l’authentification.',
      'You cannot deactivate or delete your own account':
        'Vous ne pouvez pas désactiver ou supprimer votre propre compte.',
      'Cannot deactivate or delete the last active administrator':
        'Impossible de désactiver ou supprimer le dernier administrateur actif.',
      'Email already exists': 'Cet e-mail est déjà utilisé.',
      'Password must contain at least 8 characters, one uppercase letter, one lowercase letter, one number and one special character':
        '8 caractères min., majuscule, minuscule, chiffre et caractère spécial (@$!%*?&._-).'
    };
    return known[raw] || raw;
  }

  private revokeAvatar(): void {
    const current = this.avatarUrl();
    if (this.ownsAvatarBlob && current?.startsWith('blob:')) {
      URL.revokeObjectURL(current);
    }
    this.ownsAvatarBlob = false;
  }
}
