package com.recrutement.offreservice.repository;

import com.recrutement.offreservice.entity.MatchResult;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface MatchResultRepository extends JpaRepository<MatchResult, Long> {

    Optional<MatchResult> findByCandidatureId(Long candidatureId);

    @Query("""
            SELECT m FROM MatchResult m
            JOIN FETCH m.candidature c
            WHERE m.offreId = :offreId
            ORDER BY
              CASE WHEN m.score IS NULL THEN 1 ELSE 0 END,
              m.score DESC,
              c.appliedAt DESC
            """)
    List<MatchResult> findByOffreIdOrderByScoreDesc(Long offreId);

    boolean existsByCandidatureId(Long candidatureId);

    /** Scores seuls (pas le JSON des features) pour la liste admin. */
    @Query("""
            SELECT m.candidature.id, m.score, m.scoreBand, m.status
            FROM MatchResult m
            WHERE m.candidature.id IN :ids
            """)
    List<Object[]> findScoreSlices(@Param("ids") Collection<Long> ids);

    @Query("SELECT m.status, m.scoreBand, COUNT(m) FROM MatchResult m GROUP BY m.status, m.scoreBand")
    List<Object[]> countByStatusAndBand();
}
