import {
  ChangeDetectorRef,
  Component,
  inject,
  signal,
  OnInit,
  OnDestroy,
  computed,
  HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  Router,
  RouterLink,
  ActivatedRoute
} from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SafeResourceUrl } from '@angular/platform-browser';
import {
  finalize,
  forkJoin,
  of,
  catchError,
  map,
  Subscription
} from 'rxjs';

import { AuthService } from '../../core/services/auth.service';
import { OffresListComponent } from '../offres/offres-list/offres-list.component';
import { CandidateTestsComponent } from '../candidate/tests/candidate-tests.component';
import {
  PlatformService,
  Offre,
  Candidature,
  Cv,
  User,
  CandidateSkill,
  SkillLevel,
  AppNotification,
  Experience,
  ExperienceRequest,
  Education,
  EducationRequest
} from '../../core/services/platform.service';
import { ToastService } from '../../core/services/toast.service';
import { CandidateSessionService } from '../candidate/data/candidate-session.service';

@Component({
  selector: 'app-workspace',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    FormsModule,
    OffresListComponent,
    CandidateTestsComponent
  ],
  templateUrl: './workspace.component.html',
  styleUrl: './workspace.component.scss'
})
export class WorkspaceComponent implements OnInit, OnDestroy {

  auth = inject(AuthService);
  api = inject(PlatformService);
  private readonly toast = inject(ToastService);
  private readonly candidateSession = inject(CandidateSessionService);
  private readonly cdr = inject(ChangeDetectorRef);
  route = inject(ActivatedRoute);
  router = inject(Router);

  role = this.auth.currentSession()?.role || 'CANDIDATE';
  section = this.route.snapshot.data['section'] || 'dashboard';

  offres = signal<Offre[]>([]);
  applications = signal<Candidature[]>([]);
  cvs = signal<Cv[]>([]);
  users = signal<User[]>([]);
  me = signal<User | null>(null);

  loading = signal(false);

