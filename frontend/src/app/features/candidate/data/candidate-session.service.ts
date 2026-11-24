import { Injectable, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import {
  Observable,
  catchError,
  from,
  map,
  of,
  shareReplay,
  switchMap,
  tap,
  throwError,
  timeout
} from 'rxjs';

import { PlatformService, User } from '../../../core/services/platform.service';

export type CachedCvPreview = {
  raw: string;
  safe: SafeResourceUrl;
  name: string;
};

/**
 * Cache session candidat — même mécanisme que admin/recruteur.
 * Évite de re-télécharger /users/me, photo et CV à chaque navigation.
 */
@Injectable({ providedIn: 'root' })
export class CandidateSessionService {
  private readonly platform = inject(PlatformService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly me = signal<User | null>(null);
  readonly avatarUrl = signal<string | null>(null);

  private meInflight$: Observable<User> | null = null;
  private avatarInflight$: Observable<string | null> | null = null;
  private avatarReady = false;
  private ownsAvatarBlob = false;
  private readonly photoTimeoutMs = 12000;
  private readonly cvTimeoutMs = 10000;
  private readonly cvCache = new Map<number, CachedCvPreview>();
  private readonly cvInflight = new Map<number, Observable<CachedCvPreview>>();

  ensureMe(force = false): Observable<User> {
    const cached = this.me();
    if (!force && cached) {
      return of(cached);
    }
    if (!force && this.meInflight$) {
      return this.meInflight$;
    }

    this.meInflight$ = this.platform.me().pipe(
      tap((u) => {
        this.me.set(u);
        this.meInflight$ = null;
      }),
      catchError((err) => {
        this.meInflight$ = null;
        return throwError(() => err);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    return this.meInflight$;
  }

  /**
   * Photo de profil une fois par session (cache + dédup inflight).
   * Timeout anti-blocage réseau.
   */
  ensureAvatarPhoto(force = false): Observable<string | null> {
    if (!force && this.avatarReady) {
      return of(this.avatarUrl());
    }
    if (!force && this.avatarInflight$) {
      return this.avatarInflight$;
    }

    this.avatarInflight$ = this.platform.downloadProfilePhoto().pipe(
      timeout({ first: this.photoTimeoutMs }),
      map((blob) => {
        if (!blob || blob.size === 0) {
          this.revokeAvatarBlob();
          this.avatarUrl.set(null);
          this.avatarReady = true;
          return null;
        }
        const type = (blob.type || '').toLowerCase();
        if (type && !type.startsWith('image/') && type !== 'application/octet-stream') {
          this.revokeAvatarBlob();
          this.avatarUrl.set(null);
          this.avatarReady = true;
          return null;
        }
        this.revokeAvatarBlob();
        const url = URL.createObjectURL(blob);
        this.ownsAvatarBlob = true;
        this.avatarUrl.set(url);
        this.avatarReady = true;
        return url;
      }),
      catchError(() => {
        this.revokeAvatarBlob();
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

  /** Affichage immédiat après upload (avant refresh serveur). */
  setLocalAvatar(url: string): void {
    this.revokeAvatarBlob();
    this.ownsAvatarBlob = true;
    this.avatarUrl.set(url);
    this.avatarReady = true;
    this.avatarInflight$ = null;
  }

  patchMe(user: User): void {
    this.me.set(user);
  }

  /** Aperçu CV (cache session + dédup inflight), comme la photo. */
  getCachedCv(cvId: number): CachedCvPreview | null {
    return this.cvCache.get(cvId) ?? null;
  }

  ensureCvPreview(cvId: number, fileName: string, force = false): Observable<CachedCvPreview> {
    if (!force) {
      const cached = this.cvCache.get(cvId);
      if (cached) {
        return of(cached);
      }
      const inflight = this.cvInflight.get(cvId);
      if (inflight) {
        return inflight;
      }
    }

    const req$ = this.platform.downloadCv(cvId).pipe(
      timeout({ first: this.cvTimeoutMs }),
      switchMap((blob) => from(this.toPdfPreview(blob, fileName))),
      tap((entry) => {
        const previous = this.cvCache.get(cvId);
        if (previous && previous.raw !== entry.raw) {
          URL.revokeObjectURL(previous.raw);
        }
        this.cvCache.set(cvId, entry);
        this.cvInflight.delete(cvId);
      }),
      catchError((err) => {
        this.cvInflight.delete(cvId);
        return throwError(() => err);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.cvInflight.set(cvId, req$);
    return req$;
  }

  /** Précharge en arrière-plan (actif en premier) — n’affiche rien. */
  prefetchCvs(cvs: { id: number; fileName: string; active?: boolean }[]): void {
    const ordered = [...cvs].sort((a, b) => Number(!!b.active) - Number(!!a.active));
    for (const cv of ordered.slice(0, 3)) {
      if (this.cvCache.has(cv.id) || this.cvInflight.has(cv.id)) {
        continue;
      }
      this.ensureCvPreview(cv.id, cv.fileName).subscribe({ error: () => undefined });
    }
  }

  invalidateCv(cvId?: number): void {
    if (cvId != null) {
      const entry = this.cvCache.get(cvId);
      if (entry) {
        URL.revokeObjectURL(entry.raw);
        this.cvCache.delete(cvId);
      }
      this.cvInflight.delete(cvId);
      return;
    }
    for (const entry of this.cvCache.values()) {
      URL.revokeObjectURL(entry.raw);
    }
    this.cvCache.clear();
    this.cvInflight.clear();
  }

  clear(): void {
    this.me.set(null);
    this.meInflight$ = null;
    this.avatarInflight$ = null;
    this.avatarReady = false;
    this.revokeAvatarBlob();
    this.avatarUrl.set(null);
    this.invalidateCv();
  }

  private async toPdfPreview(blob: Blob, fileName: string): Promise<CachedCvPreview> {
    if (!blob || blob.size === 0) {
      throw new Error('EMPTY_CV');
    }
    const type = (blob.type || '').toLowerCase();
    if (type.includes('json') || type.includes('text/html') || type.includes('text/plain')) {
      throw new Error('INVALID_CV');
    }
    const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    const magic = String.fromCharCode(...head);
    if (!magic.startsWith('%PDF')) {
      throw new Error('INVALID_CV');
    }
    const pdf =
      type === 'application/pdf' || type === '' || type === 'application/octet-stream'
        ? blob
        : new Blob([blob], { type: 'application/pdf' });
    const raw = URL.createObjectURL(pdf);
    const safe = this.sanitizer.bypassSecurityTrustResourceUrl(
      `${raw}#navpanes=0&toolbar=1&view=FitH`
    );
    return { raw, safe, name: fileName };
  }

  private revokeAvatarBlob(): void {
    const current = this.avatarUrl();
    if (this.ownsAvatarBlob && current?.startsWith('blob:')) {
      URL.revokeObjectURL(current);
    }
    this.ownsAvatarBlob = false;
  }
}
