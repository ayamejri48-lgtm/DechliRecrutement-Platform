package com.recrutement.offreservice.dto;

import com.recrutement.offreservice.entity.CandidatureStatus;
import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

@Data
@Builder
public class CandidateDossierResponse {

    private Long candidatureId;
    private Long offreId;
    private String offreTitle;
    private CandidatureStatus status;
    private LocalDateTime appliedAt;

    private Long candidateId;
    private String firstName;
    private String lastName;
    private String description;

    private List<CandidateSkillItem> skills;
    private List<ExperienceItem> experiences;
    private List<EducationItem> educations;

    /** Métadonnées du CV snapshot (cvId de la candidature). */
    private CvSnapshotItem cv;

    @Data
    @Builder
    public static class CandidateSkillItem {
        private Long id;
        private String name;
        private String level;
    }

    @Data
    @Builder
    public static class ExperienceItem {
        private Long id;
        private String jobTitle;
        private String company;
        private String description;
        private String startDate;
        private String endDate;
    }

    @Data
    @Builder
    public static class EducationItem {
        private Long id;
        private String institution;
        private String degree;
        private String fieldOfStudy;
        private String startDate;
        private String endDate;
    }

    @Data
    @Builder
    public static class CvSnapshotItem {
        private Long id;
        private String fileName;
        private String contentType;
        private Long fileSize;
        private Integer version;
        private Boolean active;
        private Boolean visible;
    }
}
