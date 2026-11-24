
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';


export interface Offre {
  id: number;
  recruiterId: number;
  title: string;
  description: string;
  location: string;
  contractType: string;
  workMode: string;
  experienceYears: number;
  educationLevel: string;
  deadline: string;
  /** Nombre de postes ouverts (plafond d'acceptations). */
  postes?: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Candidature {
  id: number;
  offreId: number;
  offreTitle?: string;
  candidateId: number;
  cvId: number;
  status: string;
  appliedAt: string;
  updatedAt?: string;
  /** 0–1 si le matching est terminé. Présent sur le catalogue admin. */
  matchScore?: number | null;
  matchBand?: string | null;
}

export interface AdminUserStats {
  total: number;
  active: number;
  disabled: number;
  candidates: number;
  recruiters: number;
  admins: number;
}

export interface AdminDayVolume {
  date: string;
  count: number;
}

export interface AdminOffreStats {
  offres: number;
  published: number;
  draft: number;
  closed: number;
  candidatures: number;
  pending: number;
  underReview: number;
  accepted: number;
  rejected: number;
  withdrawn: number;
  volume7d: AdminDayVolume[];
  matchLow: number;
  matchMedium: number;
  matchHigh: number;
  matchUnavailable: number;
  matchPending: number;
  matchFailed: number;
  matchAbsent: number;
  decisionDelayDays: number | null;
  decisionSamples: number;
  draftsWithoutSkills: number;
  publishedPastDeadline: number;
  publishedWithoutCandidature: number;
  staleOpen: number;
  publishedOffreIds: number[];
}

export interface AdminAuditEntry {
  id: number;
  actorEmail: string;
  action: string;
  targetUserId: number;
  targetEmail: string;
  createdAt: string;
}

/** Dossier recruteur — GET /candidatures/{id}/dossier */
export interface CandidateDossier {
  candidatureId: number;
  offreId: number;
  offreTitle: string;
  status: string;
  appliedAt: string;
  candidateId: number;
  firstName: string;
  lastName: string;
  description?: string | null;
  skills: Array<{ id: number; name: string; level?: string }>;
  experiences: Array<{
    id: number;
    jobTitle: string;
    company: string;
    description?: string;
    startDate?: string;
    endDate?: string;
  }>;
  educations: Array<{
    id: number;
    institution: string;
    degree: string;
    fieldOfStudy?: string;
    startDate?: string;
    endDate?: string;
  }>;
  /** Absent si le CV snapshot est introuvable / incohérent. */
  cv?: {
    id: number;
    fileName: string;
    contentType?: string;
    fileSize?: number;
    version?: number;
    active?: boolean;
    visible?: boolean;
  } | null;
}

/** Compétences rattachées à une offre (Offre-Service). */
export interface OffreSkill {
  id: number;
  offreId: number;
  name: string;
  level: string;
  required: boolean;
}

/** Features matching IA (Offre-Service MatchResult.features). */
export interface MatchFeatures {
  skills_coverage?: number | null;
  required_skills_coverage?: number | null;
  experience_match?: number | null;
  education_match?: number | null;
  semantic_similarity?: number | null;
  title_similarity?: number | null;
  critical_skills_missing?: number;
  matchedSkills?: string[];
  missingSkills?: string[];
  missingRequiredSkills?: string[];
}

export type MatchScoreBand = 'low' | 'medium' | 'high' | 'unavailable';
export type MatchResultStatus = 'PENDING' | 'DONE' | 'FAILED';

/** Résultat matching persisté — GET/POST /candidatures/{id}/match, GET /offres/{id}/matches. */
export interface MatchResult {
  id: number;
  candidatureId: number;
  offreId: number;
  cvId: number;
  candidateId?: number | null;
  score: number | null;
  scoreBand: MatchScoreBand | string | null;
  features?: MatchFeatures | null;
  explanations?: string[] | null;
  method?: string | null;
  modelVersion?: string | null;
  status: MatchResultStatus | string;
  errorCode?: string | null;
  errorMessage?: string | null;
  rank?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export type OffreSkillRequest = {
  name: string;
  level: string;
  required: boolean;
};

/** Liste légère candidats (User-Service GET /users/candidates). */
export interface CandidateSummary {
  id: number;
  firstName: string;
  lastName: string;
}

/** Statuts autorisés pour PATCH /candidatures/{id}/status (recruteur). */
export type RecruiterCandidatureDecision =
  | 'UNDER_REVIEW'
  | 'ACCEPTED'
  | 'REJECTED';

export interface Cv {
  id: number;
  fileName: string;
  fileSize: number;
  active: boolean;
  createdAt: string;
}

export interface User {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role?: string;
  enabled?: boolean;
  profilePicture?: string;
  description?: string | null;
}

/** Réponse Auth-Service création / cycle de vie compte. */
export interface AuthUserResponse {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  status?: string;
}

export type AdminCreateUserBody = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone?: string;
  role: 'ADMIN' | 'RECRUITER';
};

export type SkillLevel =
  | 'BEGINNER'
  | 'INTERMEDIATE'
  | 'ADVANCED'
  | 'EXPERT';

export interface CandidateSkill {
  id: number;
  name: string;
  level: SkillLevel;
  createdAt: string;
  updatedAt: string;
}

export interface AppNotification {
  id: number;
  recipientId: number;
  title: string;
  message: string;
  read: boolean;
  eventKey: string;
  createdAt: string;
}

export interface Experience {
  id: number;
  jobTitle: string;
  company: string;
  startDate: string;
  endDate: string | null;
  description: string | null;
}

export type ExperienceRequest = Omit<Experience, 'id'>;

export interface Education {
  id: number;
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startDate: string;
  endDate: string | null;
}

export type EducationRequest = Omit<Education, 'id'>;


export interface OffreSearchParams {
  title?: string;
  location?: string;
  contractType?: string;
  workMode?: string;
  maxExperience?: number;
  educationLevel?: string;
  status?: string;
  page?: number;
  size?: number;
  sort?: 'recent' | 'oldest' | 'title';
}

export interface PageResponse<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
  first: boolean;
  last: boolean;
}


