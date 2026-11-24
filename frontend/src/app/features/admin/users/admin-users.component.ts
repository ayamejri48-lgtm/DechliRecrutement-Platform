import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  OnInit,
  inject
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { PlatformService, User } from '../../../core/services/platform.service';
import { ToastService } from '../../../core/services/toast.service';
import { PASSWORD_PATTERN } from '../../../shared/validators/password.validator';
import { cmp, slicePage } from '../data/admin-list.util';
import { AdminSessionService } from '../data/admin-session.service';

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-users.component.html',
  styleUrl: './admin-users.component.scss'
})
export class AdminUsersComponent implements OnInit {
  private readonly session = inject(AdminSessionService);
  private readonly toast = inject(ToastService);
  private readonly platform = inject(PlatformService);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);

  loading = true;
  busyId: number | null = null;
  creating = false;
  error = '';
  showCreate = false;

  q = '';
  roleFilter = '';
  enabledFilter = '';
  sortKey: 'name' | 'email' | 'role' = 'name';
  sortDir: 'asc' | 'desc' = 'asc';
  page = 1;
  pending: { user: User; kind: 'off' | 'on' | 'del'; message: string } | null = null;

  all: User[] = [];
  meId: number | null = null;
  showPassword = false;
  private readonly hiddenIds = new Set<number>();

  form = {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    role: 'CANDIDATE' as 'CANDIDATE' | 'RECRUITER' | 'ADMIN'
  };

  private justCreated: User | null = null;

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      this.roleFilter = params.get('role') ?? '';
      this.enabledFilter = params.get('enabled') ?? '';
      this.cdr.detectChanges();
    });
    this.session.ensureMe().subscribe({
      next: (u) => (this.meId = u.id)
    });
    this.reload();
  }

  get view() {
    const items = [...this.filtered].sort((a, b) => {
      const dir = this.sortDir === 'asc' ? 1 : -1;
      const av =
        this.sortKey === 'email'
          ? a.email
          : this.sortKey === 'role'
            ? a.role
            : `${a.lastName} ${a.firstName}`;
      const bv =
        this.sortKey === 'email'
          ? b.email
          : this.sortKey === 'role'
            ? b.role
            : `${b.lastName} ${b.firstName}`;
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

  roleLabel(role?: string): string {
    return ({ CANDIDATE: 'Candidat', RECRUITER: 'Recruteur', ADMIN: 'Admin' } as Record<string, string>)[role || ''] ?? (role || '—');
  }

  get filtered(): User[] {
    const q = this.q.trim().toLowerCase();
    return this.all.filter((u) => {
      if (this.roleFilter && u.role !== this.roleFilter) return false;
      if (this.enabledFilter === '1' && u.enabled === false) return false;
      if (this.enabledFilter === '0' && u.enabled !== false) return false;
      if (!q) return true;
      const hay = `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase();
      return hay.includes(q);
    });
  }

  reload(): void {
    this.loading = true;
    this.cdr.detectChanges();
    this.session
      .refreshUsers()
      .pipe(
        finalize(() => {
          this.loading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (list) => {
          const created = this.justCreated;
          const present = created
            ? list.some((u) => u.id === created.id || u.email === created.email)
            : true;
          const visible = (present || !created ? list : [created, ...list]).filter(
            (u) => !this.hiddenIds.has(u.id)
          );
          this.all = visible;
          if (present) this.justCreated = null;
        },
        error: (err) => {
          this.toast.error(this.session.mapHttpError(
            err?.status,
            this.extractMessage(err)
          ));
        }
      });
  }

  openCreate(): void {
    this.showCreate = true;
    this.showPassword = false;
    this.form = {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      password: '',
      confirmPassword: '',
      role: 'CANDIDATE'
    };
  }

  createAccount(): void {
    if (this.creating) return;
    if (!this.form.phone.trim()) {
      this.toast.error('Le téléphone est obligatoire.');
      return;
    }
    if (!PASSWORD_PATTERN.test(this.form.password)) {
      this.toast.error('8 caractères min., majuscule, minuscule, chiffre et caractère spécial (@$!%*?&._-).');
      return;
    }
    if (this.form.password !== this.form.confirmPassword) {
      this.toast.error('Les mots de passe ne correspondent pas.');
      return;
    }
    this.creating = true;
    const body = {
      firstName: this.form.firstName.trim(),
      lastName: this.form.lastName.trim(),
      email: this.form.email.trim(),
      password: this.form.password,
      phone: this.form.phone.trim() || undefined
    };
    const request =
      this.form.role === 'CANDIDATE'
        ? this.platform.adminCreateCandidate(body)
        : this.platform.adminCreateUser({ ...body, role: this.form.role });
    request
      .pipe(finalize(() => (this.creating = false)))
      .subscribe({
        next: (created) => {
          this.justCreated = {
            id: created.id,
            firstName: created.firstName,
            lastName: created.lastName,
            email: created.email,
            role: created.role,
            enabled: true
          };
          this.toast.success(`${this.roleLabel(created.role)} créé : ${created.email}`);
          this.showCreate = false;
          this.reload();
        },
        error: (err) => {
          this.toast.error(this.session.mapHttpError(
            err?.status,
            this.extractMessage(err)
          ));
          this.cdr.detectChanges();
        }
      });
  }

  deactivate(u: User): void {
    if (u.id === this.meId) {
      this.toast.error('Vous ne pouvez pas désactiver votre propre compte.');
      return;
    }
    this.pending = {
      user: u,
      kind: 'off',
      message: `Désactiver le compte « ${u.email} » ?`
    };
  }

  reactivate(u: User): void {
    this.pending = {
      user: u,
      kind: 'on',
      message: `Réactiver le compte « ${u.email} » ?`
    };
  }

  remove(u: User): void {
    if (u.id === this.meId) {
      this.toast.error('Vous ne pouvez pas supprimer votre propre compte.');
      return;
    }
    this.pending = {
      user: u,
      kind: 'del',
      message: `Supprimer définitivement « ${u.email} » ? Cette action est irréversible.`
    };
  }

  cancelPending(): void {
    this.pending = null;
  }

  confirmPending(): void {
    const action = this.pending;
    if (!action) return;
    this.pending = null;
    if (action.kind === 'off') {
      this.runLifecycle(
        action.user.id,
        () => this.platform.adminDeactivateUser(action.user.id),
        'Compte désactivé.',
        false
      );
    } else if (action.kind === 'on') {
      this.runLifecycle(
        action.user.id,
        () => this.platform.adminReactivateUser(action.user.id),
        'Compte réactivé.',
        true
      );
    } else {
      this.runLifecycle(
        action.user.id,
        () => this.platform.adminDeleteUser(action.user.id),
        'Compte supprimé.'
      );
    }
  }

  private runLifecycle(
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
          this.hideDeleted(id);
        } else {
          this.applyEnabled(id, expectEnabled);
        }
        this.refreshUntilEnabled(id, expectEnabled, 0);
      },
      error: (err) => {
        const detail = this.extractMessage(err);
        if (this.isMissingAccount(err?.status, detail)) {
          this.finishOnProfile(id, expectEnabled, ok);
          return;
        }
        this.busyId = null;
        this.toast.error(this.session.mapHttpError(err?.status, detail));
        this.cdr.detectChanges();
      }
    });
  }

  private applyEnabled(id: number, enabled: boolean): void {
    this.all = this.all.map((u) => (u.id === id ? { ...u, enabled } : u));
    this.session.patchUserEnabled(id, enabled);
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
          this.all = list.filter((u) => !this.hiddenIds.has(u.id)).map((u) => ({ ...u }));
          for (const hidden of this.hiddenIds) {
            if (!list.some((u) => u.id === hidden)) this.hiddenIds.delete(hidden);
            else this.session.removeUser(hidden);
          }
          const row = this.all.find((u) => u.id === id);
          const actual = row ? row.enabled !== false : undefined;
          const synced =
            expectEnabled === undefined ||
            !row ||
            actual === expectEnabled;
          if (!synced && expectEnabled !== undefined) {
            this.applyEnabled(id, expectEnabled);
          }
          if (synced || attempt + 1 >= maxAttempts) {
            this.busyId = null;
            this.loading = false;
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

  private hideDeleted(id: number): void {
    this.hiddenIds.add(id);
    this.all = this.all.filter((u) => u.id !== id);
    this.session.removeUser(id);
    this.cdr.detectChanges();
  }

  private finishOnProfile(
    id: number,
    expectEnabled: boolean | undefined,
    ok: string
  ): void {
    const call =
      expectEnabled === undefined
        ? this.platform.adminDeleteProfile(id)
        : this.platform.adminSetPresence(id, expectEnabled);
    call.subscribe({
      next: () => {
        this.toast.success(ok);
        if (expectEnabled === undefined) this.hideDeleted(id);
        else this.applyEnabled(id, expectEnabled);
        this.busyId = null;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.busyId = null;
        this.toast.error(this.session.mapHttpError(err?.status, this.extractMessage(err)));
        this.cdr.detectChanges();
      }
    });
  }

  private isMissingAccount(status?: number, detail?: string): boolean {
    if (status === 404) return true;
    const text = (detail || '').toLowerCase();
    return text.includes('not found') || text.includes('introuvable');
  }

  private extractMessage(err: unknown): string | undefined {
    const e = err as { error?: { message?: string; error?: string } | string };
    if (typeof e?.error === 'string') return e.error;
    if (e?.error?.message || e?.error?.error) return e.error.message || e.error.error;
    const first = e?.error ? Object.values(e.error).find((value) => typeof value === 'string') : undefined;
    return typeof first === 'string' ? first : undefined;
  }
}
