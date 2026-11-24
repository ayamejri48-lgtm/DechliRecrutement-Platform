import { Injectable, inject, signal } from '@angular/core';
import {
  Observable,
  catchError,
  forkJoin,
  map,
  of,
  shareReplay,
  tap,
  throwError,
  timeout
} from 'rxjs';

import {
  CandidateSummary,
  Candidature,
  Offre,
  PlatformService,
  User
} from '../../../core/services/platform.service';

export type CandidatureRow = Candidature & {
  offreTitle: string;
  candidateName: string;
};

export type CandidatureSnapshot = {
  total: number;
  byStatus: {
    pending: number;
    underReview: number;
    accepted: number;
    rejected: number;
    withdrawn: number;
    other: number;
  };
  recent: CandidatureRow[];
  loadedOffres: number;
  failedOffres: number;
};

/**
 * Facade espace recruteur (perf + architecture).
 * Cache /users/me, offres, candidats et candidatures par offre.
 */
@Injectable({ providedIn: 'root' })
export class RecruiterSessionService {
  private readonly platform = inject(PlatformService);

  readonly me = signal<User | null>(null);
  readonly myOffres = signal<Offre[]>([]);
  readonly meLoading = signal(false);
  readonly offresLoading = signal(false);
  /** Photo profil (blob URL) — header + pages. */
  readonly avatarUrl = signal<string | null>(null);

  private meInflight$: Observable<User> | null = null;
  private offresInflight$: Observable<Offre[]> | null = null;
  private avatarInflight$: Observable<string | null> | null = null;
  private avatarReady = false;
  private ownsAvatarBlob = false;
  private offresReady = false;
  /** Ignore les réponses HTTP obsolètes après invalidate/refresh. */
  private offresFetchGen = 0;

  private candidaturesByOffreCache = new Map<number, CandidatureRow[]>();
  private candidaturesInflight = new Map<
    number,
    Observable<{ rows: CandidatureRow[]; failed: boolean }>
  >();
  private candidaturesTotalCache: { key: string; total: number } | null = null;
  private snapshotCache: { key: string; data: CandidatureSnapshot } | null =
    null;
  private acceptedIdsCache: { key: string; ids: Set<number> } | null = null;

  private candidatesById = new Map<number, CandidateSummary>();
  private candidatesReady = false;
  private candidatesInflight$: Observable<Map<number, CandidateSummary>> | null =
    null;

  hasOffresCache(): boolean {
    return this.offresReady;
  }

