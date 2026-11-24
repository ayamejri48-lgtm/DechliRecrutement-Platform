package com.recrutement.authservice.service;

import com.recrutement.authservice.dto.AdminUserStatsResponse;
import com.recrutement.authservice.enums.Role;
import com.recrutement.authservice.repository.UserRepository;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

@Service
public class AdminUserStatsService {

    private final UserRepository userRepository;

    public AdminUserStatsService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @PreAuthorize("hasRole('ADMIN')")
    public AdminUserStatsResponse stats() {
        long total = userRepository.count();
        long disabled = userRepository.countDisabled();
        return new AdminUserStatsResponse(
                total,
                Math.max(0, total - disabled),
                disabled,
                userRepository.countByRole(Role.CANDIDATE),
                userRepository.countByRole(Role.RECRUITER),
                userRepository.countByRole(Role.ADMIN)
        );
    }
}
