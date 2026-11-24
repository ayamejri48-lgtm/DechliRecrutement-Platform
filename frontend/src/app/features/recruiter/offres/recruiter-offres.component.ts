import { ToastService } from '../../../core/services/toast.service';
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
import { Subscription, finalize } from 'rxjs';

import { Offre, PlatformService } from '../../../core/services/platform.service';
import { RecruiterSessionService } from '../data/recruiter-session.service';

@Component({
  selector: 'app-recruiter-offres',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './recruiter-offres.component.html',
  styleUrl: './recruiter-offres.component.scss'
})
export class RecruiterOffresComponent implements OnInit, OnDestroy {
  private readonly platform = inject(PlatformService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(RecruiterSessionService);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);
  private countsSub?: Subscription;

  allMine: Offre[] = [];
  offres: Offre[] = [];
  /** Compteurs candidatures (page visible) — cache session partagé. */
  countsByOffre = new Map<number, number>();
  countsLoading = false;
  loading = false;
  busyId: number | null = null;
  createHint = false;

  title = '';
  location = '';
  contractType = '';
  workMode = '';
  status = '';
  sort: 'recent' | 'oldest' | 'title' = 'recent';
  page = 0;
  readonly pageSize = 10;

  readonly contracts = ['CDI', 'CDD', 'STAGE'] as const;
  readonly modes = ['ONSITE', 'HYBRID', 'REMOTE'] as const;
  readonly statuses = ['DRAFT', 'PUBLISHED', 'CLOSED'] as const;

  ngOnInit(): void {
    const navState = (history.state ?? {}) as {
      success?: string;
      createdOffre?: Offre;
    };
    const fromCreate = !!navState.createdOffre || !!navState.success;

    if (fromCreate) {
      this.status = '';
      this.toast.success(navState.success || '');
      this.createHint = !!navState.createdOffre;
      if (navState.createdOffre) {
        this.session.upsertOffre(navState.createdOffre);
      }
    } else {
      const statusQ = this.route.snapshot.queryParamMap.get('status');
      if (statusQ) {
        this.status = statusQ;
      }
    }

    if (this.session.hasOffresCache()) {
      this.allMine = this.session.myOffres();
      this.applyFilters();
      this.cdr.detectChanges();
    }

    this.reload(fromCreate || !this.session.hasOffresCache());
  }

  ngOnDestroy(): void {
    this.countsSub?.unsubscribe();
  }

