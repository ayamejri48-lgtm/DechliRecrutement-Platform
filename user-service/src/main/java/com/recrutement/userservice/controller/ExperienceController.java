
package com.recrutement.userservice.controller;

import com.recrutement.userservice.dto.ExperienceRequest;
import com.recrutement.userservice.dto.ExperienceResponse;
import com.recrutement.userservice.service.ExperienceService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/users/experiences")
@RequiredArgsConstructor
public class ExperienceController {

    private final ExperienceService experienceService;

    @PostMapping("/ajouter")
    public ResponseEntity<ExperienceResponse> ajouter(
            @Valid @RequestBody ExperienceRequest request,
            @AuthenticationPrincipal Jwt jwt) {

        return ResponseEntity.status(HttpStatus.CREATED)
                .body(experienceService.ajouter(getCandidateId(jwt), request));
    }

    @GetMapping("/consulter")
    public ResponseEntity<List<ExperienceResponse>> consulter(
            @AuthenticationPrincipal Jwt jwt) {

        return ResponseEntity.ok(
                experienceService.consulter(getCandidateId(jwt)));
    }

    @GetMapping("/consulter/{experienceId}")
    public ResponseEntity<ExperienceResponse> consulterParId(
            @PathVariable Long experienceId,
            @AuthenticationPrincipal Jwt jwt) {

        return ResponseEntity.ok(
                experienceService.consulterParId(
                        getCandidateId(jwt), experienceId));
    }

    @PutMapping("/modifier/{experienceId}")
    public ResponseEntity<ExperienceResponse> modifier(
            @PathVariable Long experienceId,
            @Valid @RequestBody ExperienceRequest request,
            @AuthenticationPrincipal Jwt jwt) {

        return ResponseEntity.ok(
                experienceService.modifier(
                        getCandidateId(jwt), experienceId, request));
    }

    @DeleteMapping("/supprimer/{experienceId}")
    public ResponseEntity<Void> supprimer(
            @PathVariable Long experienceId,
            @AuthenticationPrincipal Jwt jwt) {

        experienceService.supprimer(getCandidateId(jwt), experienceId);
        return ResponseEntity.noContent().build();
    }

    private Long getCandidateId(Jwt jwt) {

        if (jwt == null ||
                !"CANDIDATE".equals(jwt.getClaimAsString("role"))) {
            throw new AccessDeniedException(
                    "Accès réservé aux candidats");
        }

        Number userId = jwt.getClaim("userId");

        if (userId == null) {
            throw new AccessDeniedException(
                    "Identifiant utilisateur absent du JWT");
        }

        return userId.longValue();
    }
}
