import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';

const workspace = () =>
  import('./features/workspace/workspace.component').then(
    (m) => m.WorkspaceComponent
  );

const recruiterLayout = () =>
  import('./features/recruiter/layout/recruiter-layout.component').then(
    (m) => m.RecruiterLayoutComponent
  );

const adminLayout = () =>
  import('./features/admin/layout/admin-layout.component').then(
    (m) => m.AdminLayoutComponent
  );

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/home/home.component').then((m) => m.HomeComponent)
  },
  {
    path: 'signup',
    loadComponent: () =>
      import('./features/auth/signup/signup.component').then(
        (m) => m.SignupComponent
      )
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then(
        (m) => m.LoginComponent
      )
  },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./features/auth/forgot-password/forgot-password.component').then(
        (m) => m.ForgotPasswordComponent
      )
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./features/auth/reset-password/reset-password.component').then(
        (m) => m.ResetPasswordComponent
      )
  },
  {
    path: 'account',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/auth/account/account.component').then(
        (m) => m.AccountComponent
      )
  },
  {
    path: 'offres/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/offre-detail/offre-detail.component').then(
        (m) => m.OffreDetailComponent
      )
  },

  // Espace CANDIDATE (Workspace) — tests inclus (même shell / sidebar)
  ...(['dashboard', 'offres', 'candidatures', 'tests', 'cv', 'profile'] as const).map(
    (s) => ({
      path: `candidate/${s}`,
      canActivate: [roleGuard('CANDIDATE')],
      loadComponent: workspace,
      data: { section: s === 'candidatures' ? 'applications' : s }
    })
  ),

  // Espace ADMIN indépendant
  {
    path: 'admin',
    canActivate: [roleGuard('ADMIN')],
    loadComponent: adminLayout,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import(
            './features/admin/dashboard/admin-dashboard.component'
          ).then((m) => m.AdminDashboardComponent)
      },
      {
        path: 'users',
        loadComponent: () =>
          import('./features/admin/users/admin-users.component').then(
            (m) => m.AdminUsersComponent
          )
      },
      {
        path: 'recruiters',
        loadComponent: () =>
          import(
            './features/admin/recruiters/admin-recruiters.component'
          ).then((m) => m.AdminRecruitersComponent)
      },
      {
        path: 'recruiters/:id',
        loadComponent: () =>
          import(
            './features/admin/recruiters/admin-recruiter-detail.component'
          ).then((m) => m.AdminRecruiterDetailComponent)
      },
      {
        path: 'offres',
        loadComponent: () =>
          import('./features/admin/offres/admin-offres.component').then(
            (m) => m.AdminOffresComponent
          )
      },
      {
        path: 'tests',
        loadComponent: () =>
          import('./features/admin/tests/admin-tests.component').then(
            (m) => m.AdminTestsComponent
          )
      },
      {
        path: 'journal',
        loadComponent: () =>
          import('./features/admin/journal/admin-journal.component').then(
            (m) => m.AdminJournalComponent
          )
      },
      {
        path: 'candidatures',
        loadComponent: () =>
          import(
            './features/admin/candidatures/admin-candidatures.component'
          ).then((m) => m.AdminCandidaturesComponent)
      },
      {
        path: 'candidatures/:id/dossier',
        loadComponent: () =>
          import(
            './features/admin/candidatures/admin-dossier.component'
          ).then((m) => m.AdminDossierComponent)
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('./features/admin/profile/admin-profile.component').then(
            (m) => m.AdminProfileComponent
          )
      }
    ]
  },

  // Espace RECRUITER indépendant
  {
    path: 'recruiter',
    canActivate: [roleGuard('RECRUITER')],
    loadComponent: recruiterLayout,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import(
            './features/recruiter/dashboard/recruiter-dashboard.component'
          ).then((m) => m.RecruiterDashboardComponent)
      },
      {
        path: 'offres',
        loadComponent: () =>
          import('./features/recruiter/offres/recruiter-offres.component').then(
            (m) => m.RecruiterOffresComponent
          )
      },
      {
        path: 'offre/new',
        loadComponent: () =>
          import(
            './features/recruiter/offres/recruiter-offre-form.component'
          ).then((m) => m.RecruiterOffreFormComponent)
      },
      {
        path: 'offre/:id/edit',
        loadComponent: () =>
          import(
            './features/recruiter/offres/recruiter-offre-form.component'
          ).then((m) => m.RecruiterOffreFormComponent)
      },
      {
        path: 'candidatures',
        loadComponent: () =>
          import(
            './features/recruiter/candidatures/recruiter-candidatures.component'
          ).then((m) => m.RecruiterCandidaturesComponent)
      },
      {
        path: 'candidatures/:id/dossier',
        loadComponent: () =>
          import(
            './features/recruiter/candidatures/recruiter-candidate-dossier.component'
          ).then((m) => m.RecruiterCandidateDossierComponent)
      },
      {
        path: 'matching',
        loadComponent: () =>
          import(
            './features/recruiter/matching/recruiter-matching.component'
          ).then((m) => m.RecruiterMatchingComponent)
      },
      {
        path: 'evaluations',
        loadComponent: () =>
          import(
            './features/recruiter/evaluations/recruiter-evaluations.component'
          ).then((m) => m.RecruiterEvaluationsComponent)
      },
      {
        path: 'profile',
        loadComponent: () =>
          import(
            './features/recruiter/profile/recruiter-profile.component'
          ).then((m) => m.RecruiterProfileComponent)
      }
    ]
  },

  { path: '**', redirectTo: '' }
];
