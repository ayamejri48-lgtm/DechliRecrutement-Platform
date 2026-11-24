import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  inject
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription, catchError, finalize, forkJoin, of } from 'rxjs';

import {
  CandidateSummary,
  Candidature,
  MatchResult,
  Offre,
  PlatformService
} from '../../../core/services/platform.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  TestApiService,
  TestAssignment
} from '../../../core/services/test-api.service';
import {
  CandidatureRow,
  CandidatureSnapshot,
  RecruiterSessionService
} from '../data/recruiter-session.service';

type ActivityKind = 'ready' | 'missing' | 'invited' | 'scored' | 'expired';

type ActivityRow = {
  key: string;
  candidatureId: number;
  candidateName: string;
  offreId: number;
  offreTitle: string;
  detail: string;
};

@Component({
  selector: 'app-recruiter-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './recruiter-dashboard.component.html',
  styleUrl: './recruiter-dashboard.component.scss'
})
export class RecruiterDashboardComponent implements OnInit, OnDestroy {
  private readonly session = inject(RecruiterSessionService);
  private readonly toast = inject(ToastService);
  private readonly platform = inject(PlatformService);
  private readonly testsApi = inject(TestApiService);
  private readonly cdr = inject(ChangeDetectorRef);
  private offresSub?: Subscription;
  private snapshotSub?: Subscription;
  private insightsSub?: Subscription;
  private deferTimer?: ReturnType<typeof setTimeout>;

  bootstrapping = true;
  pipelineLoading = false;
  firstName = '';
  myOffres: Offre[] = [];
  recentCandidatures: CandidatureRow[] = [];
  deadlineOffers: Offre[] = [];
  matchReady = 0;
  matchMissing = 0;
  testInvited = 0;
  testScored = 0;
  testExpired = 0;
  matchReadyRows: ActivityRow[] = [];
  matchMissingRows: ActivityRow[] = [];
  testInvitedRows: ActivityRow[] = [];
  testScoredRows: ActivityRow[] = [];
  testExpiredRows: ActivityRow[] = [];
  activityOpen: ActivityKind | null = null;
  insightsLoading = false;

  /** Calendrier des deadlines. */
  calCursor = new Date();
  selectedDeadlineKey: string | null = null;
  readonly weekDays = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  stats = {
    total: 0,
    draft: 0,
    published: 0,
    closed: 0,
    applications: 0
  };

  pipeline = {
    pending: 0,
    underReview: 0,
    accepted: 0,
    rejected: 0,
    withdrawn: 0
  };

  get pipelineSteps(): Array<{
    key: string;
    label: string;
    count: number;
    tone: string;
  }> {
    return [
      { key: 'PENDING', label: 'En attente', count: this.pipeline.pending, tone: 'pending' },
      { key: 'UNDER_REVIEW', label: 'En revue', count: this.pipeline.underReview, tone: 'review' },
      { key: 'ACCEPTED', label: 'Acceptées', count: this.pipeline.accepted, tone: 'accepted' },
      { key: 'REJECTED', label: 'Refusées', count: this.pipeline.rejected, tone: 'rejected' },
      { key: 'WITHDRAWN', label: 'Retirées', count: this.pipeline.withdrawn, tone: 'withdrawn' }
    ];
  }

  ngOnInit(): void {
    this.session.ensureMe().subscribe({
      next: (u) => {
        this.firstName = (u.firstName || '').trim();
        this.cdr.detectChanges();
      },
      error: () => undefined
    });

    if (this.session.hasOffresCache()) {
      this.applyOffres(this.session.myOffres());
      this.bootstrapping = false;
      this.cdr.detectChanges();
    }

    this.offresSub = this.session
      .ensureMyOffres()
      .pipe(
        finalize(() => {
          this.bootstrapping = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (offres) => {
          this.applyOffres(offres);
          this.cdr.detectChanges();
          this.schedulePipeline(offres);
        },
        error: (err) => {
          this.toast.error(this.session.mapHttpError(err?.status));
          this.cdr.detectChanges();
        }
      });
  }

  ngOnDestroy(): void {
    this.offresSub?.unsubscribe();
    this.snapshotSub?.unsubscribe();
    this.insightsSub?.unsubscribe();
    if (this.deferTimer) {
      clearTimeout(this.deferTimer);
    }
  }

  private applyOffres(offres: Offre[]): void {
    this.myOffres = [...offres].sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    );
    const s = this.session.statsFrom(this.myOffres);
    this.stats.total = s.total;
    this.stats.draft = s.draft;
    this.stats.published = s.published;
    this.stats.closed = s.closed;
    this.deadlineOffers = this.computeDeadlines(this.myOffres);
    this.syncCalSelection();
  }

