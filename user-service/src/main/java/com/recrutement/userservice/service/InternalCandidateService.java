package com.recrutement.userservice.service;

import com.recrutement.userservice.dto.InternalCandidateProfileResponse;
import com.recrutement.userservice.dto.InternalCvMetadataResponse;
import com.recrutement.userservice.entity.Cv;
import com.recrutement.userservice.entity.Role;
import com.recrutement.userservice.entity.User;
import com.recrutement.userservice.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class InternalCandidateService {

    private final UserRepository userRepository;
    private final CandidateSkillService candidateSkillService;
    private final ExperienceService experienceService;
    private final EducationService educationService;
    private final CvService cvService;

    @Transactional(readOnly = true)
    public InternalCandidateProfileResponse getProfile(Long candidateId) {
        User candidate = requireActiveCandidate(candidateId);

        return InternalCandidateProfileResponse.builder()
                .candidateId(candidate.getId())
                .firstName(candidate.getFirstName())
                .lastName(candidate.getLastName())
                .description(candidate.getDescription())
                .skills(candidateSkillService.consulter(candidateId))
                .experiences(experienceService.consulter(candidateId))
                .educations(educationService.consulter(candidateId))
                .build();
    }

    @Transactional(readOnly = true)
    public InternalCvMetadataResponse getCvMetadata(Long candidateId, Long cvId) {
        requireActiveCandidate(candidateId);
        Cv cv = cvService.getCvForApplication(candidateId, cvId);
        return toMeta(cv);
    }

    @Transactional(readOnly = true)
    public byte[] downloadCvForApplication(Long candidateId, Long cvId) {
        requireActiveCandidate(candidateId);
        return cvService.downloadForApplication(candidateId, cvId);
    }

    @Transactional(readOnly = true)
    public Cv requireCvEntity(Long candidateId, Long cvId) {
        requireActiveCandidate(candidateId);
        return cvService.getCvForApplication(candidateId, cvId);
    }

    private User requireActiveCandidate(Long candidateId) {
        User user = userRepository.findById(candidateId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "Candidat introuvable"));

        if (!Boolean.TRUE.equals(user.getEnabled()) || user.getRole() != Role.CANDIDATE) {
            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND, "Candidat introuvable");
        }
        return user;
    }

    private static InternalCvMetadataResponse toMeta(Cv cv) {
        return InternalCvMetadataResponse.builder()
                .id(cv.getId())
                .fileName(cv.getFileName())
                .contentType(cv.getContentType())
                .fileSize(cv.getFileSize())
                .version(cv.getVersion())
                .active(cv.getActive())
                .visible(cv.getVisible())
                .createdAt(cv.getCreatedAt())
                .build();
    }
}
