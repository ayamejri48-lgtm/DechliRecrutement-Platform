
package com.recrutement.offreservice.controller;

import com.recrutement.offreservice.dto.AdminOffreStatsResponse;
import com.recrutement.offreservice.dto.MatchResultResponse;
import com.recrutement.offreservice.dto.OffreCreateRequest;
import com.recrutement.offreservice.dto.OffreResponse;
import com.recrutement.offreservice.dto.OffreUpdateRequest;
import com.recrutement.offreservice.entity.ContractType;
import com.recrutement.offreservice.entity.Offre;
import com.recrutement.offreservice.entity.OffreStatus;
import com.recrutement.offreservice.entity.WorkMode;
import com.recrutement.offreservice.service.AdminOffreStatsService;
import com.recrutement.offreservice.service.MatchOrchestrationService;
import com.recrutement.offreservice.service.OffreService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Locale;

@RestController
@RequestMapping("/offres")
@RequiredArgsConstructor
public class OffreController {

    private final OffreService offreService;
    private final MatchOrchestrationService matchOrchestrationService;
    private final AdminOffreStatsService adminOffreStatsService;

    private Long getUserId(Jwt jwt) {
        if (jwt == null) {
            throw new AccessDeniedException("Authentification requise");
        }

        Number userIdClaim = jwt.getClaim("userId");

        if (userIdClaim == null) {
            throw new AccessDeniedException(
                    "Identifiant utilisateur absent du JWT"
            );
        }

        return userIdClaim.longValue();
    }

    private OffreResponse toResponse(Offre offre) {
        return OffreResponse.builder()
                .id(offre.getId())
                .recruiterId(offre.getRecruiterId())
                .title(offre.getTitle())
                .description(offre.getDescription())
                .location(offre.getLocation())
                .contractType(offre.getContractType())
                .workMode(offre.getWorkMode())
                .experienceYears(offre.getExperienceYears())
                .educationLevel(offre.getEducationLevel())
                .deadline(offre.getDeadline())
                .postes(offre.getPostes() != null ? offre.getPostes() : 1)
                .status(offre.getStatus())
                .createdAt(offre.getCreatedAt())
                .updatedAt(offre.getUpdatedAt())
                .build();
    }

    /** Classement des MatchResult persistés pour une offre (owner / ADMIN). */
    @GetMapping("/{id}/matches")
    public ResponseEntity<List<MatchResultResponse>> getMatches(
            @PathVariable Long id,
            @AuthenticationPrincipal Jwt jwt) {

        Long userId = getUserId(jwt);
        String role = jwt.getClaimAsString("role");
        return ResponseEntity.ok(
                matchOrchestrationService.listMatchesForOffre(id, userId, role)
        );
    }

    // Consulter une offre
    @GetMapping("/{id}")
    public ResponseEntity<OffreResponse> getOffreById(
            @PathVariable Long id,
            @AuthenticationPrincipal Jwt jwt) {

        Long userId = getUserId(jwt);
        String role = jwt.getClaimAsString("role");

        Offre offre = offreService.getOffreById(id);

        boolean isAdmin = "ADMIN".equals(role);
        boolean isOwner = "RECRUITER".equals(role)
                && offre.getRecruiterId().equals(userId);
        boolean isPublished =
                offre.getStatus() == OffreStatus.PUBLISHED;

        if (!isAdmin && !isOwner && !isPublished) {
            throw new AccessDeniedException(
                    "Vous n'êtes pas autorisé à consulter cette offre"
            );
        }

        return ResponseEntity.ok(toResponse(offre));
    }

    // Consulter les offres visibles
    @GetMapping
    public ResponseEntity<List<OffreResponse>> getAllOffres(
            @AuthenticationPrincipal Jwt jwt) {

        Long userId = getUserId(jwt);
        String role = jwt.getClaimAsString("role");

        List<OffreResponse> responses = offreService
                .getVisibleOffres(userId, role)
                .stream()
                .map(this::toResponse)
                .toList();

        return ResponseEntity.ok(responses);
    }

    /**
     * Brouillons sans compétence structurée.
     * Une requête SQL, ids seulement — le front a déjà les titres.
     */
    @GetMapping("/admin/stats")
    public ResponseEntity<AdminOffreStatsResponse> adminStats(
            @AuthenticationPrincipal Jwt jwt) {
        String role = jwt == null ? null : jwt.getClaimAsString("role");
        return ResponseEntity.ok(adminOffreStatsService.stats(role));
    }

    @GetMapping("/admin/drafts-without-skills")
    public ResponseEntity<List<Long>> draftsWithoutSkills(
            @AuthenticationPrincipal Jwt jwt) {
        String role = jwt == null ? null : jwt.getClaimAsString("role");
        return ResponseEntity.ok(offreService.draftIdsWithoutSkills(role));
    }

