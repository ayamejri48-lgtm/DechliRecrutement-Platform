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
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import {
  Offre,
  PlatformService,
  User
} from '../../../core/services/platform.service';
import { RecruiterSessionService } from '../data/recruiter-session.service';

@Component({
  selector: 'app-recruiter-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './recruiter-profile.component.html',
  styleUrl: './recruiter-profile.component.scss'
})
export class RecruiterProfileComponent implements OnInit, OnDestroy {
  private readonly platform = inject(PlatformService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(RecruiterSessionService);
  private readonly cdr = inject(ChangeDetectorRef);

  user: User | null = null;
  recentOffres: Offre[] = [];
  loading = true;
  statsLoading = false;
  saving = false;
  savingPhoto = false;
  editing = false;
  error = '';
  photoHint = '';

  pictureUrl: string | null = null;
  photoBroken = false;
  editingPhoto = false;
  selectedPhotoFile: File | null = null;
  private ownsPhotoPreview = false;
  photoPreviewUrl: string | null = null;

  readonly photoStageSize = 220;
  photoZoom = 1;
  photoOffsetX = 0;
  photoOffsetY = 0;
  photoDragging = false;
  private photoDragOrigin = { x: 0, y: 0, ox: 0, oy: 0 };

  stats = {
    totalOffres: 0,
    published: 0,
    draft: 0,
    closed: 0,
    candidatures: 0
  };

  form = {
    firstName: '',
    lastName: '',
    phone: ''
  };

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.revokeOwnedPreview();
    // Ne pas révoquer avatarUrl session (partagé avec le header).
  }

  get initials(): string {
    if (!this.user) return 'R';
    return (
      (this.user.firstName?.[0] ?? '') + (this.user.lastName?.[0] ?? '')
    ).toUpperCase() || 'R';
  }

  get photoTransform(): string {
    return `translate(calc(-50% + ${this.photoOffsetX}px), calc(-50% + ${this.photoOffsetY}px)) scale(${this.photoZoom})`;
  }

  get displayPhoto(): string | null {
    if (this.editingPhoto && this.photoPreviewUrl) return this.photoPreviewUrl;
    const shared = this.session.avatarUrl();
    if (shared && !this.photoBroken) return shared;
    if (this.pictureUrl && !this.photoBroken) return this.pictureUrl;
    return null;
  }

