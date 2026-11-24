package com.recrutement.offreservice.repository;

import com.recrutement.offreservice.entity.Candidature;
import com.recrutement.offreservice.entity.CandidatureStatus;
import com.recrutement.offreservice.entity.MatchResult;
import com.recrutement.offreservice.entity.Offre;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

public interface CandidatureRepository extends JpaRepository<Candidature, Long> {

    /** Toutes les candidatures avec offre (supervision ADMIN — 1 requête). */
    @Query("SELECT c FROM Candidature c JOIN FETCH c.offre ORDER BY c.appliedAt DESC")
    List<Candidature> findAllWithOffre();

    // Candidatures d'un candidat
    List<Candidature> findByCandidateId(Long candidateId);

    // Candidatures pour une offre
    List<Candidature> findByOffreId(Long offreId);

    // Vérifier l'existence d'une candidature non retirée
    boolean existsByOffreIdAndCandidateIdAndStatusNot(
            Long offreId,
            Long candidateId,
            CandidatureStatus status
    );

    boolean existsByOffreIdAndStatus(Long offreId, CandidatureStatus status);

    long countByOffreIdAndStatus(Long offreId, CandidatureStatus status);

    /**
     * Au plus une acceptation par candidat chez un même recruteur
     * (toutes ses offres confondues).
     */
    @Query("SELECT c.status, COUNT(c) FROM Candidature c GROUP BY c.status")
    List<Object[]> countByStatus();

    @Query("SELECT c.appliedAt FROM Candidature c WHERE c.appliedAt >= :since")
    List<LocalDateTime> findAppliedAtSince(@Param("since") LocalDateTime since);

    @Query("""
            SELECT c.appliedAt, c.decidedAt FROM Candidature c
            WHERE c.decidedAt IS NOT NULL AND c.appliedAt IS NOT NULL
            """)
    List<Object[]> findDecisionSpans();

    @Query("""
            SELECT COUNT(c) FROM Candidature c
            WHERE c.status IN (
              com.recrutement.offreservice.entity.CandidatureStatus.PENDING,
              com.recrutement.offreservice.entity.CandidatureStatus.UNDER_REVIEW
            )
            AND c.appliedAt < :limit
            """)
    long countStaleOpen(@Param("limit") LocalDateTime limit);

    @Query("""
            SELECT COUNT(c) FROM Candidature c
            WHERE NOT EXISTS (
              SELECT m.id FROM MatchResult m WHERE m.candidature = c
            )
            """)
    long countWithoutMatch();

    boolean existsByCandidateIdAndStatusAndOffre_RecruiterId(
            Long candidateId,
            CandidatureStatus status,
            Long recruiterId
    );

}