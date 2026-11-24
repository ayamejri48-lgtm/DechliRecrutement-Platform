package com.recrutement.authservice.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "admin_audit_log")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AdminAuditEntry {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 180)
    private String actorEmail;

    @Column(nullable = false, length = 32)
    private String action;

    @Column(nullable = false)
    private Long targetUserId;

    @Column(nullable = false, length = 180)
    private String targetEmail;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
