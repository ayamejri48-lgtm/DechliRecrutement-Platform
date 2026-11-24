package com.recrutement.offreservice.controller;

import com.recrutement.offreservice.service.CandidatureService;
import com.recrutement.offreservice.service.MatchOrchestrationService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import com.recrutement.offreservice.dto.CandidatureCreateRequest;
import com.recrutement.offreservice.dto.CandidatureResponse;
import com.recrutement.offreservice.dto.MatchResultResponse;
import com.recrutement.offreservice.entity.Candidature;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import com.recrutement.offreservice.dto.CandidatureStatusUpdateRequest;
import org.springframework.web.bind.annotation.RequestParam;

import org.springframework.web.bind.annotation.GetMapping;
import com.recrutement.offreservice.dto.CandidateDossierResponse;
import com.recrutement.offreservice.dto.InternalCvMetadataDto;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import java.util.List;

@RestController
@RequestMapping("/candidatures")
@RequiredArgsConstructor
public class CandidatureController {

    private final CandidatureService candidatureService;
    private final MatchOrchestrationService matchOrchestrationService;

    @PostMapping
    public ResponseEntity<CandidatureResponse> postuler(
            @Valid @RequestBody CandidatureCreateRequest request,
            @AuthenticationPrincipal Jwt jwt) {

        String role = jwt.getClaimAsString("role");

        if (!"CANDIDATE".equals(role)) {
            throw new AccessDeniedException(
                    "Seul un candidat peut postuler");
        }

        Number userIdClaim = jwt.getClaim("userId");

        if (userIdClaim == null) {
            throw new AccessDeniedException(
                    "Identifiant utilisateur absent du JWT");
        }

        Long candidateId = userIdClaim.longValue();

        Candidature candidature =
                candidatureService.postuler(
                        request,
                        candidateId,
                        "Bearer " + jwt.getTokenValue()
                );

        CandidatureResponse response = CandidatureResponse.builder()
                .id(candidature.getId())
                .offreId(request.getOffreId())
                .candidateId(candidature.getCandidateId())
                .cvId(candidature.getCvId())
                .status(candidature.getStatus())
                .appliedAt(candidature.getAppliedAt())
                .updatedAt(candidature.getUpdatedAt())
                .build();

        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @GetMapping("/me")
    public ResponseEntity<List<CandidatureResponse>> getMesCandidatures(
            @AuthenticationPrincipal Jwt jwt) {

        if (!"CANDIDATE".equals(jwt.getClaimAsString("role"))) {
            throw new AccessDeniedException(
                    "Accès réservé aux candidats");
        }

        Number userIdClaim = jwt.getClaim("userId");

        if (userIdClaim == null) {
            throw new AccessDeniedException(
                    "Identifiant utilisateur absent du JWT");
        }

        Long candidateId = userIdClaim.longValue();

        List<CandidatureResponse> responses =
                candidatureService.getCandidaturesByCandidate(candidateId)
                        .stream()
                        .map(c -> CandidatureResponse.builder()
                                .id(c.getId())
                                .offreId(c.getOffre().getId())
                                .offreTitle(c.getOffre().getTitle())
                                .candidateId(c.getCandidateId())
                                .cvId(c.getCvId())
                                .status(c.getStatus())
                                .appliedAt(c.getAppliedAt())
                                .updatedAt(c.getUpdatedAt())
                                .build())
                        .toList();

        return ResponseEntity.ok(responses);
    }

    @PatchMapping("/{id}/withdraw")
    public ResponseEntity<Void> retirerCandidature(
            @PathVariable Long id,
            @AuthenticationPrincipal Jwt jwt) {

        String role = jwt.getClaimAsString("role");

        if (!"CANDIDATE".equals(role)) {
            throw new AccessDeniedException(
                    "Seul un candidat peut retirer une candidature");
        }

        Number userIdClaim = jwt.getClaim("userId");

        if (userIdClaim == null) {
            throw new AccessDeniedException(
                    "Identifiant utilisateur absent du JWT");
        }

        Long candidateId = userIdClaim.longValue();

        candidatureService.retirerCandidature(id, candidateId);

        return ResponseEntity.noContent().build();
    }

    @PatchMapping("/{id}/status")
    public ResponseEntity<Void> modifierStatut(
            @PathVariable Long id,
            @Valid @RequestBody CandidatureStatusUpdateRequest request,
            @AuthenticationPrincipal Jwt jwt) {

        Number userIdClaim = jwt.getClaim("userId");

        if (userIdClaim == null) {
            throw new AccessDeniedException(
                    "Identifiant utilisateur absent du JWT");
        }

        Long userId = userIdClaim.longValue();
        String role = jwt.getClaimAsString("role");

        candidatureService.traiterCandidature(
                id,
                request.getStatus(),
                userId,
                role
        );

        return ResponseEntity.noContent().build();
    }


    /** Catalogue global — ADMIN uniquement (évite N+1 côté FE). */
    @GetMapping("/admin")
    public ResponseEntity<List<CandidatureResponse>> getAllForAdmin(
            @AuthenticationPrincipal Jwt jwt) {

        String role = jwt.getClaimAsString("role");
        var rows = candidatureService.getAllForAdmin(role);
        var briefs = candidatureService.matchBriefs(
                rows.stream().map(c -> c.getId()).toList()
        );
        List<CandidatureResponse> responses = rows.stream()
                .map(c -> {
                    var brief = briefs.get(c.getId());
                    return CandidatureResponse.builder()
                            .id(c.getId())
                            .offreId(c.getOffre().getId())
                            .offreTitle(c.getOffre().getTitle())
                            .candidateId(c.getCandidateId())
                            .cvId(c.getCvId())
                            .status(c.getStatus())
                            .appliedAt(c.getAppliedAt())
                            .updatedAt(c.getUpdatedAt())
                            .matchScore(brief == null ? null : brief.score())
                            .matchBand(brief == null ? null : brief.band())
                            .build();
                })
                .toList();

        return ResponseEntity.ok(responses);
    }

    @GetMapping("/offre/{offreId}")
    public ResponseEntity<List<CandidatureResponse>> getCandidaturesByOffre(
            @PathVariable Long offreId,
            @AuthenticationPrincipal Jwt jwt) {

        Number userIdClaim = jwt.getClaim("userId");

        if (userIdClaim == null) {
            throw new AccessDeniedException(
                    "Identifiant utilisateur absent du JWT");
        }

        Long userId = userIdClaim.longValue();
        String role = jwt.getClaimAsString("role");

        List<Candidature> rows =
                candidatureService.getCandidaturesByOffre(offreId, userId, role);
        var scores = candidatureService.matchBriefs(
                rows.stream().map(Candidature::getId).toList()
        );

        List<CandidatureResponse> responses = rows.stream()
                .map(c -> {
                    var brief = scores.get(c.getId());
                    return CandidatureResponse.builder()
                            .id(c.getId())
                            .offreId(c.getOffre().getId())
                            .offreTitle(c.getOffre().getTitle())
                            .candidateId(c.getCandidateId())
                            .cvId(c.getCvId())
                            .status(c.getStatus())
                            .appliedAt(c.getAppliedAt())
                            .updatedAt(c.getUpdatedAt())
                            .matchScore(brief == null ? null : brief.score())
                            .matchBand(brief == null ? null : brief.band())
                            .build();
                })
                .toList();

        return ResponseEntity.ok(responses);
    }

    /** Dossier professionnel + méta CV snapshot — owner / ADMIN. */
    @GetMapping("/{id}/dossier")
    public ResponseEntity<CandidateDossierResponse> getDossier(
            @PathVariable Long id,
            @AuthenticationPrincipal Jwt jwt) {

        Number userIdClaim = jwt.getClaim("userId");
        if (userIdClaim == null) {
            throw new AccessDeniedException(
                    "Identifiant utilisateur absent du JWT");
        }

        return ResponseEntity.ok(
                candidatureService.getDossier(
                        id,
                        userIdClaim.longValue(),
                        jwt.getClaimAsString("role")
                )
        );
    }

    /** PDF du cvId enregistré sur la candidature — owner / ADMIN. */
    @GetMapping("/{id}/cv")
    public ResponseEntity<byte[]> downloadCv(
            @PathVariable Long id,
            @AuthenticationPrincipal Jwt jwt) {

        Number userIdClaim = jwt.getClaim("userId");
        if (userIdClaim == null) {
            throw new AccessDeniedException(
                    "Identifiant utilisateur absent du JWT");
        }

        Long userId = userIdClaim.longValue();
        String role = jwt.getClaimAsString("role");

        InternalCvMetadataDto meta =
                candidatureService.getApplicationCvMetadata(id, userId, role);
        byte[] pdf = candidatureService.downloadApplicationCv(id, userId, role);

        String fileName = meta.getFileName() != null ? meta.getFileName() : "cv.pdf";
        MediaType contentType = MediaType.APPLICATION_PDF;
        if (meta.getContentType() != null && !meta.getContentType().isBlank()) {
            try {
                contentType = MediaType.parseMediaType(meta.getContentType());
            } catch (Exception ignored) {
                contentType = MediaType.APPLICATION_PDF;
            }
        }

        return ResponseEntity.ok()
                .contentType(contentType)
                .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        "inline; filename=\"" + fileName.replace("\"", "") + "\""
                )
                .body(pdf);
    }

