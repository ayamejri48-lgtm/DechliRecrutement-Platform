package com.recrutement.offreservice.dto.ai;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class AiMatchResponse {
    private Double score;
    private String scoreBand;
    private Map<String, Object> features;
    private List<String> explanations = new ArrayList<>();
    private String method;
    private String modelVersion;
    private String warning;
    private String candidatureId;
    private String cvId;
}
