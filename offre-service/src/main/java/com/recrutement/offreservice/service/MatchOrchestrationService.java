package com.recrutement.offreservice.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.recrutement.offreservice.client.AiServiceClient;
import com.recrutement.offreservice.client.UserServiceClient;
import com.recrutement.offreservice.dto.MatchResultResponse;
import com.recrutement.offreservice.dto.ai.AiExtractResponse;
import com.recrutement.offreservice.dto.ai.AiMatchRequest;
import com.recrutement.offreservice.dto.ai.AiMatchResponse;
import com.recrutement.offreservice.dto.ai.AiProfile;
import com.recrutement.offreservice.entity.Candidature;
import com.recrutement.offreservice.entity.MatchResult;
import com.recrutement.offreservice.entity.MatchResultStatus;
import com.recrutement.offreservice.entity.Offre;
import com.recrutement.offreservice.entity.OffreSkill;
import com.recrutement.offreservice.exception.AiServiceException;
import com.recrutement.offreservice.repository.MatchResultRepository;
import com.recrutement.offreservice.repository.OffreSkillRepository;
import com.recrutement.offreservice.security.ServiceJwtTokenProvider;
import feign.FeignException;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * Orchestrates AI matching from candidature.cvId PDF snapshot only
 * (never User-Service profile skills/experiences).
 */
@Service
@RequiredArgsConstructor
public class MatchOrchestrationService {

    private static final Duration PENDING_STALE = Duration.ofMinutes(2);

    private final CandidatureService candidatureService;
    private final OffreService offreService;
    private final MatchResultRepository matchResultRepository;
    private final OffreSkillRepository offreSkillRepository;
    private final UserServiceClient userServiceClient;
    private final ServiceJwtTokenProvider serviceJwtTokenProvider;
    private final AiServiceClient aiServiceClient;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate transactionTemplate;

    public MatchResultResponse computeMatch(
            Long candidatureId,
            Long userId,
            String role,
            boolean force) {

        Candidature candidature =
                candidatureService.requireOwnedCandidature(candidatureId, userId, role);

        Optional<MatchResult> existingOpt =
                matchResultRepository.findByCandidatureId(candidatureId);

        if (existingOpt.isPresent()) {
            MatchResult existing = existingOpt.get();
            if (!force && existing.getStatus() == MatchResultStatus.DONE) {
                // Preserve historical MatchResult even if offer skills were empty.
                return toResponse(existing, null);
            }
            if (!force
                    && existing.getStatus() == MatchResultStatus.PENDING
                    && !isStale(existing)) {
                throw new IllegalStateException(
                        "Un matching est déjà en cours pour cette candidature");
            }
        }

        // New / forced computation requires structured offre_skills (HTTP 409).
        requireStructuredOffreSkills(candidature.getOffre().getId());

        MatchResult pending = markPending(candidature, existingOpt.orElse(null));

        try {
            byte[] pdf = downloadCvPdf(candidature);
            String fileName = "cv-" + candidature.getCvId() + ".pdf";

            AiExtractResponse extract = aiServiceClient.extractCvPdf(pdf, fileName);
            if (extract == null) {
                throw new AiServiceException(
                        "Réponse extract AI vide",
                        "AI_EMPTY_EXTRACT",
                        HttpStatus.SERVICE_UNAVAILABLE
                );
            }

            AiProfile candidateProfile = AiProfile.builder()
                    .skills(nullToEmpty(extract.getSkills()))
                    .experienceYears(extract.getExperienceYears())
                    .education(normalizeEducation(extract.getEducation()))
                    .title(extract.getSpecialty())
                    .summary(null)
                    .build();

            AiProfile offerProfile = buildOfferProfile(candidature.getOffre());

            AiMatchResponse match = aiServiceClient.match(
                    AiMatchRequest.builder()
                            .candidate(candidateProfile)
                            .offer(offerProfile)
                            .candidatureId(String.valueOf(candidature.getId()))
                            .cvId(String.valueOf(candidature.getCvId()))
                            .build()
            );

            if (match == null) {
                throw new AiServiceException(
                        "Réponse match AI vide",
                        "AI_EMPTY_MATCH",
                        HttpStatus.SERVICE_UNAVAILABLE
                );
            }

            return toResponse(saveSuccess(pending.getId(), match), null);
        } catch (AiServiceException ex) {
            saveFailure(pending.getId(), ex.getErrorCode(), ex.getMessage());
            throw ex;
        } catch (FeignException ex) {
            String code = ex.status() == 404 ? "CV_NOT_FOUND" : "USER_SERVICE_ERROR";
            String message = ex.status() == 404
                    ? "CV snapshot introuvable pour candidature.cvId"
                    : "Impossible de récupérer le PDF via User-Service";
            saveFailure(pending.getId(), code, message);
            throw ex;
        } catch (RuntimeException ex) {
            saveFailure(pending.getId(), "MATCH_INTERNAL_ERROR", safeMessage(ex));
            throw ex;
        }
    }

