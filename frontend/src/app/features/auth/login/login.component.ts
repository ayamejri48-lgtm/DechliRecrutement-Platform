import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { roleHome } from '../../../core/guards/role.guard';
@Component({selector:'app-login',standalone:true,imports:[CommonModule,ReactiveFormsModule,RouterLink],templateUrl:'./login.component.html',styleUrl:'./login.component.scss'})
export class LoginComponent {
  private fb=inject(FormBuilder); private auth=inject(AuthService); private router=inject(Router);
  loading=signal(false); error=signal(''); showPassword=signal(false);
  form=this.fb.nonNullable.group({email:['',[Validators.required,Validators.email]],password:['',[Validators.required]]});
  invalid(key:string){const c=this.form.get(key);return !!c&&c.invalid&&(c.dirty||c.touched);}
  submit(){this.error.set('');if(this.form.invalid){this.form.markAllAsTouched();return;}
    this.loading.set(true);const {email,password}=this.form.getRawValue();
    this.auth.login(email,password).pipe(finalize(()=>this.loading.set(false))).subscribe({
      next:(session)=>void this.router.navigateByUrl(roleHome(session.role)),
      error:(e:HttpErrorResponse)=>this.error.set(e.status===0?'Serveur inaccessible. Vérifiez le Gateway.':e.status===401||e.status===403?'Identifiants incorrects ou compte non autorisé.':'Connexion impossible. Réessayez.')
    });
  }
}