  load(): void {
    this.loading = true;

    this.cdr.detectChanges();

    // Cache session = affichage quasi immédiat si layout a déjà prefetch.
    this.session
      .ensureMe()
      .pipe(
        finalize(() => {
          this.loading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (u) => {
          this.user = u;
          this.syncForm();
          this.loadActivity();
          // Toujours tenter la photo (profilePicture peut être path/bool selon API).
          this.tryLoadPhoto();
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.toast.error(this.session.mapHttpError(err?.status));
          this.cdr.detectChanges();
        }
      });
  }

  /** Stats en arrière-plan via cache offres partagé. */
  private loadActivity(): void {
    this.statsLoading = !this.session.hasOffresCache();

    if (this.session.hasOffresCache()) {
      this.applyOffres(this.session.myOffres());
    }

    this.session
      .ensureMyOffres()
      .pipe(
        finalize(() => {
          this.statsLoading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (mine) => {
          this.applyOffres(mine);
          this.cdr.detectChanges();
        },
        error: () => undefined
      });
  }

  private applyOffres(mine: Offre[]): void {
    const s = this.session.statsFrom(mine);
    this.stats.totalOffres = s.total;
    this.stats.published = s.published;
    this.stats.draft = s.draft;
    this.stats.closed = s.closed;
    this.recentOffres = [...mine]
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, 5);

    this.session.countCandidaturesTotal(mine).subscribe({
      next: (total) => {
        this.stats.candidatures = total;
        this.cdr.detectChanges();
      }
    });
  }

  startEdit(): void {
    this.editing = true;

    this.syncForm();
  }

  cancel(): void {
    this.editing = false;
    this.syncForm();
  }

  save(): void {
    if (!this.user) return;
    this.saving = true;

    this.platform
      .updateUser(this.user.id, {
        firstName: this.form.firstName.trim(),
        lastName: this.form.lastName.trim(),
        phone: this.form.phone.trim() || undefined,
        description: this.user.description ?? null
      })
      .pipe(finalize(() => (this.saving = false)))
      .subscribe({
        next: (u) => {
          this.user = u;
          this.session.setMe(u);
          this.editing = false;
          this.toast.success('Profil recruteur mis à jour.');
          this.syncForm();
        },
        error: (err) => {
          this.toast.error(this.session.mapHttpError(
            err?.status,
            this.extractMessage(err)
          ));
        }
      });
  }

  openPhotoEditor(fileInput: HTMLInputElement): void {
    if ((this.session.avatarUrl() || this.pictureUrl) && !this.photoBroken) {
      this.startAdjustCurrentPhoto();
      return;
    }
    fileInput.click();
  }

  startAdjustCurrentPhoto(): void {
    const src = this.session.avatarUrl() || this.pictureUrl;
    if (!src) return;
    this.revokeOwnedPreview();
    this.photoPreviewUrl = src;
    this.ownsPhotoPreview = false;
    this.selectedPhotoFile = null;
    this.resetPhotoAdjust();
    this.editingPhoto = true;
    this.photoHint = '';
  }

  selectProfilePhoto(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      this.toast.error('Formats acceptés : JPEG, PNG ou WebP.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.toast.error('Image trop volumineuse (max 5 Mo).');
      return;
    }

    this.revokeOwnedPreview();
    this.selectedPhotoFile = file;
    this.photoPreviewUrl = URL.createObjectURL(file);
    this.ownsPhotoPreview = true;
    this.photoBroken = false;
    this.resetPhotoAdjust();
    this.editingPhoto = true;

    this.photoHint = '';
  }

  onPhotoPointerDown(event: PointerEvent): void {
    if (!this.editingPhoto) return;
    this.photoDragging = true;
    this.photoDragOrigin = {
      x: event.clientX,
      y: event.clientY,
      ox: this.photoOffsetX,
      oy: this.photoOffsetY
    };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  onPhotoPointerMove(event: PointerEvent): void {
    if (!this.photoDragging) return;
    const max = (this.photoStageSize / 2) * this.photoZoom;
    this.photoOffsetX = Math.max(
      -max,
      Math.min(max, this.photoDragOrigin.ox + (event.clientX - this.photoDragOrigin.x))
    );
    this.photoOffsetY = Math.max(
      -max,
      Math.min(max, this.photoDragOrigin.oy + (event.clientY - this.photoDragOrigin.y))
    );
  }

  onPhotoPointerUp(event: PointerEvent): void {
    this.photoDragging = false;
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  cancelEditPhoto(): void {
    this.revokeOwnedPreview();
    this.selectedPhotoFile = null;
    this.photoPreviewUrl = null;
    this.editingPhoto = false;
    this.resetPhotoAdjust();
    this.photoHint = '';
  }

  async savePhoto(): Promise<void> {
    if (this.savingPhoto) return;
    this.savingPhoto = true;

    this.photoHint = '';

    try {
      const file = await this.buildCroppedPhotoFile();
      this.platform.uploadProfilePhoto(file).subscribe({
        next: () => {
          this.savingPhoto = false;
          this.editingPhoto = false;
          this.selectedPhotoFile = null;
          this.revokeOwnedPreview();
          this.photoPreviewUrl = null;
          this.resetPhotoAdjust();
          this.tryLoadPhoto(true);
          this.toast.success('Photo de profil enregistrée.');
        },
        error: (err) => {
          this.savingPhoto = false;
          this.toast.error(this.session.mapHttpError(
            err?.status,
            this.extractMessage(err)
          ));
          if (err?.status === 403) {
            this.photoHint =
              'Accès photo refusé. Redémarrez user-service si la règle RECRUITER vient d’être déployée.';
          }
          this.cdr.detectChanges();
        }
      });
    } catch {
      this.savingPhoto = false;
      this.toast.error('Impossible de préparer l’image.');
    }
  }

  labelStatus(s: string): string {
    return (
      { DRAFT: 'Brouillon', PUBLISHED: 'Publiée', CLOSED: 'Clôturée' } as Record<
        string,
        string
      >
    )[s] ?? s;
  }

  statusClass(s: string): string {
    return (
      { DRAFT: 'draft', PUBLISHED: 'published', CLOSED: 'closed' } as Record<
        string,
        string
      >
    )[s] ?? '';
  }

  private tryLoadPhoto(force = false): void {
    const load$ = force
      ? this.session.refreshAvatarPhoto()
      : this.session.ensureAvatarPhoto();

    load$.subscribe({
      next: (url) => {
        this.pictureUrl = url;
        this.photoBroken = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.pictureUrl = null;
        this.cdr.detectChanges();
      }
    });
  }

  private resetPhotoAdjust(): void {
    this.photoZoom = 1;
    this.photoOffsetX = 0;
    this.photoOffsetY = 0;
    this.photoDragging = false;
  }

  private revokeOwnedPreview(): void {
    if (this.ownsPhotoPreview && this.photoPreviewUrl) {
      URL.revokeObjectURL(this.photoPreviewUrl);
    }
    this.ownsPhotoPreview = false;
  }

  private async buildCroppedPhotoFile(): Promise<File> {
    const src = this.photoPreviewUrl;
    if (!src) throw new Error('no-src');

    const img = await this.loadImage(src);
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');

    const cover = Math.max(size / img.width, size / img.height);
    const scale = cover * this.photoZoom;
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const ratio = size / this.photoStageSize;
    const dx = size / 2 + this.photoOffsetX * ratio - drawW / 2;
    const dy = size / 2 + this.photoOffsetY * ratio - drawH / 2;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, dx, dy, drawW, drawH);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('blob'))),
        'image/jpeg',
        0.92
      );
    });

    const base =
      this.selectedPhotoFile?.name?.replace(/\.[^.]+$/, '') || 'recruiter-photo';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('img'));
      img.src = url;
    });
  }

  private syncForm(): void {
    this.form = {
      firstName: this.user?.firstName ?? '',
      lastName: this.user?.lastName ?? '',
      phone: this.user?.phone ?? ''
    };
  }

  private extractMessage(err: unknown): string | undefined {
    const e = err as { error?: { message?: string } | string };
    if (typeof e?.error === 'string') return e.error;
    return e?.error?.message;
  }

}
