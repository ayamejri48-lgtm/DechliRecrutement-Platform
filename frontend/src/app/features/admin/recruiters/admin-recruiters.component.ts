import { ToastService } from '../../../core/services/toast.service';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  OnInit,
  inject,
  signal
} from '@angular/core';
import {
  FormBuilder,
  FormsModule,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

import {
  Candidature,
  Offre,
  PlatformService,
  User
} from '../../../core/services/platform.service';
import { TestApiService } from '../../../core/services/test-api.service';
import {
  matchingPasswords,
  passwordValidator
} from '../../../shared/validators/password.validator';
import { cmp, slicePage } from '../data/admin-list.util';
import { AdminSessionService } from '../data/admin-session.service';

@Component({
  selector: 'app-admin-recruiters',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink],
  templateUrl: './admin-recruiters.component.html',
  styleUrl: './admin-recruiters.component.scss'
})
export class AdminRecruitersComponent implements OnInit {
  private readonly session = inject(AdminSessionService);
  private readonly toast = inject(ToastService);
  private readonly platform = inject(PlatformService);
  private readonly testsApi = inject(TestApiService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly fb = inject(FormBuilder);

  loading = true;
  creating = false;
  busyId: number | null = null;
  error = '';
  showCreate = false;
  q = '';
  sortDir: 'asc' | 'desc' = 'asc';
  page = 1;
  pending: {
    user: User;
    kind: 'off' | 'on' | 'del';
    title: string;
    message: string;
    confirmLabel: string;
  } | null = null;
  all: User[] = [];
  /** IDs retirés localement en attendant Kafka (évite le fantôme après suppression). */
  private hiddenIds = new Set<number>();
  meId: number | null = null;
  workReady = false;
  testsKnown = false;
  private work = new Map<number, { published: number; applications: number; tests: number }>();
  showPassword = signal(false);

  /** Même contrôle de saisie que le signup. */
  createForm = this.fb.nonNullable.group(
    {
      firstName: ['', [Validators.required, Validators.maxLength(100)]],
      lastName: ['', [Validators.required, Validators.maxLength(100)]],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', [Validators.required]],
      password: ['', [Validators.required, passwordValidator]],
      confirmPassword: ['', [Validators.required]]
    },
    { validators: matchingPasswords }
  );

  ngOnInit(): void {
    this.session.ensureMe().subscribe({ next: (u) => (this.meId = u.id) });
    this.reload();
    this.loadWork();
  }

  loadWork(): void {
    forkJoin({
      offres: this.session.ensureOffres().pipe(catchError(() => of(null as Offre[] | null))),
      candidatures: this.session
        .ensureCandidatures()
        .pipe(catchError(() => of(null as Candidature[] | null))),
      tests: this.testsApi.adminOverview().pipe(catchError(() => of(null)))
    }).subscribe(({ offres, candidatures, tests }) => {
      this.workReady = offres != null && candidatures != null;
      this.testsKnown = tests != null;
      const rows = new Map<number, { published: number; applications: number; tests: number }>();
      const owner = new Map<number, number>();
      for (const offre of offres ?? []) {
        owner.set(offre.id, offre.recruiterId);
        const row = rows.get(offre.recruiterId) ?? { published: 0, applications: 0, tests: 0 };
        if (offre.status === 'PUBLISHED') row.published += 1;
        rows.set(offre.recruiterId, row);
      }
      for (const candidature of candidatures ?? []) {
        const recruiterId = owner.get(candidature.offreId);
        if (recruiterId == null) continue;
        const row = rows.get(recruiterId) ?? { published: 0, applications: 0, tests: 0 };
        row.applications += 1;
        rows.set(recruiterId, row);
      }
      for (const test of tests?.tests ?? []) {
        const recruiterId = owner.get(test.offreId);
        if (recruiterId == null) continue;
        const row = rows.get(recruiterId) ?? { published: 0, applications: 0, tests: 0 };
        row.tests += 1;
        rows.set(recruiterId, row);
      }
      this.work = rows;
      this.cdr.detectChanges();
    });
  }

  figure(id: number, key: 'published' | 'applications' | 'tests'): string {
    if (!this.workReady || (key === 'tests' && !this.testsKnown)) return '—';
    return String(this.work.get(id)?.[key] ?? 0);
  }

  get view() {
    const items = [...this.filtered].sort((a, b) => {
      const dir = this.sortDir === 'asc' ? 1 : -1;
      return cmp(`${a.lastName} ${a.firstName}`, `${b.lastName} ${b.firstName}`) * dir;
    });
    const sliced = slicePage(items, this.page);
    if (sliced.page !== this.page) this.page = sliced.page;
    return sliced;
  }

  toggleDir(): void {
    this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    this.page = 1;
  }

  get filtered(): User[] {
    const q = this.q.trim().toLowerCase();
    return this.all
      .filter((u) => u.role === 'RECRUITER')
      .filter((u) => !this.hiddenIds.has(u.id))
      .filter((u) => {
        if (!q) return true;
        return `${u.firstName} ${u.lastName} ${u.email}`
          .toLowerCase()
          .includes(q);
      });
  }

  invalid(name: string): boolean {
    const c = this.createForm.get(name);
    return !!c && c.invalid && (c.dirty || c.touched);
  }

  openCreate(): void {
    this.showCreate = true;
    this.error = '';
    this.showPassword.set(false);
    this.createForm.reset({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      password: '',
      confirmPassword: ''
    });
  }

  reload(): void {
    this.loading = true;

    this.session
      .refreshUsers()
      .pipe(
        finalize(() => {
          this.loading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (list) => (this.all = list),
        error: (err) => {
          this.toast.error(this.session.mapHttpError(
            err?.status,
            this.extractMessage(err)
          ));
        }
      });
  }

  create(): void {
    if (this.creating) return;

    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      this.error = 'Vérifiez les champs du formulaire.';
      this.cdr.detectChanges();
      return;
    }

    const { confirmPassword: _confirm, ...payload } =
      this.createForm.getRawValue();
    const body = {
      firstName: payload.firstName.trim(),
      lastName: payload.lastName.trim(),
      email: payload.email.trim(),
      password: payload.password,
      phone: payload.phone.trim(),
      role: 'RECRUITER' as const
    };
    this.creating = true;
    this.error = '';
    this.platform
      .adminCreateUser(body)
      .pipe(
        finalize(() => {
          this.creating = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (created) => {
          const row: User = {
            id: created.id,
            firstName: created.firstName,
            lastName: created.lastName,
            email: created.email,
            role: created.role || 'RECRUITER',
            phone: body.phone,
            enabled: true
          };
          // Affichage immédiat (sans attendre Kafka)
          this.all = [row, ...this.all.filter((u) => u.id !== row.id)];
          this.session.upsertUser(row);
          this.toast.success(`Recruteur créé : ${created.email}`);
          this.showCreate = false;
          this.createForm.reset();
          this.page = 1;
          this.cdr.detectChanges();

          // Filet : profil User-Service même si Kafka est lent / indisponible
          this.platform
            .adminBootstrapUserProfile({
              id: created.id,
              firstName: created.firstName,
              lastName: created.lastName,
              email: created.email,
              role: created.role || 'RECRUITER',
              phone: body.phone
            })
            .pipe(catchError(() => of(null)))
            .subscribe(() => this.reload());
        },
        error: (err) => {
          const status = err?.status as number | undefined;
          const detail = this.extractMessage(err);
          const msg =
            status === 409 ||
            (detail || '').toLowerCase().includes('email already exists')
              ? 'Cette adresse e-mail est déjà utilisée.'
              : this.session.mapHttpError(status, detail);
          this.error = msg;
          this.toast.error(msg);
          this.cdr.detectChanges();
        }
      });
  }

  deactivate(u: User): void {
    const name = this.displayName(u);
    this.pending = {
      user: u,
      kind: 'off',
      title: 'Désactiver ce recruteur ?',
      message: `${name} (${u.email}) ne pourra plus se connecter ni gérer ses offres. Le compte reste récupérable.`,
      confirmLabel: 'Désactiver'
    };
  }

  reactivate(u: User): void {
    const name = this.displayName(u);
    this.pending = {
      user: u,
      kind: 'on',
      title: 'Réactiver ce recruteur ?',
      message: `${name} (${u.email}) pourra de nouveau se connecter et gérer ses offres.`,
      confirmLabel: 'Réactiver'
    };
  }

  remove(u: User): void {
    const name = this.displayName(u);
    this.pending = {
      user: u,
      kind: 'del',
      title: 'Supprimer définitivement ?',
      message: `Le compte de ${name} (${u.email}) sera effacé. Cette action est irréversible.`,
      confirmLabel: 'Supprimer'
    };
  }

  private displayName(u: User): string {
    const name = `${u.firstName || ''} ${u.lastName || ''}`.trim();
    return name || u.email;
  }

  cancelPending(): void {
    this.pending = null;
  }

  confirmPending(): void {
    const action = this.pending;
    if (!action) return;
    this.pending = null;
    const name = this.displayName(action.user);
    if (action.kind === 'off') {
      this.act(
        action.user.id,
        () => this.platform.adminDeactivateUser(action.user.id),
        `Compte désactivé : ${name} ne peut plus se connecter.`,
        false
      );
    } else if (action.kind === 'on') {
      this.act(
        action.user.id,
        () => this.platform.adminReactivateUser(action.user.id),
        `Compte réactivé : ${name} peut de nouveau se connecter.`,
        true
      );
    } else {
      this.act(
        action.user.id,
        () => this.platform.adminDeleteUser(action.user.id),
        `Compte supprimé : ${name} a été retiré définitivement.`
      );
    }
  }

  private act(
    id: number,
    call: () => ReturnType<PlatformService['adminDeactivateUser']>,
    ok: string,
    expectEnabled?: boolean
  ): void {
    this.busyId = id;

    this.cdr.detectChanges();
    call().subscribe({
      next: () => {
        this.toast.success(ok);
        if (expectEnabled === undefined) {
          // Suppression : retirer tout de suite (ne pas attendre Kafka)
          this.hideDeleted(id);
        } else {
          this.applyEnabled(id, expectEnabled);
        }
        this.refreshUntilEnabled(id, expectEnabled, 0);
      },
      error: (err) => {
        this.busyId = null;
        this.toast.error(this.session.mapHttpError(
          err?.status,
          this.extractMessage(err)
        ));
        this.cdr.detectChanges();
      }
    });
  }

  private applyEnabled(id: number, enabled: boolean): void {
    this.all = this.all.map((u) => (u.id === id ? { ...u, enabled } : u));
    this.session.patchUserEnabled(id, enabled);
    this.cdr.detectChanges();
  }

  private hideDeleted(id: number): void {
    this.hiddenIds.add(id);
    this.all = this.all.filter((u) => u.id !== id);
    this.session.removeUser(id);
    this.cdr.detectChanges();
  }

  private refreshUntilEnabled(
    id: number,
    expectEnabled: boolean | undefined,
    attempt: number
  ): void {
    const maxAttempts = 6;
    const delayMs = attempt === 0 ? 500 : 700;
    setTimeout(() => {
      this.session.refreshUsers().subscribe({
        next: (list) => {
          this.all = list
            .filter((u) => !this.hiddenIds.has(u.id))
            .map((u) => ({ ...u }));
          for (const hidden of [...this.hiddenIds]) {
            if (!list.some((u) => u.id === hidden)) {
              this.hiddenIds.delete(hidden);
            } else {
              this.session.removeUser(hidden);
            }
          }
          const row = this.all.find((u) => u.id === id);
          const actual = row ? row.enabled !== false : undefined;
          // Suppression : continuer le poll tant que Kafka n’a pas retiré le compte
          // (la ligne reste déjà invisible via hiddenIds).
          const stillOnServer = list.some((u) => u.id === id);
          const synced =
            expectEnabled === undefined
              ? !stillOnServer
              : !row || actual === expectEnabled;
          if (!synced && expectEnabled !== undefined) {
            this.applyEnabled(id, expectEnabled);
          }
          if (synced || attempt + 1 >= maxAttempts) {
            this.busyId = null;
            this.cdr.detectChanges();
            return;
          }
          this.refreshUntilEnabled(id, expectEnabled, attempt + 1);
        },
        error: (err) => {
          this.busyId = null;
          this.toast.error(this.session.mapHttpError(
            err?.status,
            this.extractMessage(err)
          ));
          this.cdr.detectChanges();
        }
      });
    }, delayMs);
  }

  private extractMessage(err: unknown): string | undefined {
    const e = err as {
      error?: { message?: string; error?: string } | string;
    };
    if (typeof e?.error === 'string') return e.error;
    if (e?.error?.message || e?.error?.error) {
      return e.error.message || e.error.error;
    }
    const first = e?.error
      ? Object.values(e.error).find((value) => typeof value === 'string')
      : undefined;
    return typeof first === 'string' ? first : undefined;
  }
}
