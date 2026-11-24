package com.recrutement.offreservice.service;

import com.recrutement.offreservice.repository.CandidatureRepository;
import com.recrutement.offreservice.repository.MatchResultRepository;
import com.recrutement.offreservice.repository.TestAssignmentProbe;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import com.recrutement.offreservice.dto.CandidatureCreateRequest;
import com.recrutement.offreservice.entity.Candidature;
import com.recrutement.offreservice.entity.CandidatureStatus;
import com.recrutement.offreservice.entity.MatchResult;
import com.recrutement.offreservice.entity.MatchResultStatus;
import com.recrutement.offreservice.entity.Offre;
import com.recrutement.offreservice.entity.OffreStatus;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import com.recrutement.offreservice.repository.OffreRepository;
import com.recrutement.offreservice.client.UserServiceClient;
import com.recrutement.offreservice.dto.CandidateDossierResponse;
import com.recrutement.offreservice.dto.CvResponse;
import com.recrutement.offreservice.dto.InternalCandidateProfileDto;
import com.recrutement.offreservice.dto.InternalCvMetadataDto;
import com.recrutement.offreservice.event.CandidatureCreatedEvent;
import com.recrutement.offreservice.security.ServiceJwtTokenProvider;
import org.springframework.context.ApplicationEventPublisher;
import com.recrutement.offreservice.event.CandidatureStatusChangedEvent;
import org.springframework.security.access.AccessDeniedException;
import feign.FeignException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class CandidatureService {

    private final CandidatureRepository candidatureRepository;
    private final MatchResultRepository matchResultRepository;
    private final TestAssignmentProbe testAssignmentProbe;
    private final OffreService offreService;
    private final OffreRepository offreRepository;
    private final UserServiceClient userServiceClient;
    private final ApplicationEventPublisher eventPublisher;
    private final ServiceJwtTokenProvider serviceJwtTokenProvider;
    private final PlatformTransactionManager transactionManager;




    @Transactional
    public Candidature postuler(
            CandidatureCreateRequest request,
            Long candidateId,
            String authorization) {



        Offre offre = offreRepository.findByIdForUpdate(request.getOffreId())
                .orElseThrow(() ->
                        new IllegalArgumentException("Offre introuvable"));

        // Vérifier que l'offre accepte les candidatures
        if (offre.getStatus() != OffreStatus.PUBLISHED) {
            throw new IllegalStateException(
                    "Cette offre n'est pas ouverte aux candidatures"
            );
        }

        // Vérifier la date limite
        if (offre.getDeadline() != null
                && offre.getDeadline().isBefore(LocalDate.now())) {
            throw new IllegalStateException(
                    "La date limite de candidature est dépassée"
            );
        }

        // Empêcher les candidatures actives en double
        boolean dejaPostule =
                candidatureRepository.existsByOffreIdAndCandidateIdAndStatusNot(
                        offre.getId(),
                        candidateId,
                        CandidatureStatus.WITHDRAWN
                );

        if (dejaPostule) {
            throw new IllegalStateException(
                    "Vous avez déjà postulé à cette offre"
            );
        }

        List<CvResponse> cvs = userServiceClient.getMyCvs(authorization);

        boolean cvValide = cvs != null && cvs.stream()
                .anyMatch(cv ->
                        request.getCvId() != null
                                && request.getCvId().equals(cv.getId())
                                && Boolean.TRUE.equals(cv.getActive())
                                && Boolean.TRUE.equals(cv.getVisible())
                );

        if (!cvValide) {
            throw new IllegalStateException(
                    "Le CV sélectionné est introuvable, inactif ou non autorisé"
            );
        }

        Candidature candidature = new Candidature();
        candidature.setOffre(offre);
        candidature.setCandidateId(candidateId);
        candidature.setCvId(request.getCvId());
        candidature.setStatus(CandidatureStatus.PENDING);

        Candidature saved = candidatureRepository.save(candidature);

        eventPublisher.publishEvent(new CandidatureCreatedEvent(
                saved.getId(),
                offre.getId(),
                offre.getRecruiterId(),
                candidateId,
                offre.getTitle()
        ));

        return saved;
    }



    // Consulter les candidatures d'un candidat


    // Consulter les candidatures d'un candidat
    @Transactional(readOnly = true)
    public List<Candidature> getCandidaturesByCandidate(Long candidateId) {
        return candidatureRepository.findByCandidateId(candidateId);
    }

    // Retirer sa candidature
    @Transactional
    public void retirerCandidature(Long candidatureId, Long candidateId) {

        Candidature candidature = candidatureRepository.findById(candidatureId)
                .orElseThrow(() ->
                        new IllegalArgumentException("Candidature introuvable"));

        if (!candidature.getCandidateId().equals(candidateId)) {
            throw new org.springframework.security.access.AccessDeniedException(
                    "Vous ne pouvez pas retirer cette candidature");
        }

        if (candidature.getStatus() != CandidatureStatus.PENDING
                && candidature.getStatus() != CandidatureStatus.UNDER_REVIEW) {
            throw new IllegalStateException(
                    "Cette candidature ne peut plus être retirée");
        }

        candidature.setStatus(CandidatureStatus.WITHDRAWN);
    }

    @Transactional(readOnly = true)
    public List<Candidature> getCandidaturesByOffre(
            Long offreId,
            Long userId,
            String role) {

        Offre offre = offreService.getOffreById(offreId);

        boolean isAdmin = "ADMIN".equals(role);
        boolean isOwner = "RECRUITER".equals(role)
                && offre.getRecruiterId().equals(userId);

        if (!isAdmin && !isOwner) {
            throw new org.springframework.security.access.AccessDeniedException(
                    "Vous n'êtes pas autorisé à consulter ces candidatures");
        }

        return candidatureRepository.findByOffreId(offreId);
    }

    /**
     * Supervision ADMIN : toutes les candidatures en une requête (JOIN FETCH offre).
     * N'expose pas ce catalogue aux recruteurs.
     */
    @Transactional(readOnly = true)
    public List<Candidature> getAllForAdmin(String role) {
        if (!"ADMIN".equals(role)) {
            throw new org.springframework.security.access.AccessDeniedException(
                    "Accès réservé aux administrateurs");
        }
        return candidatureRepository.findAllWithOffre();
    }

    /** Score + bande, uniquement si le matching est DONE. Une requête. */
    @Transactional(readOnly = true)
    public Map<Long, MatchBrief> matchBriefs(Collection<Long> candidatureIds) {
        if (candidatureIds == null || candidatureIds.isEmpty()) {
            return Map.of();
        }
        Map<Long, MatchBrief> out = new HashMap<>();
        for (Object[] row : matchResultRepository.findScoreSlices(candidatureIds)) {
            if (!"DONE".equals(String.valueOf(row[3]))) {
                continue;
            }
            out.put((Long) row[0], new MatchBrief((BigDecimal) row[1], (String) row[2]));
        }
        return out;
    }

    public record MatchBrief(BigDecimal score, String band) {
    }

    @Transactional
    public void traiterCandidature(
            Long candidatureId,
            CandidatureStatus nouveauStatut,
            Long userId,
            String role) {

        Candidature candidature = candidatureRepository.findById(candidatureId)
                .orElseThrow(() ->
                        new IllegalArgumentException("Candidature introuvable"));

        Offre offre = candidature.getOffre();

        // Vérifier les permissions
        boolean isAdmin = "ADMIN".equals(role);
        boolean isOwner = "RECRUITER".equals(role)
                && offre.getRecruiterId().equals(userId);

        if (!isAdmin && !isOwner) {
            throw new org.springframework.security.access.AccessDeniedException(
                    "Vous n'êtes pas autorisé à traiter cette candidature");
        }

        // Vérifier le nouveau statut
        if (nouveauStatut != CandidatureStatus.UNDER_REVIEW
                && nouveauStatut != CandidatureStatus.ACCEPTED
                && nouveauStatut != CandidatureStatus.REJECTED) {
            throw new IllegalArgumentException(
                    "Statut de traitement invalide");
        }

        CandidatureStatus ancienStatut = candidature.getStatus();

        if (ancienStatut == CandidatureStatus.WITHDRAWN) {
            throw new IllegalStateException(
                    "Cette candidature ne peut plus être modifiée");
        }

        // Remettre en revue depuis Accepté / Refusé
        boolean reopen =
                nouveauStatut == CandidatureStatus.UNDER_REVIEW
                        && (ancienStatut == CandidatureStatus.ACCEPTED
                        || ancienStatut == CandidatureStatus.REJECTED);

        if ((ancienStatut == CandidatureStatus.ACCEPTED
                || ancienStatut == CandidatureStatus.REJECTED)
                && !reopen) {
            throw new IllegalStateException(
                    "Cette candidature ne peut plus être modifiée");
        }

        if (ancienStatut == nouveauStatut) {
            return;
        }

        if (nouveauStatut == CandidatureStatus.ACCEPTED) {
            int postes = offre.getPostes() != null && offre.getPostes() > 0
                    ? offre.getPostes()
                    : 1;
            long accepted = candidatureRepository.countByOffreIdAndStatus(
                    offre.getId(),
                    CandidatureStatus.ACCEPTED
            );
            if (accepted >= postes) {
                throw new IllegalStateException(
                        "Tous les postes de cette offre sont déjà pourvus ("
                                + postes
                                + "). Impossible d'accepter un candidat de plus."
                );
            }

            if (candidatureRepository.existsByCandidateIdAndStatusAndOffre_RecruiterId(
                    candidature.getCandidateId(),
                    CandidatureStatus.ACCEPTED,
                    offre.getRecruiterId())) {
                throw new IllegalStateException(
                        "Ce candidat a déjà été accepté sur une autre de vos offres."
                );
            }

            MatchResult match = matchResultRepository
                    .findByCandidatureId(candidature.getId())
                    .orElse(null);
            if (match == null
                    || match.getStatus() != MatchResultStatus.DONE
                    || match.getScore() == null) {
                throw new IllegalStateException(
                        "Le matching doit être calculé avant d'accepter ce candidat."
                );
            }

            String testStatus = testAssignmentProbe
                    .latestStatus(candidature.getId())
                    .orElse("");
            if (!"EVALUATED".equals(testStatus) && !"PUBLISHED".equals(testStatus)) {
                throw new IllegalStateException(
                        "Le candidat doit avoir passé le test technique "
                                + "(note disponible) avant d'être accepté."
                );
            }
        }

        candidature.setStatus(nouveauStatut);
        if (nouveauStatut == CandidatureStatus.ACCEPTED
                || nouveauStatut == CandidatureStatus.REJECTED) {
            candidature.setDecidedAt(LocalDateTime.now());
        } else if (reopen) {
            candidature.setDecidedAt(null);
        }

        eventPublisher.publishEvent(new CandidatureStatusChangedEvent(
                candidature.getId(),
                candidature.getCandidateId(),
                offre.getId(),
                offre.getTitle(),
                ancienStatut.name(),
                nouveauStatut.name()
        ));
    }

    /**
     * Dossier candidat pour le recruteur owner : profil User-Service + CV snapshot (cvId candidature).
     * Les appels Feign sont hors transaction pour éviter de bloquer le pool JDBC.
     */
    public CandidateDossierResponse getDossier(
            Long candidatureId,
            Long userId,
            String role) {

        OwnedDossierCore core = loadOwnedCore(candidatureId, userId, role);
        String serviceAuth = serviceJwtTokenProvider.createAuthorizationHeader();

        InternalCandidateProfileDto profile =
                userServiceClient.getCandidateProfile(core.candidateId(), serviceAuth);

        // CV snapshot optionnel : données historiques peuvent être incohérentes
        // (cvId d'un autre candidat). Le profil reste consultable.
        CandidateDossierResponse.CvSnapshotItem cvItem = null;
        try {
            InternalCvMetadataDto cvMeta =
                    userServiceClient.getCvMetadata(
                            core.candidateId(), core.cvId(), serviceAuth);
            cvItem = CandidateDossierResponse.CvSnapshotItem.builder()
                    .id(cvMeta.getId())
                    .fileName(cvMeta.getFileName())
                    .contentType(cvMeta.getContentType())
                    .fileSize(cvMeta.getFileSize())
                    .version(cvMeta.getVersion())
                    .active(cvMeta.getActive())
                    .visible(cvMeta.getVisible())
                    .build();
        } catch (FeignException ex) {
            if (ex.status() != 404) {
                throw ex;
            }
        }

        return CandidateDossierResponse.builder()
                .candidatureId(core.candidatureId())
                .offreId(core.offreId())
                .offreTitle(core.offreTitle())
                .status(core.status())
                .appliedAt(core.appliedAt())
                .candidateId(core.candidateId())
                .firstName(profile.getFirstName())
                .lastName(profile.getLastName())
                .description(profile.getDescription())
                .skills(mapSkills(profile))
                .experiences(mapExperiences(profile))
                .educations(mapEducations(profile))
                .cv(cvItem)
                .build();
    }

    private record OwnedDossierCore(
            Long candidatureId,
            Long offreId,
            String offreTitle,
            CandidatureStatus status,
            LocalDateTime appliedAt,
            Long candidateId,
            Long cvId) {}

    /**
     * PDF du CV enregistré sur la candidature (pas le CV actif actuel).
     * Feign hors transaction (même contrat ownership / snapshot cvId).
     */
    public byte[] downloadApplicationCv(
            Long candidatureId,
            Long userId,
            String role) {

        OwnedDossierCore core = loadOwnedCore(candidatureId, userId, role);
        String serviceAuth = serviceJwtTokenProvider.createAuthorizationHeader();
        return userServiceClient.downloadApplicationCv(
                core.candidateId(),
                core.cvId(),
                serviceAuth
        );
    }

    /** Métadonnées CV snapshot — Feign hors transaction. */
    public InternalCvMetadataDto getApplicationCvMetadata(
            Long candidatureId,
            Long userId,
            String role) {

        OwnedDossierCore core = loadOwnedCore(candidatureId, userId, role);
        String serviceAuth = serviceJwtTokenProvider.createAuthorizationHeader();
        return userServiceClient.getCvMetadata(
                core.candidateId(),
                core.cvId(),
                serviceAuth
        );
    }

    private OwnedDossierCore loadOwnedCore(Long candidatureId, Long userId, String role) {
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        tx.setReadOnly(true);
        OwnedDossierCore core = tx.execute(status -> {
            Candidature candidature = loadOwnedCandidature(candidatureId, userId, role);
            Offre offre = candidature.getOffre();
            return new OwnedDossierCore(
                    candidature.getId(),
                    offre.getId(),
                    offre.getTitle(),
                    candidature.getStatus(),
                    candidature.getAppliedAt(),
                    candidature.getCandidateId(),
                    candidature.getCvId()
            );
        });
        if (core == null) {
            throw new IllegalArgumentException("Candidature introuvable");
        }
        return core;
    }

    /**
     * Accès recruteur owner / ADMIN à une candidature (dossier, CV snapshot, matching).
     */
    @Transactional(readOnly = true)
    public Candidature requireOwnedCandidature(
            Long candidatureId,
            Long userId,
            String role) {
        return loadOwnedCandidature(candidatureId, userId, role);
    }

    private Candidature loadOwnedCandidature(
            Long candidatureId,
            Long userId,
            String role) {

        Candidature candidature = candidatureRepository.findById(candidatureId)
                .orElseThrow(() ->
                        new IllegalArgumentException("Candidature introuvable"));

        Offre offre = candidature.getOffre();
        boolean isAdmin = "ADMIN".equals(role);
        boolean isOwner = "RECRUITER".equals(role)
                && offre.getRecruiterId().equals(userId);

        if (!isAdmin && !isOwner) {
            throw new AccessDeniedException(
                    "Vous n'êtes pas autorisé à consulter ce dossier candidat");
        }
        return candidature;
    }

    private static List<CandidateDossierResponse.CandidateSkillItem> mapSkills(
            InternalCandidateProfileDto profile) {
        if (profile.getSkills() == null) {
            return Collections.emptyList();
        }
        return profile.getSkills().stream()
                .map(s -> CandidateDossierResponse.CandidateSkillItem.builder()
                        .id(s.getId())
                        .name(s.getName())
                        .level(s.getLevel())
                        .build())
                .toList();
    }

    private static List<CandidateDossierResponse.ExperienceItem> mapExperiences(
            InternalCandidateProfileDto profile) {
        if (profile.getExperiences() == null) {
            return Collections.emptyList();
        }
        return profile.getExperiences().stream()
                .map(e -> CandidateDossierResponse.ExperienceItem.builder()
                        .id(e.getId())
                        .jobTitle(e.getJobTitle())
                        .company(e.getCompany())
                        .description(e.getDescription())
                        .startDate(e.getStartDate())
                        .endDate(e.getEndDate())
                        .build())
                .toList();
    }

    private static List<CandidateDossierResponse.EducationItem> mapEducations(
            InternalCandidateProfileDto profile) {
        if (profile.getEducations() == null) {
            return Collections.emptyList();
        }
        return profile.getEducations().stream()
                .map(e -> CandidateDossierResponse.EducationItem.builder()
                        .id(e.getId())
                        .institution(e.getInstitution())
                        .degree(e.getDegree())
                        .fieldOfStudy(e.getFieldOfStudy())
                        .startDate(e.getStartDate())
                        .endDate(e.getEndDate())
                        .build())
                .toList();
    }

}