import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { matchingPasswords, passwordValidator } from '../../../shared/validators/password.validator';
@Component({selector:'app-reset-password',standalone:true,imports:[CommonModule,ReactiveFormsModule,RouterLink],templateUrl:'./reset-password.component.html',styleUrl:'./reset-password.component.scss'})
export class ResetPasswordComponent {
  private fb=inject(FormBuilder);private auth=inject(AuthService);private route=inject(ActivatedRoute);
  readonly token=this.route.snapshot.queryParamMap.get('token')||'';
  loading=signal(false);success=signal(false);error=signal('');showPassword=signal(false);
  form=this.fb.nonNullable.group({password:['',[Validators.required,passwordValidator]],confirmPassword:['',[Validators.required]]},{validators:matchingPasswords});
  submit(){this.error.set('');if(!this.token){this.error.set('Lien invalide : token absent.');return;}
    if(this.form.invalid){this.form.markAllAsTouched();return;}
    this.loading.set(true);this.auth.resetPassword(this.token,this.form.getRawValue().password).pipe(finalize(()=>this.loading.set(false))).subscribe({
      next:()=>this.success.set(true),error:e=>this.error.set(e.status===0?'Serveur inaccessible.':'Lien invalide ou expiré, ou mot de passe refusé. Demandez un nouveau lien.')
    });
  }
}