  ensureMe(force = false): Observable<User> {
    const cached = this.me();
    if (!force && cached) {
      return of(cached);
    }
    if (!force && this.meInflight$) {
      return this.meInflight$;
    }

    this.meLoading.set(true);
    this.meInflight$ = this.platform.me().pipe(
      tap((u) => {
        this.me.set(u);
        this.meLoading.set(false);
      }),
      catchError((err) => {
        this.me.set(null);
        this.meLoading.set(false);
        this.meInflight$ = null;
        return throwError(() => err);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    return this.meInflight$;
  }

  ensureMyOffres(force = false): Observable<Offre[]> {
    if (!force && this.offresReady) {
      return of(this.myOffres());
    }
    if (!force && this.offresInflight$) {
      return this.offresInflight$;
    }

    const gen = ++this.offresFetchGen;
    this.offresLoading.set(true);
    // Endpoint ownership serveur — pas de filtre client sur le catalogue global.
    this.offresInflight$ = this.platform.offresMine().pipe(
      map((list) => list ?? []),
      tap((mine) => {
        // Ignore une réponse plus ancienne qu’un invalidate/refresh récent.
        if (gen !== this.offresFetchGen) {
          return;
        }
        this.myOffres.set(mine);
        this.offresReady = true;
        this.offresLoading.set(false);
        this.offresInflight$ = null;
      }),
      catchError((err) => {
        if (gen === this.offresFetchGen) {
          this.offresLoading.set(false);
          this.offresInflight$ = null;
          this.offresReady = false;
        }
        return throwError(() => err);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    return this.offresInflight$;
  }

  /** Annuaire candidats (1 appel, cache session). */
  ensureCandidates(force = false): Observable<Map<number, CandidateSummary>> {
    if (!force && this.candidatesReady) {
      return of(this.candidatesById);
    }
    if (!force && this.candidatesInflight$) {
      return this.candidatesInflight$;
    }

    this.candidatesInflight$ = this.platform.candidates().pipe(
      map((list) => {
        const mapById = new Map<number, CandidateSummary>();
        for (const c of list ?? []) {
          mapById.set(c.id, c);
        }
        this.candidatesById = mapById;
        this.candidatesReady = true;
        return mapById;
      }),
      catchError(() => {
        this.candidatesById = new Map();
        this.candidatesReady = true;
        return of(this.candidatesById);
      }),
      tap(() => {
        this.candidatesInflight$ = null;
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    return this.candidatesInflight$;
  }

  /** Invalide agrégats dashboard (pipeline / totaux) — pas les listes. */
  invalidateAggregates(): void {
    this.snapshotCache = null;
    this.candidaturesTotalCache = null;
    this.acceptedIdsCache = null;
  }

  /**
   * Invalide le cache candidatures (+ agrégats).
   * @param offreId si fourni : uniquement cette offre ; sinon toutes.
   * Ne touche pas au cache offres.
   */
  invalidateCandidatures(offreId?: number): void {
    if (offreId != null) {
      this.candidaturesByOffreCache.delete(offreId);
      this.candidaturesInflight.delete(offreId);
    } else {
      this.candidaturesByOffreCache.clear();
      this.candidaturesInflight.clear();
    }
    this.invalidateAggregates();
  }

  /**
   * Force un prochain GET /offres/mine.
   * Par défaut conserve le cache candidatures (publish/close ne les altèrent pas).
   */
  invalidateOffres(opts?: { clearCandidatures?: boolean }): void {
    this.offresFetchGen += 1;
    this.offresReady = false;
    this.offresInflight$ = null;
    this.invalidateAggregates();
    if (opts?.clearCandidatures) {
      this.candidaturesByOffreCache.clear();
      this.candidaturesInflight.clear();
    }
  }

  refreshOffres(): Observable<Offre[]> {
    this.invalidateOffres();
    return this.ensureMyOffres(true);
  }

  /**
   * Insert / maj locale (après create/update API).
   * Agrégats invalidés seulement si le statut change (clé snapshot).
   * Titre changé → invalide les candidatures de cette offre (libellés).
   */
  upsertOffre(offre: Offre): void {
    const current = this.myOffres();
    const prev = current.find((o) => o.id === offre.id);
    const idx = current.findIndex((o) => o.id === offre.id);
    const next =
      idx >= 0
        ? current.map((o, i) => (i === idx ? offre : o))
        : [offre, ...current];
    this.myOffres.set(next);
    this.offresReady = true;

    if (!prev || prev.status !== offre.status) {
      this.invalidateAggregates();
    } else if (prev.title !== offre.title) {
      this.invalidateCandidatures(offre.id);
    }
  }

  /** Maj locale du statut (publish / close) — 0 GET. */
  patchOffreStatus(id: number, status: Offre['status']): void {
    const current = this.myOffres();
    if (!current.some((o) => o.id === id)) {
      this.invalidateOffres();
      return;
    }
    this.myOffres.set(
      current.map((o) => (o.id === id ? { ...o, status } : o))
    );
    this.offresReady = true;
    this.invalidateAggregates();
  }

  /** Retrait local (delete brouillon) — 0 GET. */
  removeOffreLocal(id: number): void {
    this.myOffres.set(this.myOffres().filter((o) => o.id !== id));
    this.invalidateCandidatures(id);
  }

  setMe(user: User): void {
    this.me.set(user);
  }

  /**
   * Charge la photo de profil une fois (cache session).
   * Utilisée par le header et la page Mon profil.
   */
  ensureAvatarPhoto(force = false): Observable<string | null> {
    if (!force && this.avatarReady) {
      return of(this.avatarUrl());
    }
    if (!force && this.avatarInflight$) {
      return this.avatarInflight$;
    }

    this.avatarInflight$ = this.platform.downloadProfilePhoto().pipe(
      map((blob) => {
        if (!blob || blob.size === 0) {
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

  private revokeAvatarBlob(): void {
    const current = this.avatarUrl();
    if (this.ownsAvatarBlob && current?.startsWith('blob:')) {
      URL.revokeObjectURL(current);
    }
    this.ownsAvatarBlob = false;
  }

  private activeOffres(offres: Offre[]): Offre[] {
    return [...offres]
      .filter((o) => o.status === 'PUBLISHED' || o.status === 'CLOSED')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  private candidateName(
    candidateId: number,
    directory: Map<number, CandidateSummary>
  ): string {
    const c = directory.get(candidateId);
    if (!c) return `Candidat #${candidateId}`;
    const full = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
    return full || `Candidat #${candidateId}`;
  }

  private enrichRows(
    rows: Array<Candidature & { offreTitle: string }>,
    directory: Map<number, CandidateSummary>
  ): CandidatureRow[] {
    return rows.map((r) => ({
      ...r,
      candidateName: this.candidateName(r.candidateId, directory)
    }));
  }

  private candidaturesForOffre(
    offre: Offre
  ): Observable<{ rows: CandidatureRow[]; failed: boolean }> {
    const cached = this.candidaturesByOffreCache.get(offre.id);
    if (cached) {
      return of({ rows: cached, failed: false });
    }

    const inflight = this.candidaturesInflight.get(offre.id);
    if (inflight) {
      return inflight;
    }

    const req$ = this.platform.candidaturesByOffre(offre.id).pipe(
      timeout({ first: 2500 }),
      map((list) => {
        const base = (list ?? []).map((c) => ({
          ...c,
          offreTitle: offre.title,
          candidateName: `Candidat #${c.candidateId}`
        }));
        return { rows: base, failed: false };
      }),
      catchError(() => of({ rows: [] as CandidatureRow[], failed: true })),
      tap((result) => {
        if (!result.failed) {
          this.candidaturesByOffreCache.set(offre.id, result.rows);
        }
        this.candidaturesInflight.delete(offre.id);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.candidaturesInflight.set(offre.id, req$);
    return req$;
  }

  private buildSnapshot(
    groups: Array<{ rows: CandidatureRow[]; failed: boolean }>,
    directory: Map<number, CandidateSummary>
  ): CandidatureSnapshot {
    const all = groups.flatMap((g) => this.enrichRows(g.rows, directory));
    // Enrich + refresh cache entries with names
    for (const g of groups) {
      if (!g.failed && g.rows.length) {
        const offreId = g.rows[0]?.offreId;
        if (offreId != null) {
          this.candidaturesByOffreCache.set(
            offreId,
            this.enrichRows(g.rows, directory)
          );
        }
      }
    }

    const byStatus = {
      pending: 0,
      underReview: 0,
      accepted: 0,
      rejected: 0,
      withdrawn: 0,
      other: 0
    };

    for (const c of all) {
      switch (c.status) {
        case 'PENDING':
          byStatus.pending += 1;
          break;
        case 'UNDER_REVIEW':
          byStatus.underReview += 1;
          break;
        case 'ACCEPTED':
          byStatus.accepted += 1;
          break;
        case 'REJECTED':
          byStatus.rejected += 1;
          break;
        case 'WITHDRAWN':
          byStatus.withdrawn += 1;
          break;
        default:
          byStatus.other += 1;
      }
    }

    const recent = [...all]
      .sort((a, b) => (b.appliedAt || '').localeCompare(a.appliedAt || ''))
      .slice(0, 8);

    return {
      total: all.length,
      byStatus,
      recent,
      loadedOffres: groups.length,
      failedOffres: groups.filter((g) => g.failed).length
    };
  }

  /**
   * Une seule passe : total + pipeline + aperçu multi-offres + noms.
   * Réutilise le cache candidatures ; candidates() appelé au plus une fois.
   */
  loadCandidatureSnapshot(offres: Offre[]): Observable<CandidatureSnapshot> {
    // Toutes les offres actives (publiées + clôturées) — même base que la liste Candidatures.
    const targets = this.activeOffres(offres);
    const key = targets.map((o) => o.id).join(',') || 'none';

    if (this.snapshotCache?.key === key) {
      return of(this.snapshotCache.data);
    }
    if (!targets.length) {
      const empty: CandidatureSnapshot = {
        total: 0,
        byStatus: {
          pending: 0,
          underReview: 0,
          accepted: 0,
          rejected: 0,
          withdrawn: 0,
          other: 0
        },
        recent: [],
        loadedOffres: 0,
        failedOffres: 0
      };
      this.snapshotCache = { key, data: empty };
      this.candidaturesTotalCache = { key, total: 0 };
      return of(empty);
    }

    return forkJoin({
      directory: this.ensureCandidates(),
      groups: forkJoin(targets.map((o) => this.candidaturesForOffre(o)))
    }).pipe(
      map(({ directory, groups }) => this.buildSnapshot(groups, directory)),
      tap((data) => {
        this.snapshotCache = { key, data };
        this.candidaturesTotalCache = { key, total: data.total };
      })
    );
  }

  /**
   * IDs candidats déjà ACCEPTED sur au moins une offre active du recruteur.
   * Réutilise le cache candidatures (0 HTTP si déjà chargé) — même règle métier.
   */
  loadAcceptedCandidateIds(offres: Offre[]): Observable<Set<number>> {
    // Brouillons : pas de pipeline décisionnel ; on aligne sur les offres actives.
    const targets = this.activeOffres(offres);
    const key = targets.map((o) => o.id).join(',') || 'none';
    if (this.acceptedIdsCache?.key === key) {
      return of(this.acceptedIdsCache.ids);
    }
    if (!targets.length) {
      const empty = new Set<number>();
      this.acceptedIdsCache = { key, ids: empty };
      return of(empty);
    }

    const fromCacheOnly = this.acceptedIdsFromCache(targets);
    if (fromCacheOnly) {
      this.acceptedIdsCache = { key, ids: fromCacheOnly };
      return of(fromCacheOnly);
    }

    return forkJoin(
      targets.map((o) =>
        this.candidaturesForOffre(o).pipe(
          map((result) =>
            result.failed
              ? ([] as number[])
              : result.rows
                  .filter((r) => r.status === 'ACCEPTED')
                  .map((r) => r.candidateId)
          )
        )
      )
    ).pipe(
      map((groups) => new Set<number>(groups.flat())),
      tap((ids) => {
        this.acceptedIdsCache = { key, ids };
      })
    );
  }

  /**
   * Candidatures enrichies pour N offres — réutilise cache + timeout session.
   * Remplace les N appels directs platform.candidaturesByOffre() côté pages.
   */
  loadRowsForOffres(offres: Offre[]): Observable<CandidatureRow[]> {
    const targets = [...offres];
    if (!targets.length) {
      return of([]);
    }
    return forkJoin({
      directory: this.ensureCandidates(),
      groups: forkJoin(targets.map((o) => this.candidaturesForOffre(o)))
    }).pipe(
      map(({ directory, groups }) =>
        groups.flatMap((g) =>
          g.failed ? [] : this.enrichRows(g.rows, directory)
        )
      )
    );
  }

  private acceptedIdsFromCache(targets: Offre[]): Set<number> | null {
    const ids = new Set<number>();
    for (const o of targets) {
      const rows = this.candidaturesByOffreCache.get(o.id);
      if (!rows) return null;
      for (const r of rows) {
        if (r.status === 'ACCEPTED') ids.add(r.candidateId);
      }
    }
    return ids;
  }

  /**
   * Toutes les candidatures d’un candidat sur les offres du recruteur
   * (réutilise le cache par offre).
   */
  findApplicationsByCandidate(
    candidateId: number,
    offres: Offre[]
  ): Observable<CandidatureRow[]> {
    const targets = [...offres];
    if (!targets.length) {
      return of([]);
    }
    return forkJoin(
      targets.map((o) =>
        this.candidaturesForOffre(o).pipe(
          map((result) =>
            result.failed
              ? []
              : result.rows.filter((r) => r.candidateId === candidateId)
          )
        )
      )
    ).pipe(
      map((groups) =>
        groups
          .flat()
          .sort((a, b) => (b.appliedAt || '').localeCompare(a.appliedAt || ''))
      )
    );
  }

  /**
   * Compteurs candidatures par offre (réutilise le cache /offre).
   * Non bloquant : à appeler en arrière-plan sur la page courante.
   */
  loadCandidatureCountsByOffre(
    offres: Offre[]
  ): Observable<Map<number, number>> {
    const targets = [...offres];
    if (!targets.length) {
      return of(new Map());
    }

    return forkJoin(
      targets.map((o) =>
        this.candidaturesForOffre(o).pipe(
          map((result) => ({
            id: o.id,
            count: result.failed ? null : result.rows.length
          }))
        )
      )
    ).pipe(
      map((rows) => {
        const out = new Map<number, number>();
        for (const row of rows) {
          if (row.count != null) {
            out.set(row.id, row.count);
          }
        }
        return out;
      })
    );
  }

  /** Total réel sur toutes les offres actives — non bloquant pour l’UI. */
  countCandidaturesTotal(offres: Offre[]): Observable<number> {
    const targets = this.activeOffres(offres);
    const key = targets.map((o) => o.id).join(',') || 'none';

    if (this.candidaturesTotalCache?.key === key) {
      return of(this.candidaturesTotalCache.total);
    }
    if (this.snapshotCache?.key === key) {
      return of(this.snapshotCache.data.total);
    }

    return this.loadCandidatureSnapshot(offres).pipe(map((s) => s.total));
  }

  /** Aperçu liste multi-offres — partage le snapshot / cache. */
  loadCandidaturesPreview(
    offres: Offre[],
    limit = 8
  ): Observable<CandidatureRow[]> {
    return this.loadCandidatureSnapshot(offres).pipe(
      map((s) => s.recent.slice(0, limit))
    );
  }

  clear(): void {
    this.me.set(null);
    this.myOffres.set([]);
    this.meInflight$ = null;
    this.offresInflight$ = null;
    this.offresReady = false;
    this.revokeAvatarBlob();
    this.avatarUrl.set(null);
    this.avatarReady = false;
    this.avatarInflight$ = null;
    this.candidaturesByOffreCache.clear();
    this.candidaturesInflight.clear();
    this.candidaturesTotalCache = null;
    this.snapshotCache = null;
    this.acceptedIdsCache = null;
    this.candidatesById.clear();
    this.candidatesReady = false;
    this.candidatesInflight$ = null;
    this.meLoading.set(false);
    this.offresLoading.set(false);
  }

  mapHttpError(status?: number, detail?: string): string {
    if (status === 400) return detail || 'Requête invalide.';
    if (status === 401) return 'Session expirée. Reconnectez-vous.';
    if (status === 403) return 'Accès refusé (permissions insuffisantes).';
    if (status === 404) return 'Ressource introuvable.';
    if (status === 500) return 'Erreur serveur. Réessayez plus tard.';
    return detail || 'Une erreur est survenue.';
  }

  statsFrom(offres: Offre[]): {
    total: number;
    draft: number;
    published: number;
    closed: number;
  } {
    return {
      total: offres.length,
      draft: offres.filter((o) => o.status === 'DRAFT').length,
      published: offres.filter((o) => o.status === 'PUBLISHED').length,
      closed: offres.filter((o) => o.status === 'CLOSED').length
    };
  }
}
