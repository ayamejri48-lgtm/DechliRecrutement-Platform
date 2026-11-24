package com.recrutement.authservice.dto;

public record AdminUserStatsResponse(
        long total,
        long active,
        long disabled,
        long candidates,
        long recruiters,
        long admins
) {
}
