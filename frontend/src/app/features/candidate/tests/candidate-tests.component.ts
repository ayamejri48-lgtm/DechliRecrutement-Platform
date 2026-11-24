import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  inject
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, forkJoin, interval, of } from 'rxjs';
import { catchError, finalize, map, switchMap } from 'rxjs/operators';

import {
  Candidature,
  Offre,
  PlatformService
} from '../../../core/services/platform.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  CandidateResult,
  TestApiService,
  TestAssignment,
  TestPaper,
  TestQuestion
} from '../../../core/services/test-api.service';

@Component({
  selector: 'app-candidate-tests',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './candidate-tests.component.html',
  styleUrl: './candidate-tests.component.scss'
})
export class CandidateTestsComponent implements OnInit, OnDestroy {
  /** true = dans le shell workspace (sidebar visible). */
  @Input() embedded = false;

  private readonly tests = inject(TestApiService);
  private readonly toast = inject(ToastService);
  private readonly platform = inject(PlatformService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  assignments: TestAssignment[] = [];
  private offerTitles = new Map<number, string>();

  loading = false;
  busy = false;
  error = '';
  saveHint = '';

  activeId: number | null = null;
  paper: TestPaper | null = null;
  answers: Record<number, { option?: string; text?: string }> = {};
  remainingSec: number | null = null;
  result: CandidateResult | null = null;
  currentIndex = 0;

  /** Intégrité / anti-triche */
  incidentCount = 0;
  incidentLimit = 3;
  integrityWarn = '';
  integrityLocked = false;
  private wantFullscreen = false;
  private reportingIncident = false;
  /** Ignore les faux positifs juste après l’entrée en plein écran. */
  private integrityArmedAt = 0;

  private tickSub: Subscription | null = null;
  private saveSub: Subscription | null = null;
  private autoSubmitted = false;

  ngOnInit(): void {
    this.reload();
  }

  ngOnDestroy(): void {
    this.tickSub?.unsubscribe();
    this.saveSub?.unsubscribe();
    this.exitFullscreenQuiet();
  }

  @HostListener('window:blur')
  onBlur(): void {
    this.reportIncident('TAB_BLUR');
  }

  @HostListener('document:fullscreenchange')
  onFullscreenChange(): void {
    if (!this.wantFullscreen) return;
    if (!document.fullscreenElement) {
      this.reportIncident('EXIT_FULLSCREEN');
    }
  }

  get actionable(): TestAssignment[] {
    return this.assignments.filter((a) =>
      ['PENDING', 'IN_PROGRESS'].includes(a.status)
    );
  }

  get waiting(): TestAssignment[] {
    return this.assignments.filter((a) =>
      ['SUBMITTED', 'EVALUATING', 'EVALUATED'].includes(a.status)
    );
  }

  get done(): TestAssignment[] {
    return this.assignments.filter((a) =>
      ['PUBLISHED', 'EXPIRED'].includes(a.status)
    );
  }

  get currentQuestion(): TestQuestion | null {
    if (!this.paper?.questions?.length) return null;
    return this.paper.questions[this.currentIndex] ?? null;
  }

  get answeredCount(): number {
    if (!this.paper) return 0;
    return this.paper.questions.filter((q) => this.isAnswered(q)).length;
  }

  get progressPct(): number {
    const n = this.paper?.questions?.length || 0;
    if (!n) return 0;
    return Math.round((this.answeredCount / n) * 100);
  }

  reload(): void {
    this.loading = true;
    forkJoin({
      rows: this.tests.myAssignments().pipe(catchError(() => of([] as TestAssignment[]))),
      apps: this.platform
        .myApplications()
        .pipe(catchError(() => of([] as Candidature[])))
    })
      .pipe(
        switchMap(({ rows, apps }) => {
          const titles = new Map<number, string>();
          for (const a of apps || []) {
            if (a.offreId && a.offreTitle) titles.set(a.offreId, a.offreTitle);
          }
          const missing = [
            ...new Set(
              (rows || [])
                .map((r) => r.offreId)
                .filter((id) => id && !titles.has(id))
            )
          ];
          if (!missing.length) {
            return of({ rows, titles });
          }
          return forkJoin(
            missing.map((id) =>
              this.platform.offre(id).pipe(
                map((o: Offre) => [id, o.title] as const),
                catchError(() => of([id, `Offre #${id}`] as const))
              )
            )
          ).pipe(
            map((pairs) => {
              for (const [id, title] of pairs) titles.set(id, title);
              return { rows, titles };
            })
          );
        }),
        finalize(() => {
          this.loading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: ({ rows, titles }) => {
          this.offerTitles = titles;
          this.assignments = [...(rows || [])].sort((a, b) => b.id - a.id);
          this.applyDeepLink();
        },
        error: (err) => {
          this.toast.error(this.biz(err));
        }
      });
  }

  /** Navigation depuis une notification (query ?open=&id=). */
  private applyDeepLink(): void {
    const open = this.route.snapshot.queryParamMap.get('open');
    const rawId = this.route.snapshot.queryParamMap.get('id');
    if (!open) return;

    const id = rawId ? Number(rawId) : NaN;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {},
      replaceUrl: true
    });

    if (open === 'result') {
      const a =
        (Number.isFinite(id) && this.assignments.find((x) => x.id === id)) ||
        this.assignments.find((x) => x.status === 'PUBLISHED');
      if (a) {
        this.viewResult(a);
      } else if (Number.isFinite(id)) {
        // assignment connu via notif même s’il n’est pas encore dans la liste
        this.viewResult({
          id,
          testId: 0,
          offreId: 0,
          candidatureId: 0,
          candidateId: 0,
          status: 'PUBLISHED'
        });
      } else {
        this.toast.error('Aucun résultat publié à afficher.');
      }
      return;
    }

    if (open === 'start' || open === 'invite') {
      const a = Number.isFinite(id)
        ? this.assignments.find((x) => x.id === id)
        : this.assignments.find((x) =>
            ['PENDING', 'IN_PROGRESS'].includes(x.status)
          );
      if (!a) {
        this.toast.error('Invitation introuvable ou déjà terminée.');
        return;
      }
      if (a.status === 'PENDING') this.start(a);
      else if (a.status === 'IN_PROGRESS') this.openPaper(a.id);
      else if (a.status === 'PUBLISHED') this.viewResult(a);
      // sinon on laisse la liste visible
    }
  }

