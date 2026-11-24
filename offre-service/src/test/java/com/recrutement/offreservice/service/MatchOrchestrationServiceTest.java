package com.recrutement.offreservice.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.recrutement.offreservice.client.AiServiceClient;
import com.recrutement.offreservice.client.UserServiceClient;
import com.recrutement.offreservice.dto.MatchResultResponse;
import com.recrutement.offreservice.dto.ai.AiExtractResponse;
import com.recrutement.offreservice.dto.ai.AiMatchResponse;
import com.recrutement.offreservice.entity.Candidature;
import com.recrutement.offreservice.entity.MatchResult;
import com.recrutement.offreservice.entity.MatchResultStatus;
import com.recrutement.offreservice.entity.Offre;
import com.recrutement.offreservice.entity.OffreSkill;
import com.recrutement.offreservice.repository.MatchResultRepository;
import com.recrutement.offreservice.repository.OffreSkillRepository;
import com.recrutement.offreservice.security.ServiceJwtTokenProvider;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MatchOrchestrationServiceTest {

    @Mock private CandidatureService candidatureService;
    @Mock private OffreService offreService;
    @Mock private MatchResultRepository matchResultRepository;
    @Mock private OffreSkillRepository offreSkillRepository;
    @Mock private UserServiceClient userServiceClient;
    @Mock private ServiceJwtTokenProvider serviceJwtTokenProvider;
    @Mock private AiServiceClient aiServiceClient;
    @Mock private PlatformTransactionManager transactionManager;

    private MatchOrchestrationService service;

    private Offre offre;
    private Candidature candidature;

    @BeforeEach
    void setUp() {
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        lenient().when(transactionManager.getTransaction(any()))
                .thenReturn(new SimpleTransactionStatus());

        service = new MatchOrchestrationService(
                candidatureService,
                offreService,
                matchResultRepository,
                offreSkillRepository,
                userServiceClient,
                serviceJwtTokenProvider,
                aiServiceClient,
                new ObjectMapper(),
                tx
        );

        offre = new Offre();
        offre.setId(10L);
        offre.setRecruiterId(7L);
        offre.setTitle("AI Engineer");
        offre.setDescription("Python NLP");
        offre.setExperienceYears(2);
        offre.setEducationLevel("master");

        candidature = new Candidature();
        candidature.setId(100L);
        candidature.setOffre(offre);
        candidature.setCandidateId(55L);
        candidature.setCvId(99L);
    }

    @Test
    void computeMatch_usesCvIdPdfOnly_andPersistsDone() {
        when(candidatureService.requireOwnedCandidature(100L, 7L, "RECRUITER"))
                .thenReturn(candidature);
        when(matchResultRepository.findByCandidatureId(100L)).thenReturn(Optional.empty());
        when(matchResultRepository.save(any(MatchResult.class))).thenAnswer(inv -> {
            MatchResult m = inv.getArgument(0);
            if (m.getId() == null) {
                m.setId(1L);
            }
            return m;
        });
        when(matchResultRepository.findById(1L)).thenAnswer(inv -> {
            MatchResult m = new MatchResult();
            m.setId(1L);
            m.setCandidature(candidature);
            m.setOffreId(10L);
            m.setCvId(99L);
            m.setStatus(MatchResultStatus.PENDING);
            return Optional.of(m);
        });

        when(serviceJwtTokenProvider.createAuthorizationHeader()).thenReturn("Bearer svc");
        when(userServiceClient.downloadApplicationCv(55L, 99L, "Bearer svc"))
                .thenReturn("%PDF-1.4 mock".getBytes());

        OffreSkill required = new OffreSkill();
        required.setName("PyTorch");
        required.setRequired(true);
        OffreSkill optional = new OffreSkill();
        optional.setName("Python");
        optional.setRequired(false);
        when(offreSkillRepository.findByOffreId(10L)).thenReturn(List.of(required, optional));

        AiExtractResponse extract = new AiExtractResponse();
        extract.setSkills(List.of("python", "pytorch"));
        extract.setExperienceYears(3.0);
        extract.setEducation("master");
        when(aiServiceClient.extractCvPdf(any(), anyString())).thenReturn(extract);

        AiMatchResponse match = new AiMatchResponse();
        match.setScore(0.82);
        match.setScoreBand("high");
        match.setMethod("hybrid-baseline-v3");
        match.setModelVersion("hybrid-v3");
        match.setFeatures(Map.of("matchedSkills", List.of("python", "pytorch")));
        match.setExplanations(List.of("ok"));
        when(aiServiceClient.match(any())).thenReturn(match);

        MatchResultResponse response = service.computeMatch(100L, 7L, "RECRUITER", false);

        assertEquals(MatchResultStatus.DONE, response.getStatus());
        assertEquals(new BigDecimal("0.8200"), response.getScore());
        assertEquals(99L, response.getCvId());
        verify(userServiceClient).downloadApplicationCv(eq(55L), eq(99L), anyString());
        verify(userServiceClient, never()).getCandidateProfile(anyLong(), anyString());
    }

    @Test
    void computeMatch_returnsExistingDoneWithoutCallingAi() {
        MatchResult existing = new MatchResult();
        existing.setId(5L);
        existing.setCandidature(candidature);
        existing.setOffreId(10L);
        existing.setCvId(99L);
        existing.setStatus(MatchResultStatus.DONE);
        existing.setScore(new BigDecimal("0.5000"));
        existing.setScoreBand("medium");

        when(candidatureService.requireOwnedCandidature(100L, 7L, "RECRUITER"))
                .thenReturn(candidature);
        when(matchResultRepository.findByCandidatureId(100L)).thenReturn(Optional.of(existing));

        MatchResultResponse response = service.computeMatch(100L, 7L, "RECRUITER", false);

        assertEquals(new BigDecimal("0.5000"), response.getScore());
        verify(aiServiceClient, never()).extractCvPdf(any(), anyString());
        verify(aiServiceClient, never()).match(any());
        verify(userServiceClient, never()).downloadApplicationCv(anyLong(), anyLong(), anyString());
    }

    @Test
    void listMatches_deniesNonOwnerRecruiter() {
        when(offreService.getOffreById(10L)).thenReturn(offre);
        assertThrows(org.springframework.security.access.AccessDeniedException.class,
                () -> service.listMatchesForOffre(10L, 999L, "RECRUITER"));
    }

    @Test
    void computeMatch_rejectsEmptyOffreSkillsWithConflict() {
        when(candidatureService.requireOwnedCandidature(100L, 7L, "RECRUITER"))
                .thenReturn(candidature);
        when(matchResultRepository.findByCandidatureId(100L)).thenReturn(Optional.empty());
        when(offreSkillRepository.findByOffreId(10L)).thenReturn(List.of());

        IllegalStateException ex = assertThrows(
                IllegalStateException.class,
                () -> service.computeMatch(100L, 7L, "RECRUITER", true)
        );
        assertEquals(
                "Matching impossible : ajoutez au moins une compétence structurée à l'offre",
                ex.getMessage()
        );
        verify(aiServiceClient, never()).extractCvPdf(any(), anyString());
        verify(aiServiceClient, never()).match(any());
        verify(matchResultRepository, never()).save(any());
    }

    @Test
    void listMatches_excludesNullSkillsCoverageFromRank() throws Exception {
        when(offreService.getOffreById(10L)).thenReturn(offre);

        MatchResult withSkills = new MatchResult();
        withSkills.setId(1L);
        withSkills.setCandidature(candidature);
        withSkills.setOffreId(10L);
        withSkills.setCvId(99L);
        withSkills.setStatus(MatchResultStatus.DONE);
        withSkills.setScore(new BigDecimal("0.8000"));
        withSkills.setScoreBand("high");
        withSkills.setFeaturesJson("{\"skills_coverage\":1.0}");

        MatchResult emptySkillsHist = new MatchResult();
        emptySkillsHist.setId(2L);
        emptySkillsHist.setCandidature(candidature);
        emptySkillsHist.setOffreId(10L);
        emptySkillsHist.setCvId(99L);
        emptySkillsHist.setStatus(MatchResultStatus.DONE);
        emptySkillsHist.setScore(new BigDecimal("0.7500"));
        emptySkillsHist.setScoreBand("high");
        emptySkillsHist.setFeaturesJson("{\"skills_coverage\":null}");

        when(matchResultRepository.findByOffreIdOrderByScoreDesc(10L))
                .thenReturn(List.of(withSkills, emptySkillsHist));

        var list = service.listMatchesForOffre(10L, 7L, "RECRUITER");
        assertEquals(2, list.size());
        assertEquals(1, list.get(0).getRank());
        assertEquals(null, list.get(1).getRank());
    }
}