  get pipelineTotal(): number {
    return (
      this.pipeline.pending +
      this.pipeline.underReview +
      this.pipeline.accepted +
      this.pipeline.rejected +
      this.pipeline.withdrawn
    );
  }

  get activityList(): ActivityRow[] {
    switch (this.activityOpen) {
      case 'ready':
        return this.matchReadyRows;
      case 'missing':
        return this.matchMissingRows;
      case 'invited':
        return this.testInvitedRows;
      case 'scored':
        return this.testScoredRows;
      case 'expired':
        return this.testExpiredRows;
      default:
        return [];
    }
  }

  openActivity(kind: ActivityKind): void {
    this.activityOpen = this.activityOpen === kind ? null : kind;
    this.cdr.detectChanges();
  }

  pipelineShare(count: number): number {
    const max = Math.max(1, this.pipelineTotal);
    return Math.round((count / max) * 100);
  }

  isToday(deadline?: string | null): boolean {
    if (!deadline) return false;
    const d = String(deadline).slice(0, 10);
    return d === new Date().toISOString().slice(0, 10);
  }

  get calMonthLabel(): string {
    const label = this.calCursor.toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric'
    });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  get calCells(): Array<{
    key: string | null;
    day: number | null;
    inMonth: boolean;
    isToday: boolean;
    hasDeadline: boolean;
    count: number;
  }> {
    const year = this.calCursor.getFullYear();
    const month = this.calCursor.getMonth();
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // Lundi = 0 … Dimanche = 6
    const startPad = (first.getDay() + 6) % 7;
    const todayKey = this.dateKey(new Date());
    const cells: Array<{
      key: string | null;
      day: number | null;
      inMonth: boolean;
      isToday: boolean;
      hasDeadline: boolean;
      count: number;
    }> = [];

    for (let i = 0; i < startPad; i++) {
      cells.push({
        key: null,
        day: null,
        inMonth: false,
        isToday: false,
        hasDeadline: false,
        count: 0
      });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const key = this.dateKey(new Date(year, month, day));
      const list = this.deadlinesOn(key);
      cells.push({
        key,
        day,
        inMonth: true,
        isToday: key === todayKey,
        hasDeadline: list.length > 0,
        count: list.length
      });
    }
    while (cells.length % 7 !== 0) {
      cells.push({
        key: null,
        day: null,
        inMonth: false,
        isToday: false,
        hasDeadline: false,
        count: 0
      });
    }
    return cells;
  }

  get selectedDeadlineOffers(): Offre[] {
    if (!this.selectedDeadlineKey) return [];
    return this.deadlinesOn(this.selectedDeadlineKey);
  }

  get upcomingDeadlineCount(): number {
    return this.nextDeadlineKeys.length;
  }

  /** Prochaines offres à clôturer (panneau latéral). */
  get nextClosingOffers(): Offre[] {
    const today = this.dateKey(new Date());
    return this.myOffres
      .filter((o) => o.deadline && (o.status === 'PUBLISHED' || o.status === 'CLOSED'))
      .filter((o) => String(o.deadline).slice(0, 10) >= today)
      .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
      .slice(0, 4);
  }

  get selectedDeadlineLabel(): string {
    if (!this.selectedDeadlineKey) return '';
    const [y, m, d] = this.selectedDeadlineKey.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  private get nextDeadlineKeys(): string[] {
    const today = this.dateKey(new Date());
    const keys = new Set<string>();
    for (const o of this.myOffres) {
      if (!o.deadline) continue;
      if (o.status !== 'PUBLISHED' && o.status !== 'CLOSED') continue;
      const key = String(o.deadline).slice(0, 10);
      if (key >= today) keys.add(key);
    }
    return [...keys].sort();
  }

  private syncCalSelection(): void {
    if (this.selectedDeadlineKey) {
      const stillValid = this.deadlinesOn(this.selectedDeadlineKey).length > 0;
      if (stillValid) return;
    }
    const next = this.nextDeadlineKeys[0];
    if (!next) {
      this.selectedDeadlineKey = null;
      return;
    }
    const [y, m] = next.split('-').map(Number);
    this.calCursor = new Date(y, m - 1, 1);
    this.selectedDeadlineKey = next;
  }

  shiftMonth(delta: number): void {
    this.calCursor = new Date(
      this.calCursor.getFullYear(),
      this.calCursor.getMonth() + delta,
      1
    );
    this.selectedDeadlineKey = null;
    this.cdr.detectChanges();
  }

  goCalToday(): void {
    this.calCursor = new Date();
    this.syncCalSelection();
    this.cdr.detectChanges();
  }

  onCalDayClick(cell: { key: string | null; hasDeadline: boolean }): void {
    if (!cell.key || !cell.hasDeadline) {
      this.selectedDeadlineKey = null;
      return;
    }
    this.selectedDeadlineKey =
      this.selectedDeadlineKey === cell.key ? null : cell.key;
  }

  closeDeadlinePopover(): void {
    this.selectedDeadlineKey = null;
  }

  private dateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private deadlinesOn(key: string): Offre[] {
    return this.myOffres
      .filter((o) => o.deadline && String(o.deadline).slice(0, 10) === key)
      .filter((o) => o.status === 'PUBLISHED' || o.status === 'CLOSED')
      .sort((a, b) => a.title.localeCompare(b.title, 'fr'));
  }

  private computeDeadlines(offres: Offre[]): Offre[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const limit = new Date(today);
    limit.setDate(limit.getDate() + 7);
    return offres
      .filter((o) => o.status === 'PUBLISHED' && o.deadline)
      .filter((o) => {
        const d = new Date(String(o.deadline).slice(0, 10) + 'T00:00:00');
        return !Number.isNaN(d.getTime()) && d >= today && d <= limit;
      })
      .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
      .slice(0, 5);
  }

  /** Après 1er paint : une seule passe candidatures (total + pipeline + aperçu). */
  private schedulePipeline(offres: Offre[]): void {
    if (this.deferTimer) {
      clearTimeout(this.deferTimer);
    }
    this.deferTimer = setTimeout(() => this.loadPipeline(offres), 0);
  }

  private loadPipeline(offres: Offre[]): void {
    this.snapshotSub?.unsubscribe();
    this.pipelineLoading = true;
    this.cdr.detectChanges();

    this.snapshotSub = this.session
      .loadCandidatureSnapshot(offres)
      .pipe(
        finalize(() => {
          this.pipelineLoading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (snap) => this.applySnapshot(snap),
        error: () => {
          this.stats.applications = 0;
          this.recentCandidatures = [];
          this.toast.error('Impossible de charger le pipeline candidatures.');
        }
      });
  }

  /** Candidatures à traiter en priorité (PENDING + UNDER_REVIEW). */
  get todoCandidatures(): CandidatureRow[] {
    return this.recentCandidatures
      .filter(
        (c) => c.status === 'PENDING' || c.status === 'UNDER_REVIEW'
      )
      .slice(0, 5);
  }

  get todoCount(): number {
    return this.pipeline.pending + this.pipeline.underReview;
  }

  private applySnapshot(snap: CandidatureSnapshot): void {
    this.stats.applications = snap.total;
    this.pipeline = {
      pending: snap.byStatus.pending,
      underReview: snap.byStatus.underReview,
      accepted: snap.byStatus.accepted,
      rejected: snap.byStatus.rejected,
      withdrawn: snap.byStatus.withdrawn
    };
    this.recentCandidatures = snap.recent;

    if (snap.failedOffres > 0) {
      this.toast.warn(
        `${snap.failedOffres} offre(s) n’ont pas pu être chargées. Totaux potentiellement partiels.`
      );
    }

    this.loadInsights(this.myOffres);
  }

  private loadInsights(offres: Offre[]): void {
    this.insightsSub?.unsubscribe();
    // Même périmètre que le snapshot pipeline / page Candidatures.
    const active = [...offres]
      .filter((o) => o.status === 'PUBLISHED' || o.status === 'CLOSED')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    if (!active.length) {
      this.matchReady = 0;
      this.matchMissing = 0;
      this.testInvited = 0;
      this.testScored = 0;
      this.testExpired = 0;
      this.matchReadyRows = [];
      this.matchMissingRows = [];
      this.testInvitedRows = [];
      this.testScoredRows = [];
      this.testExpiredRows = [];
      return;
    }

    this.insightsLoading = true;
    this.insightsSub = forkJoin({
      matches: forkJoin(
        active.map((o) =>
          this.platform
            .offreMatches(o.id)
            .pipe(catchError(() => of([] as MatchResult[])))
        )
      ),
      assignments: forkJoin(
        active.map((o) =>
          this.testsApi
            .listAssignments(o.id)
            .pipe(catchError(() => of([] as TestAssignment[])))
        )
      ),
      candidatures: this.session.loadRowsForOffres(active).pipe(
        catchError(() => of([] as Candidature[]))
      ),
      candidates: this.session.ensureCandidates().pipe(
        catchError(() => of(new Map<number, CandidateSummary>()))
      )
    })
      .pipe(
        finalize(() => {
          this.insightsLoading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: ({ matches, assignments, candidatures, candidates }) => {
          const names = new Map<number, string>();
          (candidates instanceof Map ? candidates : new Map()).forEach(
            (c, id) => {
              names.set(
                id,
                `${c.firstName || ''} ${c.lastName || ''}`.trim() ||
                  `Candidat #${id}`
              );
            }
          );
          const offreTitle = new Map(active.map((o) => [o.id, o.title]));
          const allCands: Candidature[] = (candidatures ?? []).map((c) => ({
            ...c,
            offreTitle: c.offreTitle || offreTitle.get(c.offreId) || 'Offre'
          }));

          const readyRows: ActivityRow[] = [];
          const matchedIds = new Set<number>();
          active.forEach((o, i) => {
            for (const m of matches[i] ?? []) {
              if (m?.status === 'DONE' && m.score != null) {
                matchedIds.add(m.candidatureId);
                const cand = allCands.find((c) => c.id === m.candidatureId);
                const pct = Math.round(
                  Math.abs(Number(m.score)) <= 1
                    ? Number(m.score) * 100
                    : Number(m.score)
                );
                readyRows.push({
                  key: `m-${m.id}`,
                  candidatureId: m.candidatureId,
                  candidateName:
                    names.get(cand?.candidateId ?? m.candidateId ?? 0) ||
                    `Candidat #${cand?.candidateId ?? m.candidateId ?? '?'}`,
                  offreId: o.id,
                  offreTitle: o.title,
                  detail: `${pct} % · ${m.scoreBand || '—'}`
                });
              }
            }
          });

          const missingRows: ActivityRow[] = allCands
            .filter((c) => !matchedIds.has(c.id))
            .map((c) => ({
              key: `c-${c.id}`,
              candidatureId: c.id,
              candidateName:
                names.get(c.candidateId) || `Candidat #${c.candidateId}`,
              offreId: c.offreId,
              offreTitle: c.offreTitle || offreTitle.get(c.offreId) || 'Offre',
              detail: this.statusLabel(c.status)
            }));

          const invitedRows: ActivityRow[] = [];
          const scoredRows: ActivityRow[] = [];
          const expiredRows: ActivityRow[] = [];
          active.forEach((o, i) => {
            for (const a of assignments[i] ?? []) {
              const row: ActivityRow = {
                key: `t-${a.id}`,
                candidatureId: a.candidatureId,
                candidateName:
                  names.get(a.candidateId) || `Candidat #${a.candidateId}`,
                offreId: o.id,
                offreTitle: o.title,
                detail:
                  a.scoreTotal != null
                    ? `Test passé · ${Math.round(Number(a.scoreTotal))}/100`
                    : a.status === 'SUBMITTED' || a.status === 'EVALUATING'
                      ? 'Test passé — en correction'
                      : a.status === 'EVALUATED'
                        ? 'Test passé — à publier'
                        : a.status === 'PUBLISHED'
                          ? 'Test passé'
                          : a.status
              };
              if (a.status === 'PENDING' || a.status === 'IN_PROGRESS') {
                invitedRows.push(row);
              } else if (
                a.status === 'SUBMITTED' ||
                a.status === 'EVALUATING' ||
                a.status === 'EVALUATED' ||
                a.status === 'PUBLISHED'
              ) {
                // Dès que le candidat a rendu : visible comme « passé / noté »
                scoredRows.push(row);
              } else if (a.status === 'EXPIRED') {
                expiredRows.push(row);
              }
            }
          });

          this.matchReadyRows = readyRows;
          this.matchMissingRows = missingRows;
          this.testInvitedRows = invitedRows;
          this.testScoredRows = scoredRows;
          this.testExpiredRows = expiredRows;
          this.matchReady = readyRows.length;
          this.matchMissing = missingRows.length;
          this.testInvited = invitedRows.length;
          this.testScored = scoredRows.length;
          this.testExpired = expiredRows.length;
          if (!this.activityOpen) {
            if (missingRows.length) this.activityOpen = 'missing';
            else if (readyRows.length) this.activityOpen = 'ready';
            else if (invitedRows.length) this.activityOpen = 'invited';
            else if (expiredRows.length) this.activityOpen = 'expired';
            else if (scoredRows.length) this.activityOpen = 'scored';
          }
          this.cdr.detectChanges();
        },
        error: () => undefined
      });
  }

  statusLabel(status: string): string {
    return (
      {
        DRAFT: 'Brouillon',
        PUBLISHED: 'Publiée',
        CLOSED: 'Clôturée',
        PENDING: 'En attente',
        UNDER_REVIEW: 'En revue',
        ACCEPTED: 'Acceptée',
        REJECTED: 'Refusée',
        WITHDRAWN: 'Retirée'
      } as Record<string, string>
    )[status] ?? status;
  }

  statusClass(status: string): string {
    return (
      {
        DRAFT: 'draft',
        PUBLISHED: 'published',
        CLOSED: 'closed',
        PENDING: 'pending',
        UNDER_REVIEW: 'review',
        ACCEPTED: 'accepted',
        REJECTED: 'rejected',
        WITHDRAWN: 'withdrawn'
      } as Record<string, string>
    )[status] ?? '';
  }
}