  get totalElements(): number {
    return this.filtered().length;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalElements / this.pageSize));
  }

  get hasActiveFilters(): boolean {
    return !!(
      this.title.trim() ||
      this.location.trim() ||
      this.contractType ||
      this.workMode ||
      this.status ||
      this.sort !== 'recent'
    );
  }

  countByStatus(s: string): number {
    return this.allMine.filter((o) => o.status === s).length;
  }

  setStatusFilter(s: string): void {
    this.status = s;
    this.search();
  }

  candidatureCount(o: Offre): string {
    if (this.countsByOffre.has(o.id)) {
      return String(this.countsByOffre.get(o.id));
    }
    return this.countsLoading ? '…' : '—';
  }

  formatDate(value: string): string {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }

  reload(force = true): void {
    this.loading = this.allMine.length === 0;

    this.cdr.detectChanges();
    const req$ = force
      ? this.session.refreshOffres()
      : this.session.ensureMyOffres();

    req$
      .pipe(
        finalize(() => {
          this.loading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (list) => {
          const created = (history.state as { createdOffre?: Offre } | null)
            ?.createdOffre;
          let merged = list;
          if (created && !merged.some((o) => o.id === created.id)) {
            merged = [created, ...merged];
            this.session.upsertOffre(created);
          }
          this.allMine = merged;
          this.applyFilters();
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.toast.error(this.session.mapHttpError(err?.status));
          this.cdr.detectChanges();
        }
      });
  }

  search(): void {
    this.page = 0;
    this.applyFilters();
  }

  resetFilters(): void {
    this.title = '';
    this.location = '';
    this.contractType = '';
    this.workMode = '';
    this.status = '';
    this.sort = 'recent';
    this.search();
  }

  prev(): void {
    if (this.page <= 0) return;
    this.page -= 1;
    this.applyFilters(false);
  }

  next(): void {
    if (this.page >= this.totalPages - 1) return;
    this.page += 1;
    this.applyFilters(false);
  }

  publish(o: Offre): void {
    if (this.busyId != null) return;
    this.busyId = o.id;

    this.cdr.detectChanges();
    this.platform.offreSkills(o.id).subscribe({
      next: (skills) => {
        if (!skills?.length) {
          this.busyId = null;
          this.toast.warn(
            `Publication impossible : ajoutez au moins une compétence à « ${o.title} ».`
          );
          this.cdr.detectChanges();
          return;
        }
        this.busyId = null;
        this.runAction(
          o.id,
          () => this.platform.publishOffre(o.id),
          `Offre « ${o.title} » publiée.`,
          'PUBLISHED'
        );
      },
      error: (err) => {
        this.busyId = null;
        this.toast.error(this.businessError(err));
        this.cdr.detectChanges();
      }
    });
  }

  close(o: Offre): void {
    this.runAction(
      o.id,
      () => this.platform.closeOffre(o.id),
      'Offre clôturée.',
      'CLOSED'
    );
  }

  remove(o: Offre): void {
    if (!confirm(`Supprimer le brouillon « ${o.title} » ?`)) return;
    this.runAction(
      o.id,
      () => this.platform.removeOffre(o.id),
      'Offre supprimée.',
      'REMOVE'
    );
  }

  labelStatus(s: string): string {
    return (
      { DRAFT: 'Brouillon', PUBLISHED: 'Publiée', CLOSED: 'Clôturée' } as Record<
        string,
        string
      >
    )[s] ?? s;
  }

  labelContract(c: string): string {
    return c;
  }

  labelMode(m: string): string {
    return (
      { ONSITE: 'Sur site', HYBRID: 'Hybride', REMOTE: 'Télétravail' } as Record<
        string,
        string
      >
    )[m] ?? m;
  }

  private filtered(): Offre[] {
    const t = this.title.trim().toLowerCase();
    const loc = this.location.trim().toLowerCase();
    let list = this.allMine.filter((o) => {
      if (t && !o.title?.toLowerCase().includes(t)) return false;
      if (loc && !o.location?.toLowerCase().includes(loc)) return false;
      if (this.contractType && o.contractType !== this.contractType) return false;
      if (this.workMode && o.workMode !== this.workMode) return false;
      if (this.status) {
        const allowed = this.status
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (allowed.length && !allowed.includes(o.status)) return false;
      }
      return true;
    });

    list = [...list].sort((a, b) => {
      if (this.sort === 'title') {
        return (a.title || '').localeCompare(b.title || '');
      }
      const cmp = (a.createdAt || '').localeCompare(b.createdAt || '');
      return this.sort === 'oldest' ? cmp : -cmp;
    });
    return list;
  }

  private applyFilters(resetPage = true): void {
    if (resetPage) this.page = 0;
    const list = this.filtered();
    const start = this.page * this.pageSize;
    this.offres = list.slice(start, start + this.pageSize);
    this.scheduleCounts(this.offres);
  }

  /** Compteurs en différé — ne bloque pas la liste. */
  private scheduleCounts(pageOffres: Offre[]): void {
    this.countsSub?.unsubscribe();
    if (!pageOffres.length) {
      this.countsByOffre = new Map();
      this.countsLoading = false;
      return;
    }
    this.countsLoading = true;
    this.cdr.detectChanges();
    this.countsSub = this.session
      .loadCandidatureCountsByOffre(pageOffres)
      .pipe(
        finalize(() => {
          this.countsLoading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (map) => {
          this.countsByOffre = map;
        },
        error: () => {
          this.countsByOffre = new Map();
        }
      });
  }

  private runAction(
    id: number,
    call: () => ReturnType<PlatformService['publishOffre']>,
    okMsg: string,
    effect: 'PUBLISHED' | 'CLOSED' | 'REMOVE'
  ): void {
    this.busyId = id;

    this.cdr.detectChanges();
    call()
      .pipe(
        finalize(() => {
          this.busyId = null;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: () => {
          this.toast.success(okMsg);
          // Maj locale — pas de GET /offres/mine ni clear candidatures.
          if (effect === 'REMOVE') {
            this.session.removeOffreLocal(id);
          } else {
            this.session.patchOffreStatus(id, effect);
          }
          this.allMine = this.session.myOffres();
          this.applyFilters();
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.toast.error(this.businessError(err));
          this.cdr.detectChanges();
        }
      });
  }

  private businessError(err: unknown): string {
    const e = err as {
      status?: number;
      error?: { message?: string } | string;
    };
    const detail =
      typeof e?.error === 'string' ? e.error : e?.error?.message;
    if (detail && detail.trim()) {
      return detail.trim();
    }
    return this.session.mapHttpError(e?.status);
  }
}
