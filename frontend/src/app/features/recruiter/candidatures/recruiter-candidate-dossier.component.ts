import { ToastService } from '../../../core/services/toast.service';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  NgZone,
  OnDestroy,
  OnInit,
  inject
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  Subscription,
  catchError,
  finalize,
  forkJoin,
  of,
  timeout
} from 'rxjs';

import {
  CandidateDossier,
  MatchResult,
  Offre,
  PlatformService,
  RecruiterCandidatureDecision
} from '../../../core/services/platform.service';
import {
  TestApiService,
  TestAssignment,
  TechnicalTest
} from '../../../core/services/test-api.service';
import {
  CandidatureRow,
  RecruiterSessionService
} from '../data/recruiter-session.service';

@Component({
  selector: 'app-recruiter-candidate-dossier',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './recruiter-candidate-dossier.component.html',
  styleUrl: './recruiter-candidate-dossier.component.scss'
})
export class RecruiterCandidateDossierComponent implements OnInit, OnDestroy {
  private readonly platform = inject(PlatformService);
  private readonly toast = inject(ToastService);
  private readonly testsApi = inject(TestApiService);
  private readonly session = inject(RecruiterSessionService);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly zone = inject(NgZone);
  private readonly sanitizer = inject(DomSanitizer);
  private rawCvUrl: string | null = null;
  private loadSub?: Subscription;
  private extrasSub?: Subscription;
  private matchSub?: Subscription;
  private routeSub?: Subscription;
  private safetyTimer?: ReturnType<typeof setTimeout>;
  private loadedId: number | null = null;

  dossier: CandidateDossier | null = null;
  offre: Offre | null = null;
  offres: Offre[] = [];
  candidateApps: CandidatureRow[] = [];
  assignment: TestAssignment | null = null;
  test: TechnicalTest | null = null;
  acceptedCandidateIds = new Set<number>();
  acceptedOnOffre = 0;

  match: MatchResult | null = null;
  matchMissing = false;
  matchBusy = false;
  matchError = '';

  loading = true;
  extrasReady = false;
  error = '';
  cvBusy = false;
  cvUrl: SafeResourceUrl | null = null;
  busy = false;
  inviteBusy = false;

  /** Même entrée que l’admin : snapshot immédiat, puis écoute des changements d’id. */
  ngOnInit(): void {
    const first = Number(this.route.snapshot.paramMap.get('id'));
    if (!first || Number.isNaN(first)) {
      this.loading = false;
      this.toast.error('Candidature invalide.');
      this.cdr.detectChanges();
    } else {
      this.load(first);
    }
    this.routeSub = this.route.paramMap.subscribe((params) => {
      const id = Number(params.get('id'));
      if (!id || Number.isNaN(id) || id === this.loadedId) return;
      this.load(id);
    });
  }

  ngOnDestroy(): void {
    this.loadSub?.unsubscribe();
    this.extrasSub?.unsubscribe();
    this.matchSub?.unsubscribe();
    this.routeSub?.unsubscribe();
    if (this.safetyTimer) clearTimeout(this.safetyTimer);
    this.releaseCv();
  }

  get postsCount(): number {
    return new Set(this.candidateApps.map((a) => a.offreId)).size;
  }

  get canInvite(): boolean {
    if (!this.dossier) return false;
    const pendingLike =
      this.dossier.status === 'PENDING' || this.dossier.status === 'UNDER_REVIEW';
    const testReady =
      !!this.test &&
      (this.test.status === 'READY' || this.test.status === 'ASSIGNED');
    return (
      pendingLike &&
      testReady &&
      !this.assignment &&
      this.match?.score != null
    );
  }