    @Transactional(readOnly = true)
    public MatchResultResponse getMatch(Long candidatureId, Long userId, String role) {
        candidatureService.requireOwnedCandidature(candidatureId, userId, role);
        MatchResult result = matchResultRepository.findByCandidatureId(candidatureId)
                .orElseThrow(() -> new IllegalArgumentException(
                        "Aucun résultat de matching pour cette candidature"));
        return toResponse(result, null);
    }

    @Transactional(readOnly = true)
    public List<MatchResultResponse> listMatchesForOffre(
            Long offreId,
            Long userId,
            String role) {

        Offre offre = offreService.getOffreById(offreId);
        boolean isAdmin = "ADMIN".equals(role);
        boolean isOwner = "RECRUITER".equals(role)
                && offre.getRecruiterId().equals(userId);
        if (!isAdmin && !isOwner) {
            throw new AccessDeniedException(
                    "Vous n'êtes pas autorisé à consulter les matchings de cette offre");
        }

        List<MatchResult> results = matchResultRepository.findByOffreIdOrderByScoreDesc(offreId);
        List<MatchResultResponse> responses = new ArrayList<>();
        int rank = 1;
        for (MatchResult result : results) {
            Integer r = isRankable(result) ? rank++ : null;
            responses.add(toResponse(result, r));
        }
        return responses;
    }

    private void requireStructuredOffreSkills(Long offreId) {
        List<OffreSkill> skills = offreSkillRepository.findByOffreId(offreId);
        boolean hasSkill = skills != null && skills.stream()
                .anyMatch(s -> s.getName() != null && !s.getName().isBlank());
        if (!hasSkill) {
            throw new IllegalStateException(
                    "Matching impossible : ajoutez au moins une compétence structurée à l'offre"
            );
        }
    }

    /**
     * Rank only DONE results with a numeric score, a usable band, and a non-null
     * skills_coverage (excludes historical empty-offer scores without deleting them).
     */
    private boolean isRankable(MatchResult result) {
        if (result.getStatus() != MatchResultStatus.DONE || result.getScore() == null) {
            return false;
        }
        String band = result.getScoreBand();
        if (band != null && "unavailable".equalsIgnoreCase(band.trim())) {
            return false;
        }
        Object features = readJson(result.getFeaturesJson());
        if (!(features instanceof Map<?, ?> map)) {
            return false;
        }
        Object coverage = map.get("skills_coverage");
        return coverage instanceof Number;
    }

    private MatchResult markPending(Candidature candidature, MatchResult existing) {
        try {
            return transactionTemplate.execute(status -> {
                MatchResult entity = existing;
                if (entity == null) {
                    entity = matchResultRepository.findByCandidatureId(candidature.getId())
                            .orElse(null);
                }
                if (entity == null) {
                    entity = new MatchResult();
                    entity.setCandidature(candidature);
                }
                entity.setOffreId(candidature.getOffre().getId());
                entity.setCvId(candidature.getCvId());
                entity.setStatus(MatchResultStatus.PENDING);
                entity.setErrorCode(null);
                entity.setErrorMessage(null);
                entity.setScore(null);
                entity.setScoreBand(null);
                entity.setFeaturesJson(null);
                entity.setExplanationsJson(null);
                entity.setMethod(null);
                entity.setModelVersion(null);
                return matchResultRepository.save(entity);
            });
        } catch (DataIntegrityViolationException ex) {
            // Concurrent create: reuse the row created by the other request.
            MatchResult raced = matchResultRepository.findByCandidatureId(candidature.getId())
                    .orElseThrow(() -> ex);
            if (raced.getStatus() == MatchResultStatus.DONE) {
                return raced;
            }
            if (raced.getStatus() == MatchResultStatus.PENDING && !isStale(raced)) {
                throw new IllegalStateException(
                        "Un matching est déjà en cours pour cette candidature");
            }
            return transactionTemplate.execute(status -> {
                raced.setStatus(MatchResultStatus.PENDING);
                raced.setCvId(candidature.getCvId());
                raced.setOffreId(candidature.getOffre().getId());
                raced.setErrorCode(null);
                raced.setErrorMessage(null);
                return matchResultRepository.save(raced);
            });
        }
    }

    private MatchResult saveSuccess(Long matchId, AiMatchResponse match) {
        return transactionTemplate.execute(status -> {
            MatchResult entity = matchResultRepository.findById(matchId)
                    .orElseThrow(() -> new IllegalStateException("MatchResult introuvable"));
            entity.setStatus(MatchResultStatus.DONE);
            entity.setScore(toScore(match.getScore()));
            entity.setScoreBand(match.getScoreBand());
            entity.setMethod(match.getMethod());
            entity.setModelVersion(match.getModelVersion());
            entity.setFeaturesJson(writeJson(match.getFeatures()));
            entity.setExplanationsJson(writeJson(match.getExplanations()));
            entity.setErrorCode(null);
            entity.setErrorMessage(null);
            return matchResultRepository.save(entity);
        });
    }

