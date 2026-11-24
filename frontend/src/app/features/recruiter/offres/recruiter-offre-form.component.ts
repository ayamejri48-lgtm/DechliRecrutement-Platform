import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize, of, switchMap } from 'rxjs';

import {
  Offre,
  OffreSkill,
  OffreSkillRequest,
  PlatformService,
  User
} from '../../../core/services/platform.service';
import { ToastService } from '../../../core/services/toast.service';
import { RecruiterSessionService } from '../data/recruiter-session.service';

@Component({
  selector: 'app-recruiter-offre-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './recruiter-offre-form.component.html',
  styleUrl: './recruiter-offre-form.component.scss'
})
export class RecruiterOffreFormComponent implements OnInit {
  private readonly platform = inject(PlatformService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(RecruiterSessionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  me: User | null = null;
  offreId: number | null = null;
  isEdit = false;
  loading = true;
  saving = false;
  actionBusy = false;
  skillBusy = false;
  error = '';
  submitted = false;

  /** Erreurs de champ (alignées sur OffreCreate/UpdateRequest). */
  fieldErrors: Record<string, string> = {};

  model = {
    title: '',
    description: '',
    location: '',
    contractType: 'CDI',
    workMode: 'HYBRID',
    experienceYears: 0,
    postes: 1,
    educationLevel: '',
    deadline: ''
  };

  skills: OffreSkill[] = [];
  skillForm: OffreSkillRequest = {
    name: '',
    level: 'INTERMEDIATE',
    required: true
  };
  editingSkillId: number | null = null;

  readonly contracts = ['CDI', 'CDD', 'STAGE'] as const;
  readonly modes = ['ONSITE', 'HYBRID', 'REMOTE'] as const;
  readonly skillLevels = [
    'BEGINNER',
    'INTERMEDIATE',
    'ADVANCED',
    'EXPERT'
  ] as const;

  /** Liste contrôlée (String libre côté API — pas de rupture de contrat). */
  readonly educationLevels = [
    'Sans diplôme',
    'CAP / BEP',
    'Baccalauréat',
    'Bac+2 (BTS/DUT)',
    'Bac+3 (Licence)',
    'Bac+4',
    'Bac+5 (Master / Ingénieur)',
    'Doctorat'
  ] as const;

  /** 0 à 20 ans — UX plus claire qu’un spinner libre. */
  readonly experienceOptions = Array.from({ length: 21 }, (_, i) => i);

  get locked(): boolean {
    return this.currentStatus === 'CLOSED';
  }

  /** min date = demain (aligné @Future backend). */
  get minDeadline(): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 1);
    return this.toDateInput(d);
  }

