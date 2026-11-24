package com.recrutement.userservice.dto;

import lombok.Builder;
import lombok.Data;

import java.util.List;

/**
 * Profil professionnel exposé aux appels interservices (sans email / téléphone).
 */
@Data
@Builder
public class InternalCandidateProfileResponse {

    private Long candidateId;
    private String firstName;
    private String lastName;
    private String description;
    private List<CandidateSkillResponse> skills;
    private List<ExperienceResponse> experiences;
    private List<EducationResponse> educations;
}