    private void saveFailure(Long matchId, String code, String message) {
        transactionTemplate.executeWithoutResult(status -> {
            matchResultRepository.findById(matchId).ifPresent(entity -> {
                entity.setStatus(MatchResultStatus.FAILED);
                entity.setErrorCode(code);
                entity.setErrorMessage(truncate(message, 1000));
                entity.setScore(null);
                entity.setScoreBand("unavailable");
                matchResultRepository.save(entity);
            });
        });
    }

    private byte[] downloadCvPdf(Candidature candidature) {
        String serviceAuth = serviceJwtTokenProvider.createAuthorizationHeader();
        // Exclusive source: candidature.cvId snapshot (not active profile CV).
        return userServiceClient.downloadApplicationCv(
                candidature.getCandidateId(),
                candidature.getCvId(),
                serviceAuth
        );
    }

    private AiProfile buildOfferProfile(Offre offre) {
        List<OffreSkill> skills = offreSkillRepository.findByOffreId(offre.getId());
        List<String> all = new ArrayList<>();
        List<String> required = new ArrayList<>();
        for (OffreSkill skill : skills) {
            if (skill.getName() == null || skill.getName().isBlank()) {
                continue;
            }
            all.add(skill.getName().trim());
            if (skill.isRequired()) {
                required.add(skill.getName().trim());
            }
        }
        Double years = offre.getExperienceYears() != null
                ? offre.getExperienceYears().doubleValue()
                : null;
        return AiProfile.builder()
                .skills(all)
                .requiredSkills(required)
                .experienceYears(years)
                .education(normalizeEducation(offre.getEducationLevel()))
                .title(offre.getTitle())
                .summary(null) // never send full offer description PII-heavy blob by default
                .build();
    }

    private MatchResultResponse toResponse(MatchResult result, Integer rank) {
        Candidature candidature = result.getCandidature();
        return MatchResultResponse.builder()
                .id(result.getId())
                .candidatureId(candidature != null ? candidature.getId() : null)
                .offreId(result.getOffreId())
                .cvId(result.getCvId())
                .candidateId(candidature != null ? candidature.getCandidateId() : null)
                .score(result.getScore())
                .scoreBand(result.getScoreBand())
                .features(readJson(result.getFeaturesJson()))
                .explanations(readStringList(result.getExplanationsJson()))
                .method(result.getMethod())
                .modelVersion(result.getModelVersion())
                .status(result.getStatus())
                .errorCode(result.getErrorCode())
                .errorMessage(result.getErrorMessage())
                .rank(rank)
                .createdAt(result.getCreatedAt())
                .updatedAt(result.getUpdatedAt())
                .build();
    }

    private static boolean isStale(MatchResult result) {
        LocalDateTime updated = result.getUpdatedAt() != null
                ? result.getUpdatedAt()
                : result.getCreatedAt();
        if (updated == null) {
            return true;
        }
        return Duration.between(updated, LocalDateTime.now()).compareTo(PENDING_STALE) > 0;
    }

    private static List<String> nullToEmpty(List<String> values) {
        return values != null ? values : Collections.emptyList();
    }

    private static String normalizeEducation(String education) {
        if (education == null || education.isBlank()) {
            return null;
        }
        String e = education.trim().toLowerCase(Locale.ROOT);
        if (e.contains("phd") || e.contains("doctor")) {
            return "phd";
        }
        if (e.contains("master") || e.contains("ingénieur") || e.contains("ingenieur")
                || e.contains("bac+5") || e.contains("mba")) {
            return "master";
        }
        if (e.contains("bachelor") || e.contains("licence") || e.contains("bac+3")) {
            return "bachelor";
        }
        return e;
    }

    private static BigDecimal toScore(Double score) {
        if (score == null) {
            return null;
        }
        return BigDecimal.valueOf(score).setScale(4, RoundingMode.HALF_UP);
    }

    private String writeJson(Object value) {
        if (value == null) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException ex) {
            return null;
        }
    }

    private Object readJson(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(json, Object.class);
        } catch (JsonProcessingException ex) {
            return json;
        }
    }

    private List<String> readStringList(String json) {
        if (json == null || json.isBlank()) {
            return Collections.emptyList();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (JsonProcessingException ex) {
            return Collections.emptyList();
        }
    }

    private static String truncate(String value, int max) {
        if (value == null) {
            return null;
        }
        return value.length() <= max ? value : value.substring(0, max);
    }

    private static String safeMessage(Throwable ex) {
        String msg = ex.getMessage();
        return msg != null ? truncate(msg, 500) : ex.getClass().getSimpleName();
    }
}
