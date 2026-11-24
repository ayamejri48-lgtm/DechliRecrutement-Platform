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
import { finalize } from 'rxjs';

import { PlatformService, User } from '../../../core/services/platform.service';
import { AdminSessionService } from '../data/admin-session.service';

@Component({
  selector: 'app-admin-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-profile.component.html',
  styleUrl: './admin-profile.component.scss'
})
export class AdminProfileComponent implements OnInit, OnDestroy {
  private readonly platform = inject(PlatformService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(AdminSessionService);
  private readonly cdr = inject(ChangeDetectorRef);

  user: User | null = null;
  loading = true;
  saving = false;
  savingPhoto = false;
  editing = false;
  editingPhoto = false;
  error = '';
  photoBroken = false;
  pictureUrl: string | null = null;
  photoPreviewUrl: string | null = null;
  selectedPhotoFile: File | null = null;
  private ownsPhotoPreview = false;

  readonly photoStageSize = 220;
  photoZoom = 1;
  photoOffsetX = 0;
  photoOffsetY = 0;
  photoDragging = false;
  private photoDragOrigin = { x: 0, y: 0, ox: 0, oy: 0 };

  form = { firstName: '', lastName: '', phone: '' };

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.revokeOwnedPreview();
  }

  get initials(): string {
    if (!this.user) return 'A';
    return (
      (this.user.firstName?.[0] ?? '') + (this.user.lastName?.[0] ?? '')
    ).toUpperCase() || 'A';
  }

  get photoTransform(): string {
    return `translate(calc(-50% + ${this.photoOffsetX}px), calc(-50% + ${this.photoOffsetY}px)) scale(${this.photoZoom})`;
  }

  get displayPhoto(): string | null {
    if (this.editingPhoto && this.photoPreviewUrl) return this.photoPreviewUrl;
    const shared = this.session.avatarUrl();
    if (shared && !this.photoBroken) return shared;
    return this.pictureUrl && !this.photoBroken ? this.pictureUrl : null;
  }

  load(): void {
    this.loading = true;
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
          this.session.ensureAvatarPhoto().subscribe({
            next: (url) => {
              this.pictureUrl = url;
              this.cdr.detectChanges();
            }
          });
        },
        error: (err) => {
          this.toast.error(this.session.mapHttpError(err?.status));
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
          this.toast.success('Profil administrateur mis à jour.');
          this.syncForm();
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.toast.error(this.session.mapHttpError(err?.status));
          this.cdr.detectChanges();
        }
      });
  }

  openPhotoEditor(fileInput: HTMLInputElement): void {
    // Toujours proposer de choisir un fichier pour remplacer ;
    // le réglage (zoom/cadrage) se fait ensuite dans l’éditeur.
    fileInput.click();
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
    this.resetPhotoAdjust();
    this.editingPhoto = true;

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
  }

  async savePhoto(): Promise<void> {
    if (this.savingPhoto) return;
    this.savingPhoto = true;
    this.photoBroken = false;

    try {
      const file = await this.buildCroppedPhotoFile();
      this.platform.uploadProfilePhoto(file).subscribe({
        next: (updated) => {
          if (this.user && updated) {
            this.user = { ...this.user, ...updated };
            this.session.setMe(this.user);
          }
          this.savingPhoto = false;
          this.editingPhoto = false;
          this.selectedPhotoFile = null;
          this.revokeOwnedPreview();
          this.photoPreviewUrl = null;
          this.resetPhotoAdjust();
          this.session.refreshAvatarPhoto().subscribe({
            next: (url) => {
              this.pictureUrl = url;
              this.photoBroken = !url;
              this.toast.success('Photo de profil enregistrée.');
              this.cdr.detectChanges();
            },
            error: () => {
              this.toast.success('Photo enregistrée. Rechargez si l’avatar n’apparaît pas.');
              this.cdr.detectChanges();
            }
          });
        },
        error: (err) => {
          this.savingPhoto = false;
          this.toast.error(this.session.mapHttpError(err?.status));
          this.cdr.detectChanges();
        }
      });
    } catch {
      this.savingPhoto = false;
      this.toast.error('Impossible de préparer l’image.');
      this.cdr.detectChanges();
    }
  }

  private syncForm(): void {
    this.form = {
      firstName: this.user?.firstName ?? '',
      lastName: this.user?.lastName ?? '',
      phone: this.user?.phone ?? ''
    };
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
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('blob'))), 'image/jpeg', 0.92);
    });
    return new File([blob], 'admin-photo.jpg', { type: 'image/jpeg' });
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('img'));
      img.src = url;
    });
  }
}
