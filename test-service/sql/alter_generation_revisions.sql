-- B7 — Historique des (re)générations de questions
USE test_db;

CREATE TABLE IF NOT EXISTS test_generation_revisions (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  test_id         BIGINT NOT NULL,
  revision        INT NOT NULL,
  difficulty      VARCHAR(32) NOT NULL,
  duration_sec    INT NOT NULL,
  questions_json  JSON NOT NULL,
  llm_provider    VARCHAR(32) NULL,
  llm_model       VARCHAR(128) NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_gen_rev_test
    FOREIGN KEY (test_id) REFERENCES technical_tests(id) ON DELETE CASCADE,
  UNIQUE KEY uq_gen_rev_test_revision (test_id, revision),
  KEY idx_gen_rev_test (test_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
