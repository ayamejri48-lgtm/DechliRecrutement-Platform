
import { CommonModule } from '@angular/common';
import {
  Component,
  ChangeDetectorRef,
  EventEmitter,
  Input,
  Output,
  OnInit,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  inject
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import {
  Offre,
  OffreSearchParams,
  PlatformService
} from '../../../core/services/platform.service';

@Component({
  selector: 'app-offres-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './offres-list.component.html',
  styleUrl: './offres-list.component.scss'
})
export class OffresListComponent
  implements OnInit, OnChanges, OnDestroy {

  private platform = inject(PlatformService);
  private cdr = inject(ChangeDetectorRef);
  private searchSubscription?: Subscription;

  @Input() offres: Offre[] = [];
  @Input() role = 'CANDIDATE';
  /** IDs d’offres déjà postulées par le candidat (hors WITHDRAWN). */
  @Input() appliedOffreIds: number[] = [];

  @Output() offreAction = new EventEmitter<{
    id: number;
    kind: 'publish' | 'close';
  }>();

  search = '';
  keyword = '';
  location = '';
  contractType = '';
  workMode = '';
  experience = '';
  educationLevel = '';

  sort: 'recent' | 'oldest' | 'title' = 'recent';
  view: 'list' | 'grid' = 'list';
  filtersOpen = true;

  results: Offre[] = [];

  loading = false;
  error = '';

  page = 0;
  pageSize = 10;
  totalElements = 0;
  totalPages = 0;

  private initialized = false;

  ngOnInit(): void {
    this.initialized = true;
    this.loadOffers();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['role'] && this.initialized) {
      this.page = 0;
      this.loadOffers();
    }
  }

  ngOnDestroy(): void {
    this.searchSubscription?.unsubscribe();
  }

  /** Villes suggérées (Tunisie) + celles présentes dans les offres. */
  readonly citySuggestionsBase = [
    'Tunis',
    'Ariana',
    'Ben Arous',
    'Manouba',
    'Sfax',
    'Sousse',
    'Monastir',
    'Nabeul',
    'Bizerte',
    'Gabès',
    'Gafsa',
    'Kairouan',
    'Mahdia',
    'Médenine',
    'Tozeur',
    'Djerba'
  ];

  /** Aligné enum ContractType + formulaire recruteur. */
  readonly contracts = ['CDI', 'CDD', 'STAGE'];

  /** 3 modes de travail (alignés backend WorkMode). */
  readonly workModes = ['ONSITE', 'HYBRID', 'REMOTE'];

  /** Aligné sur le catalogue recruteur (valeurs stockées en base). */
  readonly educationLevels = [
    'Sans diplôme',
    'CAP / BEP',
    'Baccalauréat',
    'Bac+2 (BTS/DUT)',
    'Bac+3 (Licence)',
    'Bac+4',
    'Bac+5 (Master / Ingénieur)',
    'Doctorat'
  ];

  get locations(): string[] {
    const fromData = [...this.offres, ...this.results]
      .map(o => o.location)
      .filter(Boolean);
    return [
      ...new Set([...this.citySuggestionsBase, ...fromData])
    ].sort((a, b) => a.localeCompare(b, 'fr'));
  }

  loadOffers(): void {
    this.searchSubscription?.unsubscribe();

    this.loading = true;
    this.error = '';

    const filters: OffreSearchParams = {
      page: this.page,
      size: this.pageSize,
      sort: this.sort
    };

    if (this.keyword.trim()) {
      filters.title = this.keyword.trim();
    }

    if (this.location) {
      filters.location = this.location;
    }

    if (this.contractType) {
      // Normalise Stage / stage → STAGE (enum backend)
      const ct = this.contractType.trim().toUpperCase();
      filters.contractType =
        ct === 'STAGE' || ct === 'INTERNSHIP' ? 'STAGE' : ct;
    }

    if (this.workMode) {
      filters.workMode = this.workMode.trim().toUpperCase();
    }

    if (this.experience !== '') {
      const years = Number(this.experience);
      if (!Number.isNaN(years) && years >= 0) {
        filters.maxExperience = years;
      }
    }

    if (this.educationLevel) {
      filters.educationLevel = this.educationLevel.trim();
    }

    if (this.role === 'CANDIDATE') {
      filters.status = 'PUBLISHED';
    }

    this.searchSubscription = this.platform
      .searchOffres(filters)
      .subscribe({
        next: response => {
          this.results = this.applyLocalSort(response.content || []);
          this.totalElements = response.totalElements;
          this.totalPages = response.totalPages;
          this.page = response.number;
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.results = [];
          this.totalElements = 0;
          this.totalPages = 0;
          this.loading = false;
          this.error =
            'Impossible de charger les offres. Veuillez réessayer.';
          this.cdr.markForCheck();
        }
      });
  }

  /** Garantit l’ordre affiché (page courante) selon le tri choisi. */
  private applyLocalSort(list: Offre[]): Offre[] {
    const copy = [...list];
    const stamp = (o: Offre) => o.updatedAt || o.createdAt || '';

    if (this.sort === 'title') {
      return copy.sort(
        (a, b) =>
          (a.title || '').localeCompare(b.title || '', 'fr', {
            sensitivity: 'base'
          }) || a.id - b.id
      );
    }

    if (this.sort === 'oldest') {
      return copy.sort(
        (a, b) =>
          stamp(a).localeCompare(stamp(b)) || a.id - b.id
      );
    }

    // recent (défaut)
    return copy.sort(
      (a, b) =>
        stamp(b).localeCompare(stamp(a)) || b.id - a.id
    );
  }

  searchOffers(): void {
    this.keyword = this.search.trim();
    this.page = 0;
    this.loadOffers();
  }

  applyFilters(): void {
    this.page = 0;
    this.loadOffers();
  }

  changeSort(): void {
    this.page = 0;
    this.loadOffers();
  }

  nextPage(): void {
    if (this.page + 1 < this.totalPages && !this.loading) {
      this.page++;
      this.loadOffers();
    }
  }

  previousPage(): void {
    if (this.page > 0 && !this.loading) {
      this.page--;
      this.loadOffers();
    }
  }

  goToPage(index: number): void {
    if (
      index === this.page ||
      index < 0 ||
      index >= this.totalPages ||
      this.loading
    ) {
      return;
    }
    this.page = index;
    this.loadOffers();
  }

  get pageIndexes(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i);
  }

  resetFilters(): void {
    this.search = '';
    this.keyword = '';
    this.location = '';
    this.contractType = '';
    this.workMode = '';
    this.experience = '';
    this.educationLevel = '';
    this.sort = 'recent';
    this.page = 0;

    this.loadOffers();
  }

  labelWorkMode(mode: string): string {
    return ({
      HYBRID: 'Hybride',
      REMOTE: 'À distance',
      ONSITE: 'Sur site',
      ON_SITE: 'Sur site'
    } as Record<string, string>)[mode] || mode;
  }

  labelContract(type: string): string {
    return ({
      CDI: 'CDI',
      CDD: 'CDD',
      STAGE: 'Stage',
      Stage: 'Stage',
      INTERNSHIP: 'Stage',
      FREELANCE: 'Freelance',
      PART_TIME: 'Temps partiel',
      FULL_TIME: 'Temps plein'
    } as Record<string, string>)[type] || type;
  }

  labelStatus(status: string): string {
    return ({
      PUBLISHED: 'Publiée',
      DRAFT: 'Brouillon',
      CLOSED: 'Clôturée'
    } as Record<string, string>)[status] || status;
  }

  hasApplied(offreId: number): boolean {
    return this.appliedOffreIds.includes(offreId);
  }

  /** Jours restants jusqu’à la deadline (0 = aujourd’hui). null si absente. */
  daysUntilDeadline(deadline: string | null | undefined): number | null {
    if (!deadline) return null;
    const end = new Date(deadline);
    if (Number.isNaN(end.getTime())) return null;
    end.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((end.getTime() - today.getTime()) / 86_400_000);
  }

  /** Deadline dans ≤ 1 jour (aujourd’hui ou demain). */
  isDeadlineSoon(o: Offre): boolean {
    const days = this.daysUntilDeadline(o.deadline);
    return days !== null && days >= 0 && days <= 1;
  }

  deadlineLabel(o: Offre): string {
    const days = this.daysUntilDeadline(o.deadline);
    if (days === 0) return 'Expire aujourd’hui';
    if (days === 1) return '1 jour restant';
    return '';
  }
}
