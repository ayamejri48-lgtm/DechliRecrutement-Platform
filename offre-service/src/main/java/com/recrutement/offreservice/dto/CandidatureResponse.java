package com.recrutement.offreservice.dto;

import com.recrutement.offreservice.entity.CandidatureStatus;
import lombok.Builder;
import lombok.Getter;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Getter
@Builder
public class CandidatureResponse {

    private Long id;
    private Long offreId;
    /** Renseigné sur les vues admin / agrégées ; null sinon. */
    private String offreTitle;
    private Long candidateId;
    private Long cvId;
    private CandidatureStatus status;
    private LocalDateTime appliedAt;
    private LocalDateTime updatedAt;
    /** Score matching 0–1, seulement si le calcul est DONE. Null sinon. */
    private BigDecimal matchScore;
    private String matchBand;
}