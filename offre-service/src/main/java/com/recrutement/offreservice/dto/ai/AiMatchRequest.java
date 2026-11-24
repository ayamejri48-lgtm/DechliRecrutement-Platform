package com.recrutement.offreservice.dto.ai;

import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class AiMatchRequest {
    private AiProfile candidate;
    private AiProfile offer;
    private String candidatureId;
    private String cvId;
}
