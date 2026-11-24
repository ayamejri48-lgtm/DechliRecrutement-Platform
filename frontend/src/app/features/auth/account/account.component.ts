import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
@Component({selector:'app-account',standalone:true,imports:[CommonModule,RouterLink],templateUrl:'./account.component.html',styleUrl:'./account.component.scss'})
export class AccountComponent {
  readonly auth=inject(AuthService);private router=inject(Router);busy=signal(false);error=signal('');
  logout(){this.busy.set(true);this.auth.logout().pipe(finalize(()=>{this.busy.set(false);void this.router.navigateByUrl('/login');})).subscribe({error:()=>this.error.set('Déconnexion locale effectuée. Révocation serveur non confirmée.')});}
}
