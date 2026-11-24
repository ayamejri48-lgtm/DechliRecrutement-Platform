-- DechliRecrutement — Test-Service schema (Phase 0)
-- Database: test_db

CREATE DATABASE IF NOT EXISTS test_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE test_db;

CREATE TABLE IF NOT EXISTS technical_tests (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  offre_id          BIGINT NOT NULL,
  recruiter_id      BIGINT NOT NULL,
  difficulty        ENUM('JUNIOR', 'INTERMEDIATE', 'SENIOR') NOT NULL,
  duration_sec      INT NOT NULL,
  status            ENUM('DRAFT', 'GENERATING', 'READY', 'ASSIGNED', 'FAILED') NOT NULL DEFAULT 'DRAFT',
  llm_provider      VARCHAR(32) NULL,
  llm_model         VARCHAR(128) NULL,
  prompt_version    VARCHAR(64) NULL,
  regenerate_count  TINYINT NOT NULL DEFAULT 0,
  error_message     TEXT NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_technical_tests_offre (offre_id),
  KEY idx_technical_tests_recruiter (recruiter_id),
  KEY idx_technical_tests_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS questions (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  test_id              BIGINT NOT NULL,
  position             TINYINT NOT NULL,
  type                 ENUM('MCQ', 'OPEN') NOT NULL,
  prompt               TEXT NOT NULL,
  options_json         JSON NULL,
  correct_option       CHAR(1) NULL,
  max_score            DECIMAL(5,2) NOT NULL,
  grading_rubric_json  JSON NULL,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_questions_test
    FOREIGN KEY (test_id) REFERENCES technical_tests(id) ON DELETE CASCADE,
  UNIQUE KEY uq_questions_test_position (test_id, position),
  KEY idx_questions_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS test_assignments (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  test_id            BIGINT NOT NULL,
  offre_id           BIGINT NOT NULL,
  candidature_id     BIGINT NOT NULL,
  candidate_id       BIGINT NOT NULL,
  status             ENUM(
                       'PENDING',
                       'IN_PROGRESS',
                       'SUBMITTED',
                       'EVALUATING',
                       'EVALUATED',
                       'PUBLISHED',
                       'EXPIRED'
                     ) NOT NULL DEFAULT 'PENDING',
  invited_at         DATETIME(3) NOT NULL,
  start_deadline_at  DATETIME(3) NOT NULL,
  started_at         DATETIME(3) NULL,
  ends_at            DATETIME(3) NULL,
  submitted_at       DATETIME(3) NULL,
  score_mcq          DECIMAL(5,2) NULL,
  score_open         DECIMAL(5,2) NULL,
  score_total        DECIMAL(5,2) NULL,
  evaluation_json    JSON NULL,
  published_at       DATETIME(3) NULL,
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_assignments_test
    FOREIGN KEY (test_id) REFERENCES technical_tests(id) ON DELETE RESTRICT,
  UNIQUE KEY uq_assignments_candidature (candidature_id),
  KEY idx_assignments_test (test_id),
  KEY idx_assignments_candidate (candidate_id),
  KEY idx_assignments_status (status),
  KEY idx_assignments_deadline (start_deadline_at),
  KEY idx_assignments_ends (ends_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS candidate_answers (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  assignment_id   BIGINT NOT NULL,
  question_id     BIGINT NOT NULL,
  answer_option   CHAR(1) NULL,
  answer_text     TEXT NULL,
  is_correct      BOOLEAN NULL,
  score           DECIMAL(5,2) NULL,
  feedback        TEXT NULL,
  saved_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_answers_assignment
    FOREIGN KEY (assignment_id) REFERENCES test_assignments(id) ON DELETE CASCADE,
  CONSTRAINT fk_answers_question
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE RESTRICT,
  UNIQUE KEY uq_answers_assignment_question (assignment_id, question_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS test_incidents (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  assignment_id   BIGINT NOT NULL,
  type            VARCHAR(64) NOT NULL,
  occurred_at     DATETIME(3) NOT NULL,
  meta_json       JSON NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_incidents_assignment
    FOREIGN KEY (assignment_id) REFERENCES test_assignments(id) ON DELETE CASCADE,
  KEY idx_incidents_assignment (assignment_id),
  KEY idx_incidents_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
