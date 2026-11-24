import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, finalize, forkJoin, map, of, switchMap } from 'rxjs';

import {
  CandidateSummary,
  Candidature,
  Offre,
  PlatformService,
  RecruiterCandidatureDecision
} from '../../../core/services/platform.service';
import {
  TestApiService,
  TestAssignment,
  TechnicalTest
} from '../../../core/services/test-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { RecruiterSessionService } from '../data/recruiter-session.service';

type Row = Candidature & {
  offreTitle: string;
  candidateName: string;
  matchLabel: string;
  testLabel: string;
  testReadyToInvite: boolean;
  canInvite: boolean;
  otherOffers: string[];
  otherOffersCount: number;
};

@Component({
  selector: 'app-recruiter-candidatures',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './recruiter-candidatures.component.html',
  styleUrl: './recruiter-candidatures.component.scss'
})
export class RecruiterCandidaturesComponent implements OnInit {
  private readonly platform = inject(PlatformService);
  private readonly testsApi = inject(TestApiService);
  private readonly session = inject(RecruiterSessionService);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly toast = inject(ToastService);

  offres: Offre[] = [];
  rows: Row[] = [];
  candidates = new Map<number, CandidateSummary>();
  private assignments = new Map<number, TestAssignment>();
  private testsByOffre = new Map<number, TechnicalTest | null>();

  selectedOffreId: number | null = null;
  statusFilter = '';
  q = '';
  sortKey: 'date' | 'name' | 'match' | 'status' = 'date';
  sortDir: 'asc' | 'desc' = 'desc';
  page = 1;
  readonly pageSize = 12;
  loading = false;
  busyId: number | null = null;
  inviteBusyId: number | null = null;
  acceptedCandidateIds = new Set<number>();

  readonly statusTabs = [
    { value: 'PENDING', label: 'En attente' },
    { value: 'UNDER_REVIEW', label: 'En revue' },
    { value: 'ACCEPTED', label: 'Acceptées' },
    { value: 'REJECTED', label: 'Refusées' },
    { value: 'WITHDRAWN', label: 'Retirées' }
  ] as const;

  ngOnInit(): void {
    const q = this.route.snapshot.queryParamMap.get('offreId');
    if (q && !Number.isNaN(Number(q))) {
      this.selectedOffreId = Number(q);
    } else {
      this.selectedOffreId = null;
    }
    const statusQ = this.route.snapshot.queryParamMap.get('status');
    if (statusQ) {
      this.statusFilter = statusQ;
    }
    this.load();
  }

