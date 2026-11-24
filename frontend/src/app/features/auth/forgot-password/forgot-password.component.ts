import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
@Component({selector:'app-forgot-password',standalone:true,imports:[CommonModule,ReactiveFormsModule,RouterLink],templateUrl:'./forgot-password.component.html',styleUrl:'./forgot-password.component.scss'})
export class ForgotPasswordComponent {
  private fb=inject(FormBuilder);private auth=inject(AuthService);
  loading=signal(false);success=signal(false);error=signal('');
  form=this.fb.nonNullable.group({email:['',[Validators.required,Validators.email]]});
  submit(){this.error.set('');if(this.form.invalid){this.form.markAllAsTouched();return;}
    this.loading.set(true);this.auth.forgotPassword(this.form.getRawValue().email).pipe(finalize(()=>this.loading.set(false))).subscribe({
      next:()=>this.success.set(true),error:e=>this.error.set(e.status===0?'Serveur inaccessible.':'Demande impossible pour le moment. Réessayez plus tard.')
    });
  }
}