  /** max date = +2 ans (évite dates aberrantes). */
  get maxDeadline(): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setFullYear(d.getFullYear() + 2);
    return this.toDateInput(d);
  }

  /** Options études : liste standard + valeur legacy si hors liste. */
  get educationOptions(): string[] {
    const current = this.model.educationLevel?.trim();
    const base = [...this.educationLevels];
    if (current && !base.includes(current as (typeof this.educationLevels)[number])) {
      return [current, ...base];
    }
    return base;
  }

  /** Options expérience : 0–20 + valeur legacy si > 20. */
  get experienceSelectOptions(): number[] {
    const y = Number(this.model.experienceYears);
    if (!Number.isNaN(y) && y > 20 && Number.isInteger(y)) {
      return [...this.experienceOptions, y];
    }
    return this.experienceOptions;
  }

  currentStatus = '';
  /** Étape UX : infos → compétences → publication */
  activeStep: 'info' | 'skills' | 'publish' = 'info';

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    this.offreId = idParam ? Number(idParam) : null;
    this.isEdit = !!this.offreId && !Number.isNaN(this.offreId);

    const navState = (history.state ?? {}) as {
      success?: string;
      focusSkills?: boolean;
    };
    if (navState.success) {
      this.toast.success(navState.success);
    }
    if (navState.focusSkills && this.isEdit) {
      this.activeStep = 'skills';
    } else if (this.route.snapshot.fragment === 'skills' && this.isEdit) {
      this.activeStep = 'skills';
    }

    this.session
      .ensureMe()
      .pipe(
        switchMap((me) => {
          this.me = me;
          if (!this.isEdit || !this.offreId) {
            this.loading = false;
            this.cdr.detectChanges();
            return of(null);
          }
          return this.platform.offre(this.offreId);
        })
      )
      .subscribe({
        next: (offre) => {
          if (offre) {
            if (this.me && offre.recruiterId !== this.me.id) {
              this.toast.error('Cette offre ne vous appartient pas.');
              this.loading = false;
              this.cdr.detectChanges();
              return;
            }
            this.fill(offre);
            this.loadSkills();
          }
          this.loading = false;
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.loading = false;
          this.toast.error(this.session.mapHttpError(err?.status));
          this.cdr.detectChanges();
        }
      });
  }

  save(): void {
    if (this.locked) {
      this.toast.error('Une offre clôturée ne peut plus être modifiée.');
      this.cdr.detectChanges();
      return;
    }

    this.submitted = true;
    if (!this.validateForm()) {
      this.toast.error('Corrigez les champs invalides avant d’enregistrer.');
      this.cdr.detectChanges();
      return;
    }
    this.saving = true;
    this.cdr.detectChanges();

    const body = {
      title: this.model.title.trim(),
      description: this.model.description.trim(),
      location: this.model.location.trim(),
      contractType: this.model.contractType,
      workMode: this.model.workMode,
      experienceYears: Number(this.model.experienceYears),
      educationLevel: this.model.educationLevel.trim(),
      deadline: this.model.deadline || undefined,
      postes: Math.max(1, Number(this.model.postes) || 1)
    };

    const wasEdit = this.isEdit && !!this.offreId;
    const req$ = wasEdit
      ? this.platform.updateOffre(this.offreId!, body)
      : this.platform.createOffre(body);

    req$
      .pipe(
        finalize(() => {
          this.saving = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (offre) => {
          this.session.upsertOffre(offre);
          if (wasEdit) {
            this.toast.success(`Offre « ${offre.title} » mise à jour.`);
            if (this.currentStatus === 'DRAFT') {
              this.activeStep = 'skills';
            }
            this.cdr.detectChanges();
            return;
          }
          // Création → étape compétences (même parcours, plus fluide).
          void this.router.navigate(['/recruiter/offre', offre.id, 'edit'], {
            fragment: 'skills',
            state: {
              focusSkills: true,
              success: `Offre « ${offre.title} » créée. Ajoutez maintenant les compétences.`
            }
          });
        },
        error: (err) => {
          this.toast.error(this.businessError(err));
          this.cdr.detectChanges();
        }
      });
  }

  /** Contrôle de saisie aligné sur les DTO backend (@NotBlank, @Size, @Min, @Future). */
  validateForm(): boolean {
    const errors: Record<string, string> = {};
    const title = this.model.title.trim();
    const description = this.model.description.trim();
    const location = this.model.location.trim();
    const educationLevel = this.model.educationLevel.trim();
    const years = Number(this.model.experienceYears);

    if (!title) {
      errors['title'] = 'Le titre est obligatoire.';
    } else if (title.length > 255) {
      errors['title'] = 'Le titre ne peut pas dépasser 255 caractères.';
    }

    if (!description) {
      errors['description'] = 'La description est obligatoire.';
    } else if (description.length < 20) {
      errors['description'] =
        'La description doit contenir au moins 20 caractères.';
    }

    if (!location) {
      errors['location'] = 'La localisation est obligatoire.';
    }

    if (!educationLevel) {
      errors['educationLevel'] = 'Le niveau d’études est obligatoire.';
    } else if (!this.educationOptions.includes(educationLevel)) {
      errors['educationLevel'] = 'Niveau d’études invalide.';
    }

    if (
      !this.contracts.includes(
        this.model.contractType as (typeof this.contracts)[number]
      )
    ) {
      errors['contractType'] = 'Type de contrat invalide.';
    }

    if (
      !this.modes.includes(this.model.workMode as (typeof this.modes)[number])
    ) {
      errors['workMode'] = 'Mode de travail invalide.';
    }

    if (
      this.model.experienceYears === null ||
      this.model.experienceYears === undefined ||
      Number.isNaN(years)
    ) {
      errors['experienceYears'] = 'L’expérience requise est obligatoire.';
    } else if (!Number.isInteger(years) || years < 0) {
      errors['experienceYears'] = 'L’expérience doit être un entier ≥ 0.';
    } else if (years > 50) {
      errors['experienceYears'] = 'L’expérience ne peut pas dépasser 50 ans.';
    }

    if (this.model.deadline) {
      const deadline = new Date(this.model.deadline + 'T00:00:00');
      const min = new Date(this.minDeadline + 'T00:00:00');
      const max = new Date(this.maxDeadline + 'T00:00:00');
      if (Number.isNaN(deadline.getTime())) {
        errors['deadline'] = 'Date limite invalide.';
      } else if (deadline < min) {
        errors['deadline'] =
          'La date limite doit être au moins demain (règle @Future).';
      } else if (deadline > max) {
        errors['deadline'] =
          'La date limite ne peut pas dépasser 2 ans à partir d’aujourd’hui.';
      }
    }

    this.fieldErrors = errors;
    return Object.keys(errors).length === 0;
  }

  clearDeadline(): void {
    this.model.deadline = '';
    this.clearFieldError('deadline');
  }

  clearFieldError(field: string): void {
    if (!this.fieldErrors[field]) return;
    const next = { ...this.fieldErrors };
    delete next[field];
    this.fieldErrors = next;
  }

  publish(): void {
    if (!this.offreId || this.currentStatus !== 'DRAFT' || this.actionBusy) {
      return;
    }
    if (!this.skills.length) {
      this.toast.warn(
        'Ajoutez au moins une compétence avant de publier l’offre.'
      );
      return;
    }
    this.actionBusy = true;
    this.cdr.detectChanges();
    this.platform
      .publishOffre(this.offreId)
      .pipe(
        finalize(() => {
          this.actionBusy = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: () => {
          this.currentStatus = 'PUBLISHED';
          this.session.patchOffreStatus(this.offreId!, 'PUBLISHED');
          this.toast.success('Offre publiée.');
          void this.router.navigate(['/recruiter/offres'], {
            state: { success: 'Offre publiée.' }
          });
        },
        error: (err) => {
          this.toast.error(this.businessError(err));
          this.cdr.detectChanges();
        }
      });
  }

  closeOffre(): void {
    if (!this.offreId || this.currentStatus !== 'PUBLISHED' || this.actionBusy) {
      return;
    }
    if (!confirm('Clôturer cette offre ?')) return;
    this.actionBusy = true;
    this.cdr.detectChanges();
    this.platform
      .closeOffre(this.offreId)
      .pipe(
        finalize(() => {
          this.actionBusy = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: () => {
          this.currentStatus = 'CLOSED';
          this.session.patchOffreStatus(this.offreId!, 'CLOSED');
          this.toast.success('Offre clôturée.');
          void this.router.navigate(['/recruiter/offres'], {
            state: { success: 'Offre clôturée.' }
          });
        },
        error: (err) => {
          this.toast.error(this.businessError(err));
          this.cdr.detectChanges();
        }
      });
  }

  /** Garde l’offre en brouillon et revient à la liste (sans publier ni supprimer). */
  saveAsDraft(): void {
    if (!this.offreId || this.currentStatus !== 'DRAFT' || this.actionBusy) {
      return;
    }
    this.toast.success('Offre enregistrée comme brouillon.');
    void this.router.navigate(['/recruiter/offres'], {
      queryParams: { status: 'DRAFT' },
      state: { success: 'Offre enregistrée comme brouillon.' }
    });
  }

  loadSkills(): void {
    if (!this.offreId) return;
    this.platform.offreSkills(this.offreId).subscribe({
      next: (list) => {
        this.skills = list ?? [];
        this.cdr.detectChanges();
      },
      error: (err) => {
        if (err?.status !== 403) {
          this.toast.error(this.session.mapHttpError(err?.status));
          this.cdr.detectChanges();
        }
      }
    });
  }

  goStep(step: 'info' | 'skills' | 'publish'): void {
    if ((step === 'skills' || step === 'publish') && !this.isEdit) return;
    this.activeStep = step;
    this.cdr.detectChanges();
  }

  labelLevel(level: string): string {
    return (
      {
        BEGINNER: 'Débutant',
        INTERMEDIATE: 'Intermédiaire',
        ADVANCED: 'Avancé',
        EXPERT: 'Expert'
      } as Record<string, string>
    )[level] ?? level;
  }

  labelMode(mode: string): string {
    return (
      {
        ONSITE: 'Sur site',
        HYBRID: 'Hybride',
        REMOTE: 'Télétravail'
      } as Record<string, string>
    )[mode] ?? mode;
  }

  startEditSkill(s: OffreSkill): void {
    this.editingSkillId = s.id;
    this.skillForm = {
      name: s.name,
      level: s.level,
      required: s.required
    };
    this.activeStep = 'skills';
  }

  cancelSkillEdit(): void {
    this.editingSkillId = null;
    this.skillForm = { name: '', level: 'INTERMEDIATE', required: true };
  }

  submitSkill(): void {
    if (!this.offreId || this.locked) return;
    const body: OffreSkillRequest = {
      name: this.skillForm.name.trim(),
      level: this.skillForm.level,
      required: !!this.skillForm.required
    };
    if (!body.name || !body.level) {
      this.toast.error('Nom et niveau de compétence requis.');
      this.cdr.detectChanges();
      return;
    }

    this.skillBusy = true;
    this.cdr.detectChanges();
    const req$ =
      this.editingSkillId != null
        ? this.platform.updateOffreSkill(
            this.offreId,
            this.editingSkillId,
            body
          )
        : this.platform.addOffreSkill(this.offreId, body);

    req$
      .pipe(
        finalize(() => {
          this.skillBusy = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: () => {
          this.toast.success(
            this.editingSkillId != null
              ? 'Compétence mise à jour.'
              : 'Compétence ajoutée.');
          this.cancelSkillEdit();
          this.loadSkills();
        },
        error: (err) => {
          this.toast.error(this.session.mapHttpError(
            err?.status,
            this.extractMessage(err)
          ));
        }
      });
  }

  removeSkill(s: OffreSkill): void {
    if (!this.offreId || this.locked) return;
    if (!confirm(`Supprimer « ${s.name} » ?`)) return;
    this.skillBusy = true;
    this.cdr.detectChanges();
    this.platform
      .removeOffreSkill(this.offreId, s.id)
      .pipe(
        finalize(() => {
          this.skillBusy = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: () => {
          this.toast.success('Compétence supprimée.');
          this.loadSkills();
        },
        error: (err) => {
          this.toast.error(this.session.mapHttpError(err?.status));
        }
      });
  }

  private fill(offre: Offre): void {
    this.currentStatus = offre.status;
    this.offreId = offre.id;
    this.isEdit = true;
    this.model = {
      title: offre.title ?? '',
      description: offre.description ?? '',
      location: offre.location ?? '',
      contractType: offre.contractType || 'CDI',
      workMode: offre.workMode || 'HYBRID',
      experienceYears: offre.experienceYears ?? 0,
      postes: offre.postes && offre.postes > 0 ? offre.postes : 1,
      educationLevel: offre.educationLevel ?? '',
      deadline: offre.deadline ? String(offre.deadline).slice(0, 10) : ''
    };
  }

  private toDateInput(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private extractMessage(err: unknown): string | undefined {
    const e = err as { error?: { message?: string } | string };
    if (typeof e?.error === 'string') return e.error;
    return e?.error?.message;
  }

  /** Privilégie le message métier backend (deadline, DRAFT only, etc.). */
  private businessError(err: unknown): string {
    const detail = this.extractMessage(err)?.trim();
    if (detail) return detail;
    const e = err as { status?: number };
    return this.session.mapHttpError(e?.status);
  }
}
