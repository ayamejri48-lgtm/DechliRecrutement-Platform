import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

import {
  AdminOffreStats,
  AdminUserStats,
  PlatformService
} from '../../../core/services/platform.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  AdminTestStats,
  TestApiService
} from '../../../core/services/test-api.service';
import { AdminSessionService } from '../data/admin-session.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './admin-dashboard.component.html',
  styleUrl: './admin-dashboard.component.scss'
})
export class AdminDashboardComponent implements OnInit {
  private readonly platform = inject(PlatformService);
  private readonly toast = inject(ToastService);
  private readonly testsApi = inject(TestApiService);
  private readonly session = inject(AdminSessionService);
  private readonly cdr = inject(ChangeDetectorRef);

  loading = true;
  error = '';
  users: AdminUserStats | null = null;
  offre: AdminOffreStats | null = null;
  tests: AdminTestStats | null = null;

  ngOnInit(): void {
    this.loading = true;
    forkJoin({
      users: this.platform.adminUserStats().pipe(catchError(() => of(null))),
      offre: this.platform.adminOffreStats().pipe(catchError(() => of(null))),
      tests: this.testsApi.adminStats().pipe(catchError(() => of(null)))
    })
      .pipe(
        finalize(() => {
          this.loading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: ({ users, offre, tests }) => {
          this.users = users;
          this.offre = offre;
          this.tests = tests;
          if (!users && !offre && !tests) {
            this.toast.error('Les indicateurs sont indisponibles.');
          }
        },
        error: (err) => {
          this.toast.error(this.session.mapHttpError(err?.status));
        }
      });
  }

  get lead(): string {
    if (!this.users && !this.offre && !this.tests) return 'Les indicateurs ne répondent pas.';
    const n = this.attention.length;
    if (n === 0) return 'Rien ne demande une action immédiate.';
    return n === 1 ? 'Un point demande un regard.' : `${n} points demandent un regard.`;
  }

  get attention(): Array<{
    label: string;
    detail: string;
    count: number | null;
    link: string;
    query?: Record<string, string>;
  }> {
    const items: Array<{
      label: string;
      detail: string;
      count: number | null;
      link: string;
      query?: Record<string, string>;
    }> = [];
    if (!this.users) {
      items.push({ label: 'Comptes', detail: 'Le service d’authentification ne répond pas.', count: null, link: '/admin/users' });
    } else if (this.users.disabled > 0) {
      items.push({
        label: 'Comptes désactivés',
        detail: 'Ces personnes ne peuvent plus se connecter.',
        count: this.users.disabled,
        link: '/admin/users',
        query: { enabled: '0' }
      });
    }
    if (!this.offre) {
      items.push({ label: 'Offres et candidatures', detail: 'Le service des offres ne répond pas.', count: null, link: '/admin/offres' });
    } else {
      if (this.offre.staleOpen > 0) {
        items.push({
          label: 'Candidatures sans suite',
          detail: 'En attente ou en revue depuis plus de 7 jours.',
          count: this.offre.staleOpen,
          link: '/admin/candidatures',
          query: { stale: '1' }
        });
      }
      if (this.offre.draftsWithoutSkills > 0) {
        items.push({
          label: 'Brouillons sans compétence',
          detail: 'Un test et un matching fiables ont besoin de compétences.',
          count: this.offre.draftsWithoutSkills,
          link: '/admin/offres',
          query: { alert: 'draft-skills' }
        });
      }
      if (this.offre.publishedPastDeadline > 0) {
        items.push({
          label: 'Offres à échéance dépassée',
          detail: 'Toujours publiées après la date limite.',
          count: this.offre.publishedPastDeadline,
          link: '/admin/offres',
          query: { status: 'PUBLISHED' }
        });
      }
      if (this.offre.publishedWithoutCandidature > 0) {
        items.push({
          label: 'Offres publiées sans candidature',
          detail: 'Aucune personne n’a encore postulé.',
          count: this.offre.publishedWithoutCandidature,
          link: '/admin/offres',
          query: { alert: 'no-candidature' }
        });
      }
    }
    if (this.publishedWithoutTest == null && this.tests == null) {
      items.push({ label: 'Tests', detail: 'Le service de tests ne répond pas.', count: null, link: '/admin/offres' });
    } else if (this.publishedWithoutTest != null && this.publishedWithoutTest > 0) {
      items.push({
        label: 'Offres publiées sans test',
        detail: 'Aucun test technique n’a été généré.',
        count: this.publishedWithoutTest,
        link: '/admin/offres',
        query: { alert: 'no-test' }
      });
    }
    if (this.tests && this.tests.unpublishedGraded > 0) {
      items.push({
        label: 'Notes non publiées',
        detail: 'Le recruteur n’a pas encore rendu la note au candidat.',
        count: this.tests.unpublishedGraded,
        link: '/admin/tests',
        query: { unpublished: '1' }
      });
    }
    return items;
  }

  get pipeline(): Array<{ key: string; label: string; count: number; tone: string }> {
    if (!this.offre) return [];
    return [
      { key: 'PENDING', label: 'En attente', count: this.offre.pending, tone: 'pending' },
      { key: 'UNDER_REVIEW', label: 'En revue', count: this.offre.underReview, tone: 'review' },
      { key: 'ACCEPTED', label: 'Acceptées', count: this.offre.accepted, tone: 'accepted' },
      { key: 'REJECTED', label: 'Refusées', count: this.offre.rejected, tone: 'rejected' },
      { key: 'WITHDRAWN', label: 'Retirées', count: this.offre.withdrawn, tone: 'withdrawn' }
    ];
  }

  /** Offres publiées absentes de la liste renvoyée par le Test-Service. */
  get publishedWithoutTest(): number | null {
    if (!this.offre || !this.tests) return null;
    const withTest = new Set(this.tests.offreIdsWithTest ?? []);
    return (this.offre.publishedOffreIds ?? []).filter((id) => !withTest.has(id)).length;
  }

  volumeMax(): number {
    const rows = this.offre?.volume7d ?? [];
    return rows.reduce((max, row) => Math.max(max, row.count), 0);
  }

  barHeight(count: number): string {
    const max = this.volumeMax();
    if (!max || count <= 0) return '0%';
    return `${Math.round((count / max) * 100)}%`;
  }

  get testSteps(): Array<{ label: string; count: number; query: Record<string, string> }> {
    const counts = this.tests?.assignmentsByStatus;
    if (!counts) return [];
    const rows: Array<{ label: string; count: number; query: Record<string, string> }> = [
      { label: 'Invités', count: counts['PENDING'] ?? 0, query: { status: 'PENDING' } },
      { label: 'En cours', count: counts['IN_PROGRESS'] ?? 0, query: { status: 'IN_PROGRESS' } },
      { label: 'Rendus', count: counts['SUBMITTED'] ?? 0, query: { status: 'SUBMITTED' } },
      { label: 'En correction', count: counts['EVALUATING'] ?? 0, query: { status: 'EVALUATING' } },
      { label: 'Notés, non publiés', count: counts['EVALUATED'] ?? 0, query: { unpublished: '1' } },
      { label: 'Publiés', count: counts['PUBLISHED'] ?? 0, query: { status: 'PUBLISHED' } },
      { label: 'Expirés', count: counts['EXPIRED'] ?? 0, query: { status: 'EXPIRED' } }
    ];
    return rows.filter((row) => row.count > 0);
  }

  testShare(count: number): string {
    const max = this.testSteps.reduce((top, row) => Math.max(top, row.count), 0);
    if (!max) return '0%';
    return `${Math.round((count / max) * 100)}%`;
  }

  dayLabel(iso: string): string {
    const date = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
  }

}