  search = '';
  applicationQuery = signal('');
  applicationStatus = signal('ALL');
  uploadingCv = false;
  activatingCvId = 0;
  maxCvBytes = 5 * 1024 * 1024;
  cvDragOver = false;
  /** Fichier choisi, en attente de confirmation avant upload. */
  pendingCvFile: File | null = null;
  cvConfirmOpen = false;
  /** Aperçu CV inline (même pattern admin / recruteur). */
  cvBusy = false;
  previewingCvId = 0;
  previewingCvName = '';
  cvUrl: SafeResourceUrl | null = null;
  private previewSub: Subscription | null = null;
  offerById = computed(() => new Map(this.offres().map(o => [o.id, o])));
  filteredApplications = computed(() => {
    const status = this.applicationStatus();
    const query = this.applicationQuery().toLocaleLowerCase().trim();
    return this.applications().filter((c) => {
      if (c.status === 'WITHDRAWN') return false;
      const title =
        this.offerById().get(c.offreId)?.title || `Offre n°${c.offreId}`;
      const statusOk = status === 'ALL' || c.status === status;
      const queryOk = !query || title.toLocaleLowerCase().includes(query);
      return statusOk && queryOk;
    });
  });
  /** Offres déjà postulées (hors retirées) — badge liste offres. */
  appliedOffreIds = computed(() =>
    this.applications()
      .filter((c) => c.status !== 'WITHDRAWN')
      .map((c) => c.offreId)
  );
  publishedOffersCount() { return this.offres().filter(o => o.status === 'PUBLISHED').length; }
  recentPublishedOffers() { return this.offres().filter(o => o.status === 'PUBLISHED').sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0,3); }
  applicationStatuses() { return [...new Set(this.applications().map(c => c.status).filter(s => s !== 'WITHDRAWN'))]; }
  visibleApplicationsCount() { return this.applications().filter(c => c.status !== 'WITHDRAWN').length; }
  statusLabel(status: string) {
    return ({
      PENDING: 'En attente',
      IN_PROGRESS: 'En cours',
      UNDER_REVIEW: 'En cours d’étude',
      ACCEPTED: 'Acceptée',
      ACCEPTEE: 'Acceptée',
      ACCEPTE: 'Acceptée',
      REJECTED: 'Refusée',
      REFUSED: 'Refusée',
      REFUSEE: 'Refusée',
      WITHDRAWN: 'Retirée',
      EN_COURS: 'En cours'
    } as Record<string, string>)[status] || status.replaceAll('_', ' ');
  }
  canWithdraw(c: Candidature) { return !['WITHDRAWN','ACCEPTED','REJECTED'].includes(c.status); }
  countApplications(statuses: string[]) {
    return this.applications().filter(c => statuses.includes(c.status)).length;
  }
  cvSize(size: number) { return size < 1024 * 1024 ? `${Math.round(size / 1024)} Ko` : `${(size / 1048576).toFixed(1)} Mo`; }
  activeCv() { return this.cvs().find(c => c.active) || null; }
  activateCv(id: number) {
    if (this.activatingCvId) return;
    this.activatingCvId = id; this.api.activateCv(id).pipe(finalize(() => this.activatingCvId = 0)).subscribe({
      next: () => { this.cvs.update(list => list.map(c => ({...c, active: c.id === id}))); this.selectedCv = id; this.toast.success('Votre CV actif a bien été mis à jour.'); },
      error: () => this.toast.error('Impossible d’activer ce CV pour le moment.')
    });
  }
  previewCv(cv: Cv) {
    // Fermeture uniquement via l’icône × de l’aperçu (pas depuis la liste).
    if (this.previewingCvId === cv.id && this.cvUrl) {
      return;
    }

    const cached = this.candidateSession.getCachedCv(cv.id);
    if (cached) {
      this.cancelCvDownload();
      this.previewingCvId = cv.id;
      this.previewingCvName = cached.name || cv.fileName;
      this.cvUrl = cached.safe;
      this.cvBusy = false;
      this.cdr.detectChanges();
      return;
    }

    this.cancelCvDownload();
    this.cvBusy = true;
    this.previewingCvId = cv.id;
    this.previewingCvName = cv.fileName;
    this.cvUrl = null;
    this.cdr.detectChanges();

    this.previewSub = this.candidateSession.ensureCvPreview(cv.id, cv.fileName).pipe(
      finalize(() => {
        this.cvBusy = false;
        this.previewSub = null;
        this.cdr.detectChanges();
      })
    ).subscribe({
      next: (entry) => {
        if (this.previewingCvId !== cv.id) return;
        this.cvUrl = entry.safe;
        this.previewingCvName = entry.name || cv.fileName;
        this.cdr.detectChanges();
      },
      error: (err) => {
        if (this.previewingCvId !== cv.id) return;
        this.closeCvPreview();
        const timedOut = err?.name === 'TimeoutError';
        const invalid = err?.message === 'INVALID_CV' || err?.message === 'EMPTY_CV';
        this.toast.error(
          timedOut
            ? 'Chargement trop long. Réessayez.'
            : invalid
              ? 'Fichier CV invalide ou inaccessible.'
              : 'Impossible d’ouvrir le CV pour le moment.'
        );
      }
    });
  }

  closeCvPreview(): void {
    this.cancelCvDownload();
    this.cvBusy = false;
    this.cvUrl = null;
    this.previewingCvId = 0;
    this.previewingCvName = '';
    this.cdr.detectChanges();
  }

  private cancelCvDownload(): void {
    if (this.previewSub) {
      this.previewSub.unsubscribe();
      this.previewSub = null;
    }
  }

  private clearCvPreviewUi(): void {
    this.cancelCvDownload();
    this.cvUrl = null;
    this.cvBusy = false;
    this.previewingCvId = 0;
    this.previewingCvName = '';
  }
  onCvDrop(event: DragEvent) {
    event.preventDefault();
    this.cvDragOver = false;
    const file = event.dataTransfer?.files?.item(0);
    if (file) this.queueCvFile(file);
  }

  /** Valide le fichier puis ouvre la fenêtre d’enregistrement. */
  queueCvFile(file: File): void {
    if (this.uploadingCv) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      this.toast.error('Seuls les fichiers PDF sont acceptés.');
      return;
    }
    if (file.size > this.maxCvBytes) {
      this.toast.error('Le fichier dépasse la limite de 5 Mo.');
      return;
    }
    this.pendingCvFile = file;
    this.cvConfirmOpen = true;
  }

  cancelCvConfirm(): void {
    if (this.uploadingCv) return;
    this.cvConfirmOpen = false;
    this.pendingCvFile = null;
  }

  @HostListener('document:keydown.escape')
  onCvEscape(): void {
    if (this.cvConfirmOpen) {
      this.cancelCvConfirm();
      return;
    }
    if (this.cvUrl || this.cvBusy) this.closeCvPreview();
  }

  confirmCvSave(): void {
    const file = this.pendingCvFile;
    if (!file || this.uploadingCv) return;
    this.sendCv(file);
  }

  sendCv(file: File) {
    if (this.uploadingCv) return;
    this.uploadingCv = true;
    this.api.uploadCv(file).pipe(finalize(() => (this.uploadingCv = false))).subscribe({
      next: () => {
        this.cvConfirmOpen = false;
        this.pendingCvFile = null;
        this.clearCvPreviewUi();
        this.candidateSession.invalidateCv();
        this.toast.success('CV enregistré.');
        this.api.cvs().subscribe({
          next: (v) => {
            this.cvs.set(v);
            if (this.section === 'cv') this.candidateSession.prefetchCvs(v);
          }
        });
      },
      error: () =>
        this.toast.error('Impossible d’importer ce CV. Vérifiez le format PDF et la taille (5 Mo max).')
    });
  }
  
  selectedCv = 0;

  editingId = 0;

  form = {
    title: '',
    description: '',
    location: '',
    contractType: '',
    workMode: '',
    experienceYears: 0,
    educationLevel: '',
    deadline: ''
  };

  profileForm = {
    firstName: '',
    lastName: '',
    phone: ''
  };

  savingProfile = false;
  editingProfile = false;
  editingDescription = false;
  savingDescription = false;
  descriptionForm = '';
  editingPhoto = false;

  /** Photo via cache session (même mécanisme admin/recruteur). */
  get pictureUrl(): string {
    return this.candidateSession.avatarUrl() || '';
  }
  photoBroken = false;
  photoPreviewUrl: string | null = null;
  selectedPhotoFile: File | null = null;
  private ownsPhotoPreview = false;

  /** Réglage photo (zoom + position) — présentation + export canvas. */
  readonly photoStageSize = 220;
  photoZoom = 1;
  photoOffsetX = 0;
  photoOffsetY = 0;
  photoDragging = false;
  private photoDragOrigin = { x: 0, y: 0, ox: 0, oy: 0 };

  managingCareer = false;

  skills = signal<CandidateSkill[]>([]);
  experiences = signal<Experience[]>([]);
  educations = signal<Education[]>([]);

  managingExperiences = false;
  managingEducations = false;
  editingExperienceId = 0;
  editingEducationId = 0;
  savingExperience = false;
  savingEducation = false;

  experienceForm: ExperienceRequest = {
    jobTitle: '', company: '', startDate: '', endDate: null, description: null
  };

  educationForm: EducationRequest = {
    institution: '', degree: '', fieldOfStudy: '', startDate: '', endDate: null
  };

  skillForm = {
    name: '',
    level: 'BEGINNER' as SkillLevel
  };

  editingSkillId = 0;
  savingSkill = false;

  skillLevels: SkillLevel[] = [
    'BEGINNER',
    'INTERMEDIATE',
    'ADVANCED',
    'EXPERT'
  ];

  notifications = signal<AppNotification[]>([]);
  unreadCount = signal(0);
  showNotifications = false;
  sendingReset = false;

  filtered = computed(() =>
    this.offres().filter(o =>
      (o.title + ' ' + o.location)
        .toLowerCase()
        .includes(this.search.toLowerCase())
    )
  );

  nav() {
    const prefix = this.role === 'ADMIN'
      ? 'admin'
      : this.role === 'RECRUITER'
        ? 'recruiter'
        : 'candidate';

    return [
      {
        label: 'Tableau de bord',
        path: `/${prefix}/dashboard`,
        icon: '▦'
      },
      ...(this.role === 'ADMIN'
        ? [
            {
              label: 'Utilisateurs',
              path: '/admin/users',
              icon: '♙'
            }
          ]
        : this.role === 'RECRUITER'
          ? [
              {
                label: 'Mes offres',
                path: '/recruiter/offres',
                icon: '▤'
              },
              {
                label: 'Créer une offre',
                path: '/recruiter/offre/new',
                icon: '＋'
              }
            ]
          : [
              {
                label: 'Offres d’emploi',
                path: '/candidate/offres',
                icon: '▤'
              },
              {
                label: 'Mes candidatures',
                path: '/candidate/candidatures',
                icon: '▣'
              },
              {
                label: 'Tests techniques',
                path: '/candidate/tests',
                icon: '◈'
              },
              {
                label: 'Mon CV',
                path: '/candidate/cv',
                icon: '▧'
              }
            ]),
      {
        label: 'Mon profil',
        path: `/${prefix}/profile`,
        icon: '♙'
      }
    ];
  }

  ngOnInit() {
    this.load();
  }

  ngOnDestroy() {
    this.clearCvPreviewUi();
    // Ne pas vider le cache session CV/photo (partagé entre navigations candidat).

    if (this.ownsPhotoPreview && this.photoPreviewUrl) {
      URL.revokeObjectURL(this.photoPreviewUrl);
    }
  }

  load() {
    this.loading.set(true);

    const done = () => this.loading.set(false);

    if (
      ['dashboard', 'offres', 'offre-form']
        .includes(this.section)
    ) {
      this.api.offres()
        .pipe(finalize(done))
        .subscribe({
          next: v => {
            this.offres.set(v);

            if (
              this.section === 'offre-form' &&
              this.route.snapshot.paramMap.has('id')
            ) {
              const o = v.find(x =>
                x.id === Number(
                  this.route.snapshot.paramMap.get('id')
                )
              );

              if (o) {
                this.editingId = o.id;

                this.form = {
                  title: o.title,
                  description: o.description,
                  location: o.location,
                  contractType: o.contractType,
                  workMode: o.workMode,
                  experienceYears: o.experienceYears,
                  educationLevel: o.educationLevel,
                  deadline: o.deadline || ''
                };
              }
            }
          },
          error: () => this.toast.error('Impossible de charger les offres. Vérifiez la Gateway et vos autorisations.')
        });
    }

    if (
      this.section === 'applications' ||
      this.section === 'offres' ||
      (
        this.role === 'CANDIDATE' &&
        (this.section === 'dashboard' || this.section === 'profile')
      )
    ) {
      this.api.myApplications().subscribe({
        next: v => this.applications.set(v),
        error: () => {
          if (this.section === 'profile') {
            this.toast.error(
              'Impossible de charger vos candidatures pour le moment.'
            );
          }
        }
      });
    }

    if (
      this.section === 'cv' ||
      this.section === 'applications' ||
      (
        this.section === 'profile' &&
        this.role === 'CANDIDATE'
      )
    ) {
      this.api.cvs().subscribe({
        next: v => {
          this.cvs.set(v);

          this.selectedCv =
            v.find(x => x.active)?.id ||
            v[0]?.id ||
            0;

          // Prefetch session (comme photo) → Consulter quasi immédiat
          if (this.section === 'cv') {
            this.candidateSession.prefetchCvs(v);
          }
        },
        error: () => this.toast.error('Impossible de charger vos CV pour le moment.')
      });
    }

    if (this.section === 'dashboard' && this.role === 'CANDIDATE') {
      this.api.cvs().subscribe({next: v => this.cvs.set(v)});
      this.api.unreadCount().subscribe({next: v => this.unreadCount.set(v.count || 0)});
    }
    if (this.section === 'applications' && this.role === 'CANDIDATE') {
      this.api.offres().subscribe({next: v => this.offres.set(v), error: () => {}});
    }

    // Identité + photo (cache session) sur toutes les pages candidat
    if (this.role === 'CANDIDATE' && this.section !== 'profile') {
      this.ensureCandidateIdentity();
    }

    // Profil : réutilise le cache session (pas de re-téléchargement photo si déjà prêt)
    if (this.section === 'profile') {
      const identity$ =
        this.role === 'CANDIDATE'
          ? forkJoin({
              user: this.candidateSession.ensureMe(),
              photoUrl: this.candidateSession.ensureAvatarPhoto()
            })
          : this.api.me().pipe(map((user) => ({ user, photoUrl: null as string | null })));

      identity$.pipe(finalize(done)).subscribe({
        next: ({ user, photoUrl }) => {
          this.me.set(user);
          this.fillProfile(user);
          this.photoBroken = !photoUrl && !!user.profilePicture;
          this.editingProfile = false;
          this.editingPhoto = false;
        },
        error: () => {
          this.toast.error('Impossible de charger votre profil pour le moment.');
        }
      });

      this.api.unreadCount().subscribe({
        next: v => {
          this.unreadCount.set(v.count || 0);
        },
        error: () => {}
      });

      if (this.role === 'CANDIDATE') {
        this.api.skills().subscribe({
          next: v => this.skills.set(v),
          error: () => this.skills.set([])
        });

        this.api.experiences().subscribe({
          next: v => this.experiences.set(v),
          error: () => this.toast.error('Impossible de charger vos expériences pour le moment.')
        });

        this.api.educations().subscribe({
          next: v => this.educations.set(v),
          error: () => this.toast.error('Impossible de charger vos formations pour le moment.')
        });
      }
    }

    if (this.section === 'users') {
      this.api.users()
        .pipe(finalize(done))
        .subscribe({
          next: v => this.users.set(v),
          error: () => this.toast.error('Accès aux utilisateurs refusé ou service indisponible.')
        });
    }
  }

  saveOffre() {
    if (
      !this.form.title ||
      !this.form.description ||
      !this.form.location ||
      !this.form.contractType ||
      !this.form.workMode ||
      !this.form.educationLevel
    ) {
      this.toast.error('Veuillez remplir tous les champs obligatoires.');
      return;
    }

    const body = {
      ...this.form,
      deadline: this.form.deadline || null
    };

    const req = this.editingId
      ? this.api.updateOffre(
          this.editingId,
          body as any
        )
      : this.api.createOffre(body as any);

    req.subscribe({
      next: () =>
        this.router.navigateByUrl('/recruiter/offres'),
      error: () => this.toast.error('Enregistrement impossible. Vérifiez les valeurs et vos droits.')
    });
  }

  action(
    id: number,
    kind: 'publish' | 'close' | 'remove'
  ) {
    if (
      kind === 'remove' &&
      !confirm('Supprimer cette offre ?')
    ) {
      return;
    }

    const req = kind === 'publish'
      ? this.api.publishOffre(id)
      : kind === 'close'
        ? this.api.closeOffre(id)
        : this.api.removeOffre(id);

    req.subscribe({
      next: () => {
        this.toast.success('Les modifications ont bien été enregistrées.');
        this.load();
      },
      error: () => this.toast.error('Cette action n’a pas pu être effectuée.')
    });
  }

  apply(id: number) {
    if (!this.selectedCv) {
      this.toast.error('Ajoutez d’abord un CV depuis « Mon CV ».');
      return;
    }

    this.api.apply(id, this.selectedCv).subscribe({
      next: () => {
        this.toast.success('Votre candidature a bien été envoyée.');
      },
      error: () => this.toast.error('Candidature impossible (offre, CV ou candidature déjà existante).')
    });
  }

  withdraw(id: number) {
    if (!confirm('Retirer cette candidature ?')) {
      return;
    }

    this.api.withdraw(id).subscribe({
      next: () => this.load(),
      error: () => this.toast.error('Impossible de retirer cette candidature pour le moment.')
    });
  }

  upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.queueCvFile(file);
    input.value = '';
  }

  download(cv: Cv) {
    const cached = this.candidateSession.getCachedCv(cv.id);
    if (cached) {
      const a = document.createElement('a');
      a.href = cached.raw;
      a.download = cv.fileName;
      a.click();
      this.toast.success('Téléchargement démarré.');
      return;
    }

    this.candidateSession.ensureCvPreview(cv.id, cv.fileName).subscribe({
      next: (entry) => {
        const a = document.createElement('a');
        a.href = entry.raw;
        a.download = cv.fileName;
        a.click();
        this.toast.success('Téléchargement démarré.');
      },
      error: (err) =>
        this.toast.error(
          err?.name === 'TimeoutError'
            ? 'Téléchargement trop long. Réessayez.'
            : 'Impossible de télécharger le CV pour le moment.'
        )
    });
  }

  fillProfile(v: User) {
    this.profileForm = {
      firstName: v.firstName || '',
      lastName: v.lastName || '',
      phone: v.phone || ''
    };

    // profilePicture est une clé SeaweedFS,
    // pas une URL directement accessible.
    this.descriptionForm = v.description || '';
    this.photoBroken = false;
  }

  initials(u?: User | null) {
    const src = u || this.me();

    return (
      (src?.firstName || '').slice(0, 1) +
      (src?.lastName || '').slice(0, 1)
    ).toUpperCase() || 'U';
  }

  skillLabel(level: SkillLevel) {
    return ({
      BEGINNER: 'Débutant',
      INTERMEDIATE: 'Intermédiaire',
      ADVANCED: 'Avancé',
      EXPERT: 'Expert'
    } as Record<SkillLevel, string>)[level] || level;
  }

  startEditDescription() {
    if (this.role !== 'CANDIDATE' || !this.me()) return;
    this.descriptionForm = this.me()?.description || '';
    this.editingDescription = true;
  }

  cancelEditDescription() {
    this.descriptionForm = this.me()?.description || '';
    this.editingDescription = false;
  }

  saveDescription() {
    const user = this.me();
    if (!user || this.role !== 'CANDIDATE' || this.savingDescription) return;

    const description = this.descriptionForm.trim();
    if (description.length > 1000) {
      this.toast.error('La présentation ne doit pas dépasser 1 000 caractères.');
      return;
    }
    this.savingDescription = true;

    this.api.updateUser(user.id, {
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone || '',
      description
    }).pipe(finalize(() => this.savingDescription = false)).subscribe({
      next: updated => {
        this.me.set(updated);
        this.descriptionForm = updated.description || '';
        this.editingDescription = false;
        this.toast.success('Votre présentation a bien été mise à jour.');
      },
      error: () => this.toast.error('Impossible d’enregistrer votre présentation pour le moment.')
    });
  }

  startEditProfile() {
    const u = this.me();
    if (!u) return;

    this.profileForm = {
      firstName: u.firstName || '',
      lastName: u.lastName || '',
      phone: u.phone || ''
    };

    this.editingProfile = true;
  }

  cancelEditProfile() {
    const u = this.me();

    if (u) {
      this.fillProfile(u);
    }

    this.editingProfile = false;
  }

  persistUser(
    patch: Partial<
      Pick<User, 'firstName' | 'lastName' | 'phone'>
    >,
    onOk: () => void
  ) {
    const u = this.me();
    if (!u) return;
    this.savingProfile = true;

    this.api.updateUser(u.id, {
      firstName: patch.firstName ?? u.firstName,
      lastName: patch.lastName ?? u.lastName,
      phone: patch.phone ?? u.phone ?? '',
      description: u.description ?? ''
    })
      .pipe(
        finalize(() => this.savingProfile = false)
      )
      .subscribe({
        next: v => {
          this.me.set(v);
          this.fillProfile(v);
          onOk();
        },
        error: () => this.toast.error('Enregistrement du profil impossible. Vérifiez vos informations et vos droits.')
      });
  }

  saveProfile() {
    const firstName =
      this.profileForm.firstName.trim();

    const lastName =
      this.profileForm.lastName.trim();

    if (!firstName || !lastName) {
      this.toast.error('Le prénom et le nom sont obligatoires.');
      return;
    }

    this.persistUser({
      firstName,
      lastName,
      phone: this.profileForm.phone.trim()
    }, () => {
      this.editingProfile = false;
      this.toast.success('Vos informations personnelles ont bien été mises à jour.');
    });
  }

  get photoTransform(): string {
    return `translate(calc(-50% + ${this.photoOffsetX}px), calc(-50% + ${this.photoOffsetY}px)) scale(${this.photoZoom})`;
  }

  resetPhotoAdjust(): void {
    this.photoZoom = 1;
    this.photoOffsetX = 0;
    this.photoOffsetY = 0;
    this.photoDragging = false;
  }

  openPhotoEditor(fileInput: HTMLInputElement): void {
    if ((this.pictureUrl || this.photoPreviewUrl) && !this.photoBroken) {
      this.startAdjustCurrentPhoto();
      return;
    }
    fileInput.click();
  }

  startAdjustCurrentPhoto(): void {
    const src = this.photoPreviewUrl || this.pictureUrl;
    if (!src) return;

    if (this.ownsPhotoPreview && this.photoPreviewUrl && this.photoPreviewUrl !== src) {
      URL.revokeObjectURL(this.photoPreviewUrl);
      this.ownsPhotoPreview = false;
    }

    this.photoPreviewUrl = src;
    this.ownsPhotoPreview = false;
    this.selectedPhotoFile = null;
    this.photoBroken = false;
    this.resetPhotoAdjust();
    this.editingPhoto = true;
  }

  selectProfilePhoto(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    if (
      !['image/jpeg', 'image/png', 'image/webp']
        .includes(file.type)
    ) {
      this.toast.error('Choisissez une image JPG, PNG ou WebP.');
      input.value = '';
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      this.toast.error('La photo ne doit pas dépasser 2 Mo.');
      input.value = '';
      return;
    }

    if (this.ownsPhotoPreview && this.photoPreviewUrl) {
      URL.revokeObjectURL(this.photoPreviewUrl);
    }

    this.selectedPhotoFile = file;
    this.photoPreviewUrl = URL.createObjectURL(file);
    this.ownsPhotoPreview = true;
    this.photoBroken = false;
    this.resetPhotoAdjust();
    this.editingPhoto = true;

    input.value = '';
  }

  onPhotoPointerDown(event: PointerEvent): void {
    if (!this.editingPhoto) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    this.photoDragging = true;
    this.photoDragOrigin = {
      x: event.clientX,
      y: event.clientY,
      ox: this.photoOffsetX,
      oy: this.photoOffsetY
    };
  }

  onPhotoPointerMove(event: PointerEvent): void {
    if (!this.photoDragging) return;
    const dx = event.clientX - this.photoDragOrigin.x;
    const dy = event.clientY - this.photoDragOrigin.y;
    const max = (this.photoStageSize / 2) * this.photoZoom;
    this.photoOffsetX = Math.max(-max, Math.min(max, this.photoDragOrigin.ox + dx));
    this.photoOffsetY = Math.max(-max, Math.min(max, this.photoDragOrigin.oy + dy));
  }

  onPhotoPointerUp(event: PointerEvent): void {
    if (!this.photoDragging) return;
    this.photoDragging = false;
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  }

  cancelEditPhoto() {
    if (this.ownsPhotoPreview && this.photoPreviewUrl) {
      URL.revokeObjectURL(this.photoPreviewUrl);
    }

    this.photoPreviewUrl = null;
    this.ownsPhotoPreview = false;
    this.selectedPhotoFile = null;
    this.photoBroken = false;
    this.editingPhoto = false;
    this.resetPhotoAdjust();
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image'));
      img.src = src;
    });
  }

  private async buildCroppedPhotoFile(): Promise<File> {
    const src = this.photoPreviewUrl;
    if (!src) {
      throw new Error('missing preview');
    }

    const img = await this.loadImage(src);
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('canvas');
    }

    const cover = Math.max(size / img.naturalWidth, size / img.naturalHeight);
    const scale = cover * this.photoZoom;
    const drawW = img.naturalWidth * scale;
    const drawH = img.naturalHeight * scale;
    const ratio = size / this.photoStageSize;
    const dx = (size - drawW) / 2 + this.photoOffsetX * ratio;
    const dy = (size - drawH) / 2 + this.photoOffsetY * ratio;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, dx, dy, drawW, drawH);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('blob'))),
        'image/jpeg',
        0.92
      );
    });

    const base =
      this.selectedPhotoFile?.name?.replace(/\.[^.]+$/, '') ||
      'photo-profil';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  }

  // Upload de la photo (après réglage zoom / position)
  async savePhoto() {
    if (!this.photoPreviewUrl || this.savingProfile) {
      return;
    }

    this.savingProfile = true;

    try {
      const file = await this.buildCroppedPhotoFile();
      this.api.uploadProfilePhoto(file)
        .pipe(finalize(() => (this.savingProfile = false)))
        .subscribe({
          next: user => {
            const merged: User = {
              ...user,
              // Certaines réponses API omettent la clé SeaweedFS juste après l'upload.
              profilePicture: user.profilePicture || this.me()?.profilePicture || 'uploaded'
            };
            this.me.set(merged);
            this.candidateSession.patchMe(merged);

            // Affichage immédiat + cache session (évite initiales / re-download inutile)
            this.candidateSession.setLocalAvatar(URL.createObjectURL(file));
            this.photoBroken = false;

            this.editingPhoto = false;
            this.selectedPhotoFile = null;
            if (this.ownsPhotoPreview && this.photoPreviewUrl) {
              URL.revokeObjectURL(this.photoPreviewUrl);
            }
            this.photoPreviewUrl = null;
            this.ownsPhotoPreview = false;
            this.resetPhotoAdjust();
            this.loadProfilePhoto();
            this.toast.success('Votre photo de profil a bien été mise à jour.');
          },
          error: () => {
            this.toast.error('Impossible d’enregistrer la photo de profil.');
          }
        });
    } catch {
      this.savingProfile = false;
      this.toast.error('Impossible de préparer la photo. Veuillez réessayer.');
    }
  }

  /** Rafraîchit la photo via le cache session (force réseau). */
  loadProfilePhoto() {
    this.candidateSession.refreshAvatarPhoto().subscribe({
      next: (url) => {
        this.photoBroken = !url && !!this.me()?.profilePicture;
      },
      error: () => {
        if (!this.pictureUrl && !this.photoPreviewUrl) {
          this.photoBroken = !!this.me()?.profilePicture;
        }
      }
    });
  }

  /** Charge me + photo une fois (cache session, comme admin/recruteur). */
  private ensureCandidateIdentity(): void {
    if (this.role !== 'CANDIDATE') {
      return;
    }

    forkJoin({
      user: this.candidateSession.ensureMe(),
      photo: this.candidateSession.ensureAvatarPhoto()
    }).subscribe({
      next: ({ user, photo }) => {
        this.me.set(user);
        this.photoBroken = !photo && !!user.profilePicture;
      },
      error: () => {}
    });
  }

  toggleCareer() {
    this.managingCareer = !this.managingCareer;
    this.editingSkillId = 0;

    this.skillForm = {
      name: '',
      level: 'BEGINNER'
    };
  }

  editSkill(s: CandidateSkill) {
    this.managingCareer = true;
    this.editingSkillId = s.id;

    this.skillForm = {
      name: s.name,
      level: s.level
    };
  }

  saveSkill() {
    if (this.role !== 'CANDIDATE') return;

    const name = this.skillForm.name.trim();

    if (!name) {
      this.toast.error('Le nom de la compétence est obligatoire.');
      return;
    }
    this.savingSkill = true;

    const body = {
      name,
      level: this.skillForm.level
    };

    const req = this.editingSkillId
      ? this.api.updateSkill(
          this.editingSkillId,
          body
        )
      : this.api.addSkill(body);

    req
      .pipe(
        finalize(() => this.savingSkill = false)
      )
      .subscribe({
        next: () => {
          this.toast.success('La compétence a bien été enregistrée.');

          this.editingSkillId = 0;

          this.skillForm = {
            name: '',
            level: 'BEGINNER'
          };

          this.api.skills().subscribe({
            next: v => this.skills.set(v)
          });
        },
        error: () => this.toast.error('Impossible d’enregistrer cette compétence pour le moment.')
      });
  }

  removeSkill(id: number) {
    if (!confirm('Supprimer cette compétence ?')) {
      return;
    }

    this.api.removeSkill(id).subscribe({
      next: () => {
        this.skills.set(
          this.skills().filter(s => s.id !== id)
        );

        if (this.editingSkillId === id) {
          this.editingSkillId = 0;

          this.skillForm = {
            name: '',
            level: 'BEGINNER'
          };
        }

        this.toast.success('La compétence a bien été retirée.');
      },
      error: () => this.toast.error('Impossible de supprimer cet élément pour le moment.')
    });
  }

  // Gestion des expériences professionnelles
  resetExperienceForm() {
    this.editingExperienceId = 0;
    this.experienceForm = {
      jobTitle: '', company: '', startDate: '', endDate: null, description: null
    };
  }

  toggleExperiences() {
    this.managingExperiences = !this.managingExperiences;
    this.resetExperienceForm();
  }

  editExperience(exp: Experience) {
    this.managingExperiences = true;
    this.editingExperienceId = exp.id;
    this.experienceForm = {
      jobTitle: exp.jobTitle,
      company: exp.company,
      startDate: exp.startDate,
      endDate: exp.endDate,
      description: exp.description
    };
  }

  saveExperience() {
    if (this.role !== 'CANDIDATE' || this.savingExperience) return;
    const body: ExperienceRequest = {
      jobTitle: this.experienceForm.jobTitle.trim(),
      company: this.experienceForm.company.trim(),
      startDate: this.experienceForm.startDate,
      endDate: this.experienceForm.endDate || null,
      description: this.experienceForm.description?.trim() || null
    };
    if (!body.jobTitle || !body.company || !body.startDate) {
      this.toast.error('Indiquez le poste, l’entreprise et la date de début.');
      return;
    }
    if (body.endDate && body.endDate < body.startDate) {
      this.toast.error('La date de fin doit être postérieure à la date de début.');
      return;
    }
    this.savingExperience = true;
    const request = this.editingExperienceId
      ? this.api.updateExperience(this.editingExperienceId, body)
      : this.api.addExperience(body);
    request.pipe(finalize(() => this.savingExperience = false)).subscribe({
      next: () => {
        this.toast.success('L’expérience a bien été enregistrée.');
        this.resetExperienceForm();
        this.api.experiences().subscribe({
          next: v => this.experiences.set(v),
          error: () => this.toast.error('Impossible d’actualiser la liste des expériences.')
        });
      },
      error: () => this.toast.error('Impossible d’enregistrer cette expérience pour le moment.')
    });
  }

  removeExperience(id: number) {
    if (this.role !== 'CANDIDATE' || !confirm('Supprimer cette expérience ?')) return;
    this.api.removeExperience(id).subscribe({
      next: () => {
        this.experiences.update(items => items.filter(x => x.id !== id));
        if (this.editingExperienceId === id) this.resetExperienceForm();
        this.toast.success('L’expérience a bien été retirée.');
      },
      error: () => this.toast.error('Impossible de supprimer cette expérience pour le moment.')
    });
  }

  // Gestion des formations
  resetEducationForm() {
    this.editingEducationId = 0;
    this.educationForm = {
      institution: '', degree: '', fieldOfStudy: '', startDate: '', endDate: null
    };
  }

  toggleEducations() {
    this.managingEducations = !this.managingEducations;
    this.resetEducationForm();
  }

  editEducation(edu: Education) {
    this.managingEducations = true;
    this.editingEducationId = edu.id;
    this.educationForm = {
      institution: edu.institution,
      degree: edu.degree,
      fieldOfStudy: edu.fieldOfStudy,
      startDate: edu.startDate,
      endDate: edu.endDate
    };
  }

  saveEducation() {
    if (this.role !== 'CANDIDATE' || this.savingEducation) return;
    const body: EducationRequest = {
      institution: this.educationForm.institution.trim(),
      degree: this.educationForm.degree.trim(),
      fieldOfStudy: this.educationForm.fieldOfStudy.trim(),
      startDate: this.educationForm.startDate,
      endDate: this.educationForm.endDate || null
    };
    if (!body.institution || !body.degree || !body.fieldOfStudy || !body.startDate) {
      this.toast.error('Indiquez l’établissement, le diplôme, le domaine et la date de début.');
      return;
    }
    if (body.endDate && body.endDate < body.startDate) {
      this.toast.error('La date de fin doit être postérieure à la date de début.');
      return;
    }
    this.savingEducation = true;
    const request = this.editingEducationId
      ? this.api.updateEducation(this.editingEducationId, body)
      : this.api.addEducation(body);
    request.pipe(finalize(() => this.savingEducation = false)).subscribe({
      next: () => {
        this.toast.success('La formation a bien été enregistrée.');
        this.resetEducationForm();
        this.api.educations().subscribe({
          next: v => this.educations.set(v),
          error: () => this.toast.error('Impossible d’actualiser la liste des formations.')
        });
      },
      error: () => this.toast.error('Impossible d’enregistrer cette formation pour le moment.')
    });
  }

  removeEducation(id: number) {
    if (this.role !== 'CANDIDATE' || !confirm('Supprimer cette formation ?')) return;
    this.api.removeEducation(id).subscribe({
      next: () => {
        this.educations.update(items => items.filter(x => x.id !== id));
        if (this.editingEducationId === id) this.resetEducationForm();
        this.toast.success('La formation a bien été retirée.');
      },
      error: () => this.toast.error('Impossible de supprimer cette formation pour le moment.')
    });
  }

  requestPasswordChange() {
    const email = this.me()?.email;
    if (!email) return;
    this.sendingReset = true;

    this.auth.forgotPassword(email)
      .pipe(
        finalize(() => this.sendingReset = false)
      )
      .subscribe({
        next: () => this.toast.success('Un e-mail de réinitialisation du mot de passe a été envoyé.'),
        error: () => this.toast.error('Demande de réinitialisation impossible pour le moment.')
      });
  }

  toggleNotifications() {
    this.showNotifications = !this.showNotifications;

    if (this.showNotifications) {
      // Badge masqué dès l’ouverture
      this.unreadCount.set(0);
      this.api.notifications().subscribe({
        next: (v) => {
          const list = v || [];
          this.notifications.set(list);
          // Marquer toutes les non lues comme lues
          for (const n of list) {
            if (n.read) continue;
            this.api.markNotificationRead(n.id).subscribe({
              next: () => {
                this.notifications.set(
                  this.notifications().map((x) =>
                    x.id === n.id ? { ...x, read: true } : x
                  )
                );
              },
              error: () => undefined
            });
          }
        },
        error: () => this.notifications.set([])
      });
    }
  }

  badgeLabel(): string {
    const n = this.unreadCount();
    if (n <= 0) return '';
    return n > 99 ? '99+' : String(n);
  }

  openNotification(n: AppNotification) {
    this.readNotification(n);
    this.showNotifications = false;

    const key = (n.eventKey || '').trim();
    const testPublished = key.match(/^TEST_PUBLISHED:(\d+)$/i);
    const testInvited = key.match(/^TEST_INVITED:(\d+)$/i);
    const offrePublished = key.match(/^OFFRE_PUBLISHED:(\d+)/i);

    if (testPublished) {
      void this.router.navigate(['/candidate/tests'], {
        queryParams: { open: 'result', id: testPublished[1] }
      });
      return;
    }
    if (testInvited) {
      void this.router.navigate(['/candidate/tests'], {
        queryParams: { open: 'start', id: testInvited[1] }
      });
      return;
    }
    if (offrePublished) {
      void this.router.navigate(['/offres', offrePublished[1]]);
      return;
    }

    // Fallback: parse « offre #19 » / « offre n°19 » dans le message
    const fromMsg = (n.message || '').match(/offre\s*(?:n[°o.]?\s*|#)\s*(\d+)/i);
    const title = (n.title || '').toLowerCase();

    if (
      title.includes('nouvelle offre') ||
      title.includes('offre publi') ||
      (fromMsg && title.includes('offre'))
    ) {
      if (fromMsg) {
        void this.router.navigate(['/offres', fromMsg[1]]);
      } else {
        void this.router.navigate(['/candidate/offres']);
      }
      return;
    }

    if (title.includes('résultat') || title.includes('resultat')) {
      void this.router.navigate(['/candidate/tests'], {
        queryParams: { open: 'result' }
      });
      return;
    }
    if (title.includes('invitation') && title.includes('test')) {
      void this.router.navigate(['/candidate/tests']);
    }
  }

  readNotification(n: AppNotification) {
    if (n.read) return;

    this.api.markNotificationRead(n.id)
      .subscribe({
        next: () => {
          this.notifications.set(
            this.notifications().map(x =>
              x.id === n.id
                ? { ...x, read: true }
                : x
            )
          );

          this.unreadCount.set(
            Math.max(
              0,
              this.unreadCount() - 1
            )
          );
        },
        error: () => {}
      });
  }

  signout() {
    this.clearCvPreviewUi();
    this.candidateSession.clear();

    this.auth.logout().subscribe({
      next: () => {},
      error: () => {}
    });

    this.router.navigateByUrl('/login');
  }
}