  offerTitle(a: TestAssignment): string {
    const t = this.offerTitles.get(a.offreId);
    return (t && t.trim()) || `Offre #${a.offreId}`;
  }

  labelStatus(s: string): string {
    const map: Record<string, string> = {
      PENDING: 'À démarrer',
      IN_PROGRESS: 'En cours',
      SUBMITTED: 'Test passé',
      EVALUATING: 'Test passé',
      EVALUATED: 'Test passé',
      PUBLISHED: 'Résultats publiés',
      EXPIRED: 'Expiré'
    };
    return map[s] || s;
  }

  statusHint(s: string): string {
    const map: Record<string, string> = {
      PENDING: 'Vous avez 48 h pour commencer.',
      IN_PROGRESS: 'Reprenez où vous vous êtes arrêté.',
      SUBMITTED: 'Votre copie a bien été envoyée.',
      EVALUATING: 'Correction en cours.',
      EVALUATED: 'En attente de publication des résultats par le recruteur.',
      PUBLISHED: 'Consultez votre note et les retours.',
      EXPIRED: 'Le délai pour démarrer est dépassé.'
    };
    return map[s] || '';
  }

  statusClass(s: string): string {
    if (s === 'PENDING' || s === 'IN_PROGRESS') return 'todo';
    if (
      s === 'SUBMITTED' ||
      s === 'EVALUATING' ||
      s === 'EVALUATED' ||
      s === 'PUBLISHED'
    ) {
      return 'ok';
    }
    if (s === 'EXPIRED') return 'bad';
    return 'wait';
  }

