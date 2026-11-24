
package com.recrutement.userservice.service;

import com.recrutement.userservice.dto.CandidateSkillRequest;
import com.recrutement.userservice.dto.CandidateSkillResponse;
import com.recrutement.userservice.entity.CandidateSkill;
import com.recrutement.userservice.entity.Role;
import com.recrutement.userservice.entity.User;
import com.recrutement.userservice.repository.CandidateSkillRepository;
import com.recrutement.userservice.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.recrutement.userservice.exception.CandidateSkillNotFoundException;


import java.util.List;
import java.util.Locale;

@Service
@RequiredArgsConstructor
public class CandidateSkillService {

    private final CandidateSkillRepository skillRepository;
    private final UserRepository userRepository;

    @Transactional
    public CandidateSkillResponse ajouter(
            Long userId, CandidateSkillRequest request) {

        User user = verifierCandidat(userId);
        String normalizedName = normaliser(request.getName());

        if (skillRepository.existsByUserIdAndNormalizedName(
                userId, normalizedName)) {
            throw new IllegalArgumentException(
                    "Cette compétence existe déjà dans votre profil");
        }

        CandidateSkill skill = CandidateSkill.builder()
                .user(user)
                .name(request.getName().trim())
                .normalizedName(normalizedName)
                .level(request.getLevel())
                .build();

        return toResponse(skillRepository.save(skill));
    }

    @Transactional(readOnly = true)
    public List<CandidateSkillResponse> consulter(Long userId) {
        verifierCandidat(userId);

        return skillRepository.findByUserIdOrderByNameAsc(userId)
                .stream()
                .map(this::toResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    public CandidateSkillResponse consulterParId(
            Long userId, Long skillId) {

        verifierCandidat(userId);
        return toResponse(trouverCompetence(userId, skillId));
    }

    @Transactional
    public CandidateSkillResponse modifier(
            Long userId, Long skillId,
            CandidateSkillRequest request) {

        verifierCandidat(userId);
        CandidateSkill skill = trouverCompetence(userId, skillId);
        String normalizedName = normaliser(request.getName());

        if (!skill.getNormalizedName().equals(normalizedName)
                && skillRepository.existsByUserIdAndNormalizedName(
                userId, normalizedName)) {
            throw new IllegalArgumentException(
                    "Cette compétence existe déjà dans votre profil");
        }

        skill.setName(request.getName().trim());
        skill.setNormalizedName(normalizedName);
        skill.setLevel(request.getLevel());

        return toResponse(skillRepository.save(skill));
    }

    @Transactional
    public void supprimer(Long userId, Long skillId) {
        verifierCandidat(userId);
        CandidateSkill skill = trouverCompetence(userId, skillId);
        skillRepository.delete(skill);
    }

    private User verifierCandidat(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new AccessDeniedException(
                        "Utilisateur non autorisé"));

        if (!Boolean.TRUE.equals(user.getEnabled())
                || user.getRole() != Role.CANDIDATE) {
            throw new AccessDeniedException(
                    "Accès réservé aux candidats actifs");
        }

        return user;
    }

    private CandidateSkill trouverCompetence(
            Long userId, Long skillId) {

        return skillRepository.findByIdAndUserId(skillId, userId)
                .orElseThrow(() -> new CandidateSkillNotFoundException(
                        "Compétence introuvable dans votre profil"));
    }

    private String normaliser(String name) {
        return name.trim()
                .replaceAll("\\s+", " ")
                .toLowerCase(Locale.ROOT);
    }

    private CandidateSkillResponse toResponse(CandidateSkill skill) {
        return CandidateSkillResponse.builder()
                .id(skill.getId())
                .name(skill.getName())
                .level(skill.getLevel())
                .createdAt(skill.getCreatedAt())
                .updatedAt(skill.getUpdatedAt())
                .build();
    }
}
