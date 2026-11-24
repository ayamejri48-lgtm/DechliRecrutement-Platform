package com.recrutement.offreservice.dto;

import com.recrutement.offreservice.entity.MatchResultStatus;
import lombok.Builder;
import lombok.Getter;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

@Getter
@Builder
public class MatchResultResponse {

    private Long id;
    private Long candidatureId;
    private Long offreId;
    private Long cvId;
    private Long candidateId;
    private BigDecimal score;
    private String scoreBand;
    private Object features;
    private List<String> explanations;
    private String method;
    private String modelVersion;
    private MatchResultStatus status;
    private String errorCode;
    private String errorMessage;
    private Integer rank;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
