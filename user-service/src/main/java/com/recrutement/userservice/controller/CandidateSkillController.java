
package com.recrutement.userservice.controller;

import com.recrutement.userservice.dto.CandidateSkillRequest;
import com.recrutement.userservice.dto.CandidateSkillResponse;
import com.recrutement.userservice.service.CandidateSkillService;
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
@RequestMapping("/users/skills")
@RequiredArgsConstructor
public class CandidateSkillController {

    private final CandidateSkillService skillService;

    @PostMapping("/ajouter")
    public ResponseEntity<CandidateSkillResponse> ajouter(
            @Valid @RequestBody CandidateSkillRequest request,
            @AuthenticationPrincipal Jwt jwt) {

        return ResponseEntity.status(HttpStatus.CREATED)
                .body(skillService.ajouter(getCandidateId(jwt), request));
    }

    @GetMapping("/consulter")
    public ResponseEntity<List<CandidateSkillResponse>> consulter(
            @AuthenticationPrincipal Jwt jwt) {

        return ResponseEntity.ok(
                skillService.consulter(getCandidateId(jwt)));
    }

    @GetMapping("/consulter/{skillId}")
    public ResponseEntity<CandidateSkillResponse> consulterParId(
            @PathVariable Long skillId,
            @AuthenticationPrincipal Jwt jwt) {

        return ResponseEntity.ok(
                skillService.consulterParId(getCandidateId(jwt), skillId));
    }

    @PutMapping("/modifier/{skillId}")
    public ResponseEntity<CandidateSkillResponse> modifier(
            @PathVariable Long skillId,
            @Valid @RequestBody CandidateSkillRequest request,
            @AuthenticationPrincipal Jwt jwt) {

        return ResponseEntity.ok(
                skillService.modifier(getCandidateId(jwt), skillId, request));
    }

    @DeleteMapping("/supprimer/{skillId}")
    public ResponseEntity<Void> supprimer(
            @PathVariable Long skillId,
            @AuthenticationPrincipal Jwt jwt) {

        skillService.supprimer(getCandidateId(jwt), skillId);
        return ResponseEntity.noContent().build();
    }

    private Long getCandidateId(Jwt jwt) {
        if (jwt == null ||
                !"CANDIDATE".equals(jwt.getClaimAsString("role"))) {
            throw new AccessDeniedException("Accès réservé aux candidats");
        }

        Number userId = jwt.getClaim("userId");

        if (userId == null) {
            throw new AccessDeniedException(
                    "Identifiant utilisateur absent du JWT");
        }

        return userId.longValue();
    }
}