    /**
     * Offres du recruteur connecté (tous statuts).
     * N'expose pas les offres des autres recruteurs.
     * ADMIN : catalogue complet (support).
     * Ne modifie pas le contrat de GET /offres.
     */
    @GetMapping("/mine")
    public ResponseEntity<List<OffreResponse>> getMyOffres(
            @AuthenticationPrincipal Jwt jwt) {

        Long userId = getUserId(jwt);
        String role = jwt.getClaimAsString("role");

        if (!"RECRUITER".equals(role) && !"ADMIN".equals(role)) {
            throw new AccessDeniedException(
                    "Accès réservé aux recruteurs"
            );
        }

        List<Offre> offres = "ADMIN".equals(role)
                ? offreService.getAllOffres()
                : offreService.getOffresByRecruiter(userId);

        List<OffreResponse> responses = offres.stream()
                .map(this::toResponse)
                .toList();

        return ResponseEntity.ok(responses);
    }

    // Créer une offre
    @PostMapping
    public ResponseEntity<OffreResponse> createOffre(
            @Valid @RequestBody OffreCreateRequest request,
            @AuthenticationPrincipal Jwt jwt) {

        Long recruiterId = getUserId(jwt);

        Offre offre = offreService.createOffre(
                request, recruiterId
        );

        return ResponseEntity
                .status(HttpStatus.CREATED)
                .body(toResponse(offre));
    }

    // Modifier une offre
    @PutMapping("/{id}")
    public ResponseEntity<OffreResponse> updateOffre(
            @PathVariable Long id,
            @Valid @RequestBody OffreUpdateRequest request,
            @AuthenticationPrincipal Jwt jwt) {

        Long userId = getUserId(jwt);
        String role = jwt.getClaimAsString("role");

        Offre offre = offreService.updateOffre(
                id, request, userId, role
        );

        return ResponseEntity.ok(toResponse(offre));
    }

    // Supprimer une offre
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteOffre(
            @PathVariable Long id,
            @AuthenticationPrincipal Jwt jwt) {

        Long userId = getUserId(jwt);
        String role = jwt.getClaimAsString("role");

        offreService.deleteOffre(id, userId, role);

        return ResponseEntity.noContent().build();
    }

    // Publier une offre
    @PatchMapping("/{id}/publish")
    public ResponseEntity<OffreResponse> publishOffre(
            @PathVariable Long id,
            @AuthenticationPrincipal Jwt jwt) {

        Long userId = getUserId(jwt);
        String role = jwt.getClaimAsString("role");

        Offre offre = offreService.publishOffre(
                id, userId, role
        );

        return ResponseEntity.ok(toResponse(offre));
    }

    // Clôturer une offre
    @PatchMapping("/{id}/close")
    public ResponseEntity<OffreResponse> closeOffre(
            @PathVariable Long id,
            @AuthenticationPrincipal Jwt jwt) {

        Long userId = getUserId(jwt);
        String role = jwt.getClaimAsString("role");

        Offre offre = offreService.closeOffre(
                id, userId, role
        );

        return ResponseEntity.ok(toResponse(offre));
    }

    // Recherche multicritère avec pagination et tri
    @GetMapping("/search")
    public ResponseEntity<Page<OffreResponse>> searchOffres(
            @RequestParam(required = false) String title,
            @RequestParam(required = false) String location,
            @RequestParam(required = false) ContractType contractType,
            @RequestParam(required = false) WorkMode workMode,
            @RequestParam(required = false) Integer maxExperience,
            @RequestParam(required = false) String educationLevel,
            @RequestParam(required = false) OffreStatus status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size,
            @RequestParam(defaultValue = "recent") String sort,
            @AuthenticationPrincipal Jwt jwt) {

        if (page < 0 || size < 1 || size > 100) {
            throw new IllegalArgumentException(
                    "Pagination invalide : page >= 0 et size entre 1 et 100"
            );
        }

        Long userId = getUserId(jwt);
        String role = jwt.getClaimAsString("role");

        String sortValue = sort == null
                ? "recent"
                : sort.trim().toLowerCase(Locale.ROOT);

        // recent/oldest : updatedAt (publication / dernière maj), pas createdAt
        // (sinon une offre brouillon ancienne puis publiée reste « vieille »).
        Sort sorting = switch (sortValue) {
            case "recent" -> Sort.by(
                    Sort.Order.desc("updatedAt"),
                    Sort.Order.desc("createdAt"),
                    Sort.Order.desc("id")
            );
            case "oldest" -> Sort.by(
                    Sort.Order.asc("updatedAt"),
                    Sort.Order.asc("createdAt"),
                    Sort.Order.asc("id")
            );
            case "title" -> Sort.by(
                    Sort.Order.asc("title").ignoreCase(),
                    Sort.Order.asc("id")
            );
            default -> throw new IllegalArgumentException(
                    "Tri invalide : valeurs autorisées recent, oldest, title"
            );
        };

        Pageable pageable = PageRequest.of(
                page,
                size,
                sorting
        );

        Page<OffreResponse> result = offreService.rechercherOffres(
                userId,
                role,
                title,
                location,
                contractType,
                workMode,
                maxExperience,
                educationLevel,
                status,
                pageable
        ).map(this::toResponse);

        return ResponseEntity.ok(result);
    }
}
