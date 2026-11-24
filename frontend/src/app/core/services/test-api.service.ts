import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

export type TestStatus =
  | 'DRAFT'
  | 'GENERATING'
  | 'READY'
  | 'ASSIGNED'
  | 'FAILED';

export type AssignmentStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'EVALUATING'
  | 'EVALUATED'
  | 'PUBLISHED'
  | 'EXPIRED';

export interface TestQuestion {
  id: number;
  position: number;
  type: 'MCQ' | 'OPEN';
  prompt: string;
  options?: Record<string, string> | null;
  correctOption?: string | null;
  maxScore: number;
  rubric?: unknown;
}

export interface TechnicalTest {
  id: number;
  offreId: number;
  recruiterId: number;
  difficulty: string;
  durationSec: number;
  status: TestStatus | string;
  llmProvider?: string | null;
  llmModel?: string | null;
  promptVersion?: string | null;
  regenerateCount: number;
  errorMessage?: string | null;
  questions: TestQuestion[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface TestAssignment {
  id: number;
  testId: number;
  offreId: number;
  candidatureId: number;
  candidateId: number;
  status: AssignmentStatus | string;
  invitedAt?: string | null;
  startDeadlineAt?: string | null;
  startedAt?: string | null;
  endsAt?: string | null;
  submittedAt?: string | null;
  scoreMcq?: number | null;
  scoreOpen?: number | null;
  scoreTotal?: number | null;
  evaluation?: unknown;
  publishedAt?: string | null;
}

export interface TestPaper {
  assignment: TestAssignment;
  durationSec: number;
  serverNow: string;
  remainingSec?: number | null;
  questions: TestQuestion[];
  answers?: Array<{
    questionId: number;
    answerOption?: string | null;
    answerText?: string | null;
  }>;
}

/** Supervision admin : pas de questions ni de corrigé. Score seulement si publié. */
export interface AdminTestOverview {
  tests: Array<{
    offreId: number;
    status: string;
    assignmentCount: number;
    publishedCount: number;
    unpublishedGradedCount: number;
  }>;
  assignments: Array<{
    candidatureId: number;
    offreId: number;
    status: string;
    scoreTotal?: number | null;
  }>;
}

export interface AdminTestStats {
  testsByStatus: Record<string, number>;
  assignmentsByStatus: Record<string, number>;
  unpublishedGraded: number;
  scoredCount: number;
  meanScore?: number | null;
  meanMcq?: number | null;
  meanOpen?: number | null;
  mcqCount?: number;
  openCount?: number;
  offreIdsWithTest: number[];
}

export interface CandidateResult {
  assignment: TestAssignment;
  answers: Array<{
    questionId: number;
    position: number;
    type: 'MCQ' | 'OPEN';
    prompt: string;
    maxScore: number;
    score?: number | null;
    isCorrect?: boolean | null;
    feedback?: string | null;
    answerOption?: string | null;
    answerText?: string | null;
    correctOption?: string | null;
  }>;
}

export type CorrectionDetail = CandidateResult;

export interface QuestionDiff {
  added: Array<{ position: number; type?: string; prompt?: string }>;
  removed: Array<{ position: number; type?: string; prompt?: string }>;
  changed: Array<{
    position: number;
    type?: string;
    fromPrompt?: string;
    toPrompt?: string;
  }>;
  addedCount: number;
  removedCount: number;
  changedCount: number;
}

export interface GenerationRevision {
  revision: number;
  difficulty: string;
  durationSec: number;
  llmProvider?: string | null;
  llmModel?: string | null;
  createdAt?: string | null;
  questionCount: number;
  questions: Array<Record<string, unknown>>;
  diffFromPrevious?: QuestionDiff | null;
}

export interface GenerationHistory {
  testId: number;
  offreId: number;
  regenerateCount: number;
  revisions: GenerationRevision[];
}

@Injectable({ providedIn: 'root' })
export class TestApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/tests';

  generate(offreId: number) {
    return this.http.post<{
      testId: number;
      offreId: number;
      status: string;
      message: string;
    }>(`${this.base}/offres/${offreId}/generate`, {});
  }

  regenerate(offreId: number) {
    return this.http.post<{
      testId: number;
      offreId: number;
      status: string;
      message: string;
    }>(`${this.base}/offres/${offreId}/regenerate`, {});
  }

  /** Une requête pour tout l'espace admin. Réservé au rôle ADMIN côté API. */
  adminOverview() {
    return this.http.get<AdminTestOverview>(`${this.base}/admin/overview`);
  }

  adminStats() {
    return this.http.get<AdminTestStats>(`${this.base}/admin/stats`);
  }

  getByOffre(offreId: number) {
    return this.http.get<TechnicalTest>(`${this.base}/offres/${offreId}`);
  }

  assign(offreId: number, candidatureIds: number[]) {
    return this.http.post<{
      offreId: number;
      testId: number;
      assigned: TestAssignment[];
      message: string;
    }>(`${this.base}/offres/${offreId}/assign`, { candidatureIds });
  }

  listAssignments(offreId: number) {
    return this.http.get<TestAssignment[]>(
      `${this.base}/offres/${offreId}/assignments`
    );
  }

  generationHistory(offreId: number) {
    return this.http.get<GenerationHistory>(
      `${this.base}/offres/${offreId}/generation-history`
    );
  }

  getAssignment(id: number) {
    return this.http.get<TestAssignment>(`${this.base}/assignments/${id}`);
  }

  /** E7 — détail correction recruteur (EVALUATED / PUBLISHED). */
  correction(assignmentId: number) {
    return this.http.get<CorrectionDetail>(
      `${this.base}/assignments/${assignmentId}/correction`
    );
  }

  evaluate(assignmentId: number) {
    return this.http.post<{
      assignmentId: number;
      status: string;
      message: string;
    }>(`${this.base}/assignments/${assignmentId}/evaluate`, {});
  }

  publish(assignmentId: number) {
    return this.http.post<TestAssignment>(
      `${this.base}/assignments/${assignmentId}/publish`,
      {}
    );
  }

  publishOffreResults(offreId: number, assignmentIds?: number[]) {
    return this.http.post<{
      offreId: number;
      published: TestAssignment[];
      message: string;
    }>(`${this.base}/offres/${offreId}/publish-results`, {
      assignmentIds: assignmentIds ?? null
    });
  }

  myAssignments() {
    return this.http.get<TestAssignment[]>(`${this.base}/me/assignments`);
  }

  paper(assignmentId: number) {
    return this.http.get<TestPaper>(
      `${this.base}/assignments/${assignmentId}/paper`
    );
  }

  start(assignmentId: number) {
    return this.http.post<TestAssignment>(
      `${this.base}/assignments/${assignmentId}/start`,
      {}
    );
  }

  saveAnswers(
    assignmentId: number,
    answers: Array<{
      questionId: number;
      answerOption?: string | null;
      answerText?: string | null;
    }>
  ) {
    return this.http.put<TestAssignment>(
      `${this.base}/assignments/${assignmentId}/answers`,
      { answers }
    );
  }

  submit(assignmentId: number) {
    return this.http.post<TestAssignment>(
      `${this.base}/assignments/${assignmentId}/submit`,
      {}
    );
  }

  incident(
    assignmentId: number,
    type: 'TAB_BLUR' | 'EXIT_FULLSCREEN',
    meta?: Record<string, unknown>
  ) {
    return this.http.post<{
      id: number;
      type: string;
      occurredAt: string;
      incidentCount: number;
      limit: number;
      blocked: boolean;
      message?: string | null;
    }>(`${this.base}/assignments/${assignmentId}/incidents`, {
      type,
      meta: meta ?? null
    });
  }

  myResult(assignmentId: number) {
    return this.http.get<CandidateResult>(
      `${this.base}/me/assignments/${assignmentId}/result`
    );
  }
}
