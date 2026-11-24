package com.recrutement.offreservice.repository;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;

/** Lecture seule de test_db pour vérifier qu'un candidat a passé le test. */
@Component
@RequiredArgsConstructor
public class TestAssignmentProbe {

    private final JdbcTemplate jdbcTemplate;

    public Optional<String> latestStatus(Long candidatureId) {
        if (candidatureId == null) {
            return Optional.empty();
        }
        try {
            List<String> rows = jdbcTemplate.query(
                    """
                    SELECT status FROM test_db.test_assignments
                    WHERE candidature_id = ?
                    ORDER BY id DESC
                    LIMIT 1
                    """,
                    (rs, rowNum) -> rs.getString(1),
                    candidatureId
            );
            return rows.stream().findFirst();
        } catch (Exception ex) {
            return Optional.empty();
        }
    }
}
