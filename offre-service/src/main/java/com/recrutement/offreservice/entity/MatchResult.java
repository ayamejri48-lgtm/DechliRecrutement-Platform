package com.recrutement.offreservice.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(
        name = "match_results",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_match_results_candidature",
                columnNames = "candidature_id"
        )
)
@Getter
@Setter
public class MatchResult {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "candidature_id", nullable = false, unique = true)
    private Candidature candidature;

    @Column(nullable = false)
    private Long offreId;

    /** Snapshot CV used for scoring (candidature.cvId). */
    @Column(nullable = false)
    private Long cvId;

    @Column(precision = 5, scale = 4)
    private BigDecimal score;

    @Column(length = 32)
    private String scoreBand;

    @Column(columnDefinition = "TEXT")
    private String featuresJson;

    @Column(columnDefinition = "TEXT")
    private String explanationsJson;

    @Column(length = 64)
    private String method;

    @Column(length = 64)
    private String modelVersion;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private MatchResultStatus status = MatchResultStatus.PENDING;

    @Column(length = 128)
    private String errorCode;

    @Column(columnDefinition = "TEXT")
    private String errorMessage;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = createdAt;
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
