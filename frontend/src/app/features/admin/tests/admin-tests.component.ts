import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

import {
  Candidature,
  CandidateSummary,
  Offre,
  PlatformService,
  User
} from '../../../core/services/platform.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  AdminTestOverview,
  TestApiService
} from '../../../core/services/test-api.service';
import { AdminSessionService } from '../data/admin-session.service';

type TestRow = AdminTestOverview['tests'][number] & { title: string };
type CopyRow = AdminTestOverview['assignments'][number] & {
  title: string;
  candidateName: string;
};

@Component({
  selector: 'app-admin-tests',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-tests.component.html',
  styleUrl: './admin-tests.component.scss'
})
export class AdminTestsComponent implements OnInit {
  private readonly testsApi = inject(TestApiService);
  private readonly toast = inject(ToastService);
  private readonly platform = inject(PlatformService);
  private readonly session = inject(AdminSessionService);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);

  loading = true;
  error = '';
  tests: TestRow[] = [];
  copies: CopyRow[] = [];
  onlyUnpublished = false;
  copyStatus = '';

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      this.onlyUnpublished = params.get('unpublished') === '1';
      this.copyStatus = params.get('status') ?? '';
      this.cdr.detectChanges();
    });
    forkJoin({
      overview: this.testsApi.adminOverview().pipe(catchError(() => of(null))),
      offres: this.session.ensureOffres().pipe(catchError(() => of([] as Offre[]))),
      candidatures: this.session.ensureCandidatures().pipe(catchError(() => of([] as Candidature[]))),
      people: this.platform.candidates().pipe(catchError(() => of([] as CandidateSummary[]))),
      users: this.session.ensureUsers().pipe(catchError(() => of([] as User[])))
    })
      .pipe(
        finalize(() => {
          this.loading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: ({ overview, offres, candidatures, people, users }) => {
          if (!overview) {
            this.toast.error('Le service de tests ne répond pas.');
            return;
          }
          const titles = new Map(
            offres.filter((o) => !!o.title).map((o) => [o.id, o.title])
          );
          const names = new Map<number, string>();
          for (const user of users) {
            const label = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
            if (label) names.set(user.id, label);
          }
          for (const person of people) {
            const label = `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim();
            if (label) names.set(person.id, label);
          }
          const candidateOf = new Map(
            candidatures.map((row) => [row.id, names.get(row.candidateId) || ''])
          );
          this.tests = overview.tests.map((row) => ({
            ...row,
            title: titles.get(row.offreId) || 'Offre sans titre'
          }));
          this.copies = overview.assignments.map((row) => ({
            ...row,
            title: titles.get(row.offreId) || 'Offre sans titre',
            candidateName: candidateOf.get(row.candidatureId) || 'Nom indisponible'
          }));
        },
        error: () => {
          this.toast.error('Le service de tests ne répond pas.');
        }
      });
  }

  get visibleCopies(): CopyRow[] {
    return this.copies.filter((row) => {
      if (this.onlyUnpublished && row.status !== 'EVALUATED') return false;
      if (this.copyStatus && row.status !== this.copyStatus) return false;
      return true;
    });
  }

  get copyStatuses(): string[] {
    return [...new Set(this.copies.map((row) => row.status))].sort();
  }

  testStatus(status: string): string {
    return (
      {
        DRAFT: 'Brouillon',
        GENERATING: 'Génération',
        READY: 'Prêt',
        ASSIGNED: 'Assigné',
        FAILED: 'Échec'
      } as Record<string, string>
    )[status] ?? status;
  }

  copyStatusLabel(status: string): string {
    return (
      {
        PENDING: 'Invité',
        IN_PROGRESS: 'En cours',
        SUBMITTED: 'Rendu',
        EVALUATING: 'Correction',
        EVALUATED: 'Noté, non publié',
        PUBLISHED: 'Publié',
        EXPIRED: 'Expiré'
      } as Record<string, string>
    )[status] ?? status;
  }

  scoreOf(row: CopyRow): string {
    if (row.scoreTotal == null) return '—';
    return row.status === 'EVALUATED' ? `${row.scoreTotal}/100 · non publié` : `${row.scoreTotal}/100`;
  }
}
