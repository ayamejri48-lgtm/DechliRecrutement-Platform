import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  inject
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription, forkJoin, of, timer } from 'rxjs';
import { catchError, finalize, map, switchMap, takeWhile } from 'rxjs/operators';

import {
  CandidateSummary,
  Candidature,
  Offre,
  PlatformService
} from '../../../core/services/platform.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  CorrectionDetail,
  GenerationHistory,
  TechnicalTest,
  TestApiService,
  TestAssignment
} from '../../../core/services/test-api.service';
import { RecruiterSessionService } from '../data/recruiter-session.service';

export type SessionFilter =
  | 'all'
  | 'todo'
  | 'evaluated'
  | 'published'
  | 'scored'
  | 'expired'
  | 'active';

/** Ligne de suivi multi-offres (Sessions). */
type SessionRow = {
  assignment: TestAssignment;
  offreId: number;
  offreTitle: string;
};

@Component({
  selector: 'app-recruiter-evaluations',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './recruiter-evaluations.component.html',
  styleUrl: './recruiter-evaluations.component.scss'
})
export class RecruiterEvaluationsComponent implements OnInit, OnDestroy {
  private readonly platform = inject(PlatformService);
  private readonly toast = inject(ToastService);
  private readonly tests = inject(TestApiService);
  private readonly session = inject(RecruiterSessionService);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);

  offres: Offre[] = [];
  selectedOffreId: number | null = null;
  test: TechnicalTest | null = null;
  assignments: TestAssignment[] = [];
  candidatures: Candidature[] = [];
  selectedCandidatureIds = new Set<number>();
  private candidateNames = new Map<number, string>();

  /** E1 */
  sessionFilter: SessionFilter = 'all';

  /** Panneau du parcours : test → invitations → sessions */
  activePanel: 'test' | 'invite' | 'sessions' = 'test';

  /** B7 */
  history: GenerationHistory | null = null;
  historyOpen = false;

  /** E7 */
  correctionOpen = false;
  correctionLoading = false;
  correction: CorrectionDetail | null = null;
  correctionLabel = '';

  loadingOffres = false;
  loadingTest = false;
  busy = false;
  /** Action Calculer / Publier sur une ligne (n’bloque pas tout le panneau). */
  busyAssignmentId: number | null = null;
  /** Vue Sessions : toutes les invitations du recruteur (offre + candidat). */
  sessionRows: SessionRow[] = [];
  loadingSessions = false;
  error = '';
  private pollSub: Subscription | null = null;

  ngOnInit(): void {
    const sessions = this.route.snapshot.queryParamMap.get('sessions');
    const offreQ = this.route.snapshot.queryParamMap.get('offreId');
    const deepOffreId = offreQ ? Number(offreQ) : NaN;
    if (
      sessions === 'all' ||
      sessions === 'todo' ||
      sessions === 'evaluated' ||
      sessions === 'published' ||
      sessions === 'scored' ||
      sessions === 'expired' ||
      sessions === 'active'
    ) {
      this.sessionFilter = sessions;
      this.activePanel = 'sessions';
    }

    this.loadingOffres = true;
    this.session
      .ensureMyOffres()
      .pipe(
        finalize(() => {
          this.loadingOffres = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (list) => {
          this.offres = [...list]
            .filter((o) => o.status === 'PUBLISHED' || o.status === 'CLOSED')
            .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
          if (
            Number.isFinite(deepOffreId) &&
            this.offres.some((o) => o.id === deepOffreId)
          ) {
            this.selectedOffreId = deepOffreId;
          } else {
            this.selectedOffreId = this.offres[0]?.id ?? null;
          }
          if (this.selectedOffreId != null) {
            this.reloadAll();
          } else if (this.activePanel === 'sessions') {
            this.loadSessionOverview();
          }
        },
        error: (err) => {
          this.toast.error(this.biz(err));
        }
      });
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
  }

  get selectedOffre(): Offre | null {
    if (this.selectedOffreId == null) return null;
    return this.offres.find((o) => o.id === this.selectedOffreId) ?? null;
  }

  get selectedOffreTitle(): string {
    return this.selectedOffre?.title || 'Offre';
  }

  get questionCount(): number {
    return this.test?.questions?.length ?? 0;
  }

  get durationMin(): number {
    if (!this.test?.durationSec) return 0;
    return Math.round(this.test.durationSec / 60);
  }

  get invitedCount(): number {
    return this.assignments.length;
  }

  get pendingStartCount(): number {
    return this.countStatus('PENDING');
  }

  get inProgressCount(): number {
    return this.countStatus('IN_PROGRESS');
  }

  get toCorrectCount(): number {
    return (
      this.countStatus('SUBMITTED') + this.countStatus('EVALUATING')
    );
  }

  get evaluatedCount(): number {
    return this.countStatus('EVALUATED');
  }

  get publishedCount(): number {
    return this.countStatus('PUBLISHED');
  }

  get expiredCount(): number {
    return this.countStatus('EXPIRED');
  }

  get scoredCount(): number {
    return this.assignments.filter(
      (a) => a.status === 'EVALUATED' || a.status === 'PUBLISHED'
    ).length;
  }

  /** Invités : pas encore rendu (PENDING / en cours) — toutes offres. */
  get invitedSessions(): SessionRow[] {
    return this.sessionRows.filter(
      (r) =>
        r.assignment.status === 'PENDING' ||
        r.assignment.status === 'IN_PROGRESS'
    );
  }

  /** Déjà passé le test : rendu → publié — toutes offres. */
  get passedSessions(): SessionRow[] {
    return this.sessionRows.filter((r) =>
      ['SUBMITTED', 'EVALUATING', 'EVALUATED', 'PUBLISHED'].includes(
        r.assignment.status
      )
    );
  }

  get expiredSessions(): SessionRow[] {
    return this.sessionRows.filter((r) => r.assignment.status === 'EXPIRED');
  }

  get sessionsToPublishCount(): number {
    return this.sessionRows.filter((r) => r.assignment.status === 'EVALUATED')
      .length;
  }

  canCalculate(a: TestAssignment): boolean {
    return a.status === 'SUBMITTED' || a.status === 'EVALUATING';
  }

  canPublish(a: TestAssignment): boolean {
    return a.status === 'EVALUATED';
  }

  rowBusy(a: TestAssignment): boolean {
    return this.busyAssignmentId === a.id;
  }

  /** Avancement correction+publication sur les sessions. */
  get pipelineShare(): number {
    if (!this.invitedCount) return 0;
    const done =
      this.toCorrectCount + this.evaluatedCount + this.publishedCount;
    return Math.min(100, Math.round((done / this.invitedCount) * 100));
  }

  get avgScoreLabel(): string {
    const scored = this.assignments.filter((a) => a.scoreTotal != null);
    if (!scored.length) return '—';
    const avg =
      scored.reduce((s, a) => s + Number(a.scoreTotal), 0) / scored.length;
    return `${Math.round(avg)}`;
  }

  get inviteableCount(): number {
    return this.candidatures.filter((c) => !this.alreadyAssigned(c.id)).length;
  }

  get selectedInviteCount(): number {
    return this.selectedCandidatureIds.size;
  }

  goPanel(panel: 'test' | 'invite' | 'sessions'): void {
    if (panel === 'invite' && !(this.test && (this.test.status === 'READY' || this.test.status === 'ASSIGNED'))) {
      return;
    }
    this.activePanel = panel;
    if (panel === 'sessions') {
      this.loadSessionOverview();
    }
    this.cdr.detectChanges();
  }

  labelDifficulty(d: string | null | undefined): string {
    const map: Record<string, string> = {
      EASY: 'Facile',
      MEDIUM: 'Intermédiaire',
      HARD: 'Difficile',
      BEGINNER: 'Débutant',
      INTERMEDIATE: 'Intermédiaire',
      ADVANCED: 'Avancé',
      EXPERT: 'Expert'
    };
    return map[(d || '').toUpperCase()] || d || '—';
  }

  private countStatus(status: string): number {
    return this.assignments.filter((a) => a.status === status).length;
  }

  initials(label: string): string {
    const parts = (label || '')
      .replace(/#\d+/g, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  selectAllInviteable(): void {
    const next = new Set(this.selectedCandidatureIds);
    for (const c of this.candidatures) {
      if (!this.alreadyAssigned(c.id)) {
        next.add(c.id);
      }
    }
    this.selectedCandidatureIds = next;
  }

  clearInviteSelection(): void {
    this.selectedCandidatureIds = new Set();
  }

  labelCandStatus(s: string): string {
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

  statusTone(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'PUBLISHED' || s === 'READY' || s === 'ASSIGNED') return 'ok';
    if (s === 'SUBMITTED' || s === 'EVALUATING') return 'wait'; // à corriger
    if (s === 'EVALUATED' || s === 'IN_PROGRESS') return 'mid';
    if (s === 'FAILED' || s === 'EXPIRED') return 'bad';
    if (s === 'GENERATING' || s === 'PENDING') return 'wait';
    return 'neutral';
  }

  deadlineLabel(a: TestAssignment): string {
    if (!a.startDeadlineAt || a.status !== 'PENDING') return '';
    const d = new Date(a.startDeadlineAt);
    if (Number.isNaN(d.getTime())) return '';
    return `Avant le ${d.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    })}`;
  }

  get filteredAssignments(): TestAssignment[] {
    const rows = this.assignments;
    switch (this.sessionFilter) {
      case 'todo':
        return rows.filter(
          (a) => a.status === 'SUBMITTED' || a.status === 'EVALUATING'
        );
      case 'evaluated':
        return rows.filter((a) => a.status === 'EVALUATED');
      case 'published':
        return rows.filter((a) => a.status === 'PUBLISHED');
      case 'scored':
        return rows.filter(
          (a) => a.status === 'EVALUATED' || a.status === 'PUBLISHED'
        );
      case 'expired':
        return rows.filter((a) => a.status === 'EXPIRED');
      case 'active':
        return rows.filter(
          (a) => a.status === 'PENDING' || a.status === 'IN_PROGRESS'
        );
      default:
        return rows;
    }
  }

  get latestDiff() {
    const revs = this.history?.revisions ?? [];
    for (let i = revs.length - 1; i >= 0; i--) {
      if (revs[i].diffFromPrevious) return revs[i];
    }
    return null;
  }

  canOpenCorrection(a: TestAssignment): boolean {
    return a.status === 'EVALUATED' || a.status === 'PUBLISHED';
  }

  onOffreChange(): void {
    this.selectedCandidatureIds = new Set();
    this.sessionFilter = 'all';
    this.activePanel = 'test';
    this.closeCorrection();
    this.history = null;
    this.historyOpen = false;
    this.reloadAll();
  }

  /** Charge les invitations de toutes les offres (1 requête / offre, en parallèle). */
  loadSessionOverview(): void {
    if (!this.offres.length) {
      this.sessionRows = [];
      return;
    }
    this.loadingSessions = true;
    this.cdr.detectChanges();
    forkJoin(
      this.offres.map((o) =>
        this.tests.listAssignments(o.id).pipe(
          catchError(() => of([] as TestAssignment[])),
          map((list) =>
            (list ?? []).map((a) => ({
              assignment: a,
              offreId: o.id,
              offreTitle: o.title
            }))
          )
        )
      )
    )
      .pipe(
        finalize(() => {
          this.loadingSessions = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (packs) => {
          this.sessionRows = packs
            .flat()
            .sort((a, b) => b.assignment.id - a.assignment.id);
          this.cdr.detectChanges();
        },
        error: () => {
          this.sessionRows = [];
          this.toast.error('Impossible de charger le suivi des tests.');
        }
      });
  }

  reloadAll(): void {
    if (this.selectedOffreId == null) return;
    if (this.activePanel === 'sessions') {
      this.loadSessionOverview();
    }
    this.loadingTest = true;
    this.pollSub?.unsubscribe();
    const offreId = this.selectedOffreId;

    this.tests
      .getByOffre(offreId)
      .pipe(
        catchError((err) => {
          if (err?.status === 404) {
            this.test = null;
            return of(null);
          }
          this.toast.error(this.biz(err));
          return of(null);
        }),
        finalize(() => {
          this.loadingTest = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe((t) => {
        this.test = t;
        if (t?.status === 'GENERATING') {
          this.pollGeneration();
        }
        this.cdr.detectChanges();
      });

    this.tests
      .listAssignments(offreId)
      .pipe(catchError(() => of([] as TestAssignment[])))
      .subscribe((rows) => {
        this.assignments = rows;
        this.cdr.detectChanges();
      });

    this.tests
      .generationHistory(offreId)
      .pipe(catchError(() => of(null)))
      .subscribe((h) => {
        this.history = h;
        this.cdr.detectChanges();
      });

    this.platform
      .candidaturesByOffre(offreId)
      .pipe(catchError(() => of([] as Candidature[])))
      .subscribe((rows) => {
        this.candidatures = rows.filter((c) => c.status !== 'WITHDRAWN');
        this.cdr.detectChanges();
      });

    this.platform
      .candidates()
      .pipe(catchError(() => of([] as CandidateSummary[])))
      .subscribe((people) => {
        this.candidateNames = new Map(
          (people ?? []).map((p) => [
            p.id,
            `${p.firstName || ''} ${p.lastName || ''}`.trim() ||
              `Candidat #${p.id}`
          ])
        );
        this.cdr.detectChanges();
      });
  }

  openCorrection(a: TestAssignment): void {
    if (!this.canOpenCorrection(a)) return;
    this.correctionOpen = true;
    this.correctionLoading = true;
    this.correction = null;
    this.correctionLabel = this.assignmentLabel(a);
    this.tests
      .correction(a.id)
      .pipe(
        finalize(() => {
          this.correctionLoading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (detail) => {
          this.correction = detail;
        },
        error: (err) => {
          this.toast.error(this.biz(err));
          this.correctionOpen = false;
        }
      });
  }

  closeCorrection(): void {
    this.correctionOpen = false;
    this.correction = null;
    this.correctionLabel = '';
  }

  candidateName(candidateId: number): string {
    return (
      this.candidateNames.get(candidateId) || `Candidat #${candidateId}`
    );
  }

  candidatureLabel(c: Candidature): string {
    return this.candidateName(c.candidateId);
  }

  assignmentLabel(a: TestAssignment): string {
    return this.candidateName(a.candidateId);
  }

  generate(): void {
    if (this.selectedOffreId == null || this.busy) return;
    this.busy = true;
    this.tests
      .generate(this.selectedOffreId)
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: (r) => {
          this.toast.success(r.message);
          this.pollGeneration();
        },
        error: (err) => {
          this.toast.error(this.biz(err));
        }
      });
  }

  regenerate(): void {
    if (this.selectedOffreId == null || this.busy) return;
    this.busy = true;
    this.tests
      .regenerate(this.selectedOffreId)
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: (r) => {
          this.toast.success(r.message);
          this.pollGeneration();
        },
        error: (err) => {
          this.toast.error(this.biz(err));
        }
      });
  }

  toggleCand(id: number): void {
    const next = new Set(this.selectedCandidatureIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.selectedCandidatureIds = next;
  }

  isSelected(id: number): boolean {
    return this.selectedCandidatureIds.has(id);
  }

  alreadyAssigned(candidatureId: number): boolean {
    return this.assignments.some((a) => a.candidatureId === candidatureId);
  }

  assignSelected(): void {
    if (this.selectedOffreId == null || this.busy) return;
    const ids = [...this.selectedCandidatureIds].filter(
      (id) => !this.alreadyAssigned(id)
    );
    if (!ids.length) {
      this.toast.error('Sélectionnez au moins une candidature non invitée.');
      return;
    }
    this.busy = true;
    this.tests
      .assign(this.selectedOffreId, ids)
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: (r) => {
          this.toast.success(r.message);
          this.selectedCandidatureIds = new Set();
          this.activePanel = 'sessions';
          this.reloadAll();
        },
        error: (err) => {
          this.toast.error(this.biz(err));
        }
      });
  }

  publishOne(row: SessionRow): void {
    const a = row.assignment;
    if (this.busyAssignmentId != null || !this.canPublish(a)) return;
    this.busyAssignmentId = a.id;
    this.cdr.detectChanges();
    this.tests
      .publish(a.id)
      .pipe(
        finalize(() => {
          this.busyAssignmentId = null;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: () => {
          this.toast.success(
            `Score publié pour ${this.assignmentLabel(a)} (${row.offreTitle}).`
          );
          this.reloadAll();
        },
        error: (err) => {
          this.toast.error(this.biz(err));
        }
      });
  }

  evaluateOne(row: SessionRow): void {
    const a = row.assignment;
    if (this.busyAssignmentId != null || !this.canCalculate(a)) return;
    this.busyAssignmentId = a.id;
    this.cdr.detectChanges();
    this.tests
      .evaluate(a.id)
      .pipe(
        finalize(() => {
          this.busyAssignmentId = null;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (r) => {
          this.toast.success(
            r.message || `Score calculé pour ${this.assignmentLabel(a)}.`
          );
          this.reloadAll();
        },
        error: (err) => {
          this.toast.error(this.biz(err));
        }
      });
  }

  publishAllEvaluated(): void {
    const targets = [
      ...new Set(
        this.sessionRows
          .filter((r) => r.assignment.status === 'EVALUATED')
          .map((r) => r.offreId)
      )
    ];
    if (!targets.length || this.busy) return;
    this.busy = true;
    this.cdr.detectChanges();
    forkJoin(
      targets.map((offreId) =>
        this.tests.publishOffreResults(offreId).pipe(
          catchError((err) => {
            this.toast.error(this.biz(err));
            return of(null);
          })
        )
      )
    )
      .pipe(
        finalize(() => {
          this.busy = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (results) => {
          const ok = results.filter(Boolean).length;
          if (ok) {
            this.toast.success(
              ok === 1
                ? 'Scores publiés pour l’offre.'
                : `Scores publiés pour ${ok} offres.`
            );
          }
          this.reloadAll();
        }
      });
  }

  labelStatus(s: string): string {
    const map: Record<string, string> = {
      DRAFT: 'Brouillon',
      GENERATING: 'Génération…',
      READY: 'Prêt',
      ASSIGNED: 'Assigné',
      FAILED: 'Échec',
      PENDING: 'Pas encore démarré',
      IN_PROGRESS: 'En train de passer',
      SUBMITTED: 'Passé — à corriger',
      EVALUATING: 'Passé — correction…',
      EVALUATED: 'Passé — à publier',
      PUBLISHED: 'Publié',
      EXPIRED: 'Expiré'
    };
    return map[s] || s;
  }

  /** Colonne info : deadline, date d’envoi de la copie, etc. */
  sessionInfo(a: TestAssignment): string {
    if (a.status === 'PENDING') {
      return this.deadlineLabel(a) || 'Invitation envoyée';
    }
    if (a.status === 'IN_PROGRESS') {
      return 'Test en cours chez le candidat';
    }
    if (a.status === 'SUBMITTED' || a.status === 'EVALUATING') {
      if (a.submittedAt) {
        const d = new Date(a.submittedAt);
        if (!Number.isNaN(d.getTime())) {
          return `Copie reçue le ${d.toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
          })}`;
        }
      }
      return 'Copie reçue — cliquez Corriger';
    }
    if (a.status === 'EVALUATED') {
      return a.scoreTotal != null
        ? `Note ${Math.round(Number(a.scoreTotal))}/100 — pas encore publiée`
        : 'Corrigé — à publier';
    }
    if (a.status === 'PUBLISHED' && a.publishedAt) {
      const d = new Date(a.publishedAt);
      if (!Number.isNaN(d.getTime())) {
        return `Publié le ${d.toLocaleDateString('fr-FR', {
          day: '2-digit',
          month: 'short'
        })}`;
      }
    }
    if (a.status === 'EXPIRED') {
      return 'N’a pas démarré à temps';
    }
    return '—';
  }

  private pollGeneration(): void {
    if (this.selectedOffreId == null) return;
    const offreId = this.selectedOffreId;
    this.pollSub?.unsubscribe();
    this.pollSub = timer(0, 2000)
      .pipe(
        switchMap(() =>
          this.tests.getByOffre(offreId).pipe(catchError(() => of(null)))
        ),
        takeWhile(
          (t) => t != null && t.status === 'GENERATING',
          true
        )
      )
      .subscribe((t) => {
        if (t) {
          this.test = t;
          if (t.status === 'READY') {
            this.toast.success('Test prêt.');
            this.tests
              .generationHistory(offreId)
              .pipe(catchError(() => of(null)))
              .subscribe((h) => {
                this.history = h;
                this.cdr.detectChanges();
              });
          } else if (t.status === 'FAILED') {
            this.toast.error(t.errorMessage || 'Génération échouée.');
          }
          this.cdr.detectChanges();
        }
      });
  }

  private biz(err: unknown): string {
    const e = err as {
      status?: number;
      error?: { detail?: string } | string;
      message?: string;
    };
    const msg = e?.message || '';
    if (/parsing|Http failure/i.test(msg)) {
      return (
        'Le proxy Angular ne renvoie pas l’API Test-Service. ' +
        'Relancez le front avec : npm start'
      );
    }
    const d = typeof e?.error === 'object' ? e.error?.detail : undefined;
    if (typeof d === 'string') return d;
    return msg || 'Erreur Test-Service';
  }
}
