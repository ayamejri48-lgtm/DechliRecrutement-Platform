import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  OnInit,
  inject
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

import {
  Candidature,
  CandidateSummary,
  PlatformService,
  User
} from '../../../core/services/platform.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  AdminTestOverview,
  TestApiService
} from '../../../core/services/test-api.service';
import { cmp, slicePage } from '../data/admin-list.util';
import { AdminSessionService } from '../data/admin-session.service';

type Row = Candidature & { candidateName: string };

@Component({
  selector: 'app-admin-candidatures',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-candidatures.component.html',
  styleUrl: './admin-candidatures.component.scss'
})
export class AdminCandidaturesComponent implements OnInit {
  private readonly session = inject(AdminSessionService);
  private readonly toast = inject(ToastService);
  private readonly platform = inject(PlatformService);
  private readonly testsApi = inject(TestApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);

  private readonly staleMs = 7 * 24 * 60 * 60 * 1000;

  loading = true;
  error = '';
  status = '';
  stale = false;
  day = '';
  offreId = 0;
  q = '';
  sortKey: 'name' | 'date' | 'match' = 'date';
  sortDir: 'asc' | 'desc' = 'desc';
  page = 1;
  testsReady = false;
  rows: Row[] = [];
  private testByCand = new Map<number, AdminTestOverview['assignments'][number]>();
  users: User[] = [];
  private offerTitles = new Map<number, string>();

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      this.status = params.get('status') ?? '';
      this.stale = params.get('stale') === '1';
      this.day = params.get('day') ?? '';
      this.offreId = Number(params.get('offre')) || 0;
      this.page = 1;
      this.cdr.detectChanges();
    });
    this.reload();
  }

  get filtered(): Row[] {
    const q = this.q.trim().toLowerCase();
    return this.rows.filter((r) => {
      if (this.status && r.status !== this.status) return false;
      if (this.offreId && r.offreId !== this.offreId) return false;
      if (this.day && this.dayOf(r.appliedAt) !== this.day) return false;
      if (this.stale && !this.isBlocked(r)) return false;
      if (!q) return true;
      return `${r.candidateName} ${r.offreTitle ?? ''}`
        .toLowerCase()
        .includes(q);
    });
  }

  reload(): void {
    this.loading = true;
    this.session.ensureUsers().subscribe({ next: (u) => (this.users = u) });
    this.session.ensureOffres().subscribe({
      next: (offres) => {
        this.offerTitles = new Map(
          (offres ?? []).filter((o) => !!o.title).map((o) => [o.id, o.title])
        );
        this.rows = this.rows.map((r) => ({
          ...r,
          offreTitle: r.offreTitle || this.offerTitles.get(r.offreId) || ''
        }));
        this.cdr.detectChanges();
      }
    });
    this.platform.candidates().subscribe({
      next: (cands) => this.applyNames(cands ?? []),
      error: () => undefined
    });
    forkJoin({
      list: this.session.refreshCandidatures(),
      overview: this.testsApi.adminOverview().pipe(
        catchError(() => of(null as AdminTestOverview | null))
      )
    })
      .pipe(
        finalize(() => {
          this.loading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: ({ list, overview }) => {
          this.testsReady = overview != null;
          this.testByCand = new Map(
            (overview?.assignments ?? []).map((a) => [a.candidatureId, a])
          );
          this.rows = (list ?? []).map((c) => ({
            ...c,
            offreTitle: c.offreTitle || this.offerTitles.get(c.offreId) || '',
            candidateName: this.nameOf(c.candidateId)
          }));
        },
        error: (err) => {
          this.toast.error(this.session.mapHttpError(err?.status));
        }
      });
  }

  get view() {
    const items = [...this.filtered].sort((a, b) => {
      const dir = this.sortDir === 'asc' ? 1 : -1;
      const av =
        this.sortKey === 'name'
          ? a.candidateName
          : this.sortKey === 'match'
            ? Number(a.matchScore ?? -1)
            : a.appliedAt || '';
      const bv =
        this.sortKey === 'name'
          ? b.candidateName
          : this.sortKey === 'match'
            ? Number(b.matchScore ?? -1)
            : b.appliedAt || '';
      return cmp(av, bv) * dir;
    });
    const sliced = slicePage(items, this.page);
    if (sliced.page !== this.page) this.page = sliced.page;
    return sliced;
  }

  toggleDir(): void {
    this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    this.page = 1;
  }

  dayTitle(): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.day)) return this.day;
    const [year, month, date] = this.day.split('-').map(Number);
    return new Date(year, month - 1, date).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  matchLabel(r: Row): string {
    if (r.matchScore == null || Number.isNaN(Number(r.matchScore))) {
      return 'Matching pas encore calculé';
    }
    const band =
      (
        { low: 'faible', medium: 'moyen', high: 'élevé', unavailable: 'indisponible' } as Record<
          string,
          string
        >
      )[(r.matchBand || '').toLowerCase()] ?? '';
    const pct = `Matching ${Math.round(Number(r.matchScore) * 100)} %`;
    return band ? `${pct} · ${band}` : pct;
  }

  testLabel(id: number): string {
    if (!this.testsReady) return 'Test indisponible';
    const a = this.testByCand.get(id);
    if (!a) return 'Test non passé';
    const score = a.scoreTotal != null ? `${a.scoreTotal}/100` : '';
    const labels: Record<string, string> = {
      PENDING: 'Test non passé · invité',
      IN_PROGRESS: 'Test en cours',
      SUBMITTED: 'Test rendu · pas encore noté',
      EVALUATING: 'Test en correction',
      EVALUATED: score ? `Test noté ${score} · non publié` : 'Test noté · non publié',
      PUBLISHED: score ? `Test publié ${score}` : 'Test publié',
      EXPIRED: 'Test expiré · non passé'
    };
    return labels[a.status] ?? `Test ${a.status}`;
  }

  private dayOf(appliedAt?: string): string {
    return (appliedAt || '').slice(0, 10);
  }

  private isBlocked(r: { status: string; appliedAt?: string }): boolean {
    if (!['PENDING', 'UNDER_REVIEW'].includes(r.status) || !r.appliedAt) return false;
    const t = new Date(r.appliedAt).getTime();
    return Number.isFinite(t) && Date.now() - t >= this.staleMs;
  }

  statusClass(s: string): string {
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

  private applyNames(cands: CandidateSummary[]): void {
    const map = new Map(cands.map((c) => [c.id, c]));
    this.rows = this.rows.map((r) => {
      const c = map.get(r.candidateId);
      return {
        ...r,
        candidateName: c
          ? `${c.firstName} ${c.lastName}`.trim()
          : this.nameOf(r.candidateId)
      };
    });
    this.cdr.detectChanges();
  }

  private nameOf(candidateId: number): string {
    const u = this.users.find((x) => x.id === candidateId);
    if (u) return `${u.firstName} ${u.lastName}`.trim();
    return 'Nom indisponible';
  }
}