@Injectable({ providedIn: 'root' })
export class PlatformService {

  private http = inject(HttpClient);

  // OFFRES

  offres() {
    return this.http.get<Offre[]>('/offres');
  }

  /** Offres du recruteur connecté (RECRUITER) — tous statuts, ownership serveur. */
  offresMine() {
    return this.http.get<Offre[]>('/offres/mine');
  }

  /** Ids des brouillons sans compétence — ADMIN, une requête. */
  draftsWithoutSkills() {
    return this.http.get<number[]>('/offres/admin/drafts-without-skills');
  }

  adminUserStats() {
    return this.http.get<AdminUserStats>('/auth/admin/stats');
  }

  adminOffreStats() {
    return this.http.get<AdminOffreStats>('/offres/admin/stats');
  }

  offre(id: number) {
    return this.http.get<Offre>('/offres/' + id);
  }

  createOffre(body: Partial<Offre>) {
    return this.http.post<Offre>('/offres', body);
  }

  updateOffre(id: number, body: Partial<Offre>) {
    return this.http.put<Offre>('/offres/' + id, body);
  }

  publishOffre(id: number) {
    return this.http.patch('/offres/' + id + '/publish', {});
  }

  closeOffre(id: number) {
    return this.http.patch('/offres/' + id + '/close', {});
  }