  /**
   * Dossier d’abord (débloque l’UI), match + extras ensuite.
   * Filet de sécurité timer : le spinner ne peut plus rester bloqué.
   */
  load(id: number): void {
    this.loadSub?.unsubscribe();
    this.extrasSub?.unsubscribe();
    this.matchSub?.unsubscribe();
    if (this.safetyTimer) clearTimeout(this.safetyTimer);

    this.loadedId = id;
    this.loading = true;

    this.dossier = null;
    this.match = null;
    this.matchMissing = false;

    this.assignment = null;
    this.test = null;
    this.candidateApps = [];
    this.acceptedOnOffre = 0;
    this.extrasReady = false;
    this.releaseCv();
    this.cdr.markForCheck();
    this.cdr.detectChanges();

    // Filet absolu — même si une requête HTTP reste pendante.
    this.safetyTimer = setTimeout(() => {
      this.zone.run(() => {
        if (this.loading && this.loadedId === id) {
          this.loading = false;
          if (!this.dossier && !this.error) {
            this.error =
              'Le profil met trop de temps à répondre. Réessayez.';
            this.toast.error(this.error);
          }
          this.cdr.detectChanges();
        }
      });
    }, 10000);

    this.loadSub = this.platform
      .candidatureDossier(id)
      .pipe(
        timeout({ first: 8000 }),
        finalize(() => {
          this.zone.run(() => {
            this.loading = false;
            if (this.safetyTimer) {
              clearTimeout(this.safetyTimer);
              this.safetyTimer = undefined;
            }
            this.cdr.detectChanges();
          });
        })
      )
      .subscribe({
        next: (d) => {
          this.zone.run(() => {
            this.dossier = d;
            this.loading = false;
            this.cdr.detectChanges();
            this.loadMatch(id);
            this.loadRecruiterExtras(d);
          });
        },
        error: (err) => {
          this.zone.run(() => {
            this.dossier = null;
            this.toast.error(this.readError(err));
            this.loading = false;
            this.cdr.detectChanges();
          });
        }
      });
  }

  private loadMatch(candidatureId: number): void {
    this.matchSub?.unsubscribe();
    this.matchSub = this.platform
      .getMatch(candidatureId)
      .pipe(
        timeout({ first: 6000 }),
        catchError((err) =>
          of({
            _missing:
              err?.status === 404 ||
              err?.status === 400 ||
              err?.name === 'TimeoutError'
          } as const)
        )
      )
      .subscribe({
        next: (match) => {
          if (this.loadedId !== candidatureId) return;
          this.zone.run(() => {
            if (match && '_missing' in match) {
              this.match = null;
              this.matchMissing = true;
            } else {
              this.match = match as MatchResult;
              this.matchMissing = false;
            }
            this.cdr.detectChanges();
          });
        }
      });
  }

  /** Tests / offres / autres candidatures — n’empêchent pas l’affichage (comme admin). */
  private loadRecruiterExtras(d: CandidateDossier): void {
    this.extrasSub?.unsubscribe();
    this.extrasSub = forkJoin({
      offres: this.session.ensureMyOffres().pipe(
        timeout({ first: 8000 }),
        catchError(() => of([] as Offre[]))
      ),
      offreApps: this.platform.candidaturesByOffre(d.offreId).pipe(
        timeout({ first: 8000 }),
        catchError(() => of([] as Array<{ status: string; candidateId?: number }>))
      ),
      assignments: this.testsApi.listAssignments(d.offreId).pipe(
        timeout({ first: 8000 }),
        catchError(() => of([] as TestAssignment[]))
      ),
      test: this.testsApi.getByOffre(d.offreId).pipe(
        timeout({ first: 8000 }),
        catchError(() => of(null as TechnicalTest | null))
      )
    }).subscribe({
      next: (pack) => {
        if (this.dossier?.candidatureId !== d.candidatureId) return;
        this.offres = pack.offres;
        this.offre = pack.offres.find((o) => o.id === d.offreId) ?? null;
        this.acceptedOnOffre = (pack.offreApps ?? []).filter(
          (r) => r.status === 'ACCEPTED'
        ).length;
        this.assignment =
          pack.assignments.find((a) => a.candidatureId === d.candidatureId) ??
          null;
        this.test = pack.test;
        this.extrasReady = true;
        this.cdr.detectChanges();

        // Cross-offres + autres candidatures : non bloquant.
        const scope = this.offre ? [this.offre] : pack.offres.slice(0, 5);
        this.session
          .findApplicationsByCandidate(d.candidateId, scope)
          .pipe(
            timeout({ first: 8000 }),
            catchError(() => of([] as CandidatureRow[]))
          )
          .subscribe({
            next: (apps) => {
              if (this.dossier?.candidatureId !== d.candidatureId) return;
              this.candidateApps = apps;
              this.cdr.detectChanges();
            }
          });
        this.session
          .loadAcceptedCandidateIds(pack.offres)
          .pipe(
            timeout({ first: 10000 }),
            catchError(() => of(new Set<number>()))
          )
          .subscribe({
            next: (ids) => {
              if (this.dossier?.candidatureId !== d.candidatureId) return;
              this.acceptedCandidateIds = ids;
              this.cdr.detectChanges();
            }
          });
      },
      error: () => this.cdr.detectChanges()
    });
  }