  actionLabel(a: TestAssignment): string {
    if (a.status === 'PENDING') return 'Commencer le test';
    if (a.status === 'IN_PROGRESS') return 'Continuer';
    if (a.status === 'PUBLISHED') return 'Voir mes résultats';
    return '';
  }

  canAct(a: TestAssignment): boolean {
    return ['PENDING', 'IN_PROGRESS', 'PUBLISHED'].includes(a.status);
  }

  onCardAction(a: TestAssignment): void {
    if (a.status === 'PENDING') this.start(a);
    else if (a.status === 'IN_PROGRESS') this.openPaper(a.id);
    else if (a.status === 'PUBLISHED') this.viewResult(a);
  }

  isAnswered(q: TestQuestion): boolean {
    const a = this.answers[q.id];
    if (!a) return false;
    if (q.type === 'MCQ') return !!a.option;
    return !!(a.text && a.text.trim());
  }

  optionKeys(q: TestQuestion): string[] {
    return Object.keys(q.options || {}).sort();
  }

  start(a: TestAssignment): void {
    if (this.busy) return;
    this.busy = true;
    this.tests
      .start(a.id)
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => this.openPaper(a.id),
        error: (err) => {
          this.toast.error(this.biz(err));
        }
      });
  }

  openPaper(id: number): void {
    this.busy = true;
    this.result = null;
    this.tests
      .paper(id)
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: (p) => {
          this.activeId = id;
          this.paper = p;
          this.remainingSec = p.remainingSec ?? p.durationSec;
          this.answers = {};
          for (const a of p.answers || []) {
            this.answers[a.questionId] = {
              option: a.answerOption || undefined,
              text: a.answerText || undefined
            };
          }
          this.currentIndex = 0;
          this.autoSubmitted = false;
          this.saveHint = '';
          this.incidentCount = 0;
          this.integrityWarn = '';
          this.integrityLocked = false;
          this.startTicker();
          this.enterFullscreen();
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.toast.error(this.biz(err));
        }
      });
  }

  closePaper(): void {
    this.tickSub?.unsubscribe();
    this.wantFullscreen = false;
    this.exitFullscreenQuiet();
    this.activeId = null;
    this.paper = null;
    this.result = null;
    this.currentIndex = 0;
    this.integrityWarn = '';
    this.integrityLocked = false;
    this.reload();
  }

  reenterFullscreen(): void {
    this.enterFullscreen();
  }

  prevQ(): void {
    if (this.currentIndex > 0) this.currentIndex--;
  }

  nextQ(): void {
    if (!this.paper) return;
    if (this.currentIndex < this.paper.questions.length - 1) {
      this.currentIndex++;
    }
  }

  goQ(i: number): void {
    this.currentIndex = i;
  }

  setOption(q: TestQuestion, opt: string): void {
    if (this.integrityLocked) return;
    this.answers[q.id] = { ...this.answers[q.id], option: opt };
    this.autosave();
  }

  setText(q: TestQuestion, text: string): void {
    if (this.integrityLocked) return;
    this.answers[q.id] = { ...this.answers[q.id], text };
  }

  onTextBlur(q: TestQuestion): void {
    if (this.integrityLocked) return;
    this.autosave();
  }

  submit(): void {
    if (this.activeId == null || this.busy || this.integrityLocked) return;
    const missing = (this.paper?.questions || []).filter((q) => !this.isAnswered(q));
    if (missing.length) {
      const ok = confirm(
        `${missing.length} question(s) sans réponse. Soumettre quand même ?`
      );
      if (!ok) return;
    }
    this.busy = true;
    this.autosave(true);
    this.tests
      .submit(this.activeId)
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => {
          this.toast.success(
            'Test passé. Les résultats apparaîtront quand le recruteur les publiera.'
          );
          this.closePaper();
        },
        error: (err) => {
          this.toast.error(this.biz(err));
        }
      });
  }

  viewResult(a: TestAssignment): void {
    this.busy = true;
    this.paper = null;
    this.activeId = a.id;
    this.tests
      .myResult(a.id)
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: (r) => {
          this.result = r;
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.toast.error(this.biz(err));
          this.activeId = null;
        }
      });
  }

  formatTime(sec: number | null): string {
    if (sec == null) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  private startTicker(): void {
    this.tickSub?.unsubscribe();
    this.tickSub = interval(1000).subscribe(() => {
      if (this.remainingSec == null) return;
      this.remainingSec = Math.max(0, this.remainingSec - 1);
      if (
        this.remainingSec === 0 &&
        this.activeId != null &&
        !this.autoSubmitted
      ) {
        this.autoSubmitted = true;
        this.submit();
      }
      this.cdr.detectChanges();
    });
  }

  private reportIncident(type: 'TAB_BLUR' | 'EXIT_FULLSCREEN'): void {
    if (
      this.activeId == null ||
      this.paper?.assignment.status !== 'IN_PROGRESS' ||
      this.integrityLocked ||
      this.reportingIncident
    ) {
      return;
    }
    // Évite de compter le blur provoqué par requestFullscreen / dialogues navigateur.
    if (Date.now() < this.integrityArmedAt) {
      return;
    }
    this.reportingIncident = true;
    this.tests
      .incident(this.activeId, type)
      .pipe(finalize(() => (this.reportingIncident = false)))
      .subscribe({
        next: (res) => {
          this.incidentCount = res.incidentCount ?? this.incidentCount + 1;
          this.incidentLimit = res.limit || this.incidentLimit;
          const left = Math.max(0, this.incidentLimit - this.incidentCount);
          if (res.blocked) {
            this.onIntegrityBlocked(
              res.message ||
                'Test bloqué et soumis automatiquement (trop d’incidents).'
            );
            return;
          }
          this.integrityWarn =
            type === 'EXIT_FULLSCREEN'
              ? `Plein écran quitté — ${left} avertissement(s) restant(s) avant blocage.`
              : `Changement d’onglet détecté — ${left} avertissement(s) restant(s) avant blocage.`;
          this.cdr.detectChanges();
        },
        error: () => undefined
      });
  }

  private onIntegrityBlocked(message: string): void {
    this.integrityLocked = true;
    this.autoSubmitted = true;
    this.tickSub?.unsubscribe();
    this.wantFullscreen = false;
    this.exitFullscreenQuiet();
    this.toast.success(message);
    this.integrityWarn = message;
    this.cdr.detectChanges();
    // Laisse le message visible puis revient à la liste
    setTimeout(() => this.closePaper(), 1800);
  }

  private enterFullscreen(): void {
    this.wantFullscreen = true;
    this.integrityArmedAt = Date.now() + 2500;
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      void el.requestFullscreen()
        .then(() => {
          this.integrityArmedAt = Date.now() + 1500;
        })
        .catch(() => {
          this.integrityWarn =
            'Activez le plein écran pour continuer le test dans de bonnes conditions.';
          this.cdr.detectChanges();
        });
    }
  }

  private exitFullscreenQuiet(): void {
    if (document.fullscreenElement && document.exitFullscreen) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }

  private autosave(force = false): void {
    if (this.activeId == null || !this.paper) return;
    if (this.integrityLocked && !force) return;
    if (this.paper.assignment.status !== 'IN_PROGRESS' && !force) return;
    const payload = Object.entries(this.answers).map(([qid, v]) => ({
      questionId: Number(qid),
      answerOption: v.option ?? null,
      answerText: v.text ?? null
    }));
    if (!payload.length && !force) return;
    this.saveSub?.unsubscribe();
    this.saveSub = this.tests.saveAnswers(this.activeId, payload).subscribe({
      next: () => {
        this.saveHint = 'Enregistré';
        this.cdr.detectChanges();
      },
      error: () => undefined
    });
  }

  private biz(err: unknown): string {
    const e = err as { error?: { detail?: string }; message?: string };
    const msg = e?.message || '';
    if (/parsing|Http failure/i.test(msg)) {
      return (
        'Le proxy Angular ne renvoie pas l’API Test-Service. ' +
        'Relancez le front avec : npm start'
      );
    }
    const d = e?.error?.detail;
    if (typeof d === 'string') return d;
    return msg || 'Erreur Test-Service';
  }
}

