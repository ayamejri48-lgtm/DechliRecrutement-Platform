import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  inject
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Subscription, forkJoin, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

import { AuthService } from '../../../core/services/auth.service';
import {
  AppNotification,
  Candidature,
  Offre,
  PlatformService,
  User
} from '../../../core/services/platform.service';
import { AdminSessionService } from '../data/admin-session.service';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './admin-layout.component.html',
  styleUrl: './admin-layout.component.scss'
})
export class AdminLayoutComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly platform = inject(PlatformService);
  private readonly session = inject(AdminSessionService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly avatarUrl = this.session.avatarUrl;

  private subs = new Subscription();
  private notifSub?: Subscription;
  avatarBroken = false;

  unread = 0;
  notifications: AppNotification[] = [];
  notifOpen = false;
  notifAvailable = true;
  notifLoading = false;
  notifError = '';
  loggingOut = false;
  private offerTitles = new Map<number, string>();
  private people = new Map<number, string>();
  private candidatureLabels = new Map<number, { candidate: string; offer: string }>();

  readonly groups = [
    {
      label: 'Pilotage',
      items: [{ label: 'Tableau de bord', path: '/admin/dashboard', icon: 'dashboard' }]
    },
    {
      label: 'Comptes',
      items: [
        { label: 'Utilisateurs', path: '/admin/users', icon: 'users' },
        { label: 'Recruteurs', path: '/admin/recruiters', icon: 'recruiters' }
      ]
    },
    {
      label: 'Recrutement',
      items: [
        { label: 'Offres', path: '/admin/offres', icon: 'offres' },
        { label: 'Candidatures', path: '/admin/candidatures', icon: 'candidatures' },
        { label: 'Tests', path: '/admin/tests', icon: 'tests' }
      ]
    },
    {
      label: 'Contrôle',
      items: [{ label: 'Journal', path: '/admin/journal', icon: 'journal' }]
    }
  ] as const;

  get crumb(): { group: string; label: string } {
    const url = this.router.url.split('?')[0];
    if (url.includes('/dossier')) return { group: 'Recrutement', label: 'Profil' };
    if (url.startsWith('/admin/profile')) return { group: 'Compte', label: 'Profil' };
    for (const group of this.groups) {
      const item = group.items.find((entry) => url.startsWith(entry.path));
      if (item) return { group: group.label, label: item.label };
    }
    return { group: 'Admin', label: 'Supervision' };
  }

  get user() {
    return this.session.me();
  }

  get initials(): string {
    const u = this.user;
    if (!u) return 'A';
    return ((u.firstName?.[0] ?? '') + (u.lastName?.[0] ?? '')).toUpperCase() || 'A';
  }

  get displayName(): string {
    const u = this.user;
    if (!u) return 'Administrateur';
    return `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
  }

  ngOnInit(): void {
    this.subs.add(this.session.ensureMe().subscribe({ error: () => undefined }));
    this.subs.add(this.session.ensureUsers().subscribe({ error: () => undefined }));
    this.subs.add(this.session.ensureOffres().subscribe({ error: () => undefined }));
    this.subs.add(
      this.session.ensureAvatarPhoto().subscribe({
        next: () => this.cdr.detectChanges(),
        error: () => undefined
      })
    );
    this.refreshUnread();
  }

  onAvatarError(): void {
    this.avatarBroken = true;
    this.cdr.detectChanges();
  }

  ngOnDestroy(): void {
    this.notifSub?.unsubscribe();
    this.subs.unsubscribe();
  }

  @HostListener('document:click')
  onDocClick(): void {
    this.notifOpen = false;
  }

  toggleNotif(event: Event): void {
    event.stopPropagation();
    this.notifOpen = !this.notifOpen;
    if (this.notifOpen) {
      this.unread = 0;
      this.loadNotifications();
    }
  }

  refreshUnread(): void {
    this.platform.unreadCount().subscribe({
      next: (r) => {
        this.notifAvailable = true;
        if (!this.notifOpen) this.unread = r.count ?? 0;
        this.cdr.detectChanges();
      },
      error: () => {
        this.notifAvailable = false;
        this.unread = 0;
        this.cdr.detectChanges();
      }
    });
  }

  notifText(n: AppNotification): string {
    const key = (n.eventKey || '').trim();
    const offre = key.match(/^OFFRE_PUBLISHED:(\d+)/i);
    if (offre) {
      return this.offerTitles.get(Number(offre[1])) || this.nameAfterColon(n.message);
    }
    const candidature = key.match(/CANDIDATURE_CREATED[:_](\d+)/i);
    if (candidature) {
      const row = this.candidatureLabels.get(Number(candidature[1]));
      if (row) return `${row.candidate} — ${row.offer}`;
    }
    const cleaned = (n.message || '').replace(
      /offre\s*(?:n[°o.]?\s*|#)\s*(\d+)/gi,
      (_all, id: string) => this.offerTitles.get(Number(id)) || 'une offre'
    );
    return this.nameAfterColon(cleaned) || cleaned;
  }

  private nameAfterColon(message?: string): string {
    const text = (message || '').trim();
    const cut = text.lastIndexOf(':');
    if (cut < 0) return text;
    return text.slice(cut + 1).trim() || text;
  }

  private loadCatalogs(): void {
    forkJoin({
      offres: this.session.ensureOffres().pipe(catchError(() => of([] as Offre[]))),
      candidatures: this.session.ensureCandidatures().pipe(catchError(() => of([] as Candidature[]))),
      users: this.session.ensureUsers().pipe(catchError(() => of([] as User[])))
    }).subscribe(({ offres, candidatures, users }) => {
      this.offerTitles = new Map(offres.filter((o) => !!o.title).map((o) => [o.id, o.title]));
      this.people = new Map(
        users.flatMap((u) => {
          const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
          return name ? [[u.id, name] as const] : [];
        })
      );
      this.candidatureLabels = new Map(
        candidatures.map((c) => [
          c.id,
          {
            candidate: this.people.get(c.candidateId) || 'Un candidat',
            offer: c.offreTitle || this.offerTitles.get(c.offreId) || 'une offre'
          }
        ])
      );
      this.cdr.detectChanges();
    });
  }

  loadNotifications(): void {
    this.notifSub?.unsubscribe();
    this.notifError = '';
    this.notifLoading = true;
    this.loadCatalogs();
    this.cdr.detectChanges();
    this.notifSub = this.platform
      .notifications()
      .pipe(
        finalize(() => {
          this.notifLoading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (list) => {
          this.notifAvailable = true;
          this.notifications = list ?? [];
          this.markOpenedAsRead();
        },
        error: () => {
          this.notifAvailable = false;
          this.notifications = [];
          this.notifError = 'Impossible de charger les notifications.';
        }
      });
  }

  private markOpenedAsRead(): void {
    const pending = this.notifications.filter((n) => !n.read);
    if (!pending.length) return;
    this.unread = 0;
    for (const n of pending) {
      this.platform.markNotificationRead(n.id).subscribe({
        next: () => {
          n.read = true;
          this.cdr.detectChanges();
        },
        error: () => this.refreshUnread()
      });
    }
  }

  markRead(n: AppNotification, event: Event): void {
    event.stopPropagation();
    if (n.read) return;
    this.platform.markNotificationRead(n.id).subscribe({
      next: () => {
        n.read = true;
        this.unread = Math.max(0, this.unread - 1);
        this.cdr.detectChanges();
      },
      error: () => {
        this.notifError = 'Impossible de marquer la notification comme lue.';
        this.cdr.detectChanges();
      }
    });
  }

  logout(): void {
    if (this.loggingOut) return;
    this.loggingOut = true;
    this.session.clear();
    this.auth
      .logout()
      .pipe(finalize(() => (this.loggingOut = false)))
      .subscribe({
        next: () => void this.router.navigateByUrl('/login'),
        error: () => void this.router.navigateByUrl('/login')
      });
  }
}
