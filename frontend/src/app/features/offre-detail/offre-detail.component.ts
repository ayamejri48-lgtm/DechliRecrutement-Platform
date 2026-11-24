import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { PlatformService, Offre, Cv, Candidature } from '../../core/services/platform.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-offre-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  template: `
    <div class="detail-shell">
      <aside class="detail-sidebar">
        <div class="sidebar-top">
          <a routerLink="/" class="brand" aria-label="DechliRecrutement">
            <img src="assets/dechli-logo.png" alt="DechliRecrutement">
          </a>
          <span class="workspace-badge">Espace candidat</span>
        </div>

        <nav class="sidebar-nav" aria-label="Navigation principale">
          <p class="nav-caption">Menu</p>
          <a routerLink="/candidate/dashboard">
            <span class="nav-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10h-6v-7H9v7H3z"/></svg></span>
            <span class="nav-label">Tableau de bord</span>
          </a>
          <a routerLink="/candidate/offres" class="active">
            <span class="nav-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/></svg></span>
            <span class="nav-label">Offres d'emploi</span>
          </a>
          <a routerLink="/candidate/candidatures">
            <span class="nav-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m12 2 9 5-9 5-9-5 9-5Zm-9 10 9 5 9-5M3 17l9 5 9-5"/></svg></span>
            <span class="nav-label">Mes candidatures</span>
          </a>
          <a routerLink="/candidate/cv">
            <span class="nav-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm9 0v6h5M8 13h8M8 17h8"/></svg></span>
            <span class="nav-label">Mon CV</span>
          </a>
          <a routerLink="/candidate/profile">
            <span class="nav-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2z"/></svg></span>
            <span class="nav-label">Mon profil</span>
          </a>
        </nav>
      </aside>

      <main class="detail-main">
        <header class="detail-top">
          <p class="breadcrumb">DechliRecrutement / Candidat / <strong>Offres d’emploi</strong></p>
          <a class="back" routerLink="/candidate/offres">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18 9 12l6-6"/></svg>
            Retour aux offres
          </a>
        </header>

        <div *ngIf="loading()" class="state-box">Chargement de l'offre…</div>
        <div *ngIf="error()" class="error" role="alert">{{error()}}</div>

        <ng-container *ngIf="offre() as o">
          <section class="job-hero">
            <div class="job-mark" aria-hidden="true">{{ o.title ? o.title.charAt(0) : 'O' }}</div>
            <div class="job-hero-copy">
              <h1>{{o.title}}</h1>
              <div class="hero-chips">
                <span>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>
                  {{o.location}}
                </span>
                <span>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  {{labelContract(o.contractType)}}
                </span>
                <span>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 20h8M12 18v2"/></svg>
                  {{labelWorkMode(o.workMode)}}
                </span>
              </div>
            </div>
            <div class="job-hero-cta" *ngIf="auth.currentSession()?.role === 'CANDIDATE'">
              <button
                type="button"
                class="primary"
                [disabled]="!canApply(o) || alreadyApplied()"
                (click)="openModal()">
                {{ alreadyApplied() ? 'Déjà candidaté' : canApply(o) ? 'Postuler' : 'Indisponible' }}
                <svg *ngIf="canApply(o) && !alreadyApplied()" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
              </button>
            </div>
          </section>

          <div class="detail-grid">
            <article class="detail-card">
              <h2>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
                Description du poste
              </h2>
              <p class="description">{{o.description}}</p>
            </article>

            <aside class="detail-aside">
              <article class="detail-card profile-card">
                <h2>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2z"/></svg>
                  Profil recherché
                </h2>
                <div class="facts">
                  <div>
                    <span class="fact-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2z"/></svg></span>
                    <span>Expérience</span>
                    <strong>{{o.experienceYears}} an(s)</strong>
                  </div>
                  <div>
                    <span class="fact-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 19h16M7 16V9l5-4 5 4v7"/></svg></span>
                    <span>Études</span>
                    <strong>{{o.educationLevel || 'Non précisé'}}</strong>
                  </div>
                  <div>
                    <span class="fact-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></span>
                    <span>Contrat</span>
                    <strong>{{labelContract(o.contractType)}}</strong>
                  </div>
                  <div>
                    <span class="fact-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 20h8M12 18v2"/></svg></span>
                    <span>Mode</span>
                    <strong>{{labelWorkMode(o.workMode)}}</strong>
                  </div>
                  <div *ngIf="o.deadline">
                    <span class="fact-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/></svg></span>
                    <span>Date limite</span>
                    <strong>{{o.deadline | date:'dd/MM/yyyy'}}</strong>
                  </div>
                </div>
              </article>

              <div class="apply-card" *ngIf="auth.currentSession()?.role === 'CANDIDATE'">
                <strong *ngIf="!alreadyApplied()">Cette offre vous parle&nbsp;?</strong>
                <strong *ngIf="alreadyApplied()">Candidature envoyée</strong>
                <p *ngIf="!alreadyApplied()">Postulez en quelques clics avec l’un de vos CV.</p>
                <p *ngIf="alreadyApplied()">Vous pouvez suivre son statut dans Mes candidatures.</p>
                <button
                  type="button"
                  class="primary"
                  *ngIf="!alreadyApplied()"
                  [disabled]="!canApply(o)"
                  (click)="openModal()">
                  Postuler maintenant
                </button>
                <a *ngIf="alreadyApplied()" routerLink="/candidate/candidatures" class="secondary-link">Voir mes candidatures →</a>
              </div>
            </aside>
          </div>
        </ng-container>
      </main>
    </div>

    <div class="modal-backdrop" *ngIf="showModal()" (click)="closeModal()" role="presentation">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="apply-title" (click)="$event.stopPropagation()">
        <button type="button" class="modal-close" (click)="closeModal()" aria-label="Fermer">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
        </button>
        <p class="modal-kicker">Candidature</p>
        <h2 id="apply-title">Postuler à cette offre</h2>
        <p class="modal-subtitle">{{offre()?.title}} · {{offre()?.location}}</p>
        <label for="cv-select">Choisissez votre CV</label>
        <select id="cv-select" [(ngModel)]="cvId">
          <option [ngValue]="0">Sélectionner un CV</option>
          <option *ngFor="let c of cvs()" [ngValue]="c.id">{{c.fileName}}{{c.active ? ' (actif)' : ''}}</option>
        </select>
        <p class="info" *ngIf="!cvs().length">Aucun CV enregistré. <a routerLink="/candidate/cv">Importer un CV</a></p>
        <p *ngIf="message()" class="info warn" role="status">{{message()}}</p>
        <div class="modal-actions">
          <button type="button" class="secondary" (click)="closeModal()" [disabled]="submitting()">Annuler</button>
          <button type="button" class="primary" (click)="apply()" [disabled]="!cvId || submitting()">
            {{submitting() ? 'Envoi…' : 'Confirmer'}}
          </button>
        </div>
      </section>
    </div>

    <div class="success-toast" *ngIf="success()" role="status">
      Candidature envoyée avec succès.
      <a routerLink="/candidate/candidatures">Mes candidatures →</a>
    </div>
  `,
  styles: [`
    :host{
      display:block;
      color:var(--ink,#0e2426);
      --ink:#0e2426;
      --muted:#5a6f6d;
      --teal:#156e68;
      --teal-deep:#0a4542;
      --line:#e2ece9;
      --shadow:0 4px 18px rgba(14,36,38,.05);
    }
    .detail-shell{display:flex;min-height:100vh;background:var(--paper,#f2f5f4)}

    .detail-sidebar{
      width:260px;flex-shrink:0;position:sticky;top:0;height:100vh;
      display:flex;flex-direction:column;padding:0;overflow:hidden;
      background:
        radial-gradient(120% 60% at 0% 0%, rgba(13,138,134,.09), transparent 55%),
        linear-gradient(180deg,#fff 0%,#f7fbfa 100%);
      border-right:1px solid #e6eef0;
    }
    .sidebar-top{
      display:grid;gap:14px;justify-items:center;
      padding:26px 20px 20px;border-bottom:1px solid #e8f0f0;
    }
    .brand{display:flex;justify-content:center}
    .brand img{width:178px;max-width:100%;max-height:64px;object-fit:contain}
    .workspace-badge{
      display:inline-flex;align-items:center;justify-content:center;
      padding:6px 12px;border-radius:999px;background:#e7f5f3;color:#0d6f6b;
      font-size:10px;font-weight:750;letter-spacing:.06em;text-transform:uppercase;
    }
    .sidebar-nav{display:grid;gap:4px;padding:18px 14px;align-content:start;overflow:auto;flex:1}
    .nav-caption{
      margin:0 8px 8px;font-size:10px;font-weight:750;letter-spacing:.1em;
      text-transform:uppercase;color:#8aa0a8;
    }
    .sidebar-nav a{
      display:flex;align-items:center;gap:12px;min-height:46px;
      padding:10px 12px 10px 14px;border-radius:12px;
      color:#2a4554;text-decoration:none;font-size:13.5px;font-weight:600;
      outline:none;transition:background .16s,color .16s;
    }
    .sidebar-nav a:hover{background:rgba(13,138,134,.07);color:#0b5f5c}
    .sidebar-nav a.active{
      background:#dff3f0;color:#0a5c59;font-weight:700;
      box-shadow:inset 3px 0 0 #0d8a86;
    }
    .nav-ico{
      width:32px;height:32px;flex:0 0 32px;display:grid;place-items:center;
      border-radius:9px;color:#4d6a74;
    }
    .sidebar-nav a.active .nav-ico{
      background:#fff;color:#0b6a67;box-shadow:0 1px 4px rgba(13,90,88,.08);
    }
    .nav-ico svg{
      width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.85;
      stroke-linecap:round;stroke-linejoin:round;
    }
    .nav-label{min-width:0;line-height:1.3}

    .detail-main{flex:1;min-width:0;padding:26px 44px 42px;display:grid;gap:18px;align-content:start}
    .detail-top{display:grid;gap:8px}
    .breadcrumb{margin:0;font-size:13px;color:#728799}
    .breadcrumb strong{color:var(--ink)}
    .back{
      display:inline-flex;align-items:center;gap:6px;width:max-content;
      color:var(--teal-deep);text-decoration:none;font-weight:700;font-size:13px;
    }
    .back svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .back:hover{color:var(--teal)}

    .state-box{
      padding:28px;text-align:center;color:var(--muted);background:#fff;
      border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);
    }
    .error{padding:14px 16px;background:#fff0ee;color:#a33b30;border-radius:10px}

    .job-hero{
      display:flex;align-items:center;gap:18px;flex-wrap:wrap;
      padding:22px 24px;border-radius:18px;background:#fff;
      border:1px solid var(--line);box-shadow:var(--shadow);
    }
    .job-mark{
      width:56px;height:56px;flex:0 0 56px;display:grid;place-items:center;
      border-radius:16px;background:linear-gradient(145deg,#e4efed,#d5e0dd);
      color:var(--teal-deep);font-size:22px;font-weight:800;
    }
    .job-hero-copy{flex:1;min-width:200px}
    .job-hero-copy h1{
      margin:0 0 12px;font-size:clamp(24px,2.6vw,32px);letter-spacing:-.6px;
      font-weight:800;color:#173845;line-height:1.15;
    }
    .hero-chips{display:flex;flex-wrap:wrap;gap:8px}
    .hero-chips span{
      display:inline-flex;align-items:center;gap:6px;
      padding:7px 12px;border-radius:999px;background:#f4f9f8;
      border:1px solid #e2ece9;font-size:12px;font-weight:650;color:#3f5f5c;
    }
    .hero-chips svg{
      width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.8;
      stroke-linecap:round;stroke-linejoin:round;color:var(--teal);
    }
    .job-hero-cta{margin-left:auto}
    .job-hero-cta .primary{display:inline-flex;align-items:center;gap:8px}

    .detail-grid{
      display:grid;grid-template-columns:minmax(0,1.55fr) minmax(280px,1fr);
      gap:18px;align-items:start;
    }
    .detail-aside{display:grid;gap:14px}
    .detail-card{
      background:#fff;padding:24px 26px;border-radius:16px;
      border:1px solid var(--line);box-shadow:var(--shadow);min-width:0;
    }
    .detail-card h2{
      display:flex;align-items:center;gap:10px;font-size:17px;
      margin:0 0 16px;color:#173845;font-weight:800;
    }
    .detail-card h2 svg{
      width:20px;height:20px;flex:0 0 20px;fill:none;stroke:currentColor;
      stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;color:var(--teal);
    }
    .description{white-space:pre-wrap;line-height:1.8;color:#4a6866;font-size:14px;margin:0}

    .facts{display:grid;gap:0}
    .facts>div{
      display:grid;grid-template-columns:28px 1fr auto;align-items:center;
      gap:10px;border-bottom:1px solid #edf3f2;padding:13px 0;
    }
    .facts>div:last-child{border-bottom:0}
    .fact-ico{
      width:28px;height:28px;display:grid;place-items:center;border-radius:8px;
      background:#eef7f5;color:var(--teal);
    }
    .fact-ico svg{
      width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;
      stroke-linecap:round;stroke-linejoin:round;
    }
    .facts>div>span:not(.fact-ico){color:#5a7270;font-size:12px;font-weight:600}
    .facts strong{font-size:13px;color:#173845;text-align:right}

    .apply-card{
      padding:20px 22px;border-radius:16px;
      background:linear-gradient(145deg,#eef8f6,#e2f2ef);
      border:1px solid #d5e8e4;display:grid;gap:8px;
    }
    .apply-card strong{font-size:15px;color:#173845}
    .apply-card p{margin:0 0 6px;font-size:13px;color:#4a6866;line-height:1.45}
    .apply-card .primary{width:100%;justify-content:center}
    .secondary-link{
      color:var(--teal-deep);font-size:13px;font-weight:700;text-decoration:none;
    }
    .secondary-link:hover{text-decoration:underline}

    .primary,.secondary{
      border:0;border-radius:11px;padding:12px 18px;font-weight:700;
      cursor:pointer;font-size:13px;min-height:44px;
    }
    .primary{
      background:var(--teal-deep);color:#fff;
      display:inline-flex;align-items:center;justify-content:center;gap:8px;
    }
    .primary svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .primary:not(:disabled):hover{background:var(--teal)}
    .primary:disabled{opacity:.55;cursor:not-allowed}
    .secondary{background:#e8f4f1;color:#166d6a}

    .modal-backdrop{
      position:fixed;inset:0;background:#0a233a99;display:grid;place-items:center;
      padding:16px;z-index:100;backdrop-filter:blur(3px);
    }
    .modal{
      background:#fff;border-radius:18px;padding:28px;width:min(460px,100%);
      position:relative;box-shadow:0 24px 70px #092b3750;
    }
    .modal-kicker{
      margin:0 0 6px;font-size:11px;font-weight:750;letter-spacing:.08em;
      text-transform:uppercase;color:var(--teal);
    }
    .modal h2{margin:0 0 6px;font-size:22px;letter-spacing:-.4px;color:#173845}
    .modal-subtitle{color:var(--muted);margin:0;font-size:13px}
    .modal label{display:block;margin:22px 0 9px;font-weight:700;font-size:13px;color:var(--ink)}
    .modal select{
      width:100%;border:1px solid #d5e3e0;border-radius:10px;padding:12px;
      min-height:47px;background:#fff;color:#203d51;font-size:13px;
    }
    .modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:24px}
    .modal-close{
      position:absolute;right:14px;top:14px;border:0;background:#f4f8f7;
      width:34px;height:34px;border-radius:10px;display:grid;place-items:center;
      cursor:pointer;color:#4d6d69;padding:0;
    }
    .modal-close svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
    .info{padding:12px 0 0;color:#476c68;font-size:13px;margin:0}
    .info.warn{color:#a3453a}
    .info a{color:var(--teal-deep);font-weight:700}

    .success-toast{
      position:fixed;right:24px;bottom:24px;padding:16px 20px;
      background:#e1f7ee;border:1px solid #a8d7c9;border-radius:12px;
      box-shadow:0 12px 35px #103e341c;z-index:101;font-size:14px;color:#17395a;
    }
    .success-toast a{color:var(--teal-deep);margin-left:10px;font-weight:700;text-decoration:none}

    :host a:focus-visible,:host button:focus-visible,:host select:focus-visible{
      outline:3px solid #72c8c0;outline-offset:2px;
    }

    @media(max-width:1050px){
      .detail-grid{grid-template-columns:1fr}
      .job-hero-cta{margin-left:0;width:100%}
      .job-hero-cta .primary{width:100%}
    }
    @media(max-width:850px){
      .detail-shell{display:block}
      .detail-sidebar{width:100%;height:auto;position:static;overflow:visible}
      .sidebar-top{
        display:flex;align-items:center;justify-content:space-between;
        gap:12px;padding:14px 16px;
      }
      .brand img{width:140px;max-height:48px}
      .sidebar-nav{display:flex;overflow:auto;gap:6px;padding:8px 12px 12px;flex:none}
      .nav-caption{display:none}
      .sidebar-nav a{white-space:nowrap;flex:0 0 auto;min-height:40px;box-shadow:none!important}
      .detail-main{padding:18px}
      .job-hero{padding:18px}
    }
  `]
})
export class OffreDetailComponent implements OnInit {
  api = inject(PlatformService);
  auth = inject(AuthService);
  route = inject(ActivatedRoute);

  offre = signal<Offre | null>(null);
  cvs = signal<Cv[]>([]);
  applications = signal<Candidature[]>([]);
  loading = signal(true);
  error = signal('');
  message = signal('');
  showModal = signal(false);
  submitting = signal(false);
  success = signal(false);
  cvId = 0;

  ngOnInit() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.api.offre(id).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: o => this.offre.set(o),
      error: () => this.error.set('Offre indisponible ou accès refusé.')
    });
    if (this.auth.currentSession()?.role === 'CANDIDATE') {
      this.api.cvs().subscribe({
        next: c => {
          this.cvs.set(c);
          this.cvId = c.find(x => x.active)?.id || c[0]?.id || 0;
        }
      });
      this.api.myApplications().subscribe({ next: c => this.applications.set(c) });
    }
  }

  labelWorkMode(mode: string): string {
    return ({
      HYBRID: 'Hybride',
      REMOTE: 'À distance',
      ONSITE: 'Sur site',
      ON_SITE: 'Sur site'
    } as Record<string, string>)[mode] || mode;
  }

  labelContract(type: string): string {
    return ({
      CDI: 'CDI',
      CDD: 'CDD',
      Stage: 'Stage',
      INTERNSHIP: 'Stage'
    } as Record<string, string>)[type] || type;
  }

  alreadyApplied() {
    return this.applications().some(
      c => c.offreId === this.offre()?.id && c.status !== 'WITHDRAWN'
    );
  }

  canApply(o: Offre) {
    return (
      o.status === 'PUBLISHED' &&
      (!o.deadline || new Date(o.deadline).getTime() >= new Date().setHours(0, 0, 0, 0))
    );
  }

  openModal() {
    if (this.offre() && this.canApply(this.offre()!) && !this.alreadyApplied()) {
      this.message.set('');
      this.showModal.set(true);
    }
  }

  closeModal() {
    if (!this.submitting()) this.showModal.set(false);
  }

  apply() {
    if (!this.cvId || this.submitting() || !this.offre() || this.alreadyApplied()) return;
    this.submitting.set(true);
    this.message.set('');
    this.api.apply(this.offre()!.id, this.cvId).pipe(finalize(() => this.submitting.set(false))).subscribe({
      next: () => {
        this.applications.update(v => [
          ...v,
          {
            id: 0,
            offreId: this.offre()!.id,
            candidateId: 0,
            cvId: this.cvId,
            status: 'PENDING',
            appliedAt: new Date().toISOString()
          }
        ]);
        this.showModal.set(false);
        this.success.set(true);
      },
      error: () =>
        this.message.set(
          'Envoi impossible : vérifiez le CV, le statut de l’offre ou une candidature existante.'
        )
    });
  }
}