    /**
     * Calcule (ou recalcule) le matching IA à partir du PDF candidature.cvId uniquement.
     * force=false : renvoie le résultat DONE existant sans rappel AI.
     */
    @PostMapping("/{id}/match")
    public ResponseEntity<MatchResultResponse> computeMatch(
            @PathVariable Long id,
            @RequestParam(defaultValue = "false") boolean force,
            @AuthenticationPrincipal Jwt jwt) {

        Number userIdClaim = jwt.getClaim("userId");
        if (userIdClaim == null) {
            throw new AccessDeniedException(
                    "Identifiant utilisateur absent du JWT");
        }

        MatchResultResponse response = matchOrchestrationService.computeMatch(
                id,
                userIdClaim.longValue(),
                jwt.getClaimAsString("role"),
                force
        );
        return ResponseEntity.ok(response);
    }

    /** Consulte le dernier MatchResult persisté pour une candidature. */
    @GetMapping("/{id}/match")
    public ResponseEntity<MatchResultResponse> getMatch(
            @PathVariable Long id,
            @AuthenticationPrincipal Jwt jwt) {

        Number userIdClaim = jwt.getClaim("userId");
        if (userIdClaim == null) {
            throw new AccessDeniedException(
                    "Identifiant utilisateur absent du JWT");
        }

        return ResponseEntity.ok(
                matchOrchestrationService.getMatch(
                        id,
                        userIdClaim.longValue(),
                        jwt.getClaimAsString("role")
                )
        );
    }

}