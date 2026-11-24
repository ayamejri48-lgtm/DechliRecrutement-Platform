package com.recrutement.offreservice.repository;

import com.recrutement.offreservice.entity.Candidature;
import com.recrutement.offreservice.entity.Offre;
import com.recrutement.offreservice.entity.OffreSkill;
import org.springframework.data.jpa.repository.JpaRepository;
import com.recrutement.offreservice.entity.OffreStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.time.LocalDate;
import java.util.Optional;

import java.util.List;

public interface OffreRepository extends JpaRepository<Offre, Long> ,
        JpaSpecificationExecutor<Offre> {

    List<Offre> findByRecruiterId(Long recruiterId);

    List<Offre> findByStatus(OffreStatus status);

    /** Brouillons sans aucune compétence nommée — une requête, ADMIN uniquement. */
    @Query("""
            SELECT o.id FROM Offre o
            WHERE o.status = com.recrutement.offreservice.entity.OffreStatus.DRAFT
              AND NOT EXISTS (
                SELECT s.id FROM OffreSkill s
                WHERE s.offre = o AND s.name IS NOT NULL AND s.name <> ''
              )
            """)
    List<Long> findDraftIdsWithoutSkills();

    @Query("SELECT o.status, COUNT(o) FROM Offre o GROUP BY o.status")
    List<Object[]> countByStatus();

    @Query("""
            SELECT o.id FROM Offre o
            WHERE o.status = com.recrutement.offreservice.entity.OffreStatus.PUBLISHED
            """)
    List<Long> findPublishedIds();

    @Query("""
            SELECT COUNT(o) FROM Offre o
            WHERE o.status = com.recrutement.offreservice.entity.OffreStatus.PUBLISHED
              AND o.deadline IS NOT NULL
              AND o.deadline < :today
            """)
    long countPublishedPastDeadline(@Param("today") LocalDate today);

    @Query("""
            SELECT o FROM Offre o
            WHERE o.status = com.recrutement.offreservice.entity.OffreStatus.PUBLISHED
              AND o.deadline = :day
            """)
    List<Offre> findPublishedWithDeadlineOn(@Param("day") LocalDate day);

    @Query("""
            SELECT COUNT(o) FROM Offre o
            WHERE o.status = com.recrutement.offreservice.entity.OffreStatus.PUBLISHED
              AND NOT EXISTS (
                SELECT c.id FROM Candidature c WHERE c.offre = o
              )
            """)
    long countPublishedWithoutCandidature();

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT o FROM Offre o WHERE o.id = :id")
    Optional<Offre> findByIdForUpdate(@Param("id") Long id);
}