
package com.recrutement.authservice.repository;

import com.recrutement.authservice.entity.User;
import com.recrutement.authservice.enums.Role;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByEmail(String email);

    boolean existsByEmail(String email);

    boolean existsByRole(Role role);

    long countByRole(Role role);

    long countByRoleAndEnabledTrueAndStatusIgnoreCase(
            Role role,
            String status
    );

    @Query("SELECT COUNT(u) FROM User u WHERE u.enabled = false")
    long countDisabled();
}
