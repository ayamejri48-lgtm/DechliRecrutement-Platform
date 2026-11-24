import { ToastService } from '../../../core/services/toast.service';
import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

import { Candidature, Offre, User } from '../../../core/services/platform.service';
import {
  AdminTestOverview,
  TestApiService
} from '../../../core/services/test-api.service';
import { AdminSessionService } from '../data/admin-session.service';

@Component({
  selector: 'app-admin-recruiter-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './admin-recruiter-detail.component.html',
  styleUrl: './admin-recruiter-detail.component.scss'
})
export class AdminRecruiterDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);
  private readonly session = inject(AdminSessionService);
  private readonly testsApi = inject(TestApiService);
  private readonly cdr = inject(ChangeDetectorRef);

  loading = true;
  error = '';
  testsReady = false;
  recruiter: User | null = null;
  offers: Array<Offre & { applications: number; testLabel: string }> = [];

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!id) {
      this.toast.error('Recruteur invalide.');
      this.loading = false;
      return;
    }
    forkJoin({
      users: this.session.ensureUsers().pipe(catchError(() => of([] as User[]))),
      offres: this.session.ensureOffres().pipe(catchError(() => of(null as Offre[] | null))),
      candidatures: this.session.ensureCandidatures().pipe(catchError(() => of(null as Candidature[] | null))),
      tests: this.testsApi.adminOverview().pipe(catchError(() => of(null as AdminTestOverview | null)))
    })
      .pipe(finalize(() => {
        this.loading = false;
        this.cdr.detectChanges();
      }))
      .subscribe(({ users, offres, candidatures, tests }) => {
        const person = users.find((user) => user.id === id && user.role === 'RECRUITER') ?? null;
        this.recruiter = person;
        if (!person) {
          this.toast.error('Ce recruteur est introuvable dans la liste des comptes.');
          return;
        }
        if (!offres || !candidatures) {
          this.toast.error('Les offres ou les candidatures ne répondent pas.');
          return;
        }
        this.testsReady = tests != null;
        const apps = new Map<number, number>();
        for (const candidature of candidatures) {
          apps.set(candidature.offreId, (apps.get(candidature.offreId) ?? 0) + 1);
        }
        const testByOffre = new Map((tests?.tests ?? []).map((row) => [row.offreId, row]));
        this.offers = offres
          .filter((offre) => offre.recruiterId === id)
          .map((offre) => {
            const test = testByOffre.get(offre.id);
            return {
              ...offre,
              applications: apps.get(offre.id) ?? 0,
              testLabel: !tests ? '—' : test ? 'Généré' : 'Aucun'
            };
          });
      });
  }

  published(): number {
    return this.offers.filter((offre) => offre.status === 'PUBLISHED').length;
  }

  applications(): number {
    return this.offers.reduce((sum, offre) => sum + offre.applications, 0);
  }

  withTest(): number {
    return this.offers.filter((offre) => offre.testLabel === 'Généré').length;
  }

  statusLabel(status: string): string {
    return ({ DRAFT: 'Brouillon', PUBLISHED: 'Publiée', CLOSED: 'Clôturée' } as Record<string, string>)[status] ?? status;
  }

  statusClass(status: string): string {
    return ({ DRAFT: 'draft', PUBLISHED: 'published', CLOSED: 'closed' } as Record<string, string>)[status] ?? '';
  }
}
