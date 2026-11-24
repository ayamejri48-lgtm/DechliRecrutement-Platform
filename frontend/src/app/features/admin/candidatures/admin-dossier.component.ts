import { ToastService } from '../../../core/services/toast.service';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  inject
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin, of, timeout } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

import {
  CandidateDossier,
  MatchResult,
  PlatformService
} from '../../../core/services/platform.service';
import {
  AdminTestOverview,
  TestApiService
} from '../../../core/services/test-api.service';
import { AdminSessionService } from '../data/admin-session.service';

@Component({
  selector: 'app-admin-dossier',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './admin-dossier.component.html',
  styleUrl: './admin-dossier.component.scss'
})
export class AdminDossierComponent implements OnInit, OnDestroy {
  private readonly platform = inject(PlatformService);
  private readonly toast = inject(ToastService);
  private readonly testsApi = inject(TestApiService);
  private readonly session = inject(AdminSessionService);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly sanitizer = inject(DomSanitizer);
  private rawCvUrl: string | null = null;

  loading = true;
  error = '';
  dossier: CandidateDossier | null = null;
  match: MatchResult | null = null;
  matchMissing = false;
  testAssignment: AdminTestOverview['assignments'][number] | null = null;
  testsReady = false;
  cvBusy = false;
  cvUrl: SafeResourceUrl | null = null;

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!id) {
      this.toast.error('Candidature invalide.');
      this.loading = false;
      return;
    }
    forkJoin({
      dossier: this.platform.candidatureDossier(id).pipe(
        timeout({ first: 12000 })
      ),
      match: this.platform.getMatch(id).pipe(
        timeout({ first: 8000 }),
        catchError((err) =>
          of({
            _missing:
              err?.status === 400 ||
              err?.status === 404 ||
              err?.name === 'TimeoutError'
          } as const)
        )
      )
    })
      .pipe(
        finalize(() => {
          this.loading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: ({ dossier, match }) => {
          this.dossier = dossier;
          if (match && '_missing' in match) {
            this.match = null;
            this.matchMissing = match._missing;
          } else {
            this.match = match as MatchResult;
            this.matchMissing = false;
          }
          this.cdr.detectChanges();
          // Overview tests en fond — n’empêche plus l’affichage du dossier.
          this.testsApi
            .adminOverview()
            .pipe(catchError(() => of(null as AdminTestOverview | null)))
            .subscribe({
              next: (overview) => {
                this.testsReady = overview != null;
                this.testAssignment =
                  overview?.assignments.find((a) => a.candidatureId === id) ??
                  null;
                this.cdr.detectChanges();
              }
            });
        },
        error: (err) => {
          this.error =
            err?.name === 'TimeoutError'
              ? 'Le profil met trop de temps à répondre. Réessayez.'
              : this.session.mapHttpError(err?.status);
          this.cdr.detectChanges();
        }
      });
  }

  matchHeadline(): string {
    if (this.matchMissing) return 'Pas encore calculé';
    if (!this.match) return '—';
    if (this.match.status === 'DONE' && this.match.score != null) {
      const band =
        (
          { low: 'faible', medium: 'moyen', high: 'élevé', unavailable: 'indisponible' } as Record<
            string,
            string
          >
        )[String(this.match.scoreBand || '').toLowerCase()] ?? '';
      const text = `${this.asPercent(Number(this.match.score))} %`;
      return band ? `${text} · ${band}` : text;
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
    return (this.match.explanations ?? []).map((line) => line.trim()).filter(Boolean);
  }

  matchedSkills(): string[] {
    return this.match?.status === 'DONE' ? this.match.features?.matchedSkills ?? [] : [];
  }

  missingSkills(): string[] {
    if (this.match?.status !== 'DONE') return [];
    const features = this.match.features;
    return [...(features?.missingRequiredSkills ?? []), ...(features?.missingSkills ?? [])].filter(
      (name, index, all) => !!name && all.indexOf(name) === index
    );
  }

  private asPercent(value: number): number {
    const scaled = Math.abs(value) <= 1 ? value * 100 : value;
    return Math.round(scaled);
  }

  testScoreLabel(): string {
    const a = this.testAssignment;
    if (!a) return 'Pas de test assigné';
    if (a.status === 'PUBLISHED' && a.scoreTotal != null) {
      return `${a.scoreTotal} / 100 · publié`;
    }
    if (a.status === 'EVALUATED' && a.scoreTotal != null) {
      return `${a.scoreTotal} / 100 · non publié`;
    }
    const labels: Record<string, string> = {
      PENDING: 'Invité, non passé',
      IN_PROGRESS: 'En cours',
      SUBMITTED: 'Rendu, pas encore noté',
      EVALUATING: 'Correction…',
      EVALUATED: 'Noté, non publié',
      EXPIRED: 'Expiré, non passé',
      PUBLISHED: 'Publié'
    };
    return labels[a.status] ?? a.status;
  }

  ngOnDestroy(): void {
    this.releaseCv();
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
          this.toast.error(this.session.mapHttpError(err?.status));
          this.cdr.detectChanges();
        }
      });
  }

  closeCv(): void {
    this.releaseCv();
    this.cdr.detectChanges();
  }

  private releaseCv(): void {
    if (this.rawCvUrl) URL.revokeObjectURL(this.rawCvUrl);
    this.rawCvUrl = null;
    this.cvUrl = null;
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
}
