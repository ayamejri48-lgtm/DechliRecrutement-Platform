package com.recrutement.offreservice.dto;

import lombok.Data;

import java.util.List;

/** Miroir JSON User-Service /internal/.../profile (Feign). */
@Data
public class InternalCandidateProfileDto {

    private Long candidateId;
    private String firstName;
    private String lastName;
    private String description;
    private List<SkillDto> skills;
    private List<ExperienceDto> experiences;
    private List<EducationDto> educations;

    @Data
    public static class SkillDto {
        private Long id;
        private String name;
        private String level;
    }

    @Data
    public static class ExperienceDto {
        private Long id;
        private String jobTitle;
        private String company;
        private String description;
        private String startDate;
        private String endDate;
    }

    @Data
    public static class EducationDto {
        private Long id;
        private String institution;
        private String degree;
        private String fieldOfStudy;
        private String startDate;
        private String endDate;
    }
}