  computeMatch(force = false): void {
    if (!this.dossier || this.matchBusy) return;
    this.matchBusy = true;

    this.cdr.detectChanges();
    this.platform
      .computeMatch(this.dossier.candidatureId, force)
      .pipe(
        finalize(() => {
          this.matchBusy = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (m) => {
          this.match = m;
          this.matchMissing = false;
          this.toast.success('Matching mis à jour.');
        },
        error: (err) => {
          this.toast.error(this.matchHttpError(err));
        }
      });
  }

  openCv(): void {
    if (!this.dossier?.cv || this.cvBusy) return;
    this.cvBusy = true;

    this.platform
      .candidatureCvBlob(this.dossier.candidatureId)
      .pipe(
        finalize(() => {
          this.cvBusy = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (blob) => {
          const pdf =
            blob.type === 'application/pdf'
              ? blob
              : new Blob([blob], { type: 'application/pdf' });
          this.releaseCv();
          this.rawCvUrl = URL.createObjectURL(pdf);
          this.cvUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
            `${this.rawCvUrl}#navpanes=0&view=FitH`
          );
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.toast.error(this.readError(err));
          this.cdr.detectChanges();
        }
      });
  }

  closeCv(): void {
    this.releaseCv();
    this.cdr.detectChanges();
  }

  invite(): void {
    if (!this.dossier || !this.canInvite || this.inviteBusy) return;
    this.inviteBusy = true;

    this.cdr.detectChanges();
    this.testsApi
      .assign(this.dossier.offreId, [this.dossier.candidatureId])
      .pipe(
        finalize(() => {
          this.inviteBusy = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: () => {
          this.toast.success('Invitation au test envoyée.');
          this.load(this.dossier!.candidatureId);
        },
        error: (err) => {
          this.toast.error(this.readError(err));
        }
      });
  }

  decide(status: RecruiterCandidatureDecision): void {
    if (!this.dossier || this.busy) return;
    if (this.dossier.status === 'WITHDRAWN') {
      this.toast.error('Une candidature retirée ne peut plus être traitée.');
      return;
    }
    if (status === 'ACCEPTED' && this.cannotAccept()) {
      this.toast.error(this.acceptBlockedReason() || 'Acceptation impossible.');
      this.cdr.detectChanges();
      return;
    }
    this.busy = true;

    this.cdr.detectChanges();
    this.platform
      .updateCandidatureStatus(this.dossier.candidatureId, status)
      .pipe(
        finalize(() => {
          this.busy = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: () => {
          const prev = this.dossier!.status;
          this.session.invalidateCandidatures(this.dossier!.offreId);
          this.dossier = { ...this.dossier!, status };
          if (prev === 'ACCEPTED' && status !== 'ACCEPTED') {
            this.acceptedOnOffre = Math.max(0, this.acceptedOnOffre - 1);
          } else if (prev !== 'ACCEPTED' && status === 'ACCEPTED') {
            this.acceptedOnOffre += 1;
          }
          this.toast.success(
            `Statut mis à jour : ${this.labelStatus(status)}.`
          );
          this.session.loadAcceptedCandidateIds(this.offres).subscribe({
            next: (ids) => {
              this.acceptedCandidateIds = ids;
              this.cdr.detectChanges();
            },
            error: () => undefined
          });
        },
        error: (err) => {
          this.toast.error(this.readError(err));
        }
      });
  }

  cannotAccept(): boolean {
    if (!this.dossier) return true;
    if (this.acceptedOnOffre >= this.postesFor(this.dossier.offreId)) {
      return true;
    }
    if (this.acceptedCandidateIds.has(this.dossier.candidateId)) return true;
    if (this.match?.score == null) return true;
    if (
      !this.assignment ||
      (this.assignment.status !== 'EVALUATED' &&
        this.assignment.status !== 'PUBLISHED')
    ) {
      return true;
    }
    return false;
  }

  acceptBlockedReason(): string | null {
    if (!this.dossier) return null;
    if (this.acceptedOnOffre >= this.postesFor(this.dossier.offreId)) {
      return `Tous les postes sont pourvus (${this.postesFor(this.dossier.offreId)}).`;
    }
    if (this.acceptedCandidateIds.has(this.dossier.candidateId)) {
      return 'Ce candidat est déjà accepté sur une autre de vos offres.';
    }
    if (this.match?.score == null) {
      return 'Le matching doit être calculé avant l’acceptation.';
    }
    if (
      !this.assignment ||
      (this.assignment.status !== 'EVALUATED' &&
        this.assignment.status !== 'PUBLISHED')
    ) {
      return 'Le candidat doit avoir passé le test (note disponible).';
    }
    return null;
  }

  postesFor(offreId: number): number {
    const o = this.offres.find((x) => x.id === offreId);
    return o?.postes && o.postes > 0 ? o.postes : 1;
  }

  matchHeadline(): string {
    if (this.matchMissing) return 'Pas encore calculé';
    if (!this.match) return '—';
    if (this.match.status === 'DONE' && this.match.score != null) {
      const band = this.bandLabel(this.match.scoreBand);
      const text = `${this.asPercent(Number(this.match.score))} %`;
      return band && band !== '—' ? `${text} · ${band}` : text;
    }
    if (this.match.status === 'FAILED') return 'Calcul en échec';
    if (this.match.status === 'PENDING') return 'Calcul en cours';
    return this.match.status || '—';
  }

  featureRows(): Array<{ label: string; value: string }> {
    const features = this.match?.status === 'DONE' ? this.match.features : null;
    if (!features) return [];
    const specs: Array<[keyof typeof features, string]> = [
      ['skills_coverage', 'Compétences'],
      ['required_skills_coverage', 'Compétences exigées'],
      ['experience_match', 'Expérience'],
      ['education_match', 'Formation'],
      ['semantic_similarity', 'Proximité du texte'],
      ['title_similarity', 'Proximité du titre']
    ];
    return specs.flatMap(([key, label]) => {
      const raw = features[key];
      if (typeof raw !== 'number' || Number.isNaN(raw)) return [];
      return [{ label, value: `${this.asPercent(raw)} %` }];
    });
  }

  explanations(): string[] {
    if (this.match?.status !== 'DONE') return [];
    return (this.match.explanations ?? [])
      .map((line) => this.friendlyExplanation(line))
      .filter(Boolean);
  }

  matchedSkills(): string[] {
    return this.match?.status === 'DONE'
      ? this.match.features?.matchedSkills ?? []
      : [];
  }

  missingSkills(): string[] {
    if (this.match?.status !== 'DONE') return [];
    const features = this.match.features;
    return [
      ...(features?.missingRequiredSkills ?? []),
      ...(features?.missingSkills ?? [])
    ].filter((name, index, all) => !!name && all.indexOf(name) === index);
  }

  testScoreLabel(): string {
    const a = this.assignment;
    if (!a) return 'Pas de test assigné';
    if (a.status === 'PUBLISHED' && a.scoreTotal != null) {
      return `Test passé · ${a.scoreTotal} / 100 · publié`;
    }
    if (a.status === 'EVALUATED' && a.scoreTotal != null) {
      return `Test passé · ${a.scoreTotal} / 100 · à publier`;
    }
    const labels: Record<string, string> = {
      PENDING: 'Invité, non passé',
      IN_PROGRESS: 'En cours',
      SUBMITTED: 'Test passé — en correction',
      EVALUATING: 'Test passé — correction…',
      EVALUATED: 'Test passé — à publier',
      EXPIRED: 'Expiré, non passé',
      PUBLISHED: 'Test passé'
    };
    return labels[a.status] ?? a.status;
  }

  fullName(d: CandidateDossier): string {
    return `${d.firstName || ''} ${d.lastName || ''}`.trim() || 'Candidat';
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

  labelLevel(level?: string): string {
    if (!level) return '';
    return (
      {
        BEGINNER: 'Débutant',
        INTERMEDIATE: 'Intermédiaire',
        ADVANCED: 'Avancé',
        EXPERT: 'Expert'
      } as Record<string, string>
    )[level] ?? level;
  }

  private asPercent(value: number): number {
    const scaled = Math.abs(value) <= 1 ? value * 100 : value;
    return Math.round(scaled);
  }

  private bandLabel(band?: string | null): string {
    switch ((band || '').toLowerCase()) {
      case 'low':
        return 'faible';
      case 'medium':
        return 'moyen';
      case 'high':
        return 'élevé';
      case 'unavailable':
        return 'indisponible';
      default:
        return band || '—';
    }
  }

  private friendlyExplanation(raw: string): string {
    const t = (raw || '').trim();
    if (!t) return '';
    if (/^Bande de score:/i.test(t)) return '';
    if (/^Niveau d[’']adéquation/i.test(t)) return '';
    if (/Similarité sémantique/i.test(t)) return '';
    if (/Proximité globale du profil/i.test(t)) return '';
    if (/Proximité des intitulés/i.test(t)) return '';
    if (/Similarité d['’]intitulés/i.test(t)) return '';
    const exp = t.match(/Adéquation expérience:\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (exp) {
      const pct = Math.round(Number(exp[1]) * 100);
      return `Expérience par rapport à l’offre : ${pct} %.`;
    }
    return t.replace(/\s*\[(?:tfidf[^\]]*|st[^\]]*)\]\s*/gi, '').trim();
  }

  private releaseCv(): void {
    if (this.rawCvUrl) URL.revokeObjectURL(this.rawCvUrl);
    this.rawCvUrl = null;
    this.cvUrl = null;
  }

  private matchHttpError(err: unknown): string {
    const e = err as {
      status?: number;
      error?: { message?: string; detail?: string } | string;
    };
    let detail =
      typeof e?.error === 'string'
        ? e.error
        : e?.error?.message || e?.error?.detail || '';
    detail = String(detail || '').trim();
    if (detail.startsWith('{') && detail.includes('detail')) {
      try {
        const parsed = JSON.parse(detail) as { detail?: unknown };
        if (typeof parsed.detail === 'string') detail = parsed.detail;
      } catch {
        /* keep */
      }
    }
    if (/invalid or missing internal api key/i.test(detail)) {
      return 'Matching IA indisponible : clé API interne AI-Service incorrecte.';
    }
    if (e?.status === 404) {
      return detail || 'Aucun matching calculé pour cette candidature.';
    }
    if (e?.status === 409) {
      return (
        detail ||
        'Matching impossible : ajoutez au moins une compétence structurée à l’offre.'
      );
    }
    if (e?.status === 413) {
      return detail || 'CV trop volumineux pour l’analyse (limite PDF / pages).';
    }
    if (detail) return detail;
    return this.session.mapHttpError(e?.status);
  }

  private readError(err: unknown): string {
    const e = err as {
      status?: number;
      name?: string;
      error?: { message?: string } | string;
      message?: string;
    };
    if (e?.name === 'TimeoutError') {
      return 'Le profil met trop de temps à répondre. Réessayez.';
    }
    const detail =
      typeof e?.error === 'string'
        ? e.error
        : e?.error?.message || e?.message;
    if (detail && String(detail).trim() && e?.name !== 'HttpErrorResponse') {
      return String(detail).trim();
    }
    if (typeof e?.error === 'string' && e.error.trim()) return e.error.trim();
    if (e?.error && typeof e.error === 'object' && e.error.message?.trim()) {
      return e.error.message.trim();
    }
    return this.session.mapHttpError(e?.status);
  }
}
