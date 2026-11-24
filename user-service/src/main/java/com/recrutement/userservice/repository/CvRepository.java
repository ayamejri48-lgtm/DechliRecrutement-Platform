
package com.recrutement.userservice.repository;

import com.recrutement.userservice.entity.Cv;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface CvRepository extends JpaRepository<Cv, Long> {

    Optional<Cv> findByUserIdAndActiveTrue(Long userId);

    List<Cv> findByUserIdOrderByVersionDesc(Long userId);

    Optional<Cv> findByIdAndUserId(Long id, Long userId);

    boolean existsByUserIdAndVersion(Long userId, Integer version);

    List<Cv> findByUserIdAndVisibleTrueOrderByVersionDesc(Long userId);

    void deleteByUserId(Long userId);
}
