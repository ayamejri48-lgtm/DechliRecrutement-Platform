import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({ selector: 'app-home', standalone: true, imports: [RouterLink, FormsModule], templateUrl: './home.component.html', styleUrl: './home.component.scss' })
export class HomeComponent {
  private router = inject(Router);
  private auth = inject(AuthService);
  menuOpen = signal(false);
  job = '';
  location = '';
  toggleMenu(): void { this.menuOpen.update(v => !v); }
  closeMenu(): void { this.menuOpen.set(false); }
  searchJobs(): void {
    const queryParams = { job: this.job.trim() || null, location: this.location.trim() || null };
    const target = this.router.createUrlTree(['/candidate/offres'], { queryParams }).toString();
    const role = this.auth.currentSession()?.role;
    if (role === 'CANDIDATE') this.router.navigateByUrl(target);
    else this.router.navigate(['/login'], { queryParams: { returnUrl: target } });
  }
}
