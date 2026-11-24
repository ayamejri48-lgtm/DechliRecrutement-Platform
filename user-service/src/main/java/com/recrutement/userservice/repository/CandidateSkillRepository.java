
package com.recrutement.userservice.repository;

import com.recrutement.userservice.entity.CandidateSkill;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface CandidateSkillRepository
        extends JpaRepository<CandidateSkill, Long> {

    List<CandidateSkill> findByUserIdOrderByNameAsc(Long userId);

    Optional<CandidateSkill> findByIdAndUserId(
            Long skillId,
            Long userId
    );

    boolean existsByUserIdAndNormalizedName(
            Long userId,
            String normalizedName
    );

    void deleteByUserId(Long userId);
}