  removeOffre(id: number) {
    return this.http.delete('/offres/' + id);
  }

  
searchOffres(filters: OffreSearchParams = {}) {
  let params = new HttpParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params = params.set(key, String(value));
    }
  });

  return this.http.get<PageResponse<Offre>>(
    '/offres/search',
    { params }
  );
}


  // CANDIDATURES

  myApplications() {
    return this.http.get<Candidature[]>('/candidatures/me');
  }

  apply(offreId: number, cvId: number) {
    return this.http.post('/candidatures', { offreId, cvId });
  }

  withdraw(id: number) {
    return this.http.patch('/candidatures/' + id + '/withdraw', {});
  }

  /** Candidatures d'une offre — ADMIN / RECRUITER owner. */
  candidaturesByOffre(offreId: number) {
    return this.http.get<Candidature[]>('/candidatures/offre/' + offreId);
  }

  /** Catalogue candidatures — ADMIN uniquement (1 requête). */
  candidaturesAdmin() {
    return this.http.get<Candidature[]>('/candidatures/admin');
  }

  /** Création ADMIN/RECRUITER — Auth-Service. */
  adminCreateUser(body: AdminCreateUserBody) {
    return this.http.post<AuthUserResponse>('/auth/users', body);
  }

  /**
   * Garantit le profil User-Service après création Auth (filet Kafka).
   * Idempotent sur l’id Auth.
   */
  adminBootstrapUserProfile(body: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
    phone?: string;
  }) {
    return this.http.post<User>('/users/bootstrap', body);
  }

  /** Création candidat — Auth-Service (ADMIN ou RECRUITER). */
  adminCreateCandidate(body: Omit<AdminCreateUserBody, 'role'>) {
    return this.http.post<AuthUserResponse>('/auth/candidates', {
      ...body,
      role: 'CANDIDATE'
    });
  }

  adminDeactivateUser(id: number) {
    return this.http.patch<void>(`/auth/users/${id}/deactivate`, {});
  }

  adminReactivateUser(id: number) {
    return this.http.patch<void>(`/auth/users/${id}/reactivate`, {});
  }

  adminDeleteUser(id: number) {
    return this.http.delete<void>(`/auth/users/${id}`);
  }

  /** Profil sans compte d'authentification : désactivation locale. */
  adminSetPresence(id: number, enabled: boolean) {
    return this.http.patch<void>(`/users/${id}/presence`, { enabled });
  }

  /** Profil sans compte d'authentification : suppression locale. */
  adminDeleteProfile(id: number) {
    return this.http.delete<void>(`/users/${id}/profile`);
  }

  /** Dernières actions admin sur les comptes. ADMIN uniquement. */
  adminAudit() {
    return this.http.get<AdminAuditEntry[]>('/auth/admin/audit');
  }

  /** Décision recruteur : UNDER_REVIEW | ACCEPTED | REJECTED. */
  updateCandidatureStatus(
    id: number,
    status: RecruiterCandidatureDecision
  ) {
    return this.http.patch('/candidatures/' + id + '/status', { status });
  }

  /** Dossier candidat (ownership serveur) — CAND-PROFIL. */
  candidatureDossier(candidatureId: number) {
    return this.http.get<CandidateDossier>(
      '/candidatures/' + candidatureId + '/dossier'
    );
  }

  /** PDF du CV snapshot de la candidature. */
  candidatureCvBlob(candidatureId: number) {
    return this.http.get('/candidatures/' + candidatureId + '/cv', {
      responseType: 'blob'
    });
  }

  // MATCHING IA (orchestration Offre-Service — jamais AI-Service direct)

  /** Calcule ou recalcule le matching d'une candidature. */
  computeMatch(candidatureId: number, force = false) {
    const params = new HttpParams().set('force', String(force));
    return this.http.post<MatchResult>(
      '/candidatures/' + candidatureId + '/match',
      {},
      { params }
    );
  }

  /** Dernier MatchResult persisté pour une candidature. */
  getMatch(candidatureId: number) {
    return this.http.get<MatchResult>(
      '/candidatures/' + candidatureId + '/match'
    );
  }

  /** Classement des MatchResult d'une offre (owner / ADMIN). */
  offreMatches(offreId: number) {
    return this.http.get<MatchResult[]>('/offres/' + offreId + '/matches');
  }

  // COMPÉTENCES D'OFFRE

  offreSkills(offreId: number) {
    return this.http.get<OffreSkill[]>('/offres/' + offreId + '/skills');
  }

  addOffreSkill(offreId: number, body: OffreSkillRequest) {
    return this.http.post('/offres/' + offreId + '/skills', body);
  }

  updateOffreSkill(
    offreId: number,
    skillId: number,
    body: OffreSkillRequest
  ) {
    return this.http.put(
      '/offres/' + offreId + '/skills/' + skillId,
      body
    );
  }

  removeOffreSkill(offreId: number, skillId: number) {
    return this.http.delete(
      '/offres/' + offreId + '/skills/' + skillId
    );
  }

  /** Annuaire candidats (id, prénom, nom) — ADMIN / RECRUITER. */
  candidates() {
    return this.http.get<CandidateSummary[]>('/users/candidates');
  }

  // UTILISATEURS ET DESCRIPTION

  me() {
    return this.http.get<User>('/users/me');
  }

  updateUser(
    id: number,
    body: {
      firstName: string;
      lastName: string;
      phone?: string;
      profilePicture?: string;
      description?: string | null;
    }
  ) {
    return this.http.put<User>('/users/' + id, body);
  }

  users() {
    // anti-cache navigateur : l’affichage admin doit refléter enabled après Kafka
    const params = new HttpParams().set('_', String(Date.now()));
    return this.http.get<User[]>('/users', { params });
  }

  // CV

  cvs() {
    return this.http.get<Cv[]>('/users/me/cvs');
  }

  uploadCv(file: File) {
    const fd = new FormData();
    fd.append('file', file);

    return this.http.post('/users/me/cvs', fd);
  }

  downloadCv(id: number) {
    return this.http.get(
      '/users/me/cvs/' + id + '/download',
      { responseType: 'blob' }
    );
  }

  activateCv(id: number) {
    return this.http.put<Cv>(`/users/me/cvs/${id}/activate`, {});
  }

  // COMPÉTENCES

  skills() {
    return this.http.get<CandidateSkill[]>(
      '/users/skills/consulter'
    );
  }

  addSkill(body: { name: string; level: SkillLevel }) {
    return this.http.post<CandidateSkill>(
      '/users/skills/ajouter',
      body
    );
  }

  updateSkill(
    id: number,
    body: { name: string; level: SkillLevel }
  ) {
    return this.http.put<CandidateSkill>(
      '/users/skills/modifier/' + id,
      body
    );
  }

  removeSkill(id: number) {
    return this.http.delete(
      '/users/skills/supprimer/' + id
    );
  }

  // NOTIFICATIONS

  notifications() {
    return this.http.get<AppNotification[]>('/notifications');
  }

  unreadCount() {
    return this.http.get<{ count: number }>(
      '/notifications/unread-count'
    );
  }

  markNotificationRead(id: number) {
    return this.http.patch(
      '/notifications/' + id + '/read',
      {}
    );
  }

  // PHOTO DE PROFIL

  uploadProfilePhoto(file: File) {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.post<User>(
      '/users/me/photo',
      formData
    );
  }

  downloadProfilePhoto() {
    return this.http.get('/users/me/photo', {
      responseType: 'blob'
    });
  }

  // EXPÉRIENCES PROFESSIONNELLES

  experiences() {
    return this.http.get<Experience[]>(
      '/users/experiences/consulter'
    );
  }

  addExperience(body: ExperienceRequest) {
    return this.http.post<Experience>(
      '/users/experiences/ajouter',
      body
    );
  }

  updateExperience(id: number, body: ExperienceRequest) {
    return this.http.put<Experience>(
      '/users/experiences/modifier/' + id,
      body
    );
  }

  removeExperience(id: number) {
    return this.http.delete<void>(
      '/users/experiences/supprimer/' + id
    );
  }

  // FORMATIONS

  educations() {
    return this.http.get<Education[]>(
      '/users/educations/consulter'
    );
  }

  addEducation(body: EducationRequest) {
    return this.http.post<Education>(
      '/users/educations/ajouter',
      body
    );
  }

  updateEducation(id: number, body: EducationRequest) {
    return this.http.put<Education>(
      '/users/educations/modifier/' + id,
      body
    );
  }

  removeEducation(id: number) {
    return this.http.delete<void>(
      '/users/educations/supprimer/' + id
    );
  }
}
