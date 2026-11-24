package com.recrutement.offreservice.dto.ai;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class AiExtractResponse {
    private List<String> skills = new ArrayList<>();
    private Double experienceYears;
    private String education;
    private String specialty;
    private String method;
}
