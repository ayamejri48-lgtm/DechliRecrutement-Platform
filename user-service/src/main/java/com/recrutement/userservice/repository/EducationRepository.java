package com.recrutement.userservice.repository;

import com.recrutement.userservice.entity.Education;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface EducationRepository
        extends JpaRepository<Education, Long> {

    List<Education> findByUserId(Long userId);

    Optional<Education> findByIdAndUserId(
            Long educationId,
            Long userId
    );

    void deleteByUserId(Long userId);
}