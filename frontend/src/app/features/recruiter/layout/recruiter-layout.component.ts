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
import { Subscription, finalize } from 'rxjs';

import { AuthService } from '../../../core/services/auth.service';
import {
  AppNotification,
  PlatformService
} from '../../../core/services/platform.service';
import { RecruiterSessionService } from '../data/recruiter-session.service';

@Component({
  selector: 'app-recruiter-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './recruiter-layout.component.html',
  styleUrl: './recruiter-layout.component.scss'
})
export class RecruiterLayoutComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly platform = inject(PlatformService);
  private readonly session = inject(RecruiterSessionService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  /** Signal partagé — photo visible sur toutes les pages recruteur. */
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

  readonly groups = [
    {
      label: 'Pilotage',
      items: [
        { label: 'Dashboard', path: '/recruiter/dashboard', icon: 'dashboard' }
      ]
    },
    {
      label: 'Recrutement',
      items: [
        { label: 'Mes offres', path: '/recruiter/offres', icon: 'offres' },
        { label: 'Candidatures', path: '/recruiter/candidatures', icon: 'candidatures' },
        { label: 'Matching IA', path: '/recruiter/matching', icon: 'matching' },
        { label: 'Tests techniques', path: '/recruiter/evaluations', icon: 'evaluations' }
      ]
    }
  ] as const;

  get user() {
    return this.session.me();
  }

  get displayName(): string {
    const u = this.user;
    if (!u) return 'Recruteur';
    const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
    return name || 'Recruteur';
  }

  get initials(): string {
    const u = this.user;
    if (!u) return 'R';
    const a = (u.firstName || '').trim().charAt(0);
    const b = (u.lastName || '').trim().charAt(0);
    return ((a + b) || 'R').toUpperCase();
  }

  get crumb(): { group: string; label: string } {
    const url = this.router.url.split('?')[0];
    if (url.includes('/dossier')) return { group: 'Recrutement', label: 'Profil' };
    if (url.includes('/offre/') || /\/offre$/.test(url)) {
      return { group: 'Recrutement', label: 'Offre' };
    }
    if (url.includes('/profile')) return { group: 'Compte', label: 'Profil' };
    for (const g of this.groups) {
      for (const item of g.items) {
        if (url === item.path || url.startsWith(item.path + '/')) {
          return { group: g.label, label: item.label };
        }
      }
    }
    return { group: 'Espace recruteur', label: 'Navigation' };
  }

  ngOnInit(): void {
    // Prefetch parallèle : identité + offres + photo (header partout).
    this.subs.add(this.session.ensureMe().subscribe({ error: () => undefined }));
    this.subs.add(this.session.ensureMyOffres().subscribe({ error: () => undefined }));
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
      // Badge masqué dès l’ouverture
      this.unread = 0;
      this.loadNotifications(true);
    }
  }

  refreshUnread(): void {
    this.platform.unreadCount().subscribe({
      next: (r) => {
        this.notifAvailable = true;
        this.unread = r.count ?? 0;
        this.cdr.detectChanges();
      },
      error: () => {
        this.notifAvailable = false;
        this.unread = 0;
        this.cdr.detectChanges();
      }
    });
  }

  loadNotifications(markAllRead = false): void {
    this.notifSub?.unsubscribe();
    this.notifError = '';
    this.notifLoading = true;
    this.cdr.markForCheck();
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
          if (markAllRead) {
            for (const n of this.notifications) {
              if (n.read) continue;
              this.platform.markNotificationRead(n.id).subscribe({
                next: () => {
                  n.read = true;
                  this.cdr.detectChanges();
                },
                error: () => undefined
              });
            }
          }
        },
        error: () => {
          this.notifAvailable = false;
          this.notifications = [];
          this.notifError =
            'Impossible de charger les notifications.';
        }
      });
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

  /** Clic notif → marquer lue + rediriger (ex. test passé → Sessions). */
  openNotification(n: AppNotification): void {
    if (!n.read) {
      this.platform.markNotificationRead(n.id).subscribe({
        next: () => {
          n.read = true;
          this.unread = Math.max(0, this.unread - 1);
          this.cdr.detectChanges();
        },
        error: () => undefined
      });
    }
    this.notifOpen = false;

    const key = (n.eventKey || '').trim();
    const submitted = key.match(
      /^TEST_SUBMITTED:(\d+)(?::offre:(\d+))?/i
    );
    const expired = key.match(
      /^TEST_EXPIRED:(\d+)(?::offre:(\d+))?(?::recruiter:\d+)?/i
    );

    if (submitted) {
      const queryParams: Record<string, string> = { sessions: 'todo' };
      if (submitted[2]) queryParams['offreId'] = submitted[2];
      void this.router.navigate(['/recruiter/evaluations'], { queryParams });
      return;
    }
    if (expired) {
      const queryParams: Record<string, string> = { sessions: 'expired' };
      if (expired[2]) queryParams['offreId'] = expired[2];
      void this.router.navigate(['/recruiter/evaluations'], { queryParams });
      return;
    }

    const title = (n.title || '').toLowerCase();
    if (
      title.includes('test technique passé') ||
      (title.includes('test') && title.includes('passé'))
    ) {
      void this.router.navigate(['/recruiter/evaluations'], {
        queryParams: { sessions: 'todo' }
      });
    }
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
