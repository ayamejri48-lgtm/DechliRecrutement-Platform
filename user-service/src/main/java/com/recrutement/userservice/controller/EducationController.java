
package com.recrutement.userservice.controller;

import com.recrutement.userservice.dto.EducationRequest;
import com.recrutement.userservice.dto.EducationResponse;
import com.recrutement.userservice.service.EducationService;

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
@RequestMapping("/users/educations")
@RequiredArgsConstructor
public class EducationController {

    private final EducationService educationService;

    // CREATE
    @PostMapping("/ajouter")
    public ResponseEntity<EducationResponse> ajouter(
            @Valid @RequestBody EducationRequest request,
            @AuthenticationPrincipal Jwt jwt) {

        return ResponseEntity.status(HttpStatus.CREATED)
                .body(educationService.ajouter(getCandidateId(jwt), request));
    }

    // READ ALL
    @GetMapping("/consulter")
    public ResponseEntity<List<EducationResponse>> consulter(
            @AuthenticationPrincipal Jwt jwt) {

        return ResponseEntity.ok(
                educationService.consulter(getCandidateId(jwt)));
    }

    // READ BY ID
    @GetMapping("/consulter/{educationId}")
    public ResponseEntity<EducationResponse> consulterParId(
            @PathVariable Long educationId,
            @AuthenticationPrincipal Jwt jwt) {

        return ResponseEntity.ok(
                educationService.consulterParId(
                        getCandidateId(jwt), educationId));
    }

    // UPDATE
    @PutMapping("/modifier/{educationId}")
    public ResponseEntity<EducationResponse> modifier(
            @PathVariable Long educationId,
            @Valid @RequestBody EducationRequest request,
            @AuthenticationPrincipal Jwt jwt) {

        return ResponseEntity.ok(
                educationService.modifier(
                        getCandidateId(jwt), educationId, request));
    }

    // DELETE
    @DeleteMapping("/supprimer/{educationId}")
    public ResponseEntity<Void> supprimer(
            @PathVariable Long educationId,
            @AuthenticationPrincipal Jwt jwt) {

        educationService.supprimer(getCandidateId(jwt), educationId);

        return ResponseEntity.noContent().build();
    }

    // Récupération sécurisée de l'identifiant candidat
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
