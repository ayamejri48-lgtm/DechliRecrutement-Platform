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

import { Offre, OffreSkill, PlatformService, User } from '../../../core/services/platform.service';
import { ToastService } from '../../../core/services/toast.service';
import { cmp, slicePage } from '../data/admin-list.util';
import {
  AdminTestOverview,
  TestApiService
} from '../../../core/services/test-api.service';
import { AdminSessionService } from '../data/admin-session.service';

@Component({
  selector: 'app-admin-offres',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-offres.component.html',
  styleUrl: './admin-offres.component.scss'
})
export class AdminOffresComponent implements OnInit {
  private readonly session = inject(AdminSessionService);
  private readonly toast = inject(ToastService);
  private readonly platform = inject(PlatformService);
  private readonly testsApi = inject(TestApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);

  loading = true;
  error = '';
  q = '';
  status = '';
  alert = '';
  sortKey: 'title' | 'status' | 'deadline' = 'title';
  sortDir: 'asc' | 'desc' = 'asc';
  page = 1;
  recruiterId: number | null = null;
  appCounts = new Map<number, number>();
  detailSkills: OffreSkill[] = [];
  offres: Offre[] = [];
  users: User[] = [];
  selected: Offre | null = null;
  testsReady = false;
  countsReady = false;
  private countsFailed = false;
  private testByOffre = new Map<number, AdminTestOverview['tests'][number]>();
  private draftIds = new Set<number>();

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      this.status = params.get('status') ?? '';
      this.alert = params.get('alert') ?? '';
      const focus = Number(params.get('focus'));
      if (Number.isFinite(focus) && focus > 0) {
        const found = this.offres.find((o) => o.id === focus);
        if (found) this.openDetail(found);
      }
      this.cdr.detectChanges();
    });
    this.reload();
  }

  get filtered(): Offre[] {
    const q = this.q.trim().toLowerCase();
    return this.offres.filter((o) => {
      if (this.status && o.status !== this.status) return false;
      if (this.alert === 'draft-skills' && !this.draftIds.has(o.id)) return false;
      if (this.alert === 'unpublished' && this.testsReady) {
        const row = this.testByOffre.get(o.id);
        if (!row || row.unpublishedGradedCount < 1) return false;
      }
      if (this.alert === 'no-test' && this.testsReady) {
        if (o.status !== 'PUBLISHED' || this.testByOffre.has(o.id)) return false;
      }
      if (this.alert === 'no-candidature') {
        if (
          this.countsFailed ||
          !this.countsReady ||
          o.status !== 'PUBLISHED' ||
          (this.appCounts.get(o.id) || 0) > 0
        ) {
          return false;
        }
      }
      if (this.recruiterId != null && o.recruiterId !== this.recruiterId) {
        return false;
      }
      if (!q) return true;
      return `${o.title} ${o.location}`.toLowerCase().includes(q);
    });
  }

  get view() {
    const items = [...this.filtered].sort((a, b) => {
      const dir = this.sortDir === 'asc' ? 1 : -1;
      const av =
        this.sortKey === 'status'
          ? a.status
          : this.sortKey === 'deadline'
            ? a.deadline || ''
            : a.title;
      const bv =
        this.sortKey === 'status'
          ? b.status
          : this.sortKey === 'deadline'
            ? b.deadline || ''
            : b.title;
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

  testLabel(offreId: number): string {
    const row = this.testByOffre.get(offreId);
    if (!row) return 'Test absent';
    const status =
      (
        {
          GENERATING: 'Génération…',
          READY: 'Prêt',
          ASSIGNED: 'Assigné',
          FAILED: 'Échec',
          DRAFT: 'Brouillon'
        } as Record<string, string>
      )[row.status] ?? row.status;
    return `Test ${status} · ${row.publishedCount} publié(s)`;
  }

  get recruiters(): User[] {
    return this.users.filter((u) => u.role === 'RECRUITER');
  }

  recruiterLabel(id: number): string {
    const u = this.users.find((x) => x.id === id);
    return u ? `${u.firstName} ${u.lastName}`.trim() : 'Recruteur inconnu';
  }

  reload(): void {
    this.loading = true;
    this.session
      .ensureUsers()
      .subscribe({ next: (u) => (this.users = u) });
    this.session.ensureCandidatures().subscribe({
      next: (list) => {
        const counts = new Map<number, number>();
        for (const c of list ?? []) {
          counts.set(c.offreId, (counts.get(c.offreId) ?? 0) + 1);
        }
        this.appCounts = counts;
        this.countsReady = true;
        this.cdr.detectChanges();
      },
      error: () => {
        this.countsFailed = true;
        this.countsReady = true;
        this.toast.error('Impossible de compter les candidatures.');
        this.cdr.detectChanges();
      }
    });
    forkJoin({
      offres: this.session.refreshOffres(),
      overview: this.testsApi.adminOverview().pipe(
        catchError(() => of(null as AdminTestOverview | null))
      ),
      draftIds: this.platform.draftsWithoutSkills().pipe(
        catchError(() => of([] as number[]))
      )
    })
      .pipe(
        finalize(() => {
          this.loading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: ({ offres, overview, draftIds }) => {
          this.offres = offres;
          this.testsReady = overview != null;
          this.testByOffre = new Map(
            (overview?.tests ?? []).map((row) => [row.offreId, row])
          );
          this.draftIds = new Set(draftIds ?? []);
          const focus = Number(this.route.snapshot.queryParamMap.get('focus'));
          if (Number.isFinite(focus) && focus > 0) {
            const found = this.offres.find((o) => o.id === focus);
            if (found) this.openDetail(found);
          }
        },
        error: (err) => {
          this.toast.error(this.session.mapHttpError(err?.status));
        }
      });
  }

  openDetail(o: Offre): void {
    this.selected = o;
    this.detailSkills = [];
    this.platform
      .offreSkills(o.id)
      .pipe(catchError(() => of([] as OffreSkill[])))
      .subscribe((skills) => {
        if (this.selected?.id !== o.id) return;
        this.detailSkills = skills ?? [];
        this.cdr.detectChanges();
      });
  }

  skillLine(): string {
    if (!this.detailSkills.length) return 'Aucune compétence structurée';
    return this.detailSkills.map((s) => s.name).join(', ');
  }

  statusClass(s: string): string {
    return ({ DRAFT: 'draft', PUBLISHED: 'published', CLOSED: 'closed' } as Record<string, string>)[s] ?? '';
  }

  labelStatus(s: string): string {
    return (
      { DRAFT: 'Brouillon', PUBLISHED: 'Publiée', CLOSED: 'Clôturée' } as Record<
        string,
        string
      >
    )[s] ?? s;
  }
}
