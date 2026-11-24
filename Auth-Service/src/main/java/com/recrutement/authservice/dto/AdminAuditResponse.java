package com.recrutement.authservice.dto;

import java.time.LocalDateTime;

public record AdminAuditResponse(
        Long id,
        String actorEmail,
        String action,
        Long targetUserId,
        String targetEmail,
        LocalDateTime createdAt
) {
}
