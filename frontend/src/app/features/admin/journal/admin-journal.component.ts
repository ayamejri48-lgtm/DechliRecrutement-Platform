import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { finalize } from 'rxjs';

import { AdminAuditEntry, PlatformService } from '../../../core/services/platform.service';
import { ToastService } from '../../../core/services/toast.service';
import { AdminSessionService } from '../data/admin-session.service';

@Component({
  selector: 'app-admin-journal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-journal.component.html',
  styleUrl: './admin-journal.component.scss'
})
export class AdminJournalComponent implements OnInit {
  private readonly platform = inject(PlatformService);
  private readonly toast = inject(ToastService);
  private readonly session = inject(AdminSessionService);
  private readonly cdr = inject(ChangeDetectorRef);

  loading = true;
  error = '';
  rows: AdminAuditEntry[] = [];

  ngOnInit(): void {
    this.platform
      .adminAudit()
      .pipe(
        finalize(() => {
          this.loading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (rows) => (this.rows = rows ?? []),
        error: (err) => {
          this.toast.error(this.session.mapHttpError(err?.status));
        }
      });
  }

  actionLabel(code: string): string {
    return (
      { CREATE: 'Création', DEACTIVATE: 'Désactivation', REACTIVATE: 'Réactivation', DELETE: 'Suppression' } as Record<
        string,
        string
      >
    )[code] ?? code;
  }
}
