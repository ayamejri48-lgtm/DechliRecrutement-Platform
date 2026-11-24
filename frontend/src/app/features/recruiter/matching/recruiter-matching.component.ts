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
  CandidateSummary,
  Candidature,
  MatchResult,
  Offre,
  OffreSkill,
  PlatformService,
  RecruiterCandidatureDecision
} from '../../../core/services/platform.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  TestApiService,
  TestAssignment,
  TechnicalTest
} from '../../../core/services/test-api.service';
import { RecruiterSessionService } from '../data/recruiter-session.service';

type MatchRow = {
  match: MatchResult;
  candidateLabel: string;
  candidatureStatus: string;
  testLabel: string;
  testScore: number | null;
  readyToDecide: boolean;
  canInvite: boolean;
};

@Component({
  selector: 'app-recruiter-matching',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './recruiter-matching.component.html',
  styleUrl: './recruiter-matching.component.scss'
})
export class RecruiterMatchingComponent implements OnInit {
  private readonly platform = inject(PlatformService);
  private readonly toast = inject(ToastService);
  private readonly testsApi = inject(TestApiService);
  private readonly session = inject(RecruiterSessionService);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);

  offres: Offre[] = [];
  selectedOffreId: number | null = null;
  rows: MatchRow[] = [];
  selected: MatchRow | null = null;
  candidatures: Candidature[] = [];
  private candidateNames = new Map<number, string>();
  private assignments = new Map<number, TestAssignment>();
  private offerTest: TechnicalTest | null = null;
  private acceptedCandidateIds = new Set<number>();

  loadingOffres = false;
  loadingMatches = false;
  busyId: number | null = null;
  decideBusyId: number | null = null;
  batchBusy = false;
  inviteBusyId: number | null = null;
  /** Filtre shortlist : all | high | medium | low */
  bandFilter: 'all' | 'high' | 'medium' | 'low' = 'all';
  /** Vue dashboard : all | ready (scores prêts) | missing (à calculer) */
  viewFocus: 'all' | 'ready' | 'missing' = 'all';
  /** Skills structurées de l’offre sélectionnée (requis pour le matching). */
  selectedOffreSkills: OffreSkill[] = [];
  legendOpen = true;

  ngOnInit(): void {
    const view = this.route.snapshot.queryParamMap.get('view');
    if (view === 'ready' || view === 'missing') {
      this.viewFocus = view;
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
          // Matching = candidatures réelles → brouillons exclus (PUBLISHED + CLOSED).
          this.offres = [...list]
            .filter((o) => o.status === 'PUBLISHED' || o.status === 'CLOSED')
            .sort((a, b) => {
              if (a.status !== b.status) {
                return a.status === 'PUBLISHED' ? -1 : 1;
              }
              return (b.createdAt || '').localeCompare(a.createdAt || '');
            });
          const published = this.offres.find((o) => o.status === 'PUBLISHED');
          this.selectedOffreId = (published ?? this.offres[0])?.id ?? null;
          if (this.selectedOffreId != null) {
            this.reloadMatches();
          }
        },
        error: (err) => {
          this.toast.error(this.businessError(err));
        }
      });
  }

  get selectedOffre(): Offre | null {
    if (this.selectedOffreId == null) return null;
    return this.offres.find((o) => o.id === this.selectedOffreId) ?? null;
  }

  get offerHasSkills(): boolean {
    return this.selectedOffreSkills.length > 0;
  }

  get skillsEditLink(): (string | number)[] | null {
    if (this.selectedOffreId == null) return null;
    return ['/recruiter/offre', this.selectedOffreId, 'edit'];
  }

  get rankedRows(): MatchRow[] {
    const ranked = this.rows.filter((r) => r.match.rank != null);
    if (this.bandFilter === 'all') return ranked;
    return ranked.filter(
      (r) => (r.match.scoreBand || '').toLowerCase() === this.bandFilter
    );
  }

  get unrankedRows(): MatchRow[] {
    return this.rows.filter((r) => r.match.rank == null);
  }

  /** Top 3 tous niveaux confondus (hors filtre). */
  get topRecommended(): MatchRow[] {
    return this.rows
      .filter((r) => r.match.rank != null && r.match.status === 'DONE')
      .slice()
      .sort((a, b) => (a.match.rank ?? 99) - (b.match.rank ?? 99))
      .slice(0, 3);
  }

  get highFitCount(): number {
    return this.bandCount('high');
  }

  get avgScoreLabel(): string {
    const scored = this.rows.filter(
      (r) => r.match.status === 'DONE' && r.match.score != null
    );
    if (!scored.length) return '—';
    const avg =
      scored.reduce((a, b) => a + Number(b.match.score), 0) / scored.length;
    return `${Math.round(avg * 100)}`;
  }

  get pendingComputeCount(): number {
    if (!this.candidatures.length) return 0;
    const matched = new Set(this.rows.map((r) => r.match.candidatureId));
    return this.candidatures.filter((c) => !matched.has(c.id)).length;
  }

  get scoresReady(): number {
    return this.rows.filter(
      (r) => r.match.status === 'DONE' && r.match.score != null
    ).length;
  }

  /** Candidatures sans score (vue « À calculer »). */
  get pendingComputeList(): Candidature[] {
    const matched = new Set(this.rows.map((r) => r.match.candidatureId));
    return this.candidatures.filter((c) => !matched.has(c.id));
  }

  setViewFocus(view: 'all' | 'ready' | 'missing'): void {
    this.viewFocus = view;
  }

  candidateLabelOf(c: Candidature): string {
    return this.candidateNames.get(c.candidateId) || `Candidat #${c.candidateId}`;
  }

  get bandCountHigh(): number {
    return this.bandCount('high');
  }

  get bandCountMedium(): number {
    return this.bandCount('medium');
  }

  get bandCountLow(): number {
    return this.bandCount('low');
  }

  get requiredSkills(): OffreSkill[] {
    return this.selectedOffreSkills.filter((s) => s.required);
  }

  get optionalSkills(): OffreSkill[] {
    return this.selectedOffreSkills.filter((s) => !s.required);
  }

  get postesCap(): number {
    const o = this.selectedOffre;
    return o?.postes && o.postes > 0 ? o.postes : 1;
  }

  get acceptedOnOffer(): number {
    return this.candidatures.filter((c) => c.status === 'ACCEPTED').length;
  }

  private bandCount(band: string): number {
    return this.rows.filter(
      (r) =>
        r.match.status === 'DONE' &&
        (r.match.scoreBand || '').toLowerCase() === band
    ).length;
  }

  bandShare(count: number): number {
    const total = Math.max(1, this.scoresReady);
    return Math.round((count / total) * 100);
  }

  get coverageShare(): number {
    if (!this.candidatures.length) return 0;
    return Math.round((this.scoresReady / this.candidatures.length) * 100);
  }

  get postesShare(): number {
    return Math.min(100, Math.round((this.acceptedOnOffer / Math.max(1, this.postesCap)) * 100));
  }

  get readyCount(): number {
    return this.rows.filter((r) => r.readyToDecide).length;
  }

  /** Anneau répartition élevé / moyen / faible. */
  get bandRingStyle(): Record<string, string> {
    const total = Math.max(1, this.scoresReady);
    const h = (this.bandCountHigh / total) * 100;
    const m = (this.bandCountMedium / total) * 100;
    const hEnd = h;
    const mEnd = h + m;
    if (!this.scoresReady) {
      return { background: 'conic-gradient(#dce8e4 0% 100%)' };
    }
    return {
      background: `conic-gradient(#0f7a4b 0% ${hEnd}%, #c98512 ${hEnd}% ${mEnd}%, #b44a42 ${mEnd}% 100%)`
    };
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

  scoreValue(score: number | null | undefined): number {
    if (score == null || Number.isNaN(Number(score))) return 0;
    return Math.max(0, Math.min(100, Math.round(Number(score) * 100)));
  }

  coveragePct(value: number | null | undefined): number {
    if (value == null || Number.isNaN(Number(value))) return 0;
    const n = Number(value);
    const pct = n <= 1 ? n * 100 : n;
    return Math.max(0, Math.min(100, Math.round(pct)));
  }

  ringStyle(score: number | null | undefined): Record<string, string> {
    const pct = this.scoreValue(score);
    const color =
      pct >= 70 ? '#0f6b4c' : pct >= 40 ? '#9a6700' : '#a33b32';
    return {
      background: `conic-gradient(${color} ${pct}%, #e6eeec ${pct}%)`
    };
  }

  onOffreChange(): void {
    this.selected = null;
    this.selectedOffreSkills = [];
    this.reloadMatches();
  }

  /** @param quiet si true : pas de skeleton (après un recalcul ponctuel). */
  reloadMatches(quiet = false): void {
    if (this.selectedOffreId == null) {
      this.rows = [];
      this.selectedOffreSkills = [];
      this.candidatures = [];
      return;
    }
    const offreId = this.selectedOffreId;
    if (!quiet) {
      this.loadingMatches = true;
      this.cdr.detectChanges();
    }

    forkJoin({
      matches: this.platform.offreMatches(offreId).pipe(
        catchError((err) => {
          if (!quiet) this.toast.error(this.businessError(err));
          return of([] as MatchResult[]);
        })
      ),
      apps: this.platform.candidaturesByOffre(offreId).pipe(
        catchError(() => of([] as Candidature[]))
      ),
      people: this.session.ensureCandidates().pipe(
        catchError(() => of(new Map<number, CandidateSummary>()))
      ),
      skills: this.platform.offreSkills(offreId).pipe(
        catchError(() => of([] as OffreSkill[]))
      ),
      assignments: this.testsApi.listAssignments(offreId).pipe(
        catchError(() => of([] as TestAssignment[]))
      ),
      test: this.testsApi.getByOffre(offreId).pipe(
        catchError(() => of(null as TechnicalTest | null))
      )
    })
      .pipe(
        finalize(() => {
          if (!quiet) this.loadingMatches = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: ({ matches, apps, people, skills, assignments, test }) => {
          this.candidatures = apps ?? [];
          this.selectedOffreSkills = skills ?? [];
          this.offerTest = test;
          this.assignments.clear();
          for (const a of assignments ?? []) {
            this.assignments.set(a.candidatureId, a);
          }
          this.candidateNames = new Map<number, string>();
          (people instanceof Map ? people : new Map()).forEach((p, id) => {
            this.candidateNames.set(
              id,
              `${p.firstName || ''} ${p.lastName || ''}`.trim() ||
                'Nom indisponible'
            );
          });
          const byId = new Map(this.candidatures.map((c) => [c.id, c]));
          this.rows = (matches ?? []).map((m) => {
            const app = byId.get(m.candidatureId);
            return this.toRow(m, app);
          });
          if (this.selected) {
            this.selected =
              this.rows.find(
                (r) => r.match.candidatureId === this.selected!.match.candidatureId
              ) ?? null;
          }
          // Acceptés cross-offres : cache session, hors du chemin critique UI.
          this.session
            .loadAcceptedCandidateIds(this.offres)
            .pipe(catchError(() => of(new Set<number>())))
            .subscribe({
              next: (ids) => {
                this.acceptedCandidateIds = ids;
                this.cdr.detectChanges();
              }
            });
        }
      });
  }

  /** Met à jour une ligne localement dès la réponse du recalcul. */
  private applyMatchResult(m: MatchResult): void {
    const app = this.candidatures.find((c) => c.id === m.candidatureId);
    const row = this.toRow(m, app);
    const idx = this.rows.findIndex((r) => r.match.candidatureId === m.candidatureId);
    if (idx >= 0) {
      this.rows = [
        ...this.rows.slice(0, idx),
        row,
        ...this.rows.slice(idx + 1)
      ];
    } else {
      this.rows = [...this.rows, row];
    }
    this.selected = row;
  }

  private toRow(m: MatchResult, app?: Candidature): MatchRow {
    const a = this.assignments.get(m.candidatureId);
    const testScore =
      a?.scoreTotal != null && !Number.isNaN(Number(a.scoreTotal))
        ? Number(a.scoreTotal)
        : null;
    const matchDone = m.status === 'DONE' && m.score != null;
    const testDone =
      !!a && (a.status === 'EVALUATED' || a.status === 'PUBLISHED') && testScore != null;
    const testReady =
      !!this.offerTest &&
      (this.offerTest.status === 'READY' || this.offerTest.status === 'ASSIGNED');
    const pendingLike =
      !app?.status ||
      app.status === 'PENDING' ||
      app.status === 'UNDER_REVIEW';
    return {
      match: m,
      candidateLabel: this.candidateLabel(m, app),
      candidatureStatus: app?.status || '—',
      testLabel: this.testLabelOf(a),
      testScore,
      readyToDecide: matchDone && testDone,
      canInvite: pendingLike && matchDone && testReady && !a
    };
  }

  private testLabelOf(a?: TestAssignment): string {
    if (!a) return 'Pas de test';
    if (
      (a.status === 'PUBLISHED' || a.status === 'EVALUATED') &&
      a.scoreTotal != null
    ) {
      return `Test passé · ${Math.round(Number(a.scoreTotal))}/100`;
    }
    const labels: Record<string, string> = {
      PENDING: 'Invité',
      IN_PROGRESS: 'En cours',
      SUBMITTED: 'Test passé — en correction',
      EVALUATING: 'Test passé — correction…',
      EVALUATED: 'Test passé — à publier',
      PUBLISHED: 'Test passé',
      EXPIRED: 'Expiré'
    };
    return labels[a.status] ?? a.status;
  }

  selectRow(row: MatchRow): void {
    this.selected = row;
  }

  computeMissing(): void {
    if (this.selectedOffreId == null || this.batchBusy) return;
    if (!this.offerHasSkills) {
      this.toast.warn(
        'Ajoutez d’abord les compétences recherchées sur l’offre, puis relancez.'
      );
      return;
    }
    if (!this.candidatures.length) {
      this.toast.error('Personne n’a encore postulé à cette offre.');
      return;
    }
    const missing = this.candidatures.filter(
      (c) => !this.rows.some((r) => r.match.candidatureId === c.id)
    );
    if (!missing.length) {
      this.toast.success('Tous les candidats ont déjà un score.');
      return;
    }
    this.batchBusy = true;
    this.cdr.detectChanges();

    let done = 0;
    let failed = 0;
    const runNext = (index: number): void => {
      if (index >= missing.length) {
        this.batchBusy = false;
        if (failed === 0) {
          this.toast.success(`${done} candidat(s) noté(s) avec succès.`);
        } else {
          this.toast.warn(
            `${done} noté(s) · ${failed} n’ont pas pu être traités.`
          );
        }
        this.reloadMatches();
        return;
      }
      const c = missing[index];
      this.busyId = c.id;
      this.platform
        .computeMatch(c.id, false)
        .pipe(
          finalize(() => {
            this.busyId = null;
          })
        )
        .subscribe({
          next: () => {
            done++;
            runNext(index + 1);
          },
          error: (err) => {
            failed++;
            if (failed === 1) {
              this.toast.error(this.businessError(err, c.id));
            }
            runNext(index + 1);
          }
        });
    };
    runNext(0);
  }

  inviteSelected(): void {
    if (!this.selected) return;
    this.inviteRow(this.selected);
  }

  inviteRow(row: MatchRow, event?: Event): void {
    event?.stopPropagation();
    if (this.selectedOffreId == null || this.inviteBusyId != null) return;
    if (row.match.status !== 'DONE' || row.match.score == null) {
      this.toast.error('Calculez d’abord le matching avant d’inviter au test.');
      return;
    }
    const candidatureId = row.match.candidatureId;
    this.inviteBusyId = candidatureId;
    this.cdr.detectChanges();
    this.testsApi
      .assign(this.selectedOffreId, [candidatureId])
      .pipe(
        finalize(() => {
          this.inviteBusyId = null;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: () => {
          this.toast.success(
            `Invitation au test envoyée à ${row.candidateLabel}.`
          );
          this.reloadMatches(true);
        },
        error: (err) => {
          this.toast.error(
            err?.error?.detail ||
              err?.error?.message ||
              err?.error?.error ||
              this.session.mapHttpError(err?.status)
          );
          this.cdr.detectChanges();
        }
      });
  }

  canDecide(row: MatchRow, status: RecruiterCandidatureDecision): boolean {
    if (row.candidatureStatus === 'WITHDRAWN') return false;
    if (status === 'UNDER_REVIEW') {
      return (
        row.candidatureStatus === 'PENDING' ||
        row.candidatureStatus === 'ACCEPTED' ||
        row.candidatureStatus === 'REJECTED' ||
        row.candidatureStatus === 'UNDER_REVIEW'
      );
    }
    if (
      row.candidatureStatus === 'ACCEPTED' ||
      row.candidatureStatus === 'REJECTED'
    ) {
      return false;
    }
    if (status === 'ACCEPTED') return this.acceptAllowed(row);
    return true;
  }

  acceptAllowed(row: MatchRow): boolean {
    if (this.acceptedOnOffer >= this.postesCap) return false;
    const app = this.candidatures.find((c) => c.id === row.match.candidatureId);
    if (app && this.acceptedCandidateIds.has(app.candidateId)) return false;
    return row.readyToDecide;
  }

  acceptBlockedReason(row: MatchRow): string | null {
    if (this.acceptedOnOffer >= this.postesCap) {
      return `Tous les postes sont pourvus (${this.postesCap}).`;
    }
    const app = this.candidatures.find((c) => c.id === row.match.candidatureId);
    if (app && this.acceptedCandidateIds.has(app.candidateId)) {
      return 'Ce candidat est déjà accepté sur une autre de vos offres.';
    }
    if (row.match.status !== 'DONE' || row.match.score == null) {
      return 'Matching non calculé.';
    }
    if (!row.readyToDecide) {
      return 'Le test doit être passé et noté.';
    }
    return null;
  }

  decide(row: MatchRow, status: RecruiterCandidatureDecision, event?: Event): void {
    event?.stopPropagation();
    if (this.decideBusyId != null) return;
    if (status === 'ACCEPTED' && !this.acceptAllowed(row)) {
      this.toast.error(this.acceptBlockedReason(row) || 'Acceptation impossible.');
      this.cdr.detectChanges();
      return;
    }
    this.decideBusyId = row.match.candidatureId;
    this.cdr.detectChanges();
    this.platform
      .updateCandidatureStatus(row.match.candidatureId, status)
      .pipe(
        finalize(() => {
          this.decideBusyId = null;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: () => {
          this.toast.success(
            `Statut mis à jour pour ${row.candidateLabel} : ${this.labelCandidatureStatus(status)}.`
          );
          this.session.invalidateCandidatures(row.match.offreId);
          this.reloadMatches(true);
        },
        error: (err) => {
          const detail =
            err?.error?.message ||
            err?.error?.error ||
            (typeof err?.error === 'string' ? err.error : null) ||
            this.session.mapHttpError(err?.status);
          this.toast.error(detail);
          this.cdr.detectChanges();
        }
      });
  }

  recalculate(row: MatchRow, event?: Event): void {
    event?.stopPropagation();
    this.runCompute(row.match.candidatureId, true);
  }

  calculate(candidatureId: number): void {
    this.runCompute(candidatureId, false);
  }

  private runCompute(candidatureId: number, force: boolean): void {
    if (this.busyId != null) return;
    this.busyId = candidatureId;
    this.cdr.detectChanges();
    this.platform
      .computeMatch(candidatureId, force)
      .pipe(
        finalize(() => {
          this.busyId = null;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (m) => {
          this.applyMatchResult(m);
          this.toast.success(force
            ? 'Score mis à jour.'
            : 'Score calculé.');
          // Recharge le classement (rangs) sans vider l’écran.
          this.reloadMatches(true);
        },
        error: (err) => {
          this.toast.error(this.businessError(err, candidatureId));
        }
      });
  }

  scorePercent(score: number | null | undefined): string {
    if (score == null || Number.isNaN(Number(score))) return '—';
    return `${Math.round(Number(score) * 100)}`;
  }

  bandLabel(band: string | null | undefined): string {
    switch ((band || '').toLowerCase()) {
      case 'low':
        return 'Peu adapté';
      case 'medium':
        return 'Correct';
      case 'high':
        return 'Très adapté';
      case 'unavailable':
        return 'Pas noté';
      default:
        return band || '—';
    }
  }

  labelCandidatureStatus(status: string): string {
    return (
      {
        PENDING: 'En attente',
        UNDER_REVIEW: 'En revue',
        ACCEPTED: 'Acceptée',
        REJECTED: 'Refusée',
        WITHDRAWN: 'Retirée'
      } as Record<string, string>
    )[status] ?? (status && status !== '—' ? status : 'Reçue');
  }

  matchedSkills(m: MatchResult): string[] {
    return m.features?.matchedSkills ?? [];
  }

  missingRequired(m: MatchResult): string[] {
    return m.features?.missingRequiredSkills ?? [];
  }

  explanations(m: MatchResult): string[] {
    return (m.explanations ?? [])
      .map((e) => this.friendlyExplanation(e))
      .filter((e) => !!e.trim());
  }

  /** Affiche les notes IA en langage recruteur (anciennes + nouvelles formulations). */
  private friendlyExplanation(raw: string): string {
    const t = (raw || '').trim();
    if (!t) return '';

    // Skip redundancy already visible in the detail header / chips.
    if (/^Bande de score:/i.test(t)) return '';
    if (/^Niveau d[’']adéquation/i.test(t)) return '';
    if (/^Compétences communes:/i.test(t)) return '';
    if (/^Points forts communs:/i.test(t)) return '';
    if (/^Compétences obligatoires manquantes:/i.test(t)) return '';

    // Hidden from recruiter UI (still used internally in the score).
    if (/Similarité sémantique/i.test(t)) return '';
    if (/Proximité globale du profil/i.test(t)) return '';
    if (/Proximité des intitulés/i.test(t)) return '';
    if (/Similarité d['’]intitulés/i.test(t)) return '';
    // Already shown as first lines in « Pourquoi ce score ? ».
    if (/Adéquation expérience/i.test(t)) return '';
    if (/Expérience par rapport/i.test(t)) return '';
    if (/^Formation\s*:/i.test(t)) return '';

    return t.replace(/\s*\[(?:tfidf[^\]]*|st[^\]]*)\]\s*/gi, '').trim();
  }

  experienceLabel(m: MatchResult): string {
    const v = m.features?.experience_match;
    if (v == null || Number.isNaN(Number(v))) return 'Non demandée';
    return `${Math.max(0, Math.min(100, Math.round(Number(v) * 100)))} %`;
  }

  experienceHint(m: MatchResult): string {
    const v = m.features?.experience_match;
    if (v == null || Number.isNaN(Number(v))) {
      return 'L’offre ne fixe pas d’années d’expérience.';
    }
    const pct = Math.round(Number(v) * 100);
    if (pct >= 100) return 'Il a au moins l’expérience demandée.';
    if (pct >= 70) return 'Proche de ce que vous demandez.';
    return 'Un peu en dessous de l’expérience demandée.';
  }

  educationLabel(m: MatchResult): string {
    const v = m.features?.education_match;
    if (v == null || Number.isNaN(Number(v))) return 'Non comparée';
    const n = Number(v);
    if (n >= 1) return 'OK';
    if (n >= 0.5) return 'En cours';
    return 'En dessous';
  }

  educationHint(m: MatchResult): string {
    const v = m.features?.education_match;
    if (v == null || Number.isNaN(Number(v))) {
      return 'Pas assez d’infos pour comparer le diplôme.';
    }
    const n = Number(v);
    if (n >= 1) return 'Le niveau demandé est atteint.';
    if (n >= 0.5) return 'Formation en cours, proche du niveau demandé.';
    return 'Le diplôme est en dessous de ce qui est demandé.';
  }

  labelOffreStatus(s: string): string {
    return (
      {
        DRAFT: 'Brouillon',
        PUBLISHED: 'Publiée',
        CLOSED: 'Clôturée'
      } as Record<string, string>
    )[s] ?? s;
  }

  private candidateLabel(m: MatchResult, _app?: Candidature): string {
    if (m.candidateId != null) {
      return this.candidateNames.get(m.candidateId) || 'Nom indisponible';
    }
    return 'Nom indisponible';
  }

  private businessError(err: unknown, candidatureId?: number): string {
    const e = err as {
      status?: number;
      error?: { message?: string; code?: string } | string;
    };
    const detail =
      typeof e?.error === 'string' ? e.error : e?.error?.message;
    const prefix = candidatureId != null ? 'Matching — ' : '';

    if (e?.status === 404) {
      return (
        prefix + (detail?.trim() || 'Pas encore de score pour ce candidat.')
      );
    }
    if (e?.status === 409) {
      return (
        prefix +
        (detail?.trim() ||
          'Impossible de noter : ajoutez des compétences à l’offre.')
      );
    }
    if (e?.status === 413) {
      return (
        prefix +
        (detail?.trim() || 'Le CV est trop lourd pour être analysé.')
      );
    }
    if (detail?.trim()) return prefix + detail.trim();
    return prefix + this.session.mapHttpError(e?.status);
  }
}
