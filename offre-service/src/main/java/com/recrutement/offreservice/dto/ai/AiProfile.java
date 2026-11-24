package com.recrutement.offreservice.dto.ai;

import lombok.Builder;
import lombok.Getter;

import java.util.ArrayList;
import java.util.List;

@Getter
@Builder
public class AiProfile {
    @Builder.Default
    private List<String> skills = new ArrayList<>();
    @Builder.Default
    private List<String> requiredSkills = new ArrayList<>();
    private Double experienceYears;
    private String education;
    private String title;
    private String summary;
}