  load(): void {
    this.loading = true;
    this.cdr.detectChanges();

    this.session
      .ensureMyOffres()
      .pipe(
        switchMap((offres) => {
          this.offres = offres;
          const targets =
            this.selectedOffreId == null
              ? offres
              : offres.filter((o) => o.id === this.selectedOffreId);

          if (!targets.length) {
            this.acceptedCandidateIds = new Set();
            this.assignments.clear();
            this.testsByOffre.clear();
            return of([] as Row[]);
          }

          // Phase 1 (spinner) : lignes via cache session — pas de fan-out tests/acceptés.
          return this.session.loadRowsForOffres(targets).pipe(
            map((rows) =>
              rows.map((r) =>
                this.toRow(r, r.offreTitle || '')
              )
            )
          );
        }),
        finalize(() => {
          this.loading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (rows) => {
          this.rows = this.enrichRows(
            rows.sort((a, b) =>
              (b.appliedAt || '').localeCompare(a.appliedAt || '')
            )
          );
          this.cdr.detectChanges();
          this.loadListExtras();
        },
        error: (err) => {
          this.toast.error(this.session.mapHttpError(err?.status));
          this.cdr.detectChanges();
        }
      });
  }

  /** Tests + acceptés — après affichage de la liste (même règles métier). */
  private loadListExtras(): void {
    const targets =
      this.selectedOffreId == null
        ? this.offres
        : this.offres.filter((o) => o.id === this.selectedOffreId);
    if (!targets.length) return;

    const offreIds = targets.map((o) => o.id);

    forkJoin({
      acceptedIds: this.session
        .loadAcceptedCandidateIds(this.offres)
        .pipe(catchError(() => of(new Set<number>()))),
      directory: this.session
        .ensureCandidates()
        .pipe(catchError(() => of(new Map<number, CandidateSummary>()))),
      assignments: forkJoin(
        offreIds.map((id) =>
          this.testsApi.listAssignments(id).pipe(
            catchError(() => of([] as TestAssignment[])),
            map((list) => ({ id, list: list ?? [] }))
          )
        )
      ),
      tests: forkJoin(
        offreIds.map((id) =>
          this.testsApi.getByOffre(id).pipe(
            catchError(() => of(null as TechnicalTest | null)),
            map((test) => ({ id, test }))
          )
        )
      )
    }).subscribe({
      next: ({ acceptedIds, directory, assignments, tests }) => {
        this.acceptedCandidateIds = acceptedIds;
        this.candidates = directory;
        this.assignments.clear();
        for (const pack of assignments) {
          for (const a of pack.list) {
            this.assignments.set(a.candidatureId, a);
          }
        }
        this.testsByOffre.clear();
        for (const pack of tests) {
          this.testsByOffre.set(pack.id, pack.test);
        }
        this.rows = this.enrichRows(this.rows);
        this.cdr.detectChanges();
      }
    });
  }

  get filtered(): Row[] {
    const q = this.q.trim().toLowerCase();
    return this.rows.filter((r) => {
      if (this.statusFilter && r.status !== this.statusFilter) return false;
      if (!q) return true;
      return `${r.candidateName} ${r.offreTitle} ${r.matchLabel} ${r.testLabel}`
        .toLowerCase()
        .includes(q);
    });
  }

  get view(): { rows: Row[]; page: number; pages: number; total: number } {
    const items = [...this.filtered].sort((a, b) => {
      const dir = this.sortDir === 'asc' ? 1 : -1;
      let av: string | number = '';
      let bv: string | number = '';
      if (this.sortKey === 'name') {
        av = a.candidateName;
        bv = b.candidateName;
      } else if (this.sortKey === 'match') {
        av = a.matchScore == null ? -1 : Number(a.matchScore);
        bv = b.matchScore == null ? -1 : Number(b.matchScore);
      } else if (this.sortKey === 'status') {
        av = a.status;
        bv = b.status;
      } else {
        av = a.appliedAt || '';
        bv = b.appliedAt || '';
      }
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), 'fr', {
              sensitivity: 'base',
              numeric: true
            });
      return cmp * dir;
    });
    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / this.pageSize));
    const page = Math.min(Math.max(this.page, 1), pages);
    if (page !== this.page) this.page = page;
    const start = (page - 1) * this.pageSize;
    return {
      rows: items.slice(start, start + this.pageSize),
      page,
      pages,
      total
    };
  }

  countByStatus(status: string): number {
    return this.rows.filter((r) => r.status === status).length;
  }

  setStatusFilter(status: string): void {
    this.statusFilter = status;
    this.page = 1;
    this.cdr.detectChanges();
  }

  onSearchChange(): void {
    this.page = 1;
  }

  onSortChange(): void {
    this.page = 1;
  }

  toggleDir(): void {
    this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    this.page = 1;
  }

  onOffreChange(): void {
    this.page = 1;
    this.load();
  }

  postesFor(offreId: number): number {
    const o = this.offres.find((x) => x.id === offreId);
    return o?.postes && o.postes > 0 ? o.postes : 1;
  }

  acceptedCountFor(offreId: number): number {
    return this.rows.filter((r) => r.offreId === offreId && r.status === 'ACCEPTED')
      .length;
  }

  hasAcceptedCandidate(candidateId: number): boolean {
    return this.acceptedCandidateIds.has(candidateId);
  }

  cannotAccept(row: Row): boolean {
    if (this.acceptedCountFor(row.offreId) >= this.postesFor(row.offreId)) {
      return true;
    }
    if (this.hasAcceptedCandidate(row.candidateId)) return true;
    if (!row.matchScore && row.matchScore !== 0) return true;
    const a = this.assignments.get(row.id);
    if (!a || (a.status !== 'EVALUATED' && a.status !== 'PUBLISHED')) return true;
    return false;
  }

  acceptBlockedReason(row: Row): string | null {
    if (this.acceptedCountFor(row.offreId) >= this.postesFor(row.offreId)) {
      return `Tous les postes sont pourvus (${this.postesFor(row.offreId)}).`;
    }
    if (this.hasAcceptedCandidate(row.candidateId)) {
      return 'Ce candidat est déjà accepté sur une autre de vos offres.';
    }
    if (row.matchScore == null) {
      return 'Le matching doit être calculé avant l’acceptation.';
    }
    const a = this.assignments.get(row.id);
    if (!a || (a.status !== 'EVALUATED' && a.status !== 'PUBLISHED')) {
      return 'Le candidat doit avoir passé le test (note disponible).';
    }
    return null;
  }

  invite(row: Row): void {
    if (!row.canInvite || this.inviteBusyId != null) return;
    this.inviteBusyId = row.id;
    this.cdr.detectChanges();
    this.testsApi
      .assign(row.offreId, [row.id])
      .pipe(
        finalize(() => {
          this.inviteBusyId = null;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: () => {
          this.toast.success(
            `Invitation au test envoyée à ${row.candidateName}.`
          );
          this.load();
        },
        error: (err) => {
          const detail = this.extractMessage(err)?.trim();
          this.toast.error(detail || this.session.mapHttpError(err?.status));
          this.cdr.detectChanges();
        }
      });
  }

  decide(row: Row, status: RecruiterCandidatureDecision): void {
    if (row.status === 'WITHDRAWN') {
      this.toast.error('Cette candidature a été retirée et ne peut plus être traitée.');
      return;
    }
    if (status === 'ACCEPTED' && this.cannotAccept(row)) {
      this.toast.error(this.acceptBlockedReason(row) || 'Acceptation impossible pour le moment.');
      return;
    }
    this.busyId = row.id;
    this.cdr.detectChanges();
    this.platform
      .updateCandidatureStatus(row.id, status)
      .pipe(
        finalize(() => {
          this.busyId = null;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: () => {
          this.session.invalidateCandidatures(row.offreId);
          this.rows = this.enrichRows(
            this.rows.map((r) => (r.id === row.id ? { ...r, status } : r))
          );
          this.toast.success(
            `Statut mis à jour pour ${row.candidateName} : ${this.labelStatus(status)}.`
          );
          this.session.loadAcceptedCandidateIds(this.offres).subscribe({
            next: (ids) => {
              this.acceptedCandidateIds = ids;
              this.cdr.detectChanges();
            },
            error: () => undefined
          });
          this.cdr.detectChanges();
        },
        error: (err) => {
          const detail = this.extractMessage(err)?.trim();
          this.toast.error(detail || this.session.mapHttpError(err?.status));
          this.cdr.detectChanges();
        }
      });
  }

  labelStatus(s: string): string {
    return (
      {
        PENDING: 'En attente',
        UNDER_REVIEW: 'En revue',
        ACCEPTED: 'Acceptée',
        REJECTED: 'Refusée',
        WITHDRAWN: 'Retirée'
      } as Record<string, string>
    )[s] ?? s;
  }

  chipClass(s: string): string {
    return (
      {
        PENDING: 'pending',
        UNDER_REVIEW: 'review',
        ACCEPTED: 'accepted',
        REJECTED: 'rejected',
        WITHDRAWN: 'withdrawn'
      } as Record<string, string>
    )[s] ?? '';
  }

  bandLabel(band?: string | null): string {
    const key = String(band || '').toLowerCase();
    return (
      { low: 'faible', medium: 'moyen', high: 'élevé' } as Record<string, string>
    )[key] ?? '';
  }

  private enrichRows(rows: Row[]): Row[] {
    const byCandidate = new Map<number, string[]>();
    for (const r of rows) {
      const list = byCandidate.get(r.candidateId) ?? [];
      if (!list.includes(r.offreTitle)) list.push(r.offreTitle);
      byCandidate.set(r.candidateId, list);
    }

    return rows.map((r) => {
      const offers = byCandidate.get(r.candidateId) ?? [r.offreTitle];
      const other = offers.filter((t) => t !== r.offreTitle);
      const matchLabel = this.matchLabelOf(r);
      const testInfo = this.testInfoOf(r);
      const test = this.testsByOffre.get(r.offreId);
      const testReady =
        !!test && (test.status === 'READY' || test.status === 'ASSIGNED');
      const assigned = this.assignments.has(r.id);
      const pendingLike = r.status === 'PENDING' || r.status === 'UNDER_REVIEW';
      return {
        ...r,
        matchLabel,
        testLabel: testInfo,
        testReadyToInvite: testReady,
        canInvite:
          pendingLike &&
          testReady &&
          !assigned &&
          r.matchScore != null,
        otherOffers: other,
        otherOffersCount: offers.length
      };
    });
  }

  private matchLabelOf(r: Candidature): string {
    if (r.matchScore == null) return 'Matching non calculé';
    const pct = Math.round(
      Math.abs(Number(r.matchScore)) <= 1
        ? Number(r.matchScore) * 100
        : Number(r.matchScore)
    );
    const band = this.bandLabel(r.matchBand);
    return band ? `${pct} % · ${band}` : `${pct} %`;
  }

  private testInfoOf(r: Candidature): string {
    const a = this.assignments.get(r.id);
    if (!a) return 'Pas de test';
    if (a.status === 'PUBLISHED' && a.scoreTotal != null) {
      return `Test passé · ${Math.round(Number(a.scoreTotal))}/100`;
    }
    if (a.status === 'EVALUATED' && a.scoreTotal != null) {
      return `Test passé · ${Math.round(Number(a.scoreTotal))}/100`;
    }
    const labels: Record<string, string> = {
      PENDING: 'Test invité',
      IN_PROGRESS: 'Test en cours',
      SUBMITTED: 'Test passé — en correction',
      EVALUATING: 'Test passé — correction…',
      EVALUATED: 'Test passé — à publier',
      PUBLISHED: 'Test passé',
      EXPIRED: 'Test expiré'
    };
    return labels[a.status] ?? a.status;
  }

  private toRow(
    c: Candidature & { candidateName?: string },
    offreTitle: string
  ): Row {
    const cand = this.candidates.get(c.candidateId);
    const fromDir = cand
      ? `${cand.firstName} ${cand.lastName}`.trim()
      : '';
    return {
      ...c,
      offreTitle,
      candidateName:
        fromDir ||
        (c.candidateName || '').trim() ||
        'Nom indisponible',
      matchLabel: '',
      testLabel: '',
      testReadyToInvite: false,
      canInvite: false,
      otherOffers: [],
      otherOffersCount: 1
    };
  }

  private extractMessage(err: unknown): string | undefined {
    const e = err as { error?: { message?: string; error?: string } | string };
    if (typeof e?.error === 'string') return e.error;
    if (e?.error && typeof e.error === 'object') {
      return e.error.message || e.error.error;
    }
    return undefined;
  }
}
